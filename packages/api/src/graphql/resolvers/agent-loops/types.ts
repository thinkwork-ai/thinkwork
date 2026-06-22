import { and, desc, eq, lt } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentWakeupRequests,
  agentLoopEvidence,
  agentLoopIterations,
  agentLoopJudgments,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  db,
  snakeToCamel,
  threadTurns,
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

type AgentLoopJudgmentParent = TenantScoped & {
  agentLoopRunId?: string | null;
  agentLoopIterationId?: string | null;
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

  judgments: async (run: AgentLoopRunParent) => {
    if (!run.id) return [];
    const rows = await db
      .select()
      .from(agentLoopJudgments)
      .where(eq(agentLoopJudgments.agent_loop_run_id, run.id))
      .orderBy(desc(agentLoopJudgments.created_at))
      .limit(1_000);
    return rows.map(agentLoopRowToGraphql);
  },

  evidence: async (run: AgentLoopRunParent) => {
    if (!run.id) return [];
    const rows = await db
      .select()
      .from(agentLoopEvidence)
      .where(eq(agentLoopEvidence.agent_loop_run_id, run.id))
      .orderBy(desc(agentLoopEvidence.created_at))
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

  judgments: async (iteration: AgentLoopIterationParent) => {
    if (!iteration.id) return [];
    const rows = await db
      .select()
      .from(agentLoopJudgments)
      .where(eq(agentLoopJudgments.agent_loop_iteration_id, iteration.id))
      .orderBy(desc(agentLoopJudgments.created_at))
      .limit(1_000);
    return rows.map(agentLoopRowToGraphql);
  },

  evidence: async (iteration: AgentLoopIterationParent) => {
    if (!iteration.id) return [];
    const rows = await db
      .select()
      .from(agentLoopEvidence)
      .where(eq(agentLoopEvidence.agent_loop_iteration_id, iteration.id))
      .orderBy(desc(agentLoopEvidence.created_at))
      .limit(1_000);
    return rows.map(agentLoopRowToGraphql);
  },
};

async function resolveAgentLoopRunThreadId(runId: string): Promise<string | null> {
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
    if (input.tenantId) conditions.push(eq(threadTurns.tenant_id, input.tenantId));
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

export const agentLoopJudgmentTypeResolvers = {
  agentLoopRun: async (judgment: AgentLoopJudgmentParent) => {
    if (!judgment.agentLoopRunId) return null;
    const [row] = await db
      .select()
      .from(agentLoopRuns)
      .where(eq(agentLoopRuns.id, judgment.agentLoopRunId))
      .limit(1);
    return row ? agentLoopRowToGraphql(row) : null;
  },
};
