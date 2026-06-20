import { and, desc, eq, lt } from "drizzle-orm";
import {
  routineAslVersions,
  routines,
  workflowEngineBindings,
  workflowEvidence,
  workflowRunEvents,
  workflowRuns,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

type TenantScoped = {
  tenantId?: string | null;
  tenant_id?: string | null;
};

type WorkflowParent = TenantScoped & {
  id?: string;
  currentVersionId?: string | null;
  lastRunId?: string | null;
};

type WorkflowVersionParent = TenantScoped & {
  id?: string;
  workflowId?: string;
  routineAslVersionId?: string | null;
};

type WorkflowBindingParent = TenantScoped & {
  id?: string;
  workflowId?: string;
  workflowVersionId?: string | null;
  routineId?: string | null;
  routineAslVersionId?: string | null;
};

type WorkflowRunParent = TenantScoped & {
  id?: string;
  workflowId?: string;
  workflowVersionId?: string | null;
  engineBindingId?: string | null;
};

type WorkflowTriggerParent = TenantScoped & {
  workflowId?: string;
  workflowVersionId?: string | null;
};

type WorkflowEvidenceParent = TenantScoped & {
  workflowId?: string;
  workflowRunId?: string | null;
};

type WorkflowEventParent = TenantScoped & {
  workflowRunId?: string;
};

export async function resolveReadableTenantId(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
): Promise<string> {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));

  if (!requestedTenantId) {
    if (!callerTenantId) {
      throw new Error("Unable to resolve tenant for workflow query");
    }
    return callerTenantId;
  }

  if (callerTenantId === requestedTenantId) return requestedTenantId;
  await requireTenantMember(ctx, requestedTenantId);
  return requestedTenantId;
}

export async function assertCanReadWorkflowTenant(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<void> {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (callerTenantId === tenantId) return;
  await requireTenantMember(ctx, tenantId);
}

export function clampWorkflowQueryLimit(limit?: number | null): number {
  return Math.min(Math.max(limit ?? 25, 1), 100);
}

export function normalizeWorkflowEnum(value?: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

export const workflowTypeResolvers = {
  currentVersion: async (workflow: WorkflowParent) => {
    if (!workflow.currentVersionId) return null;
    const [row] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflow.currentVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  triggers: async (workflow: WorkflowParent) => {
    if (!workflow.id) return [];
    const rows = await db
      .select()
      .from(workflowTriggers)
      .where(eq(workflowTriggers.workflow_id, workflow.id))
      .orderBy(workflowTriggers.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },

  bindings: async (workflow: WorkflowParent) => {
    if (!workflow.id) return [];
    const rows = await db
      .select()
      .from(workflowEngineBindings)
      .where(eq(workflowEngineBindings.workflow_id, workflow.id))
      .orderBy(workflowEngineBindings.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },

  lastRun: async (workflow: WorkflowParent) => {
    if (!workflow.lastRunId) return null;
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflow.lastRunId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  runs: async (
    workflow: WorkflowParent,
    args: { limit?: number | null; cursor?: string | null; status?: string },
  ) => {
    if (!workflow.id) return [];
    const conditions = [eq(workflowRuns.workflow_id, workflow.id)];
    const status = normalizeWorkflowEnum(args.status);
    if (status) conditions.push(eq(workflowRuns.status, status));
    if (args.cursor) {
      conditions.push(lt(workflowRuns.created_at, new Date(args.cursor)));
    }
    const rows = await db
      .select()
      .from(workflowRuns)
      .where(and(...conditions))
      .orderBy(desc(workflowRuns.created_at))
      .limit(clampWorkflowQueryLimit(args.limit));
    return rows.map(snakeToCamel);
  },
};

export const workflowVersionTypeResolvers = {
  workflow: async (version: WorkflowVersionParent) => {
    if (!version.workflowId) return null;
    const [row] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, version.workflowId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  routineAslVersion: async (version: WorkflowVersionParent) => {
    if (!version.routineAslVersionId) return null;
    const [row] = await db
      .select()
      .from(routineAslVersions)
      .where(eq(routineAslVersions.id, version.routineAslVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};

export const workflowTriggerTypeResolvers = {
  workflow: async (trigger: WorkflowTriggerParent) => {
    if (!trigger.workflowId) return null;
    const [row] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, trigger.workflowId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  workflowVersion: async (trigger: WorkflowTriggerParent) => {
    if (!trigger.workflowVersionId) return null;
    const [row] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, trigger.workflowVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};

export const workflowEngineBindingTypeResolvers = {
  workflow: async (binding: WorkflowBindingParent) => {
    if (!binding.workflowId) return null;
    const [row] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, binding.workflowId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  workflowVersion: async (binding: WorkflowBindingParent) => {
    if (!binding.workflowVersionId) return null;
    const [row] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, binding.workflowVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  routine: async (binding: WorkflowBindingParent) => {
    if (!binding.routineId) return null;
    const [row] = await db
      .select()
      .from(routines)
      .where(eq(routines.id, binding.routineId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  routineAslVersion: async (binding: WorkflowBindingParent) => {
    if (!binding.routineAslVersionId) return null;
    const [row] = await db
      .select()
      .from(routineAslVersions)
      .where(eq(routineAslVersions.id, binding.routineAslVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};

export const workflowRunTypeResolvers = {
  workflow: async (run: WorkflowRunParent) => {
    if (!run.workflowId) return null;
    const [row] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, run.workflowId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  workflowVersion: async (run: WorkflowRunParent) => {
    if (!run.workflowVersionId) return null;
    const [row] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, run.workflowVersionId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  engineBinding: async (run: WorkflowRunParent) => {
    if (!run.engineBindingId) return null;
    const [row] = await db
      .select()
      .from(workflowEngineBindings)
      .where(eq(workflowEngineBindings.id, run.engineBindingId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  events: async (run: WorkflowRunParent) => {
    if (!run.id) return [];
    const rows = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.workflow_run_id, run.id))
      .orderBy(workflowRunEvents.occurred_at, workflowRunEvents.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },

  evidence: async (run: WorkflowRunParent) => {
    if (!run.id) return [];
    const rows = await db
      .select()
      .from(workflowEvidence)
      .where(eq(workflowEvidence.workflow_run_id, run.id))
      .orderBy(workflowEvidence.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },
};

export const workflowRunEventTypeResolvers = {
  workflowRun: async (event: WorkflowEventParent) => {
    if (!event.workflowRunId) return null;
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, event.workflowRunId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};

export const workflowEvidenceTypeResolvers = {
  workflow: async (evidence: WorkflowEvidenceParent) => {
    if (!evidence.workflowId) return null;
    const [row] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, evidence.workflowId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  workflowRun: async (evidence: WorkflowEvidenceParent) => {
    if (!evidence.workflowRunId) return null;
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, evidence.workflowRunId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};
