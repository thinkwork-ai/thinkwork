import { GraphQLError } from "graphql";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  crmWorkLinks,
  goals,
  pluginComponents,
  pluginInstalls,
  tenantMcpServers,
  threads,
  userPluginActivations,
} from "@thinkwork/database-pg/schema";

import type { GraphQLContext } from "../../context.js";
import { db, threadToCamel, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { toGraphqlLinkedTask } from "../linked-tasks/shared.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import {
  CustomerOnboardingWorkflowError,
  startCustomerOnboardingWorkflow,
} from "../../../lib/spaces/customer-onboarding-workflow.js";

const PROVIDER = "twenty";
const OBJECT_TYPE = "opportunity";
const WORKFLOW_KEY = "customer_onboarding";
const DEFAULT_OUTCOME_KEY = "default";

interface StartTwentyCustomerOnboardingArgs {
  input: {
    tenantId: string;
    spaceId?: string | null;
    opportunityId: string;
    opportunityUrl?: string | null;
    opportunityName?: string | null;
    companyName?: string | null;
    outcomeKey?: string | null;
    startSeparateOutcome?: boolean | null;
    recordSnapshot?: Record<string, unknown> | string | null;
  };
}

interface TwentyPluginReadiness {
  pluginInstallId: string;
  mcpServerId: string | null;
  activationId: string | null;
}

export async function startTwentyCustomerOnboarding(
  _parent: unknown,
  args: StartTwentyCustomerOnboardingArgs,
  ctx: GraphQLContext,
) {
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, args.input.tenantId);
  }
  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId) {
    throw new GraphQLError("User identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const outcomeKey = normalizeOutcomeKey(args.input.outcomeKey);
  if (outcomeKey !== DEFAULT_OUTCOME_KEY && !args.input.startSeparateOutcome) {
    throw new GraphQLError(
      "Separate onboarding outcome requires confirmation",
      {
        extensions: { code: "BAD_USER_INPUT" },
      },
    );
  }

  const existing = await findActiveLink({
    tenantId: args.input.tenantId,
    opportunityId: args.input.opportunityId,
    outcomeKey,
  });
  if (existing) {
    const readiness = await resolveTwentyPluginReadiness({
      tenantId: args.input.tenantId,
      userId: caller.userId,
      requireActivation: false,
    });
    const [updated] = await db
      .update(crmWorkLinks)
      .set({ last_resumed_at: new Date(), updated_at: new Date() })
      .where(eq(crmWorkLinks.id, existing.id))
      .returning();
    const thread = await getThreadOrThrow(existing.thread_id);
    return {
      action: "RESUMED",
      thread,
      threadId: existing.thread_id,
      goalId: existing.goal_id,
      idempotent: true,
      missingFields: [],
      linkedTasks: [],
      link: toGraphqlCrmWorkLink(updated ?? existing),
      pluginActivationRequired: !readiness?.activationId,
      statusWritebackState: toGraphqlEnum(
        existing.last_writeback_state ?? "pending",
      ),
    };
  }

  const readiness = await resolveTwentyPluginReadiness({
    tenantId: args.input.tenantId,
    userId: caller.userId,
    requireActivation: true,
  });
  if (!readiness) {
    throw new GraphQLError("Twenty plugin activation is required", {
      extensions: { code: "PLUGIN_ACTIVATION_REQUIRED", pluginKey: PROVIDER },
    });
  }
  if (args.input.spaceId) {
    await requireSpaceAccess(ctx, args.input.tenantId, args.input.spaceId);
  }

  const opportunity = buildOpportunityInput(args.input);
  try {
    const result = await startCustomerOnboardingWorkflow({
      tenantId: args.input.tenantId,
      spaceId: args.input.spaceId ?? null,
      source: "manual",
      opportunity,
      startedBy: { type: "user", id: caller.userId },
    });
    const goalId = await findGoalId(args.input.tenantId, result.thread.id);
    const [threadRow] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, result.thread.id))
      .limit(1);
    const [link] = await db
      .insert(crmWorkLinks)
      .values({
        tenant_id: args.input.tenantId,
        provider: PROVIDER,
        object_type: OBJECT_TYPE,
        object_id: args.input.opportunityId,
        object_url: normalizeOptionalUrl(args.input.opportunityUrl),
        workflow_key: WORKFLOW_KEY,
        outcome_key: outcomeKey,
        space_id: result.thread.spaceId,
        thread_id: result.thread.id,
        goal_id: goalId,
        requester_user_id: caller.userId,
        last_writeback_user_id: caller.userId,
        plugin_install_id: readiness.pluginInstallId,
        mcp_server_id: readiness.mcpServerId,
        state: "active",
        status_handle_state: "writeback_blocked",
        status_handle_url: buildStatusHandleUrl(result.thread.id),
        status_handle_action: "Open ThinkWork onboarding",
        last_writeback_state: "blocked",
        failure_code: "NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED",
        failure_message:
          "Twenty plugin activation is present, but native Twenty app/status writeback requires deployed self-hosted runtime verification.",
        metadata: buildLinkMetadata(args.input),
      })
      .onConflictDoUpdate({
        target: [
          crmWorkLinks.tenant_id,
          crmWorkLinks.provider,
          crmWorkLinks.object_type,
          crmWorkLinks.object_id,
          crmWorkLinks.workflow_key,
          crmWorkLinks.outcome_key,
        ],
        set: {
          thread_id: result.thread.id,
          goal_id: goalId,
          space_id: result.thread.spaceId,
          last_resumed_at: new Date(),
          updated_at: new Date(),
        },
        targetWhere: sql`${crmWorkLinks.state} IN ('starting','active')`,
      })
      .returning();

    return {
      action: result.idempotent ? "RESUMED" : "CREATED",
      thread: threadRow ? threadToCamel(threadRow) : result.thread,
      threadId: result.thread.id,
      goalId,
      idempotent: result.idempotent,
      missingFields: result.missingFields,
      linkedTasks: result.linkedTasks.map((task) =>
        toGraphqlLinkedTask(task as unknown as Record<string, unknown>),
      ),
      link: toGraphqlCrmWorkLink(link),
      pluginActivationRequired: false,
      statusWritebackState: "BLOCKED",
    };
  } catch (error) {
    if (error instanceof CustomerOnboardingWorkflowError) {
      throw new GraphQLError(error.message, {
        extensions: { code: error.code, http: { status: error.status } },
      });
    }
    throw error;
  }
}

async function findActiveLink(input: {
  tenantId: string;
  opportunityId: string;
  outcomeKey: string;
}) {
  const [link] = await db
    .select()
    .from(crmWorkLinks)
    .where(
      and(
        eq(crmWorkLinks.tenant_id, input.tenantId),
        eq(crmWorkLinks.provider, PROVIDER),
        eq(crmWorkLinks.object_type, OBJECT_TYPE),
        eq(crmWorkLinks.object_id, input.opportunityId),
        eq(crmWorkLinks.workflow_key, WORKFLOW_KEY),
        eq(crmWorkLinks.outcome_key, input.outcomeKey),
        inArray(crmWorkLinks.state, ["starting", "active"]),
      ),
    )
    .limit(1);
  return link ?? null;
}

async function resolveTwentyPluginReadiness(input: {
  tenantId: string;
  userId: string;
  requireActivation: boolean;
}): Promise<TwentyPluginReadiness | null> {
  const [install] = await db
    .select({ id: pluginInstalls.id })
    .from(pluginInstalls)
    .where(
      and(
        eq(pluginInstalls.tenant_id, input.tenantId),
        eq(pluginInstalls.plugin_key, PROVIDER),
        inArray(pluginInstalls.state, ["installed", "partially_installed"]),
      ),
    )
    .limit(1);
  if (!install) {
    throw new GraphQLError("Twenty plugin is not installed", {
      extensions: { code: "PLUGIN_INSTALL_REQUIRED", pluginKey: PROVIDER },
    });
  }

  const [component] = await db
    .select({ id: pluginComponents.id })
    .from(pluginComponents)
    .where(
      and(
        eq(pluginComponents.plugin_install_id, install.id),
        eq(pluginComponents.component_key, "crm"),
        eq(pluginComponents.component_type, "mcp-server"),
        eq(pluginComponents.state, "provisioned"),
      ),
    )
    .limit(1);
  if (!component) {
    throw new GraphQLError("Twenty CRM MCP component is not provisioned", {
      extensions: { code: "PLUGIN_COMPONENT_REQUIRED", pluginKey: PROVIDER },
    });
  }

  const [server] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        eq(tenantMcpServers.plugin_install_id, install.id),
        eq(tenantMcpServers.slug, "twenty--crm"),
      ),
    )
    .limit(1);
  const [activation] = await db
    .select({ id: userPluginActivations.id })
    .from(userPluginActivations)
    .where(
      and(
        eq(userPluginActivations.user_id, input.userId),
        eq(userPluginActivations.plugin_install_id, install.id),
        eq(userPluginActivations.status, "active"),
      ),
    )
    .limit(1);

  if (!activation && input.requireActivation) {
    throw new GraphQLError("Twenty plugin activation is required", {
      extensions: {
        code: "PLUGIN_ACTIVATION_REQUIRED",
        pluginKey: PROVIDER,
        pluginInstallId: install.id,
      },
    });
  }

  return {
    pluginInstallId: install.id,
    mcpServerId: server?.id ?? null,
    activationId: activation?.id ?? null,
  };
}

async function requireSpaceAccess(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
) {
  if (ctx.auth.authType === "cognito") {
    const ok = await hasSpaceMemberAccess(ctx, tenantId, spaceId);
    if (!ok) {
      throw new GraphQLError("Space membership required", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }
}

async function getThreadOrThrow(threadId: string | null) {
  if (!threadId) {
    throw new GraphQLError("CRM work link has no active Thread", {
      extensions: { code: "CRM_WORK_LINK_INCOMPLETE" },
    });
  }
  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId));
  if (!thread) {
    throw new GraphQLError("Linked Thread not found", {
      extensions: { code: "THREAD_NOT_FOUND" },
    });
  }
  return threadToCamel(thread);
}

async function findGoalId(tenantId: string, threadId: string) {
  const [goal] = await db
    .select({ id: goals.id })
    .from(goals)
    .where(
      and(
        eq(goals.tenant_id, tenantId),
        eq(goals.thread_id, threadId),
        inArray(goals.status, ["active", "in_review"]),
      ),
    )
    .limit(1);
  return goal?.id ?? null;
}

function buildOpportunityInput(
  input: StartTwentyCustomerOnboardingArgs["input"],
) {
  const snapshot = parseSnapshot(input.recordSnapshot);
  const customerName =
    stringValue(input.companyName) ??
    stringValue(input.opportunityName) ??
    stringValue(snapshot.companyName) ??
    stringValue(snapshot.customerName) ??
    stringValue(snapshot.name) ??
    `Twenty opportunity ${input.opportunityId}`;
  return {
    ...snapshot,
    opportunityId: input.opportunityId,
    opportunityUrl: normalizeOptionalUrl(input.opportunityUrl),
    customerName,
    companyName:
      stringValue(input.companyName) ?? stringValue(snapshot.companyName),
  };
}

function buildLinkMetadata(input: StartTwentyCustomerOnboardingArgs["input"]) {
  const snapshot = parseSnapshot(input.recordSnapshot);
  return {
    launchSurface: "twenty_opportunity",
    nativeTwentyAppVerified: false,
    statusHandleKind: "thinkwork_launch_route",
    opportunityName: limitString(
      stringValue(input.opportunityName) ?? stringValue(snapshot.name),
      160,
    ),
    companyName: limitString(
      stringValue(input.companyName) ?? stringValue(snapshot.companyName),
      160,
    ),
  };
}

function toGraphqlCrmWorkLink(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  for (const key of [
    "provider",
    "objectType",
    "workflowKey",
    "state",
    "statusHandleState",
    "lastWritebackState",
  ]) {
    if (typeof result[key] === "string") {
      result[key] = toGraphqlEnum(result[key] as string);
    }
  }
  return result;
}

function toGraphqlEnum(value: string) {
  return value.toUpperCase();
}

function normalizeOutcomeKey(value: string | null | undefined) {
  const normalized = stringValue(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_OUTCOME_KEY;
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const trimmed = stringValue(value);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function buildStatusHandleUrl(threadId: string) {
  return `/threads/${encodeURIComponent(threadId)}`;
}

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function limitString(value: string | null, max: number) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
