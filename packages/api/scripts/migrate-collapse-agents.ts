import { getDb } from "@thinkwork/database-pg";
import { agents, tenants } from "@thinkwork/database-pg/schema";
import { asc, eq, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { emitAuditEvent, type AuditTx } from "../src/lib/compliance/emit";
import {
  foldAgentWorkspaces,
  S3WorkspaceObjectStore,
  type FoldAgentWorkspacesResult,
  type WorkspaceAgent,
  type WorkspaceConflict,
  type WorkspaceObjectStore,
} from "./fold-agent-workspaces";

export interface CollapseAgentRow extends WorkspaceAgent {
  tenantId: string;
  tenantSlug: string;
  status: string;
  createdAt: Date;
  isPlatformDefault: boolean;
}

export interface TenantCollapseReport {
  tenantId: string;
  tenantSlug: string;
  status: "skipped" | "dry-run" | "migrated" | "conflict" | "noop";
  canonicalAgentId?: string;
  canonicalAgentSlug?: string;
  nonCanonicalAgentIds: string[];
  plannedWorkspaceCopies: number;
  copiedWorkspaceObjects: number;
  canonicalPrefixObjectCount: number;
  conflicts: WorkspaceConflict[];
  repointedRows: Record<string, number | "would-update">;
  auditEvents: number;
  message: string;
}

export interface CollapseAgentsSummary {
  dryRun: boolean;
  tenantReports: TenantCollapseReport[];
}

interface CollapseAgentsOptions {
  dryRun: boolean;
  tenantId?: string;
  workspaceBucket?: string;
  store?: WorkspaceObjectStore;
}

interface RepointTarget {
  table: string;
  column: string;
  label?: string;
  tenantScoped?: boolean;
}

const REPOINT_TARGETS: RepointTarget[] = [
  { table: "agents", column: "reports_to" },
  { table: "agents", column: "parent_agent_id" },
  { table: "agent_capabilities", column: "agent_id" },
  { table: "agent_skills", column: "agent_id" },
  { table: "agent_operation_leases", column: "agent_id", tenantScoped: false },
  { table: "join_requests", column: "created_agent_id" },
  { table: "agent_api_keys", column: "agent_id" },
  { table: "agent_versions", column: "agent_id" },
  { table: "threads", column: "agent_id" },
  { table: "thread_participants", column: "agent_id" },
  { table: "scheduled_jobs", column: "agent_id" },
  { table: "thread_turns", column: "agent_id" },
  { table: "thread_turn_events", column: "agent_id" },
  { table: "retry_queue", column: "agent_id" },
  // eval_test_cases.agent_id was dropped by drizzle/0128_drop_eval_test_cases_agent_id.sql
  // (one-platform-agent eval refactor) and is no longer a valid repoint target.
  { table: "eval_runs", column: "agent_id" },
  { table: "webhooks", column: "agent_id" },
  { table: "agent_knowledge_bases", column: "agent_id" },
  { table: "agent_workspace_runs", column: "agent_id" },
  { table: "agent_workspace_events", column: "agent_id" },
  { table: "agent_runtime_state", column: "agent_id" },
  { table: "wakeup_requests", column: "agent_id" },
  { table: "skill_runs", column: "agent_id" },
  { table: "email_reply_tokens", column: "agent_id" },
  { table: "sandbox_invocations", column: "agent_id" },
  { table: "sandbox_agent_hourly_counters", column: "agent_id" },
  { table: "space_agent_assignments", column: "agent_id" },
  { table: "resolved_capability_manifests", column: "agent_id" },
  { table: "agent_mcp_servers", column: "agent_id" },
  { table: "cost_events", column: "agent_id" },
  { table: "budget_policies", column: "agent_id" },
  { table: "team_agents", column: "agent_id" },
  { table: "agent_wakeup_requests", column: "agent_id" },
  { table: "code_factory_jobs", column: "agent_id" },
  { table: "routines", column: "agent_id" },
  { table: "routines", column: "owning_agent_id" },
  { table: "recipes", column: "agent_id" },
  { table: "artifacts", column: "agent_id" },
  { table: "user_quick_actions", column: "workspace_agent_id" },
  { table: "guardrail_blocks", column: "agent_id" },
  { table: "computers", column: "primary_agent_id" },
  { table: "computers", column: "migrated_from_agent_id" },
];

export function agentRepointTargets(): readonly RepointTarget[] {
  return REPOINT_TARGETS;
}

export function pickCanonicalAgent(
  agentsForTenant: CollapseAgentRow[],
): CollapseAgentRow | null {
  const activeAgents = agentsForTenant.filter(
    (agent) => agent.status !== "archived",
  );
  if (activeAgents.length === 0) return null;
  return [...activeAgents].sort((left, right) => {
    const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return left.id.localeCompare(right.id);
  })[0];
}

function identifier(name: string) {
  return sql.raw(`"${name.replace(/"/g, '""')}"`);
}

function uuidArray(ids: string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

function rowCount(result: unknown): number {
  return (result as { rowCount?: number }).rowCount ?? 0;
}

async function executeCount(
  tx: AuditTx,
  statement: ReturnType<typeof sql>,
): Promise<number> {
  const result = await tx.execute(statement);
  return rowCount(result);
}

async function loadTenantAgents(
  db: ReturnType<typeof getDb>,
  tenantId?: string,
): Promise<Map<string, CollapseAgentRow[]>> {
  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      tenantId: agents.tenant_id,
      tenantSlug: tenants.slug,
      status: agents.status,
      createdAt: agents.created_at,
      isPlatformDefault: agents.is_platform_default,
    })
    .from(agents)
    .innerJoin(tenants, eq(tenants.id, agents.tenant_id))
    .where(tenantId ? eq(agents.tenant_id, tenantId) : undefined)
    .orderBy(asc(agents.tenant_id), asc(agents.created_at), asc(agents.id));

  const grouped = new Map<string, CollapseAgentRow[]>();
  for (const row of rows) {
    if (!row.slug) {
      throw new Error(
        `Agent ${row.id} is missing slug; cannot fold workspace safely`,
      );
    }
    const current = grouped.get(row.tenantId) ?? [];
    current.push({
      id: row.id,
      slug: row.slug,
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      status: row.status,
      createdAt: row.createdAt,
      isPlatformDefault: row.isPlatformDefault,
    });
    grouped.set(row.tenantId, current);
  }
  return grouped;
}

async function mergeAgentCapabilityCollisions(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<number> {
  const otherArray = uuidArray(otherIds);
  let changed = 0;
  changed += await executeCount(
    tx,
    sql`
			UPDATE agent_capabilities canonical
			SET
				enabled = canonical.enabled OR other.enabled,
				config = COALESCE(canonical.config, '{}'::jsonb) || COALESCE(other.config, '{}'::jsonb)
			FROM agent_capabilities other
			WHERE canonical.tenant_id = ${tenantId}
				AND canonical.agent_id = ${canonicalId}
				AND other.tenant_id = ${tenantId}
				AND other.agent_id = ANY(${otherArray})
				AND other.capability = canonical.capability
		`,
  );
  changed += await executeCount(
    tx,
    sql`
			DELETE FROM agent_capabilities other
			USING agent_capabilities canonical
			WHERE canonical.tenant_id = ${tenantId}
				AND canonical.agent_id = ${canonicalId}
				AND other.tenant_id = ${tenantId}
				AND other.agent_id = ANY(${otherArray})
				AND other.capability = canonical.capability
		`,
  );
  return changed;
}

async function deleteCanonicalCollisions(
  tx: AuditTx,
  input: {
    table: string;
    tenantId: string;
    canonicalId: string;
    otherIds: string[];
    keyColumn: string;
    agentColumn?: string;
  },
): Promise<number> {
  const otherArray = uuidArray(input.otherIds);
  const agentColumn = input.agentColumn ?? "agent_id";
  return executeCount(
    tx,
    sql`
			DELETE FROM ${identifier(input.table)} other
			USING ${identifier(input.table)} canonical
			WHERE canonical.tenant_id = ${input.tenantId}
				AND canonical.${identifier(agentColumn)} = ${input.canonicalId}
				AND other.tenant_id = ${input.tenantId}
				AND other.${identifier(agentColumn)} = ANY(${otherArray})
				AND other.${identifier(input.keyColumn)} = canonical.${identifier(input.keyColumn)}
		`,
  );
}

async function mergeMcpServerCollisions(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<number> {
  const otherArray = uuidArray(otherIds);
  let changed = 0;
  changed += await executeCount(
    tx,
    sql`
			UPDATE agent_mcp_servers canonical
			SET
				enabled = canonical.enabled OR other.enabled,
				config = COALESCE(canonical.config, '{}'::jsonb) || COALESCE(other.config, '{}'::jsonb),
				updated_at = now()
			FROM agent_mcp_servers other
			WHERE canonical.tenant_id = ${tenantId}
				AND canonical.agent_id = ${canonicalId}
				AND other.tenant_id = ${tenantId}
				AND other.agent_id = ANY(${otherArray})
				AND other.mcp_server_id = canonical.mcp_server_id
		`,
  );
  changed += await deleteCanonicalCollisions(tx, {
    table: "agent_mcp_servers",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "mcp_server_id",
  });
  return changed;
}

async function mergeSandboxCounterCollisions(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<number> {
  const otherArray = uuidArray(otherIds);
  let changed = 0;
  changed += await executeCount(
    tx,
    sql`
			UPDATE sandbox_agent_hourly_counters canonical
			SET
				invocations_count = canonical.invocations_count + other.invocations_count,
				updated_at = GREATEST(canonical.updated_at, other.updated_at)
			FROM sandbox_agent_hourly_counters other
			WHERE canonical.tenant_id = ${tenantId}
				AND canonical.agent_id = ${canonicalId}
				AND other.tenant_id = ${tenantId}
				AND other.agent_id = ANY(${otherArray})
				AND other.utc_hour = canonical.utc_hour
		`,
  );
  changed += await deleteCanonicalCollisions(tx, {
    table: "sandbox_agent_hourly_counters",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "utc_hour",
  });
  return changed;
}

async function backfillSpacePrompts(
  tx: AuditTx,
  tenantId: string,
  agentIds: string[],
): Promise<number> {
  return executeCount(
    tx,
    sql`
			WITH coordinator_instructions AS (
				SELECT
					space_id,
					string_agg(btrim(local_instructions), E'\n\n' ORDER BY created_at, id) AS instructions
				FROM space_agent_assignments
				WHERE tenant_id = ${tenantId}
					AND agent_id = ANY(${uuidArray(agentIds)})
					AND local_role = 'coordinator'
					AND btrim(COALESCE(local_instructions, '')) <> ''
				GROUP BY space_id
			)
			UPDATE spaces
			SET
				prompt = CASE
					WHEN btrim(COALESCE(spaces.prompt, '')) = '' THEN coordinator_instructions.instructions
					WHEN spaces.prompt LIKE '%' || coordinator_instructions.instructions || '%' THEN spaces.prompt
					ELSE spaces.prompt || E'\n\n' || coordinator_instructions.instructions
				END,
				updated_at = now()
			FROM coordinator_instructions
			WHERE spaces.tenant_id = ${tenantId}
				AND spaces.id = coordinator_instructions.space_id
		`,
  );
}

async function dedupeBeforeRepoint(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  changed["agent_capabilities:merge"] = await mergeAgentCapabilityCollisions(
    tx,
    tenantId,
    canonicalId,
    otherIds,
  );
  changed["agent_skills:dedupe"] = await deleteCanonicalCollisions(tx, {
    table: "agent_skills",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "skill_id",
  });
  changed["agent_knowledge_bases:dedupe"] = await deleteCanonicalCollisions(
    tx,
    {
      table: "agent_knowledge_bases",
      tenantId,
      canonicalId,
      otherIds,
      keyColumn: "knowledge_base_id",
    },
  );
  changed["agent_mcp_servers:merge"] = await mergeMcpServerCollisions(
    tx,
    tenantId,
    canonicalId,
    otherIds,
  );
  changed["team_agents:dedupe"] = await deleteCanonicalCollisions(tx, {
    table: "team_agents",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "team_id",
  });
  changed["thread_participants:dedupe"] = await deleteCanonicalCollisions(tx, {
    table: "thread_participants",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "thread_id",
  });
  changed["space_agent_assignments:dedupe"] = await deleteCanonicalCollisions(
    tx,
    {
      table: "space_agent_assignments",
      tenantId,
      canonicalId,
      otherIds,
      keyColumn: "space_id",
    },
  );
  changed["sandbox_agent_hourly_counters:merge"] =
    await mergeSandboxCounterCollisions(tx, tenantId, canonicalId, otherIds);
  changed["agent_versions:dedupe"] = await deleteCanonicalCollisions(tx, {
    table: "agent_versions",
    tenantId,
    canonicalId,
    otherIds,
    keyColumn: "version_number",
  });
  return changed;
}

async function repointAgentReferences(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<Record<string, number>> {
  const otherArray = uuidArray(otherIds);
  const changed: Record<string, number> = {};
  for (const target of REPOINT_TARGETS) {
    const label = target.label ?? `${target.table}.${target.column}`;
    const tenantFilter =
      target.tenantScoped === false ? sql`` : sql`tenant_id = ${tenantId} AND`;
    changed[label] = await executeCount(
      tx,
      sql`
				UPDATE ${identifier(target.table)}
				SET ${identifier(target.column)} = ${canonicalId}
				WHERE ${tenantFilter}
					${identifier(target.column)} = ANY(${otherArray})
			`,
    );
  }
  return changed;
}

async function finalizeTenantCollapse(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  otherIds: string[],
): Promise<{ changed: Record<string, number>; auditEvents: number }> {
  const changed: Record<string, number> = {};
  Object.assign(
    changed,
    await dedupeBeforeRepoint(tx, tenantId, canonicalId, otherIds),
  );
  changed["spaces.prompt_backfill"] = await backfillSpacePrompts(tx, tenantId, [
    canonicalId,
    ...otherIds,
  ]);
  Object.assign(
    changed,
    await repointAgentReferences(tx, tenantId, canonicalId, otherIds),
  );

  changed["agents.platform_default_clear"] = await executeCount(
    tx,
    sql`
			UPDATE agents
			SET is_platform_default = false
			WHERE tenant_id = ${tenantId}
				AND id <> ${canonicalId}
				AND is_platform_default IS TRUE
		`,
  );
  changed["agents.platform_default_mark"] = await executeCount(
    tx,
    sql`
			UPDATE agents
			SET is_platform_default = true, updated_at = now()
			WHERE tenant_id = ${tenantId}
				AND id = ${canonicalId}
				AND is_platform_default IS NOT TRUE
		`,
  );
  changed["agent_capabilities.email_channel_disabled"] = await executeCount(
    tx,
    sql`
			UPDATE agent_capabilities
			SET enabled = false
			WHERE tenant_id = ${tenantId}
				AND capability = 'email_channel'
				AND agent_id = ANY(${uuidArray([canonicalId, ...otherIds])})
				AND enabled IS TRUE
		`,
  );
  changed["agents.archived"] = await executeCount(
    tx,
    sql`
			UPDATE agents
			SET status = 'archived', updated_at = now()
			WHERE tenant_id = ${tenantId}
				AND id = ANY(${uuidArray(otherIds)})
				AND status <> 'archived'
		`,
  );

  let auditEvents = 0;
  for (const archivedAgentId of otherIds) {
    await emitAuditEvent(tx, {
      tenantId,
      actorType: "system",
      actorId: "migration-script",
      eventType: "agent.deleted",
      source: "system",
      resourceType: "agent",
      resourceId: archivedAgentId,
      agentId: archivedAgentId,
      action: "collapse_to_platform_agent",
      outcome: "archived",
      payload: {
        agentId: archivedAgentId,
        reason: "collapse_to_platform_agent",
        canonicalId,
      },
    });
    auditEvents += 1;
  }
  await emitAuditEvent(tx, {
    tenantId,
    actorType: "system",
    actorId: "migration-script",
    eventType: "agent.migrated",
    source: "system",
    resourceType: "agent",
    resourceId: canonicalId,
    agentId: canonicalId,
    action: "mark_platform_default",
    outcome: "migrated",
    payload: {
      agentId: canonicalId,
      reason: "collapse_to_platform_agent",
      canonicalId,
      archivedAgentIds: otherIds,
    },
  });
  auditEvents += 1;

  return { changed, auditEvents };
}

async function markSingleAgentDefault(
  tx: AuditTx,
  tenantId: string,
  agentId: string,
): Promise<{ changed: Record<string, number>; auditEvents: number }> {
  const changed = {
    "agents.platform_default_mark": await executeCount(
      tx,
      sql`
				UPDATE agents
				SET is_platform_default = true, updated_at = now()
				WHERE tenant_id = ${tenantId}
					AND id = ${agentId}
					AND is_platform_default IS NOT TRUE
			`,
    ),
  };
  let auditEvents = 0;
  if (changed["agents.platform_default_mark"] > 0) {
    await emitAuditEvent(tx, {
      tenantId,
      actorType: "system",
      actorId: "migration-script",
      eventType: "agent.migrated",
      source: "system",
      resourceType: "agent",
      resourceId: agentId,
      agentId,
      action: "mark_platform_default",
      outcome: "migrated",
      payload: {
        agentId,
        reason: "collapse_to_platform_agent",
        canonicalId: agentId,
        archivedAgentIds: [],
      },
    });
    auditEvents = 1;
  }
  return { changed, auditEvents };
}

async function repairArchivedAgentReferences(
  tx: AuditTx,
  tenantId: string,
  canonicalId: string,
  archivedAgentIds: string[],
): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  Object.assign(
    changed,
    await dedupeBeforeRepoint(tx, tenantId, canonicalId, archivedAgentIds),
  );
  Object.assign(
    changed,
    await repointAgentReferences(tx, tenantId, canonicalId, archivedAgentIds),
  );
  changed["agent_capabilities.email_channel_disabled"] = await executeCount(
    tx,
    sql`
			UPDATE agent_capabilities
			SET enabled = false
			WHERE tenant_id = ${tenantId}
				AND capability = 'email_channel'
				AND agent_id = ANY(${uuidArray([canonicalId, ...archivedAgentIds])})
				AND enabled IS TRUE
		`,
  );
  return changed;
}

async function collapseTenant(
  db: ReturnType<typeof getDb>,
  tenantAgents: CollapseAgentRow[],
  options: Required<Pick<CollapseAgentsOptions, "dryRun">> & {
    store: WorkspaceObjectStore;
  },
): Promise<TenantCollapseReport> {
  const tenantId = tenantAgents[0]?.tenantId;
  const tenantSlug = tenantAgents[0]?.tenantSlug;
  if (!tenantId || !tenantSlug) {
    throw new Error("collapseTenant requires at least one agent row");
  }

  const canonical = pickCanonicalAgent(tenantAgents);
  if (!canonical) {
    return {
      tenantId,
      tenantSlug,
      status: "skipped",
      nonCanonicalAgentIds: [],
      plannedWorkspaceCopies: 0,
      copiedWorkspaceObjects: 0,
      canonicalPrefixObjectCount: 0,
      conflicts: [],
      repointedRows: {},
      auditEvents: 0,
      message: "Tenant has no non-archived agents; skipped.",
    };
  }

  const otherAgents = tenantAgents.filter((agent) => agent.id !== canonical.id);
  const activeOtherAgents = otherAgents.filter(
    (agent) => agent.status !== "archived",
  );

  if (canonical.isPlatformDefault && activeOtherAgents.length === 0) {
    if (!options.dryRun && otherAgents.length > 0) {
      const changed = await db.transaction((tx) =>
        repairArchivedAgentReferences(
          tx,
          tenantId,
          canonical.id,
          otherAgents.map((agent) => agent.id),
        ),
      );
      const changedRows = Object.values(changed).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (changedRows > 0) {
        return {
          tenantId,
          tenantSlug,
          status: "migrated",
          canonicalAgentId: canonical.id,
          canonicalAgentSlug: canonical.slug,
          nonCanonicalAgentIds: otherAgents.map((agent) => agent.id),
          plannedWorkspaceCopies: 0,
          copiedWorkspaceObjects: 0,
          canonicalPrefixObjectCount: 0,
          conflicts: [],
          repointedRows: changed,
          auditEvents: 0,
          message:
            "Tenant was already collapsed; repaired leftover archived-agent references.",
        };
      }
    }
    return {
      tenantId,
      tenantSlug,
      status: "noop",
      canonicalAgentId: canonical.id,
      canonicalAgentSlug: canonical.slug,
      nonCanonicalAgentIds: otherAgents.map((agent) => agent.id),
      plannedWorkspaceCopies: 0,
      copiedWorkspaceObjects: 0,
      canonicalPrefixObjectCount: 0,
      conflicts: [],
      repointedRows: {},
      auditEvents: 0,
      message: "Tenant already collapsed to a platform-default agent.",
    };
  }

  if (otherAgents.length === 0) {
    if (canonical.isPlatformDefault) {
      return {
        tenantId,
        tenantSlug,
        status: "noop",
        canonicalAgentId: canonical.id,
        canonicalAgentSlug: canonical.slug,
        nonCanonicalAgentIds: [],
        plannedWorkspaceCopies: 0,
        copiedWorkspaceObjects: 0,
        canonicalPrefixObjectCount: 0,
        conflicts: [],
        repointedRows: {},
        auditEvents: 0,
        message: "Tenant already has one platform-default agent.",
      };
    }
    if (options.dryRun) {
      return {
        tenantId,
        tenantSlug,
        status: "dry-run",
        canonicalAgentId: canonical.id,
        canonicalAgentSlug: canonical.slug,
        nonCanonicalAgentIds: [],
        plannedWorkspaceCopies: 0,
        copiedWorkspaceObjects: 0,
        canonicalPrefixObjectCount: 0,
        conflicts: [],
        repointedRows: { "agents.platform_default_mark": 1 },
        auditEvents: 1,
        message: "Would mark the only non-archived agent as platform default.",
      };
    }
    const result = await db.transaction((tx) =>
      markSingleAgentDefault(tx, tenantId, canonical.id),
    );
    return {
      tenantId,
      tenantSlug,
      status: "migrated",
      canonicalAgentId: canonical.id,
      canonicalAgentSlug: canonical.slug,
      nonCanonicalAgentIds: [],
      plannedWorkspaceCopies: 0,
      copiedWorkspaceObjects: 0,
      canonicalPrefixObjectCount: 0,
      conflicts: [],
      repointedRows: result.changed,
      auditEvents: result.auditEvents,
      message: "Marked the only non-archived agent as platform default.",
    };
  }

  let foldResult: FoldAgentWorkspacesResult;
  try {
    foldResult = await foldAgentWorkspaces({
      store: options.store,
      tenantSlug,
      canonicalAgent: canonical,
      sourceAgents: activeOtherAgents,
      dryRun: options.dryRun,
    });
  } catch (error) {
    throw new Error(
      `Workspace fold failed for tenant ${tenantSlug}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const baseReport = {
    tenantId,
    tenantSlug,
    canonicalAgentId: canonical.id,
    canonicalAgentSlug: canonical.slug,
    nonCanonicalAgentIds: otherAgents.map((agent) => agent.id),
    plannedWorkspaceCopies: foldResult.plannedCopies.length,
    copiedWorkspaceObjects: foldResult.copiedKeys.length,
    canonicalPrefixObjectCount: foldResult.canonicalPrefixObjectCount,
    conflicts: foldResult.conflicts,
  };

  if (foldResult.conflicts.length > 0) {
    return {
      ...baseReport,
      status: "conflict",
      repointedRows: {},
      auditEvents: 0,
      message:
        "Workspace conflicts found; no database writes were applied for tenant.",
    };
  }

  if (options.dryRun) {
    return {
      ...baseReport,
      status: "dry-run",
      repointedRows: Object.fromEntries(
        REPOINT_TARGETS.map((target) => [
          target.label ?? `${target.table}.${target.column}`,
          "would-update",
        ]),
      ),
      auditEvents: otherAgents.length + 1,
      message: "Dry run completed; no S3 or database writes were applied.",
    };
  }

  const result = await db.transaction((tx) =>
    finalizeTenantCollapse(
      tx,
      tenantId,
      canonical.id,
      otherAgents.map((agent) => agent.id),
    ),
  );

  return {
    ...baseReport,
    status: "migrated",
    repointedRows: result.changed,
    auditEvents: result.auditEvents,
    message: `Migrated tenant; emitted ${result.auditEvents} audit events.`,
  };
}

export async function collapseAgents(
  options: CollapseAgentsOptions,
): Promise<CollapseAgentsSummary> {
  const db = getDb();
  const store =
    options.store ??
    new S3WorkspaceObjectStore({
      bucket:
        options.workspaceBucket ??
        process.env.WORKSPACE_BUCKET ??
        process.env.AGENTCORE_FILES_BUCKET ??
        "",
    });
  const tenantsToAgents = await loadTenantAgents(db, options.tenantId);
  const tenantReports: TenantCollapseReport[] = [];

  for (const tenantAgents of tenantsToAgents.values()) {
    tenantReports.push(
      await collapseTenant(db, tenantAgents, {
        dryRun: options.dryRun,
        store,
      }),
    );
  }

  return { dryRun: options.dryRun, tenantReports };
}

function parseArgs(argv: string[]): CollapseAgentsOptions {
  const options: CollapseAgentsOptions = {
    dryRun: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.dryRun = false;
    else if (arg === "--tenant-id") options.tenantId = argv[++i];
    else if (arg === "--workspace-bucket") options.workspaceBucket = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage: pnpm --filter @thinkwork/api exec tsx scripts/migrate-collapse-agents.ts [options]

Options:
  --dry-run                    Produce report without S3 or DB writes (default)
  --apply                      Apply S3 fold and database migration
  --tenant-id <uuid>           Limit to one tenant
  --workspace-bucket <bucket>  S3 workspace bucket (defaults to WORKSPACE_BUCKET or AGENTCORE_FILES_BUCKET)
`);
}

async function main(): Promise<void> {
  const summary = await collapseAgents(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(summary, null, 2));
  const conflicts = summary.tenantReports.reduce(
    (count, report) => count + report.conflicts.length,
    0,
  );
  if (conflicts > 0) {
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
