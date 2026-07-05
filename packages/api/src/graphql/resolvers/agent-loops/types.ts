import { and, desc, eq, lt } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentWakeupRequests,
  agentLoopIterations,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  db,
  snakeToCamel,
  threadTurns,
  webhookDeliveries,
  webhooks,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type TenantScoped = {
  tenantId?: string | null;
  tenant_id?: string | null;
};

type AgentLoopParent = TenantScoped & {
  id?: string;
  currentVersionId?: string | null;
  lastRunId?: string | null;
};

type AgentLoopVersionParent = TenantScoped & {
  agentLoopId?: string | null;
};

type AgentLoopRunParent = TenantScoped & {
  id?: string;
  agentLoopId?: string | null;
  agentLoopVersionId?: string | null;
};

type AgentLoopIterationParent = TenantScoped & {
  id?: string;
  agentLoopRunId?: string | null;
  agentWakeupRequestId?: string | null;
  threadTurnId?: string | null;
};

export async function resolveAgentLoopTenantId(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
): Promise<string> {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  const tenantId = requestedTenantId ?? callerTenantId;
  if (!tenantId) {
    throw new Error("Unable to resolve tenant for AgentLoop request");
  }
  await requireAdminOrServiceCaller(ctx, tenantId, "read_agent_loop");
  return tenantId;
}

export async function requireAgentLoopAdmin(
  ctx: GraphQLContext,
  tenantId: string,
  operationName: string,
): Promise<void> {
  await requireAdminOrServiceCaller(ctx, tenantId, operationName);
}

export async function assertCanReadAgentLoopTenant(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<void> {
  await requireAdminOrServiceCaller(ctx, tenantId, "read_agent_loop");
}

export function clampAgentLoopQueryLimit(limit?: number | null): number {
  return Math.min(Math.max(limit ?? 25, 1), 100);
}

export function normalizeAgentLoopEnum(value?: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

export function parseAwsJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("AWSJSON input must be an object");
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("AWSJSON input must be an object");
}

export function agentLoopRowToGraphql(row: Record<string, unknown>): unknown {
  return snakeToCamel(row);
}

export const agentLoopTypeResolvers = {
  currentVersion: async (loop: AgentLoopParent) => {
    if (!loop.currentVersionId) return null;
    const [row] = await db
      .select()
      .from(agentLoopVersions)
      .where(eq(agentLoopVersions.id, loop.currentVersionId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },

  versions: async (loop: AgentLoopParent) => {
    if (!loop.id) return [];
    const rows = await db
      .select()
      .from(agentLoopVersions)
      .where(eq(agentLoopVersions.agent_loop_id, loop.id))
      .orderBy(desc(agentLoopVersions.version_number))
      .limit(50);
    return rows.map(agentLoopRowToGraphql);
  },

  runs: async (
    loop: AgentLoopParent,
    args: { limit?: number | null; cursor?: string | null; status?: string },
  ) => {
    if (!loop.id) return [];
    const conditions = [eq(agentLoopRuns.agent_loop_id, loop.id)];
    const status = normalizeAgentLoopEnum(args.status);
    if (status) conditions.push(eq(agentLoopRuns.status, status));
    if (args.cursor) {
      conditions.push(lt(agentLoopRuns.created_at, new Date(args.cursor)));
    }
    const rows = await db
      .select()
      .from(agentLoopRuns)
      .where(and(...conditions))
      .orderBy(desc(agentLoopRuns.created_at))
      .limit(clampAgentLoopQueryLimit(args.limit));
    return rows.map(agentLoopRowToGraphql);
  },

  // R6 UI seam: the bound inbound webhook endpoint (webhook-trigger automations).
  webhookEndpoint: async (loop: AgentLoopParent) => {
    if (!loop.id) return null;
    const [row] = await db
      .select({
        id: webhooks.id,
        token: webhooks.token,
        enabled: webhooks.enabled,
      })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.agent_loop_id, loop.id),
          eq(webhooks.target_type, "automation"),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      webhookId: row.id,
      token: row.token,
      path: `/webhooks/${row.token}`,
      enabled: row.enabled,
    };
  },

  // R8 (THINK-137 U8): metadata-only delivery history for the Automation's
  // bound webhook endpoint. The parent AgentLoop was already tenant-gated by
  // requireAdminOrServiceCaller at query time (resolveAgentLoopTenantId), so no
  // extra auth probe here — but the SELECT deliberately omits body_preview /
  // body_sha256 / body_size_bytes / source_ip so the raw request body can never
  // reach this surface (defense-in-depth over the retired Settings page).
  webhookDeliveries: async (
    loop: AgentLoopParent,
    args: { limit?: number | null },
  ) => {
    if (!loop.id) return [];
    const [endpoint] = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.agent_loop_id, loop.id),
          eq(webhooks.target_type, "automation"),
        ),
      )
      .limit(1);
    if (!endpoint) return [];
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        received_at: webhookDeliveries.received_at,
        resolution_status: webhookDeliveries.resolution_status,
        signature_status: webhookDeliveries.signature_status,
        status_code: webhookDeliveries.status_code,
        provider_name: webhookDeliveries.provider_name,
        provider_event_id: webhookDeliveries.provider_event_id,
        normalized_kind: webhookDeliveries.normalized_kind,
        thread_id: webhookDeliveries.thread_id,
        thread_created: webhookDeliveries.thread_created,
        is_replay: webhookDeliveries.is_replay,
        retry_count: webhookDeliveries.retry_count,
        duration_ms: webhookDeliveries.duration_ms,
        error_message: webhookDeliveries.error_message,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhook_id, endpoint.id))
      .orderBy(desc(webhookDeliveries.received_at))
      .limit(limit);
    return rows.map(snakeToCamel);
  },
};

export const agentLoopVersionTypeResolvers = {
  agentLoop: async (version: AgentLoopVersionParent) => {
    if (!version.agentLoopId) return null;
    const [row] = await db
      .select()
      .from(agentLoops)
      .where(eq(agentLoops.id, version.agentLoopId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },
};

export const agentLoopRunTypeResolvers = {
  agentLoop: async (run: AgentLoopRunParent) => {
    if (!run.agentLoopId) return null;
    const [row] = await db
      .select()
      .from(agentLoops)
      .where(eq(agentLoops.id, run.agentLoopId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },

  agentLoopVersion: async (run: AgentLoopRunParent) => {
    if (!run.agentLoopVersionId) return null;
    const [row] = await db
      .select()
      .from(agentLoopVersions)
      .where(eq(agentLoopVersions.id, run.agentLoopVersionId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },

  threadId: async (run: AgentLoopRunParent) => {
    if (!run.id) return null;
    return resolveAgentLoopRunThreadId(run.id);
  },

  iterations: async (run: AgentLoopRunParent) => {
    if (!run.id) return [];
    const rows = await db
      .select()
      .from(agentLoopIterations)
      .where(eq(agentLoopIterations.agent_loop_run_id, run.id))
      .orderBy(agentLoopIterations.iteration_number)
      .limit(1_000);
    return rows.map(agentLoopRowToGraphql);
  },
};

export const agentLoopIterationTypeResolvers = {
  agentLoopRun: async (iteration: AgentLoopIterationParent) => {
    if (!iteration.agentLoopRunId) return null;
    const [row] = await db
      .select()
      .from(agentLoopRuns)
      .where(eq(agentLoopRuns.id, iteration.agentLoopRunId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },

  threadId: async (iteration: AgentLoopIterationParent) =>
    resolveAgentLoopIterationThreadId({
      tenantId: iteration.tenantId ?? iteration.tenant_id ?? null,
      threadTurnId: iteration.threadTurnId ?? null,
      wakeupId: iteration.agentWakeupRequestId ?? null,
    }),
};

async function resolveAgentLoopRunThreadId(
  runId: string,
): Promise<string | null> {
  const [iteration] = await db
    .select({
      tenantId: agentLoopIterations.tenant_id,
      threadTurnId: agentLoopIterations.thread_turn_id,
      wakeupId: agentLoopIterations.agent_wakeup_request_id,
    })
    .from(agentLoopIterations)
    .where(eq(agentLoopIterations.agent_loop_run_id, runId))
    .orderBy(agentLoopIterations.iteration_number)
    .limit(1);
  if (!iteration) return null;
  return resolveAgentLoopIterationThreadId(iteration);
}

async function resolveAgentLoopIterationThreadId(input: {
  tenantId?: string | null;
  threadTurnId?: string | null;
  wakeupId?: string | null;
}): Promise<string | null> {
  if (input.threadTurnId) {
    const conditions = [eq(threadTurns.id, input.threadTurnId)];
    if (input.tenantId)
      conditions.push(eq(threadTurns.tenant_id, input.tenantId));
    const [turn] = await db
      .select({ threadId: threadTurns.thread_id })
      .from(threadTurns)
      .where(and(...conditions))
      .limit(1);
    if (turn?.threadId) return turn.threadId;
  }

  if (!input.wakeupId) return null;
  const conditions = [eq(agentWakeupRequests.id, input.wakeupId)];
  if (input.tenantId) {
    conditions.push(eq(agentWakeupRequests.tenant_id, input.tenantId));
  }
  const [wakeup] = await db
    .select({ payload: agentWakeupRequests.payload })
    .from(agentWakeupRequests)
    .where(and(...conditions))
    .limit(1);
  const payload =
    wakeup?.payload && typeof wakeup.payload === "object"
      ? (wakeup.payload as Record<string, unknown>)
      : null;
  const threadId = payload?.threadId;
  return typeof threadId === "string" && threadId.trim()
    ? threadId.trim()
    : null;
}
