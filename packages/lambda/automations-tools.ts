/**
 * Read-only Automation (agent_loop) queries for the admin-ops MCP surface
 * (THINK-137 U9, R15). The two agent tools `automations_list` and
 * `automation_get` in `packages/lambda/admin-ops-mcp.ts` are mechanical
 * wrappers over these functions.
 *
 * These live beside routine-repo-tools.ts (not in @thinkwork/admin-ops)
 * because they read Aurora directly with an injected Drizzle db and tenant
 * scoping — the same injected-db precedent as the git-backed routine tools.
 * @thinkwork/admin-ops is a DB-free GraphQL/REST client package shared with
 * the CLI, so direct DB reads must not live there.
 *
 * Tenant scoping is applied on EVERY query (loop / version / run rows are all
 * filtered on `tenant_id = tenantId`). Read-only — no mutations.
 *
 * Target presentation resolves `target_spec` directly (THINK-159: it is the
 * sole source, backfilled on every row by migration 0211), yielding a kind +
 * label.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import {
  normalizeTargetSpec,
  type AgentLoopTargetKind,
  type TargetSpec,
} from "@thinkwork/agent-loops-core";

const { agentLoops, agentLoopVersions, agentLoopRuns } = schema;

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Presented shapes
// ---------------------------------------------------------------------------

export interface AutomationTriggerSummary {
  family: string;
  source: string | null;
}

export interface AutomationTargetSummary {
  kind: AgentLoopTargetKind;
  label: string | null;
}

export interface AutomationLastRun {
  id: string;
  status: string | null;
  at: string | null;
}

export interface AutomationListItem {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTriggerSummary;
  target: AutomationTargetSummary | null;
  runAsUserId: string | null;
  spaceId: string | null;
  lastRun: AutomationLastRun | null;
}

export interface AutomationRecentRun {
  id: string;
  status: string;
  triggerFamily: string;
  triggerSource: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface AutomationDetail extends AutomationListItem {
  description: string | null;
  recentRuns: AutomationRecentRun[];
}

// ---------------------------------------------------------------------------
// Version-row shape (only the columns these reads select).
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  routine_actions_spec: unknown;
  target_spec: unknown;
  trigger_spec: unknown;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Resolves the authoritative TargetSpec for a version row. THINK-159:
 * target_spec is the sole source (backfilled on every row by migration 0211);
 * the legacy goal/worker fallback is gone. */
function resolveTargetSpec(version: VersionRow | undefined): TargetSpec | null {
  if (
    !version ||
    version.target_spec === undefined ||
    version.target_spec === null
  ) {
    return null;
  }
  try {
    return normalizeTargetSpec(version.target_spec);
  } catch {
    // A malformed stored spec must not fail the whole list read.
    return null;
  }
}

function targetSummary(
  spec: TargetSpec | null,
): AutomationTargetSummary | null {
  if (!spec) return null;
  if (spec.kind === "agent_thread") {
    const at = spec.agentThread;
    return { kind: spec.kind, label: at?.workerId ?? null };
  }
  const ref = spec.kind === "routine" ? spec.routine : spec.workflow;
  return { kind: spec.kind, label: ref?.label ?? ref?.routineId ?? null };
}

function triggerSummary(
  version: VersionRow | undefined,
  loopPrimaryFamily: string,
): AutomationTriggerSummary {
  const spec =
    version?.trigger_spec &&
    typeof version.trigger_spec === "object" &&
    !Array.isArray(version.trigger_spec)
      ? (version.trigger_spec as Record<string, unknown>)
      : null;
  const family =
    typeof spec?.family === "string" ? spec.family : loopPrimaryFamily;
  const source = typeof spec?.source === "string" ? spec.source : null;
  return { family, source };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadVersionsById(
  db: Db,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, VersionRow>> {
  const ids = versionIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();
  const rows = (await db
    .select({
      id: agentLoopVersions.id,
      routine_actions_spec: agentLoopVersions.routine_actions_spec,
      target_spec: agentLoopVersions.target_spec,
      trigger_spec: agentLoopVersions.trigger_spec,
    })
    .from(agentLoopVersions)
    .where(
      and(
        eq(agentLoopVersions.tenant_id, tenantId),
        inArray(agentLoopVersions.id, ids),
      ),
    )) as VersionRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listAutomations(input: {
  tenantId: string;
  db?: Db;
}): Promise<AutomationListItem[]> {
  const db = input.db ?? getDb();
  const loops = await db
    .select({
      id: agentLoops.id,
      name: agentLoops.name,
      enabled: agentLoops.enabled,
      primary_trigger_family: agentLoops.primary_trigger_family,
      run_as_user_id: agentLoops.run_as_user_id,
      space_id: agentLoops.space_id,
      current_version_id: agentLoops.current_version_id,
      last_run_id: agentLoops.last_run_id,
      last_run_status: agentLoops.last_run_status,
      last_run_at: agentLoops.last_run_at,
    })
    .from(agentLoops)
    .where(eq(agentLoops.tenant_id, input.tenantId));

  const versions = await loadVersionsById(
    db,
    input.tenantId,
    loops
      .map((l) => l.current_version_id)
      .filter((id): id is string => Boolean(id)),
  );

  return loops.map((loop) => {
    const version = loop.current_version_id
      ? versions.get(loop.current_version_id)
      : undefined;
    return {
      id: loop.id,
      name: loop.name,
      enabled: loop.enabled,
      trigger: triggerSummary(version, loop.primary_trigger_family),
      target: targetSummary(resolveTargetSpec(version)),
      runAsUserId: loop.run_as_user_id ?? null,
      spaceId: loop.space_id ?? null,
      lastRun: loop.last_run_id
        ? {
            id: loop.last_run_id,
            status: loop.last_run_status ?? null,
            at: iso(loop.last_run_at),
          }
        : null,
    };
  });
}

export async function getAutomation(input: {
  tenantId: string;
  automationId: string;
  db?: Db;
}): Promise<AutomationDetail> {
  const db = input.db ?? getDb();
  const [loop] = await db
    .select({
      id: agentLoops.id,
      name: agentLoops.name,
      description: agentLoops.description,
      enabled: agentLoops.enabled,
      primary_trigger_family: agentLoops.primary_trigger_family,
      run_as_user_id: agentLoops.run_as_user_id,
      space_id: agentLoops.space_id,
      current_version_id: agentLoops.current_version_id,
      last_run_id: agentLoops.last_run_id,
      last_run_status: agentLoops.last_run_status,
      last_run_at: agentLoops.last_run_at,
    })
    .from(agentLoops)
    .where(
      and(
        eq(agentLoops.id, input.automationId),
        eq(agentLoops.tenant_id, input.tenantId),
      ),
    )
    .limit(1);

  if (!loop) {
    throw new Error(`automation ${input.automationId} not found in tenant`);
  }

  const versions = await loadVersionsById(
    db,
    input.tenantId,
    loop.current_version_id ? [loop.current_version_id] : [],
  );
  const version = loop.current_version_id
    ? versions.get(loop.current_version_id)
    : undefined;

  const runs = (await db
    .select({
      id: agentLoopRuns.id,
      status: agentLoopRuns.status,
      trigger_family: agentLoopRuns.trigger_family,
      trigger_source: agentLoopRuns.trigger_source,
      created_at: agentLoopRuns.created_at,
      finished_at: agentLoopRuns.finished_at,
      error_code: agentLoopRuns.error_code,
      error_message: agentLoopRuns.error_message,
    })
    .from(agentLoopRuns)
    .where(
      and(
        eq(agentLoopRuns.tenant_id, input.tenantId),
        eq(agentLoopRuns.agent_loop_id, input.automationId),
      ),
    )
    .orderBy(desc(agentLoopRuns.created_at))
    .limit(10)) as {
    id: string;
    status: string;
    trigger_family: string;
    trigger_source: string | null;
    created_at: Date | string | null;
    finished_at: Date | string | null;
    error_code: string | null;
    error_message: string | null;
  }[];

  return {
    id: loop.id,
    name: loop.name,
    description: loop.description ?? null,
    enabled: loop.enabled,
    trigger: triggerSummary(version, loop.primary_trigger_family),
    target: targetSummary(resolveTargetSpec(version)),
    runAsUserId: loop.run_as_user_id ?? null,
    spaceId: loop.space_id ?? null,
    lastRun: loop.last_run_id
      ? {
          id: loop.last_run_id,
          status: loop.last_run_status ?? null,
          at: iso(loop.last_run_at),
        }
      : null,
    recentRuns: runs.map((run) => ({
      id: run.id,
      status: run.status,
      triggerFamily: run.trigger_family,
      triggerSource: run.trigger_source ?? null,
      createdAt: iso(run.created_at),
      finishedAt: iso(run.finished_at),
      errorCode: run.error_code ?? null,
      errorMessage: run.error_message ?? null,
    })),
  };
}
