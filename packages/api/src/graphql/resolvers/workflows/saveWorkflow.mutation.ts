/**
 * saveWorkflow — create/update a canonical workflow (THINK-218).
 *
 * The single authoring write for the unified Workflows section: validates the
 * definition document with the ThinkWork validator (errors return as
 * {stepId, field, reason} — R4's GraphQL surface, never a throw), publishes a
 * new active version on definition change, and syncs the trigger binding
 * (schedule → scheduled_jobs via job-schedule-manager; webhook → a webhooks
 * row whose token is returned; manual → both disabled).
 */
import { randomBytes } from "node:crypto";
import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import {
  validateWorkflowDefinition,
  WORKFLOW_INTERPRETER_SOURCE_KIND,
  type DefinitionValidationError,
  type WorkflowDefinition,
} from "@thinkwork/agent-loops-core";
import { findMemoryProcessorForWorkflow } from "@thinkwork/database-pg";
import {
  webhooks as webhooksTable,
  workflowVersions,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { syncWorkflowScheduleBinding } from "../../../lib/workflows/schedule-binding.js";

type SaveWorkflowArgs = {
  input: {
    id?: string | null;
    name?: string | null;
    description?: string | null;
    definition?: unknown;
    trigger?: {
      family: string;
      schedule?: {
        scheduleExpression: string;
        timezone?: string | null;
        enabled?: boolean | null;
      } | null;
    } | null;
    enabled?: boolean | null;
  };
};

const TRIGGER_FAMILIES = new Set(["manual", "schedule", "webhook"]);

export async function saveWorkflow(
  _parent: unknown,
  args: SaveWorkflowArgs,
  ctx: GraphQLContext,
  deps: { db?: typeof defaultDb } = {},
): Promise<unknown> {
  const db = deps.db ?? defaultDb;
  const input = args.input;

  // ---- Definition validation first: ThinkWork-terms errors, no throw ------
  let definition: WorkflowDefinition | undefined;
  if (input.definition !== undefined && input.definition !== null) {
    const parsed =
      typeof input.definition === "string"
        ? safeParse(input.definition)
        : input.definition;
    const result = validateWorkflowDefinition(parsed);
    if (!result.ok) {
      return {
        workflow: null,
        errors: result.errors.map(shapeError),
        webhookToken: null,
      };
    }
    definition = result.definition;
  }

  const trigger = input.trigger ?? null;
  if (trigger && !TRIGGER_FAMILIES.has(trigger.family)) {
    return {
      workflow: null,
      errors: [
        {
          stepId: null,
          field: "trigger.family",
          reason: `trigger family must be one of ${[...TRIGGER_FAMILIES].join(", ")}`,
        },
      ],
      webhookToken: null,
    };
  }
  if (trigger?.family === "schedule" && !trigger.schedule?.scheduleExpression) {
    return {
      workflow: null,
      errors: [
        {
          stepId: null,
          field: "trigger.schedule.scheduleExpression",
          reason: "a schedule trigger requires a scheduleExpression",
        },
      ],
      webhookToken: null,
    };
  }

  // ---- Load-or-create the workflow row -------------------------------------
  let workflowId = input.id?.trim() || null;
  let tenantId: string;
  if (workflowId) {
    const [existing] = await db
      .select({
        id: workflowsTable.id,
        tenant_id: workflowsTable.tenant_id,
        name: workflowsTable.name,
        current_version_number: workflowsTable.current_version_number,
      })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);
    if (!existing) {
      throw new GraphQLError("Workflow not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    tenantId = existing.tenant_id;
    await requireTenantAdmin(ctx, tenantId, db);

    // THINK-193 U3: blueprint-managed memory workflows are platform-owned.
    // Personal automations are edited only through their owner-only
    // mutations (setPersonalMemoryAutomationSchedule etc.); shared memory
    // workflows accept operator metadata/trigger edits here but their
    // DEFINITION always comes from the code-owned blueprint.
    const memoryProcessor = await findMemoryProcessorForWorkflow(db, {
      tenantId,
      workflowId,
    });
    if (memoryProcessor?.mode === "personal") {
      throw new GraphQLError(
        "This is a platform-managed personal memory automation — configure it from the Automations page, not the workflow editor",
        { extensions: { code: "FORBIDDEN" } },
      );
    }
    if (memoryProcessor && definition) {
      return {
        workflow: null,
        errors: [
          {
            stepId: null,
            field: "definition",
            reason:
              "memory workflow definitions are platform-managed by blueprint — edit sources, schedule, and grants instead",
          },
        ],
        webhookToken: null,
      };
    }

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (input.name != null) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.enabled != null) {
      patch.lifecycle_status = input.enabled ? "active" : "paused";
    }
    if (trigger) patch.primary_trigger_family = trigger.family;
    await db
      .update(workflowsTable)
      .set(patch)
      .where(eq(workflowsTable.id, workflowId));
  } else {
    const name = input.name?.trim();
    if (!name) {
      throw new GraphQLError("A workflow name is required to create one", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    if (!definition) {
      throw new GraphQLError(
        "A workflow definition is required to create one",
        { extensions: { code: "BAD_USER_INPUT" } },
      );
    }
    const resolvedTenantId = await resolveCallerTenantId(ctx);
    if (!resolvedTenantId) {
      throw new GraphQLError("Caller has no tenant", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    tenantId = resolvedTenantId;
    await requireTenantAdmin(ctx, tenantId, db);
    const [created] = await db
      .insert(workflowsTable)
      .values({
        tenant_id: tenantId,
        name,
        slug: slugify(name),
        description: input.description ?? null,
        lifecycle_status: input.enabled === false ? "paused" : "active",
        primary_trigger_family: trigger?.family ?? "manual",
      })
      .returning({ id: workflowsTable.id });
    workflowId = created.id;
  }

  // ---- Publish a new version when the definition changed -------------------
  if (definition) {
    const [current] = await db
      .select({
        id: workflowVersions.id,
        version_number: workflowVersions.version_number,
        definition_snapshot: workflowVersions.definition_snapshot,
      })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflow_id, workflowId),
          eq(workflowVersions.version_status, "active"),
        ),
      )
      .limit(1);
    const unchanged =
      current &&
      JSON.stringify(current.definition_snapshot) ===
        JSON.stringify(definition);
    if (!unchanged) {
      if (current) {
        await db
          .update(workflowVersions)
          .set({ version_status: "superseded" })
          .where(eq(workflowVersions.id, current.id));
      }
      const nextNumber = (current?.version_number ?? 0) + 1;
      const [version] = await db
        .insert(workflowVersions)
        .values({
          tenant_id: tenantId,
          workflow_id: workflowId,
          version_number: nextNumber,
          version_status: "active",
          source_kind: WORKFLOW_INTERPRETER_SOURCE_KIND,
          definition_snapshot: definition as unknown as Record<string, unknown>,
          published_at: new Date(),
        })
        .returning({ id: workflowVersions.id });
      await db
        .update(workflowsTable)
        .set({
          current_version_id: version.id,
          current_version_number: nextNumber,
          readiness_state: "ready",
          updated_at: new Date(),
        })
        .where(eq(workflowsTable.id, workflowId));
    }
  }

  // ---- Trigger bindings -----------------------------------------------------
  let webhookToken: string | null = null;
  if (trigger) {
    const [workflowRow] = await db
      .select({ name: workflowsTable.name })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId))
      .limit(1);
    await syncWorkflowScheduleBinding({
      tenantId,
      workflowId,
      name: workflowRow?.name ?? "Workflow",
      schedule:
        trigger.family === "schedule" && trigger.schedule
          ? {
              scheduleExpression: trigger.schedule.scheduleExpression,
              timezone: trigger.schedule.timezone ?? null,
              enabled: trigger.schedule.enabled ?? true,
            }
          : null,
      actorId: ctx.auth.principalId ?? null,
    });
    webhookToken = await syncWebhookBinding(db, {
      tenantId,
      workflowId,
      name: workflowRow?.name ?? "Workflow",
      wanted: trigger.family === "webhook",
      actorId: ctx.auth.principalId ?? null,
    });
  }

  const [row] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  return { workflow: snakeToCamel(row), errors: [], webhookToken };
}

async function syncWebhookBinding(
  db: typeof defaultDb,
  input: {
    tenantId: string;
    workflowId: string;
    name: string;
    wanted: boolean;
    actorId: string | null;
  },
): Promise<string | null> {
  const [existing] = await db
    .select({
      id: webhooksTable.id,
      token: webhooksTable.token,
      enabled: webhooksTable.enabled,
    })
    .from(webhooksTable)
    .where(
      and(
        eq(webhooksTable.tenant_id, input.tenantId),
        eq(webhooksTable.workflow_id, input.workflowId),
        eq(webhooksTable.target_type, "workflow"),
      ),
    )
    .limit(1);

  if (!input.wanted) {
    if (existing && existing.enabled) {
      await db
        .update(webhooksTable)
        .set({ enabled: false, updated_at: new Date() })
        .where(eq(webhooksTable.id, existing.id));
    }
    return null;
  }

  if (existing) {
    if (!existing.enabled) {
      await db
        .update(webhooksTable)
        .set({ enabled: true, updated_at: new Date() })
        .where(eq(webhooksTable.id, existing.id));
    }
    return existing.token;
  }

  const token = randomBytes(32).toString("base64url");
  await db.insert(webhooksTable).values({
    tenant_id: input.tenantId,
    name: input.name,
    token,
    target_type: "workflow",
    workflow_id: input.workflowId,
    enabled: true,
    created_by_type: input.actorId ? "user" : "system",
    created_by_id: input.actorId,
  });
  return token;
}

function shapeError(error: DefinitionValidationError) {
  return { stepId: error.stepId, field: error.field, reason: error.reason };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value; // validator reports "definition must be a JSON object"
  }
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "workflow"}-${randomBytes(3).toString("hex")}`;
}
