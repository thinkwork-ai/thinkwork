import { and, desc, eq, lt } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  agentLoopEvidence,
  agentLoopIterations,
  agentLoopJudgments,
  agentLoopRuns,
  agentLoopVersions,
  agentLoops,
  db,
  snakeToCamel,
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
