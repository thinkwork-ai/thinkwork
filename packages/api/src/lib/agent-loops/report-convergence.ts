/**
 * Save-time convergence for report automations (THINK-227 U13).
 *
 * THINK-216 shipped automation→workflow convergence as a one-time migration
 * script, so nothing `saveAgentLoop` creates ever reaches the interpreter —
 * and the deliver step (U4/U5) exists ONLY on the interpreter path. This
 * module closes that gap for the report shape: an agent_thread automation
 * carrying a document binding is born converged. Saving it upserts the linked
 * canonical workflow (keyed on `workflows.source_agent_loop_id`), publishes a
 * definition from `workflowDefinitionFromAgentLoopVersion`, and syncs the
 * schedule as a `workflow_schedule` trigger — one automation, one schedule,
 * one runner.
 *
 * Automations WITHOUT the report shape keep the legacy path untouched; the
 * migration script remains the bulk convergence path for existing loops.
 */
import { and, desc, eq } from "drizzle-orm";
import { workflowVersions, workflows } from "@thinkwork/database-pg/schema";
import {
  resolveDispatchableVersion,
  workflowDefinitionFromAgentLoopVersion,
  WORKFLOW_INTERPRETER_SOURCE_KIND,
  type TargetSpec,
  type WorkflowDefinition,
} from "@thinkwork/agent-loops-core";
import { db } from "../../graphql/utils.js";
import { syncWorkflowScheduleBinding } from "../workflows/schedule-binding.js";
import type { AgentLoopScheduleSpec } from "./schedule-binding.js";

/** The report shape: an agent-turn automation that maintains a document. */
export function isReportAutomation(
  targetSpec: TargetSpec | null | undefined,
): boolean {
  return (
    targetSpec?.kind === "agent_thread" && targetSpec.documentBinding != null
  );
}

export interface SyncReportConvergenceInput {
  tenantId: string;
  loop: {
    id: string;
    name: string;
    description?: string | null;
    ownerUserId: string | null;
    ownerAgentId: string | null;
  };
  /** The just-saved active version's spec columns (already normalized). */
  version: {
    id: string;
    routineActionsSpec: unknown;
    targetSpec: TargetSpec;
  };
  triggerSpec: AgentLoopScheduleSpec;
  loopEnabled: boolean;
  actorId?: string | null;
}

export interface SyncReportConvergenceResult {
  workflowId: string;
  workflowVersionId: string | null;
  /** True when a new definition version was published this save. */
  published: boolean;
}

/**
 * Upsert + publish + schedule-sync for a report automation. Returns null when
 * the target spec is not report-shaped (caller falls back to the legacy
 * schedule binding). EventBridge provisioning failures throw — the save
 * surfaces them synchronously, mirroring the legacy binding's contract.
 */
export async function syncReportAutomationConvergence(
  input: SyncReportConvergenceInput,
): Promise<SyncReportConvergenceResult | null> {
  if (!isReportAutomation(input.version.targetSpec)) return null;

  const definition = workflowDefinitionFromAgentLoopVersion(
    resolveDispatchableVersion({
      id: input.version.id,
      version_status: "active",
      routine_actions_spec: input.version.routineActionsSpec,
      target_spec: input.version.targetSpec,
    }),
  );

  const workflowId = await upsertLinkedWorkflow(input);
  const { versionId, published } = await publishDefinitionIfChanged(
    input.tenantId,
    workflowId,
    definition,
  );

  await syncWorkflowScheduleBinding({
    tenantId: input.tenantId,
    workflowId,
    name: input.loop.name,
    description: input.loop.description ?? null,
    schedule:
      input.triggerSpec.family === "schedule"
        ? {
            scheduleExpression: readString(
              input.triggerSpec.config.scheduleExpression,
            ),
            timezone: readString(input.triggerSpec.config.timezone) || "UTC",
            enabled: input.loopEnabled && input.triggerSpec.enabled !== false,
          }
        : null,
    actorId: input.actorId ?? null,
  });

  return { workflowId, workflowVersionId: versionId, published };
}

async function upsertLinkedWorkflow(
  input: SyncReportConvergenceInput,
): Promise<string> {
  const ownership = {
    // A Workflow projected from an Automation is never tenant-shared. If a
    // malformed legacy row has no owner, private + ownerless fails closed at
    // trigger time instead of becoming callable by the tenant.
    visibility: "agent_private",
    owner_user_id: input.loop.ownerUserId,
    owner_agent_id: input.loop.ownerAgentId,
  };
  const [existing] = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(
      and(
        eq(workflows.tenant_id, input.tenantId),
        eq(workflows.source_agent_loop_id, input.loop.id),
      ),
    )
    .limit(1);
  if (existing) {
    // Ownership is an execution boundary, not display metadata. Reassert it
    // on every save so old tenant-shared projections heal even before the
    // database backfill reaches them.
    await db
      .update(workflows)
      .set({
        ...(existing.name !== input.loop.name ? { name: input.loop.name } : {}),
        ...ownership,
        updated_at: new Date(),
      })
      .where(eq(workflows.id, existing.id));
    return existing.id;
  }

  const [workflow] = await db
    .insert(workflows)
    .values({
      tenant_id: input.tenantId,
      name: input.loop.name,
      slug: `automation-${input.loop.id.slice(0, 8)}`,
      description:
        input.loop.description ??
        "Report automation (converged at save, THINK-227).",
      lifecycle_status: "active",
      ...ownership,
      readiness_state: "ready",
      primary_trigger_family: workflowTriggerFamily(input.triggerSpec.family),
      source_agent_loop_id: input.loop.id,
    })
    .returning({ id: workflows.id });
  return workflow.id;
}

async function publishDefinitionIfChanged(
  tenantId: string,
  workflowId: string,
  definition: WorkflowDefinition,
): Promise<{ versionId: string | null; published: boolean }> {
  const [current] = await db
    .select({
      id: workflowVersions.id,
      version_number: workflowVersions.version_number,
      definition_snapshot: workflowVersions.definition_snapshot,
    })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.tenant_id, tenantId),
        eq(workflowVersions.workflow_id, workflowId),
        eq(workflowVersions.version_status, "active"),
      ),
    )
    .orderBy(desc(workflowVersions.version_number))
    .limit(1);

  if (
    current &&
    stableJson(current.definition_snapshot) === stableJson(definition)
  ) {
    return { versionId: current.id, published: false };
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

  if (current) {
    await db
      .update(workflowVersions)
      .set({ version_status: "superseded" })
      .where(eq(workflowVersions.id, current.id));
  }

  await db
    .update(workflows)
    .set({
      current_version_id: version.id,
      current_version_number: nextNumber,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, workflowId));

  return { versionId: version.id, published: true };
}

/** workflows.primary_trigger_family check constraint allows
 * manual|schedule|webhook|crm|n8n|api|agent|child_workflow; agent_loops
 * families map 1:1 except app_event → manual (same rule as the THINK-216
 * migration). */
function workflowTriggerFamily(family: string | null | undefined): string {
  if (!family) return "manual";
  return ["manual", "schedule", "webhook", "api", "n8n"].includes(family)
    ? family
    : "manual";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
