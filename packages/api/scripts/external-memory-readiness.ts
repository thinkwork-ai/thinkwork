#!/usr/bin/env -S tsx
/**
 * THINK-193 U8 — external-memory rollout readiness / gating report.
 *
 * Per-tenant report over the deployed database covering the plan's
 * independent rollout gates (shadow → personal manual → personal schedule →
 * shared workflow → canonical graph/wiki writes):
 *
 *   - source ledger state per family: configs, active grants, checkpoint
 *     age, evidence lag, evidence lifecycle mix;
 *   - personal enablement: provisioned personal processors, workflow links
 *     (manual readiness), schedule bindings (scheduled readiness);
 *   - shared enablement: shared processors per scope, tenant wiki kill
 *     switch, wiki compile job backlog age / failures;
 *   - canonical identity health: open resolution cases vs budgets, oldest
 *     case age, duplicate canonical candidates, canonical page coverage;
 *   - retraction/erase health: due + dead-lettered attempts, erase marker
 *     states, oldest non-terminal marker age;
 *   - S3 snapshot expiration horizon: referenced snapshots, already-expired
 *     refs, min/max expiry.
 *
 * Aggregate-only: no source content, subjects, or values are read.
 *
 * Usage:
 *   DATABASE_URL=… pnpm -C packages/api exec tsx \
 *     scripts/external-memory-readiness.ts [--tenant <uuid>] [--json]
 *
 * Output: human tables by default; --json prints the full report object.
 * Exit code is always 0 — this is an operator report, the gate decision is
 * the operator's. Each gate carries ok/attention plus the reasons.
 */

import { pathToFileURL } from "node:url";
import pg from "pg";

// Budgets mirrored from packages/api/src/lib/entity-identity/resolution.ts
// (kept literal here so the script runs standalone against prod-shaped DBs).
const MAX_OPEN_CASES_PER_TENANT = 200;
const CASE_EXPIRY_DAYS = 30;
/** A checkpoint older than this on an ENABLED source is flagged. */
const CHECKPOINT_STALE_HOURS = 48;

interface Args {
  databaseUrl: string;
  tenantId: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  let tenantId: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tenant") tenantId = argv[++i] ?? null;
    else if (argv[i] === "--json") json = true;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return { databaseUrl, tenantId, json };
}

type Row = Record<string, unknown>;

interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

const num = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface SourceFamilyReadiness {
  family: string;
  configs: number;
  enabledConfigs: number;
  activeGrants: number;
  /** Oldest last_advanced_at across ENABLED sources' checkpoints, hours. */
  oldestCheckpointAgeHours: number | null;
  /** Age of the newest evidence row, hours (evidence lag). */
  newestEvidenceAgeHours: number | null;
  evidenceByLifecycle: Record<string, number>;
}

export interface TenantReadiness {
  tenantId: string;
  tenantName: string | null;
  sources: SourceFamilyReadiness[];
  personal: {
    processors: number;
    enabledProcessors: number;
    workflowLinked: number;
    scheduleBindings: number;
    enabledScheduleBindings: number;
  };
  shared: {
    processorsByScope: Record<string, number>;
    enabledProcessorsByScope: Record<string, number>;
    wikiCompileEnabled: boolean;
    wikiPendingJobs: number;
    oldestPendingJobAgeHours: number | null;
    lastSucceededJobAgeHours: number | null;
    failedJobsLast24h: number;
  };
  identity: {
    openCases: number;
    oldestOpenCaseAgeDays: number | null;
    maxOpenCasesBudget: number;
    caseExpiryDaysBudget: number;
    canonicalEntitiesByStatus: Record<string, number>;
    /** Active canonical entities sharing (type, normalized_name) — merge
     * candidates the queue has not resolved. */
    duplicateCanonicalCandidates: number;
    /** Tenant-scope entity pages carrying a canonical id (coverage). */
    canonicalEntityPages: number;
    /** Tenant-scope entity pages WITHOUT a canonical id (pre-U4 residue). */
    entityPagesWithoutCanonical: number;
    /** Pages sharing one canonical id — must be 0 (partial unique). */
    duplicateCanonicalPageIds: number;
  };
  retraction: {
    dueAttempts: number;
    nonTerminalAttempts: number;
    deadLetteredAttempts: number;
    eraseMarkersByStatus: Record<string, number>;
    oldestNonTerminalMarkerAgeHours: number | null;
  };
  snapshots: {
    referencedSnapshots: number;
    expiredButReferenced: number;
    earliestExpiry: string | null;
    latestExpiry: string | null;
  };
  gates: Array<{ gate: string; ok: boolean; reasons: string[] }>;
}

export interface ReadinessReport {
  generatedAt: string;
  stage: string | null;
  tenants: TenantReadiness[];
}

// ---------------------------------------------------------------------------
// Per-tenant collection
// ---------------------------------------------------------------------------

async function collectTenant(
  client: QueryClient,
  tenantId: string,
  tenantName: string | null,
  wikiCompileEnabled: boolean,
): Promise<TenantReadiness> {
  const sourcesRes = await client.query(
    `SELECT sc.source_family AS family,
            count(*)::int AS configs,
            count(*) FILTER (WHERE sc.enabled)::int AS enabled_configs,
            min(cp.last_advanced_at) FILTER (WHERE sc.enabled) AS oldest_checkpoint
       FROM memory_source_configs sc
       LEFT JOIN memory_source_checkpoints cp ON cp.source_config_id = sc.id
      WHERE sc.tenant_id = $1
      GROUP BY sc.source_family`,
    [tenantId],
  );
  const grantsRes = await client.query(
    `SELECT source_family AS family, count(*)::int AS grants
       FROM memory_source_authorizations
      WHERE tenant_id = $1 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      GROUP BY source_family`,
    [tenantId],
  );
  const evidenceRes = await client.query(
    `SELECT sc.source_family AS family, e.lifecycle,
            count(*)::int AS n, max(e.created_at) AS newest
       FROM memory_evidence_items e
       JOIN memory_source_configs sc ON sc.id = e.source_config_id
      WHERE e.tenant_id = $1
      GROUP BY sc.source_family, e.lifecycle`,
    [tenantId],
  );

  const grantsByFamily = new Map<string, number>(
    grantsRes.rows.map((r) => [String(r.family), num(r.grants)]),
  );
  const evidenceByFamily = new Map<
    string,
    { byLifecycle: Record<string, number>; newest: Date | null }
  >();
  for (const row of evidenceRes.rows) {
    const family = String(row.family);
    const entry = evidenceByFamily.get(family) ?? {
      byLifecycle: {},
      newest: null,
    };
    entry.byLifecycle[String(row.lifecycle)] = num(row.n);
    const newest = row.newest ? new Date(row.newest as string) : null;
    if (newest && (!entry.newest || newest > entry.newest)) {
      entry.newest = newest;
    }
    evidenceByFamily.set(family, entry);
  }
  const nowMs = Date.now();
  const hoursSince = (d: Date | null): number | null =>
    d ? Math.round(((nowMs - d.getTime()) / 3_600_000) * 10) / 10 : null;

  const sources: SourceFamilyReadiness[] = sourcesRes.rows.map((row) => {
    const family = String(row.family);
    const evidence = evidenceByFamily.get(family);
    return {
      family,
      configs: num(row.configs),
      enabledConfigs: num(row.enabled_configs),
      activeGrants: grantsByFamily.get(family) ?? 0,
      oldestCheckpointAgeHours: hoursSince(
        row.oldest_checkpoint
          ? new Date(row.oldest_checkpoint as string)
          : null,
      ),
      newestEvidenceAgeHours: hoursSince(evidence?.newest ?? null),
      evidenceByLifecycle: evidence?.byLifecycle ?? {},
    };
  });

  const personalRes = await client.query(
    `SELECT count(*)::int AS processors,
            count(*) FILTER (WHERE enabled)::int AS enabled_processors,
            count(workflow_id)::int AS workflow_linked
       FROM memory_processor_configs
      WHERE tenant_id = $1 AND mode = 'personal' AND status = 'active'`,
    [tenantId],
  );
  const scheduleRes = await client.query(
    `SELECT count(*)::int AS bindings,
            count(*) FILTER (WHERE sj.enabled)::int AS enabled_bindings
       FROM memory_processor_configs pc
       JOIN scheduled_jobs sj ON sj.workflow_id = pc.workflow_id
        AND sj.trigger_type = 'workflow_schedule'
      WHERE pc.tenant_id = $1 AND pc.mode = 'personal' AND pc.status = 'active'`,
    [tenantId],
  );

  const sharedRes = await client.query(
    `SELECT target_scope, count(*)::int AS n,
            count(*) FILTER (WHERE enabled)::int AS enabled_n
       FROM memory_processor_configs
      WHERE tenant_id = $1 AND mode = 'shared' AND status = 'active'
      GROUP BY target_scope`,
    [tenantId],
  );
  const wikiJobsRes = await client.query(
    `SELECT count(*) FILTER (WHERE status IN ('pending','running'))::int AS pending,
            min(created_at) FILTER (WHERE status IN ('pending','running')) AS oldest_pending,
            max(finished_at) FILTER (WHERE status = 'succeeded') AS last_succeeded,
            count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS failed_24h
       FROM wiki.compile_jobs
      WHERE tenant_id = $1`,
    [tenantId],
  );

  const casesRes = await client.query(
    `SELECT count(*)::int AS open, min(created_at) AS oldest
       FROM identity.entity_resolution_cases
      WHERE tenant_id = $1 AND status = 'open'`,
    [tenantId],
  );
  const entitiesRes = await client.query(
    `SELECT status, count(*)::int AS n
       FROM identity.canonical_entities
      WHERE tenant_id = $1
      GROUP BY status`,
    [tenantId],
  );
  const dupCanonicalRes = await client.query(
    `SELECT count(*)::int AS dupes FROM (
       SELECT entity_type_slug, normalized_name
         FROM identity.canonical_entities
        WHERE tenant_id = $1 AND status = 'active'
        GROUP BY entity_type_slug, normalized_name
       HAVING count(*) > 1) d`,
    [tenantId],
  );
  const pagesRes = await client.query(
    `SELECT count(*) FILTER (WHERE canonical_entity_id IS NOT NULL)::int AS canonical_pages,
            count(*) FILTER (WHERE canonical_entity_id IS NULL)::int AS non_canonical_pages
       FROM wiki.pages
      WHERE tenant_id = $1 AND owner_id IS NULL AND type = 'entity'
        AND status = 'active'`,
    [tenantId],
  );
  const dupPagesRes = await client.query(
    `SELECT count(*)::int AS dupes FROM (
       SELECT canonical_entity_id
         FROM wiki.pages
        WHERE tenant_id = $1 AND owner_id IS NULL AND type = 'entity'
          AND canonical_entity_id IS NOT NULL AND status = 'active'
        GROUP BY canonical_entity_id
       HAVING count(*) > 1) d`,
    [tenantId],
  );

  const retractionRes = await client.query(
    `SELECT count(*) FILTER (WHERE status NOT IN ('retracted','dead_lettered'))::int AS non_terminal,
            count(*) FILTER (WHERE status IN ('queued','failed')
              AND (next_retry_at IS NULL OR next_retry_at <= now()))::int AS due,
            count(*) FILTER (WHERE status = 'dead_lettered')::int AS dead_lettered
       FROM memory_retraction_attempts
      WHERE tenant_id = $1 AND scope <> 'erase'`,
    [tenantId],
  );
  const markersRes = await client.query(
    `SELECT status, count(*)::int AS n,
            min(created_at) FILTER (WHERE status NOT IN ('retracted','dead_lettered')) AS oldest_open
       FROM memory_retraction_attempts
      WHERE tenant_id = $1 AND scope = 'erase'
      GROUP BY status`,
    [tenantId],
  );

  const snapshotsRes = await client.query(
    `SELECT count(*) FILTER (WHERE snapshot_ref IS NOT NULL)::int AS referenced,
            count(*) FILTER (WHERE snapshot_ref IS NOT NULL
              AND snapshot_expires_at IS NOT NULL
              AND snapshot_expires_at < now())::int AS expired_referenced,
            min(snapshot_expires_at) FILTER (WHERE snapshot_ref IS NOT NULL) AS earliest,
            max(snapshot_expires_at) FILTER (WHERE snapshot_ref IS NOT NULL) AS latest
       FROM memory_evidence_items
      WHERE tenant_id = $1`,
    [tenantId],
  );

  const personal = personalRes.rows[0] ?? {};
  const schedule = scheduleRes.rows[0] ?? {};
  const wikiJobs = wikiJobsRes.rows[0] ?? {};
  const cases = casesRes.rows[0] ?? {};
  const retractionRow = retractionRes.rows[0] ?? {};
  const pages = pagesRes.rows[0] ?? {};
  const snap = snapshotsRes.rows[0] ?? {};

  const eraseMarkersByStatus: Record<string, number> = {};
  let oldestOpenMarker: Date | null = null;
  for (const row of markersRes.rows) {
    eraseMarkersByStatus[String(row.status)] = num(row.n);
    if (row.oldest_open) {
      const d = new Date(row.oldest_open as string);
      if (!oldestOpenMarker || d < oldestOpenMarker) oldestOpenMarker = d;
    }
  }

  const oldestCase = cases.oldest ? new Date(cases.oldest as string) : null;
  const oldestOpenCaseAgeDays = oldestCase
    ? Math.round(((nowMs - oldestCase.getTime()) / 86_400_000) * 10) / 10
    : null;

  const tenant: TenantReadiness = {
    tenantId,
    tenantName,
    sources,
    personal: {
      processors: num(personal.processors),
      enabledProcessors: num(personal.enabled_processors),
      workflowLinked: num(personal.workflow_linked),
      scheduleBindings: num(schedule.bindings),
      enabledScheduleBindings: num(schedule.enabled_bindings),
    },
    shared: {
      processorsByScope: Object.fromEntries(
        sharedRes.rows.map((r) => [String(r.target_scope), num(r.n)]),
      ),
      enabledProcessorsByScope: Object.fromEntries(
        sharedRes.rows.map((r) => [String(r.target_scope), num(r.enabled_n)]),
      ),
      wikiCompileEnabled,
      wikiPendingJobs: num(wikiJobs.pending),
      oldestPendingJobAgeHours: hoursSince(
        wikiJobs.oldest_pending
          ? new Date(wikiJobs.oldest_pending as string)
          : null,
      ),
      lastSucceededJobAgeHours: hoursSince(
        wikiJobs.last_succeeded
          ? new Date(wikiJobs.last_succeeded as string)
          : null,
      ),
      failedJobsLast24h: num(wikiJobs.failed_24h),
    },
    identity: {
      openCases: num(cases.open),
      oldestOpenCaseAgeDays,
      maxOpenCasesBudget: MAX_OPEN_CASES_PER_TENANT,
      caseExpiryDaysBudget: CASE_EXPIRY_DAYS,
      canonicalEntitiesByStatus: Object.fromEntries(
        entitiesRes.rows.map((r) => [String(r.status), num(r.n)]),
      ),
      duplicateCanonicalCandidates: num(dupCanonicalRes.rows[0]?.dupes),
      canonicalEntityPages: num(pages.canonical_pages),
      entityPagesWithoutCanonical: num(pages.non_canonical_pages),
      duplicateCanonicalPageIds: num(dupPagesRes.rows[0]?.dupes),
    },
    retraction: {
      dueAttempts: num(retractionRow.due),
      nonTerminalAttempts: num(retractionRow.non_terminal),
      deadLetteredAttempts: num(retractionRow.dead_lettered),
      eraseMarkersByStatus,
      oldestNonTerminalMarkerAgeHours: hoursSince(oldestOpenMarker),
    },
    snapshots: {
      referencedSnapshots: num(snap.referenced),
      expiredButReferenced: num(snap.expired_referenced),
      earliestExpiry: snap.earliest
        ? new Date(snap.earliest as string).toISOString()
        : null,
      latestExpiry: snap.latest
        ? new Date(snap.latest as string).toISOString()
        : null,
    },
    gates: [],
  };
  tenant.gates = evaluateGates(tenant);
  return tenant;
}

// ---------------------------------------------------------------------------
// Gate evaluation (pure — exported for reuse/tests)
// ---------------------------------------------------------------------------

export function evaluateGates(
  t: Omit<TenantReadiness, "gates">,
): TenantReadiness["gates"] {
  const gates: TenantReadiness["gates"] = [];
  const push = (gate: string, reasons: string[]) =>
    gates.push({ gate, ok: reasons.length === 0, reasons });

  // Gate 1 — shadow acquisition per family: a config AND a current grant.
  const shadowReasons: string[] = [];
  for (const s of t.sources) {
    if (s.enabledConfigs > 0 && s.activeGrants === 0) {
      shadowReasons.push(`${s.family}: enabled config without an active grant`);
    }
    if (
      s.enabledConfigs > 0 &&
      s.oldestCheckpointAgeHours !== null &&
      s.oldestCheckpointAgeHours > CHECKPOINT_STALE_HOURS
    ) {
      shadowReasons.push(
        `${s.family}: checkpoint stale ${s.oldestCheckpointAgeHours}h (> ${CHECKPOINT_STALE_HOURS}h)`,
      );
    }
    const failed = s.evidenceByLifecycle["failed"] ?? 0;
    if (failed > 0)
      shadowReasons.push(`${s.family}: ${failed} failed evidence`);
  }
  push("source_ledger", shadowReasons);

  // Gate 2 — personal manual.
  const manualReasons: string[] = [];
  if (t.personal.processors === 0) {
    manualReasons.push("no personal processors provisioned");
  }
  if (t.personal.workflowLinked < t.personal.processors) {
    manualReasons.push(
      `${t.personal.processors - t.personal.workflowLinked} personal processor(s) missing workflow link`,
    );
  }
  push("personal_manual", manualReasons);

  // Gate 3 — personal schedule.
  push(
    "personal_schedule",
    t.personal.enabledScheduleBindings > 0
      ? []
      : ["no enabled personal schedule bindings"],
  );

  // Gate 4 — shared workflow.
  const sharedEnabled = Object.values(t.shared.enabledProcessorsByScope).reduce(
    (a, b) => a + b,
    0,
  );
  push(
    "shared_workflow",
    sharedEnabled > 0 ? [] : ["no enabled shared processors"],
  );

  // Gate 5 — canonical graph/wiki writes.
  const wikiReasons: string[] = [];
  if (!t.shared.wikiCompileEnabled) {
    wikiReasons.push("tenants.wiki_compile_enabled is false (kill switch)");
  }
  if (t.identity.duplicateCanonicalPageIds > 0) {
    wikiReasons.push(
      `${t.identity.duplicateCanonicalPageIds} canonical id(s) with duplicate pages`,
    );
  }
  if (t.identity.duplicateCanonicalCandidates > 0) {
    wikiReasons.push(
      `${t.identity.duplicateCanonicalCandidates} duplicate active canonical-entity candidate(s)`,
    );
  }
  if (t.identity.openCases >= t.identity.maxOpenCasesBudget) {
    wikiReasons.push(
      `resolution queue at budget (${t.identity.openCases}/${t.identity.maxOpenCasesBudget})`,
    );
  }
  if (
    t.identity.oldestOpenCaseAgeDays !== null &&
    t.identity.oldestOpenCaseAgeDays > t.identity.caseExpiryDaysBudget
  ) {
    wikiReasons.push(
      `oldest open case ${t.identity.oldestOpenCaseAgeDays}d (> ${t.identity.caseExpiryDaysBudget}d budget)`,
    );
  }
  if (t.shared.failedJobsLast24h > 0) {
    wikiReasons.push(`${t.shared.failedJobsLast24h} wiki compile failures/24h`);
  }
  push("canonical_wiki", wikiReasons);

  // Gate 6 — retraction/erase health (applies to every stage).
  const retractionReasons: string[] = [];
  if (t.retraction.deadLetteredAttempts > 0) {
    retractionReasons.push(
      `${t.retraction.deadLetteredAttempts} dead-lettered retraction attempt(s)`,
    );
  }
  const deadMarkers = t.retraction.eraseMarkersByStatus["dead_lettered"] ?? 0;
  if (deadMarkers > 0) {
    retractionReasons.push(`${deadMarkers} dead-lettered erase marker(s)`);
  }
  if (
    t.retraction.oldestNonTerminalMarkerAgeHours !== null &&
    t.retraction.oldestNonTerminalMarkerAgeHours > 24
  ) {
    retractionReasons.push(
      `erase marker open ${t.retraction.oldestNonTerminalMarkerAgeHours}h (> 24h)`,
    );
  }
  if (t.snapshots.expiredButReferenced > 0) {
    retractionReasons.push(
      `${t.snapshots.expiredButReferenced} evidence row(s) reference expired snapshots`,
    );
  }
  push("retraction_erase", retractionReasons);

  return gates;
}

// ---------------------------------------------------------------------------
// Human rendering
// ---------------------------------------------------------------------------

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    "  " + cells.map((c, i) => pad(c, widths[i]!)).join("  ");
  return [
    line(headers),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map(line),
  ].join("\n");
}

function renderTenant(t: TenantReadiness): string {
  const out: string[] = [];
  out.push(`\nTenant ${t.tenantName ?? "?"} (${t.tenantId})`);
  out.push("\nSources:");
  out.push(
    renderTable(
      [
        "family",
        "configs",
        "enabled",
        "grants",
        "ckpt age(h)",
        "evidence age(h)",
        "lifecycles",
      ],
      t.sources.map((s) => [
        s.family,
        String(s.configs),
        String(s.enabledConfigs),
        String(s.activeGrants),
        s.oldestCheckpointAgeHours === null
          ? "-"
          : String(s.oldestCheckpointAgeHours),
        s.newestEvidenceAgeHours === null
          ? "-"
          : String(s.newestEvidenceAgeHours),
        Object.entries(s.evidenceByLifecycle)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ") || "-",
      ]),
    ),
  );
  out.push(
    `\nPersonal: processors=${t.personal.processors} enabled=${t.personal.enabledProcessors} workflowLinked=${t.personal.workflowLinked} scheduleBindings=${t.personal.scheduleBindings} enabledSchedules=${t.personal.enabledScheduleBindings}`,
  );
  out.push(
    `Shared: ${
      Object.entries(t.shared.processorsByScope)
        .map(
          ([scope, n]) =>
            `${scope}=${t.shared.enabledProcessorsByScope[scope] ?? 0}/${n}`,
        )
        .join(" ") || "none"
    } wikiCompileEnabled=${t.shared.wikiCompileEnabled} wikiPending=${t.shared.wikiPendingJobs} oldestPending(h)=${t.shared.oldestPendingJobAgeHours ?? "-"} lastSucceeded(h)=${t.shared.lastSucceededJobAgeHours ?? "-"} failed24h=${t.shared.failedJobsLast24h}`,
  );
  out.push(
    `Identity: openCases=${t.identity.openCases}/${t.identity.maxOpenCasesBudget} oldestCase(d)=${t.identity.oldestOpenCaseAgeDays ?? "-"} dupCanonicalCandidates=${t.identity.duplicateCanonicalCandidates} canonicalPages=${t.identity.canonicalEntityPages} nonCanonicalEntityPages=${t.identity.entityPagesWithoutCanonical} dupCanonicalPageIds=${t.identity.duplicateCanonicalPageIds}`,
  );
  out.push(
    `Retraction: due=${t.retraction.dueAttempts} nonTerminal=${t.retraction.nonTerminalAttempts} deadLettered=${t.retraction.deadLetteredAttempts} eraseMarkers=${
      Object.entries(t.retraction.eraseMarkersByStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") || "none"
    } oldestOpenMarker(h)=${t.retraction.oldestNonTerminalMarkerAgeHours ?? "-"}`,
  );
  out.push(
    `Snapshots: referenced=${t.snapshots.referencedSnapshots} expiredButReferenced=${t.snapshots.expiredButReferenced} horizon=[${t.snapshots.earliestExpiry ?? "-"} .. ${t.snapshots.latestExpiry ?? "-"}]`,
  );
  out.push("\nGates:");
  out.push(
    renderTable(
      ["gate", "status", "reasons"],
      t.gates.map((g) => [
        g.gate,
        g.ok ? "OK" : "ATTENTION",
        g.reasons.join("; ") || "-",
      ]),
    ),
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: args.databaseUrl, max: 2 });
  try {
    const tenantsRes = await pool.query(
      args.tenantId
        ? `SELECT id, name, wiki_compile_enabled FROM tenants WHERE id = $1`
        : `SELECT id, name, wiki_compile_enabled FROM tenants ORDER BY created_at`,
      args.tenantId ? [args.tenantId] : [],
    );
    const report: ReadinessReport = {
      generatedAt: new Date().toISOString(),
      stage: process.env.STAGE ?? null,
      tenants: [],
    };
    for (const row of tenantsRes.rows) {
      report.tenants.push(
        await collectTenant(
          pool,
          String(row.id),
          row.name === null ? null : String(row.name),
          Boolean(row.wiki_compile_enabled),
        ),
      );
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `External-memory readiness — generated ${report.generatedAt} stage=${report.stage ?? "?"}`,
      );
      for (const tenant of report.tenants) console.log(renderTenant(tenant));
      console.log(
        "\nNote: WIKI_SOURCE (stage-global graph/planner switch) is a Lambda env var, not visible from the DB — check the deployed handler configuration.",
      );
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
