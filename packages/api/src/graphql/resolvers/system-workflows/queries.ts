import { and, desc, eq, lt } from "drizzle-orm";
import {
  systemWorkflowConfigs,
  systemWorkflowEvidence,
  systemWorkflowExtensionBindings,
  systemWorkflowRuns as systemWorkflowRunsTable,
  systemWorkflowStepEvents,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import {
  defaultSystemWorkflowConfig,
  getSystemWorkflowDefinition,
  listSystemWorkflowDefinitions,
} from "../../../lib/system-workflows/registry.js";
import type { SystemWorkflowDefinition } from "../../../lib/system-workflows/types.js";

type SystemWorkflowRow = ReturnType<typeof shapeDefinition>;

function evidenceStatus(run?: Record<string, unknown> | null): string {
  if (!run) return "not_run";
  const summary = run.evidence_summary_json;
  if (
    summary &&
    typeof summary === "object" &&
    Object.keys(summary).length > 0
  ) {
    return "available";
  }
  return run.status === "succeeded" ? "pending" : "not_available";
}

function shapeDefinition(
  definition: SystemWorkflowDefinition,
  tenantId: string,
  latestRun?: Record<string, unknown> | null,
  activeConfig?: Record<string, unknown> | null,
): {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  category: string;
  owner: string;
  runtimeShape: string;
  status: string;
  activeVersion: string;
  customizationStatus: string;
  evidenceStatus: string;
  configSchemaJson: unknown;
  extensionPointsJson: unknown;
  evidenceContractJson: unknown;
  stepManifestJson: unknown;
  activeConfig?: unknown;
  lastRun?: unknown;
} {
  return {
    id: definition.id,
    tenantId,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    owner: definition.owner,
    runtimeShape: definition.runtimeShape,
    status: definition.status,
    activeVersion: definition.activeVersion,
    customizationStatus: activeConfig ? "customized" : "defaults",
    evidenceStatus: evidenceStatus(latestRun),
    configSchemaJson: definition.configSchema,
    extensionPointsJson: definition.extensionPoints,
    evidenceContractJson: definition.evidenceContract,
    stepManifestJson: definition.stepManifest,
    activeConfig: activeConfig ? snakeToCamel(activeConfig) : null,
    lastRun: latestRun ? snakeToCamel(latestRun) : null,
  };
}

async function latestRunsByWorkflow(
  tenantId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(systemWorkflowRunsTable)
    .where(eq(systemWorkflowRunsTable.tenant_id, tenantId))
    .orderBy(
      desc(systemWorkflowRunsTable.started_at),
      desc(systemWorkflowRunsTable.created_at),
    )
    .limit(100);

  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows as Record<string, unknown>[]) {
    const workflowId = String(row.workflow_id);
    if (!latest.has(workflowId)) latest.set(workflowId, row);
  }
  return latest;
}

async function activeConfigsByWorkflow(
  tenantId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await db
    .select()
    .from(systemWorkflowConfigs)
    .where(
      and(
        eq(systemWorkflowConfigs.tenant_id, tenantId),
        eq(systemWorkflowConfigs.status, "active"),
      ),
    )
    .orderBy(desc(systemWorkflowConfigs.version_number))
    .limit(100);

  const configs = new Map<string, Record<string, unknown>>();
  for (const row of rows as Record<string, unknown>[]) {
    const workflowId = String(row.workflow_id);
    if (!configs.has(workflowId)) configs.set(workflowId, row);
  }
  return configs;
}

export async function systemWorkflows(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<SystemWorkflowRow[]> {
  await requireTenantMember(ctx, args.tenantId);

  const [latestRuns, activeConfigs] = await Promise.all([
    latestRunsByWorkflow(args.tenantId),
    activeConfigsByWorkflow(args.tenantId),
  ]);

  return listSystemWorkflowDefinitions().map((definition) =>
    shapeDefinition(
      definition,
      args.tenantId,
      latestRuns.get(definition.id),
      activeConfigs.get(definition.id),
    ),
  );
}

export async function systemWorkflow(
  _parent: unknown,
  args: { id: string; tenantId: string },
  ctx: GraphQLContext,
): Promise<SystemWorkflowRow | null> {
  await requireTenantMember(ctx, args.tenantId);
  const definition = getSystemWorkflowDefinition(args.id);
  if (!definition) return null;

  const [runs, configs] = await Promise.all([
    systemWorkflowRuns(
      null,
      { tenantId: args.tenantId, workflowId: args.id, limit: 1 },
      ctx,
    ),
    activeConfigsByWorkflow(args.tenantId),
  ]);

  return shapeDefinition(
    definition,
    args.tenantId,
    (runs[0] as Record<string, unknown>) ?? null,
    configs.get(definition.id),
  );
}

export async function systemWorkflowRuns(
  _parent: unknown,
  args: {
    tenantId: string;
    workflowId?: string | null;
    status?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  await requireTenantMember(ctx, args.tenantId);

  const conditions = [eq(systemWorkflowRunsTable.tenant_id, args.tenantId)];
  if (args.workflowId) {
    conditions.push(eq(systemWorkflowRunsTable.workflow_id, args.workflowId));
  }
  if (args.status) {
    conditions.push(
      eq(systemWorkflowRunsTable.status, args.status.toLowerCase()),
    );
  }
  if (args.cursor) {
    conditions.push(
      lt(systemWorkflowRunsTable.started_at, new Date(args.cursor)),
    );
  }

  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const rows = await db
    .select()
    .from(systemWorkflowRunsTable)
    .where(and(...conditions))
    .orderBy(
      desc(systemWorkflowRunsTable.started_at),
      desc(systemWorkflowRunsTable.created_at),
    )
    .limit(limit);

  return rows.map(snakeToCamel);
}

export async function systemWorkflowRun(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(systemWorkflowRunsTable)
    .where(eq(systemWorkflowRunsTable.id, args.id))
    .limit(1);
  if (row) await requireTenantMember(ctx, row.tenant_id);
  return row ? snakeToCamel(row) : null;
}

export async function systemWorkflowStepEvents_(
  _parent: unknown,
  args: { runId: string },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const [run] = await db
    .select({ tenant_id: systemWorkflowRunsTable.tenant_id })
    .from(systemWorkflowRunsTable)
    .where(eq(systemWorkflowRunsTable.id, args.runId))
    .limit(1);
  if (!run) return [];
  await requireTenantMember(ctx, run.tenant_id);

  const rows = await db
    .select()
    .from(systemWorkflowStepEvents)
    .where(eq(systemWorkflowStepEvents.run_id, args.runId))
    .orderBy(
      systemWorkflowStepEvents.started_at,
      systemWorkflowStepEvents.created_at,
    )
    .limit(1_000);

  return rows.map(snakeToCamel);
}

export async function systemWorkflowEvidence_(
  _parent: unknown,
  args: { runId: string },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const [run] = await db
    .select({ tenant_id: systemWorkflowRunsTable.tenant_id })
    .from(systemWorkflowRunsTable)
    .where(eq(systemWorkflowRunsTable.id, args.runId))
    .limit(1);
  if (!run) return [];
  await requireTenantMember(ctx, run.tenant_id);

  const rows = await db
    .select()
    .from(systemWorkflowEvidence)
    .where(eq(systemWorkflowEvidence.run_id, args.runId))
    .orderBy(systemWorkflowEvidence.created_at)
    .limit(1_000);

  return rows.map(snakeToCamel);
}

export const systemWorkflowTypeResolvers = {
  activeConfig: async (
    workflow: { id?: string; tenantId?: string; activeConfig?: unknown },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (workflow.activeConfig !== undefined) return workflow.activeConfig;
    if (!workflow.id || !workflow.tenantId) return null;
    await requireTenantMember(ctx, workflow.tenantId);
    const [row] = await db
      .select()
      .from(systemWorkflowConfigs)
      .where(
        and(
          eq(systemWorkflowConfigs.tenant_id, workflow.tenantId),
          eq(systemWorkflowConfigs.workflow_id, workflow.id),
          eq(systemWorkflowConfigs.status, "active"),
        ),
      )
      .orderBy(desc(systemWorkflowConfigs.version_number))
      .limit(1);
    if (row) return snakeToCamel(row);
    const definition = getSystemWorkflowDefinition(workflow.id);
    if (!definition) return null;
    return {
      id: `default:${workflow.tenantId}:${workflow.id}`,
      tenantId: workflow.tenantId,
      workflowId: workflow.id,
      versionNumber: 0,
      status: "defaults",
      configJson: defaultSystemWorkflowConfig(definition),
      createdByActorId: null,
      createdByActorType: "system",
      activatedAt: null,
      createdAt: null,
    };
  },

  extensionBindings: async (
    workflow: { id?: string; tenantId?: string },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (!workflow.id || !workflow.tenantId) return [];
    await requireTenantMember(ctx, workflow.tenantId);
    const rows = await db
      .select()
      .from(systemWorkflowExtensionBindings)
      .where(
        and(
          eq(systemWorkflowExtensionBindings.tenant_id, workflow.tenantId),
          eq(systemWorkflowExtensionBindings.workflow_id, workflow.id),
        ),
      )
      .orderBy(systemWorkflowExtensionBindings.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },

  lastRun: async (
    workflow: { id?: string; tenantId?: string; lastRun?: unknown },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (workflow.lastRun !== undefined) return workflow.lastRun;
    if (!workflow.id || !workflow.tenantId) return null;
    const rows = await systemWorkflowRuns(
      null,
      { tenantId: workflow.tenantId, workflowId: workflow.id, limit: 1 },
      ctx,
    );
    return rows[0] ?? null;
  },

  recentRuns: async (
    workflow: { id?: string; tenantId?: string },
    args: { limit?: number | null },
    ctx: GraphQLContext,
  ) => {
    if (!workflow.id || !workflow.tenantId) return [];
    return systemWorkflowRuns(
      null,
      {
        tenantId: workflow.tenantId,
        workflowId: workflow.id,
        limit: args.limit ?? 25,
      },
      ctx,
    );
  },
};

export const systemWorkflowRunTypeResolvers = {
  workflow: async (
    run: { workflowId?: string; tenantId?: string },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (!run.workflowId || !run.tenantId) return null;
    return systemWorkflow(
      null,
      { id: run.workflowId, tenantId: run.tenantId },
      ctx,
    );
  },

  stepEvents: async (
    run: { id?: string },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (!run.id) return [];
    return systemWorkflowStepEvents_(null, { runId: run.id }, ctx);
  },

  evidence: async (
    run: { id?: string },
    _args: unknown,
    ctx: GraphQLContext,
  ) => {
    if (!run.id) return [];
    return systemWorkflowEvidence_(null, { runId: run.id }, ctx);
  },
};
