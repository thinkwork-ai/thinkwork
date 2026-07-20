/**
 * Identity-source registration + bootstrap/drift matching job (THINK-321 U7,
 * KTD-5 / KTD-7 — R8/R9/R10, F4).
 *
 * Registration writes `identity.source_system_connectors` (KTD-5) after
 * validating the connector row exists and identity rules exist for every
 * target entity type, then re-projects the workspace routing map.
 *
 * The match job mirrors `ontology.suggestion_scan_jobs` exactly (KTD-7):
 * dedupe-key insert-or-load on `identity.match_jobs`, async Event invoke of
 * the dedicated `identity-match` Lambda, invoke failure marked on the row
 * with an `invokeFailure` metric. Metrics report scanned / autoLinked /
 * casesFiled / casesExpired so the 200-open-case budget interaction
 * (`enforceQueueBudgets`) is VISIBLE, never silent (F4).
 *
 * Continuation dedupe keys derive from the predecessor's key — never
 * recomputed from wall-clock or created_at (the compile-continuation bucket
 * lesson: docs/solutions/logic-errors/compile-continuation-dedupe-bucket-
 * 2026-04-20.md).
 *
 * Row fetching is delegated to injectable source fetchers (see
 * `source-fetchers.ts`): external/internal Postgres rides the analyst
 * broker's HTTP MCP route with a signed system_refresh caller context (the
 * dual-plane rule — this module never opens sockets to customer databases),
 * Twenty rides the memory-source config credential client.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { and, eq, inArray } from "drizzle-orm";
import {
  entitySourceMappings,
  identityMatchJobs,
  ontologyEntityTypes,
  sourceSystemConnectors,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import type {
  IdentityDbClient,
  MatchVerdict,
  MatchRequest,
} from "./matcher.js";
import { matchCanonicalEntity, defaultIdentityRules } from "./matcher.js";
import {
  computeIdentitySignature,
  parseIdentityRules,
  type IdentityRule,
} from "./normalizers.js";
import {
  attachIdentityEvidence,
  appendResolutionEvent,
  createCanonicalEntity,
  enforceQueueBudgets,
  openOrCoalesceResolutionCase,
  type OpenResolutionCaseInput,
  type OpenResolutionCaseResult,
} from "./resolution.js";
import { normalizeNaturalKeys } from "./matcher.js";
import {
  refreshRoutingMapFile,
  type RoutingMapRefreshResult,
} from "./routing-map-file.js";

const LOG_PREFIX = "[identity-match]";

// ---------------------------------------------------------------------------
// Registration (KTD-5)
// ---------------------------------------------------------------------------

export type IdentitySourceRegistrationErrorCode =
  | "connector_not_found"
  | "identity_rules_missing"
  | "invalid_input";

/** Typed registration failure — resolvers surface `code` + message as-is. */
export class IdentitySourceRegistrationError extends Error {
  constructor(
    readonly code: IdentitySourceRegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentitySourceRegistrationError";
  }
}

export interface RegisterIdentitySourceInput {
  tenantId: string;
  sourceSystem: string;
  connectorSlug: string;
  /** Entity types this source holds records for — each MUST have identity rules. */
  entityTypeSlugs: string[];
}

export interface RegisterIdentitySourceResult {
  tenantId: string;
  sourceSystem: string;
  connectorSlug: string;
  entityTypeSlugs: string[];
  routingMap: { agents: number; written: number };
}

export interface RegisterIdentitySourceDeps {
  db?: IdentityDbClient;
  /** Test seam — defaults to the shared routing-map materializer (U4). */
  refreshRoutingMap?: (
    db: IdentityDbClient,
    tenantId: string,
  ) => Promise<RoutingMapRefreshResult>;
}

/**
 * Register a source system as an identity source: validate the connector
 * row exists for the tenant and identity rules exist for every target
 * entity type, write the `source_system_connectors` link (upsert on the
 * (tenant, source_system) primary key), and re-project the routing map.
 */
export async function registerIdentitySource(
  input: RegisterIdentitySourceInput,
  deps: RegisterIdentitySourceDeps = {},
): Promise<RegisterIdentitySourceResult> {
  const db = deps.db ?? defaultDb;
  const sourceSystem = input.sourceSystem.trim();
  const connectorSlug = input.connectorSlug.trim();
  const entityTypeSlugs = [
    ...new Set(
      input.entityTypeSlugs.map((slug) => slug.trim()).filter(Boolean),
    ),
  ];
  if (!sourceSystem || !connectorSlug) {
    throw new IdentitySourceRegistrationError(
      "invalid_input",
      "sourceSystem and connectorSlug are required",
    );
  }
  if (entityTypeSlugs.length === 0) {
    throw new IdentitySourceRegistrationError(
      "invalid_input",
      "at least one entityTypeSlug is required",
    );
  }

  const [connector] = await db
    .select({ slug: tenantMcpServers.slug })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        eq(tenantMcpServers.slug, connectorSlug),
      ),
    )
    .limit(1);
  if (!connector) {
    throw new IdentitySourceRegistrationError(
      "connector_not_found",
      `no connector with slug "${connectorSlug}" exists for this tenant — ` +
        "register the connector (tenant_mcp_servers) before declaring it an identity source",
    );
  }

  // Identity rules must exist for every target type (ontology snapshot read
  // — approved types only, mirroring the matcher's rule source).
  const typeRows = await db
    .select({
      slug: ontologyEntityTypes.slug,
      identity_rules: ontologyEntityTypes.identity_rules,
    })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, input.tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
        inArray(ontologyEntityTypes.slug, entityTypeSlugs),
      ),
    );
  const rulesBySlug = new Map(
    typeRows.map((row) => [row.slug, parseIdentityRules(row.identity_rules)]),
  );
  const missing = entityTypeSlugs.filter(
    (slug) => (rulesBySlug.get(slug) ?? []).length === 0,
  );
  if (missing.length > 0) {
    throw new IdentitySourceRegistrationError(
      "identity_rules_missing",
      `entity type(s) ${missing.map((slug) => `"${slug}"`).join(", ")} have no ` +
        "approved identity rules — author identity rules for each target type " +
        "before registering an identity source against it",
    );
  }

  await db
    .insert(sourceSystemConnectors)
    .values({
      tenant_id: input.tenantId,
      source_system: sourceSystem,
      connector_slug: connectorSlug,
    })
    .onConflictDoUpdate({
      target: [
        sourceSystemConnectors.tenant_id,
        sourceSystemConnectors.source_system,
      ],
      set: { connector_slug: connectorSlug },
    });

  const refresh = deps.refreshRoutingMap ?? refreshRoutingMapFile;
  let routingMap: RoutingMapRefreshResult;
  try {
    routingMap = await refresh(db, input.tenantId);
  } catch (err) {
    // The registration write already landed; the map converges on the next
    // trigger. Best-effort, mirroring the U4 refresh posture.
    console.warn(
      `${LOG_PREFIX} routing-map refresh failed after registration:`,
      err instanceof Error ? err.message : err,
    );
    routingMap = { content: "", agents: 0, written: 0, skipped: [] };
  }

  return {
    tenantId: input.tenantId,
    sourceSystem,
    connectorSlug,
    entityTypeSlugs,
    routingMap: { agents: routingMap.agents, written: routingMap.written },
  };
}

/** Registered identity sources for a tenant (source_system → connector). */
export async function listRegisteredIdentitySources(
  db: IdentityDbClient,
  tenantId: string,
): Promise<Array<{ sourceSystem: string; connectorSlug: string }>> {
  const rows = await db
    .select({
      source_system: sourceSystemConnectors.source_system,
      connector_slug: sourceSystemConnectors.connector_slug,
    })
    .from(sourceSystemConnectors)
    .where(eq(sourceSystemConnectors.tenant_id, tenantId));
  return rows.map((row) => ({
    sourceSystem: row.source_system,
    connectorSlug: row.connector_slug,
  }));
}

// ---------------------------------------------------------------------------
// Dedupe keys (KTD-7)
// ---------------------------------------------------------------------------

export const IDENTITY_MATCH_BUCKET_SECONDS = 300;

export function buildIdentityMatchDedupeKey(args: {
  tenantId: string;
  trigger?: string | null;
  now?: Date;
}): string {
  const bucket = Math.floor(
    (args.now ?? new Date()).valueOf() / 1000 / IDENTITY_MATCH_BUCKET_SECONDS,
  );
  return `identity-match:${args.tenantId}:${args.trigger || "manual"}:${bucket}`;
}

/**
 * Continuation dedupe key derived from the PREDECESSOR'S key — never from
 * wall-clock or created_at (both drift relative to the key; see the
 * compile-continuation bucket learning). A standard `...:{bucket}` key
 * advances to bucket+1; a non-standard key gets a `:c{n}` chain suffix.
 */
export function deriveContinuationDedupeKey(predecessorKey: string): string {
  const parts = predecessorKey.split(":");
  const last = parts[parts.length - 1] ?? "";
  const chain = last.match(/^c(\d+)$/);
  if (chain) {
    parts[parts.length - 1] = `c${Number(chain[1]) + 1}`;
    return parts.join(":");
  }
  if (/^\d+$/.test(last)) {
    parts[parts.length - 1] = String(Number(last) + 1);
    return parts.join(":");
  }
  return `${predecessorKey}:c1`;
}

// ---------------------------------------------------------------------------
// Job row mapping / loading
// ---------------------------------------------------------------------------

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Map a match_jobs row to the GraphQL IdentityMatchJob shape. */
export function toIdentityMatchJob(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    status: String(row.status ?? "pending").toUpperCase(),
    trigger: (row.trigger as string) ?? "manual",
    dedupeKey: (row.dedupe_key as string | null) ?? null,
    sourceSystems: Array.isArray(row.source_systems)
      ? (row.source_systems as string[])
      : [],
    result: (row.result as Record<string, unknown>) ?? {},
    metrics: (row.metrics as Record<string, unknown>) ?? {},
    error: (row.error as string | null) ?? null,
    createdAt: iso(row.created_at as Date | string | null),
    startedAt: iso(row.started_at as Date | string | null),
    finishedAt: iso(row.finished_at as Date | string | null),
  };
}

export async function loadIdentityMatchJob(args: {
  tenantId: string;
  jobId: string;
  db?: IdentityDbClient;
}) {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .select()
    .from(identityMatchJobs)
    .where(
      and(
        eq(identityMatchJobs.id, args.jobId),
        eq(identityMatchJobs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  return job ? toIdentityMatchJob(job as Record<string, unknown>) : null;
}

async function updateMatchJob(
  db: IdentityDbClient,
  jobId: string,
  values: Partial<typeof identityMatchJobs.$inferInsert>,
) {
  await db
    .update(identityMatchJobs)
    .set(values)
    .where(eq(identityMatchJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Start (dedupe insert-or-load + Event invoke — the suggestion-scan mirror)
// ---------------------------------------------------------------------------

export interface StartIdentityMatchJobArgs {
  tenantId: string;
  trigger?: string | null;
  dedupeKey?: string | null;
  /** Subset of registered source systems to scan; empty/omitted = all. */
  sourceSystems?: string[] | null;
  /** Continuation seed (cursors from the predecessor) — internal use. */
  seedResult?: Record<string, unknown>;
  db?: IdentityDbClient;
  invoke?: boolean;
  lambdaClient?: Pick<LambdaClient, "send">;
}

export async function startIdentityMatchJob(args: StartIdentityMatchJobArgs) {
  const db = args.db ?? defaultDb;
  const dedupeKey =
    args.dedupeKey ??
    buildIdentityMatchDedupeKey({
      tenantId: args.tenantId,
      trigger: args.trigger,
    });

  const [existing] = await db
    .select()
    .from(identityMatchJobs)
    .where(
      and(
        eq(identityMatchJobs.tenant_id, args.tenantId),
        eq(identityMatchJobs.dedupe_key, dedupeKey),
      ),
    )
    .limit(1);

  const created = existing
    ? { job: existing, deduped: true }
    : await insertOrLoadMatchJob({
        tenantId: args.tenantId,
        trigger: args.trigger || "manual",
        dedupeKey,
        sourceSystems: args.sourceSystems ?? [],
        seedResult: args.seedResult,
        db,
      });
  const { job } = created;
  if (!job) {
    throw new Error("Identity match job could not be created");
  }

  const mapped = toIdentityMatchJob(job as Record<string, unknown>);
  if (args.invoke !== false && shouldInvokeMatch(String(job.status))) {
    try {
      const invokeResult = await invokeIdentityMatch({
        tenantId: args.tenantId,
        jobId: job.id as string,
        lambdaClient: args.lambdaClient,
      });
      return {
        ...mapped,
        result: {
          ...(mapped.result ?? {}),
          invoke: invokeResult,
          deduped: created.deduped,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = {
        ...(mapped.result ?? {}),
        invoke: { state: "error", error: message },
        deduped: created.deduped,
      };
      await updateMatchJob(db, job.id as string, {
        status: "failed",
        finished_at: new Date(),
        error: message,
        result,
        metrics: { invokeFailure: true },
      });
      return (
        (await loadIdentityMatchJob({
          tenantId: args.tenantId,
          jobId: job.id as string,
          db,
        })) ?? {
          ...mapped,
          status: "FAILED",
          error: message,
          result,
          metrics: { invokeFailure: true },
        }
      );
    }
  }

  return {
    ...mapped,
    result: {
      ...(mapped.result ?? {}),
      deduped: created.deduped,
      invoke: { state: "skipped" },
    },
  };
}

async function insertOrLoadMatchJob(args: {
  tenantId: string;
  trigger: string;
  dedupeKey: string;
  sourceSystems: string[];
  seedResult?: Record<string, unknown>;
  db: IdentityDbClient;
}) {
  const [inserted] = await args.db
    .insert(identityMatchJobs)
    .values({
      tenant_id: args.tenantId,
      trigger: args.trigger,
      dedupe_key: args.dedupeKey,
      source_systems: args.sourceSystems,
      status: "pending",
      result: args.seedResult ?? {},
      metrics: {},
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return { job: inserted, deduped: false };

  const [existing] = await args.db
    .select()
    .from(identityMatchJobs)
    .where(
      and(
        eq(identityMatchJobs.tenant_id, args.tenantId),
        eq(identityMatchJobs.dedupe_key, args.dedupeKey),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(
      `Identity match job dedupe conflict but no existing job was found for key=${args.dedupeKey}`,
    );
  }
  return { job: existing, deduped: true };
}

function shouldInvokeMatch(status: string) {
  return status === "pending" || status === "failed";
}

export async function invokeIdentityMatch(args: {
  tenantId: string;
  jobId: string;
  lambdaClient?: Pick<LambdaClient, "send">;
}) {
  const functionName =
    process.env.IDENTITY_MATCH_FUNCTION_NAME ||
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-identity-match`
      : "");
  if (!functionName) {
    return { state: "skipped", reason: "IDENTITY_MATCH_FUNCTION_NAME unset" };
  }
  const client =
    args.lambdaClient ??
    new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({ tenantId: args.tenantId, jobId: args.jobId }),
      ),
    }),
  );
  return { state: "invoked", functionName };
}

// ---------------------------------------------------------------------------
// Run (the identity-match handler's core)
// ---------------------------------------------------------------------------

/** One source record normalized for matching. */
export interface IdentitySourceRecord {
  entityTypeSlug: string;
  externalId: string;
  namespace?: string;
  displayName: string;
  naturalKeys: Array<{ keyKind: string; rawValue: string }>;
}

export interface SourceFetchArgs {
  tenantId: string;
  jobId: string;
  sourceSystem: string;
  connectorSlug: string;
  entityTypeSlugs: string[];
  rulesByType: Map<string, IdentityRule[]>;
  /** Opaque per-source continuation cursor from the predecessor job. */
  cursor: Record<string, unknown> | null;
  /** Max records to return this call. */
  limit: number;
}

export interface SourceFetchResult {
  records: IdentitySourceRecord[];
  /** Cursor to resume from; null when drained. */
  cursor: Record<string, unknown> | null;
  /** True when the source has no more records after this batch. */
  drained: boolean;
  /** Non-fatal per-source diagnostics (e.g. unresolvable entity types). */
  warnings?: string[];
}

export type SourceRecordFetcher = (
  args: SourceFetchArgs,
) => Promise<SourceFetchResult>;

export interface IdentityMatchMetrics {
  scanned: number;
  alreadyMapped: number;
  autoLinked: number;
  created: number;
  casesFiled: number;
  casesCoalesced: number;
  /** Total cases expired by budget enforcement DURING this run (F4). */
  casesExpired: number;
  /** The 200-cap displacement subset of casesExpired — never silent. */
  casesExpiredOverBudget: number;
  staleMappings: number;
  errors: number;
  continuationEnqueued: number;
}

export interface RunIdentityMatchDeps {
  db?: IdentityDbClient;
  /** Source fetcher — defaults to the real connector-backed fetcher. */
  fetchSourceRecords?: SourceRecordFetcher;
  /** Matcher seam (defaults to matchCanonicalEntity). */
  matchEntity?: (
    db: IdentityDbClient,
    request: MatchRequest,
    rules: IdentityRule[],
  ) => Promise<MatchVerdict>;
  /** Case writer seam (defaults to openOrCoalesceResolutionCase). */
  openCase?: (
    db: IdentityDbClient,
    input: OpenResolutionCaseInput,
  ) => Promise<OpenResolutionCaseResult>;
  /** Budget seam — observed so displacement lands in metrics (F4). */
  enforceBudgets?: (
    db: IdentityDbClient,
    tenantId: string,
  ) => Promise<{ expiredStale: number; expiredOverBudget: number }>;
  /** Continuation starter (defaults to startIdentityMatchJob). */
  startContinuation?: typeof startIdentityMatchJob;
  /** Per-run record budget before chaining a continuation job. */
  maxRecords?: number;
}

export const IDENTITY_MATCH_MAX_RECORDS_PER_RUN = 500;

/** Cap on stale-mapping cases filed per run (drift hygiene, not a purge). */
const MAX_STALE_CASES_PER_RUN = 50;

export interface RunIdentityMatchResult {
  jobId: string;
  tenantId: string;
  status: "succeeded" | "failed";
  metrics: IdentityMatchMetrics;
  error?: string;
}

/**
 * Execute one identity match job: fetch source rows per registered source
 * system, feed each through the matcher, write mappings / cases per
 * verdict, surface budget displacement, detect stale mappings on drained
 * drift scans, and chain a continuation when the record budget runs out.
 */
export async function runIdentityMatchJob(
  args: { tenantId: string; jobId: string },
  deps: RunIdentityMatchDeps = {},
): Promise<RunIdentityMatchResult> {
  const db = deps.db ?? defaultDb;
  const matchEntity = deps.matchEntity ?? matchCanonicalEntity;
  const openCase = deps.openCase ?? openOrCoalesceResolutionCase;
  const enforceBudgets = deps.enforceBudgets ?? enforceQueueBudgets;
  const startContinuation = deps.startContinuation ?? startIdentityMatchJob;
  const maxRecords = deps.maxRecords ?? IDENTITY_MATCH_MAX_RECORDS_PER_RUN;

  const [job] = await db
    .select()
    .from(identityMatchJobs)
    .where(
      and(
        eq(identityMatchJobs.id, args.jobId),
        eq(identityMatchJobs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!job) throw new Error("Identity match job not found");

  await updateMatchJob(db, args.jobId, {
    status: "running",
    started_at: new Date(),
    error: null,
  });

  const metrics: IdentityMatchMetrics = {
    scanned: 0,
    alreadyMapped: 0,
    autoLinked: 0,
    created: 0,
    casesFiled: 0,
    casesCoalesced: 0,
    casesExpired: 0,
    casesExpiredOverBudget: 0,
    staleMappings: 0,
    errors: 0,
    continuationEnqueued: 0,
  };
  const errorSamples: string[] = [];
  const warnings: string[] = [];
  const recordError = (message: string) => {
    metrics.errors += 1;
    if (errorSamples.length < 10) errorSamples.push(message);
    console.warn(`${LOG_PREFIX} ${message}`);
  };

  try {
    if (!deps.fetchSourceRecords) {
      // Lazy import keeps the pure orchestration testable without the
      // network-facing fetcher module's transitive imports.
      const { createDefaultSourceRecordFetcher } =
        await import("./source-fetchers.js");
      deps = {
        ...deps,
        fetchSourceRecords: createDefaultSourceRecordFetcher(),
      };
    }
    const fetchSourceRecords = deps.fetchSourceRecords!;

    const registered = await listRegisteredIdentitySources(db, args.tenantId);
    const requested = Array.isArray(job.source_systems)
      ? (job.source_systems as string[]).filter(Boolean)
      : [];
    const targets =
      requested.length > 0
        ? registered.filter((s) => requested.includes(s.sourceSystem))
        : registered;
    if (targets.length === 0) {
      warnings.push(
        requested.length > 0
          ? `none of the requested source systems (${requested.join(", ")}) are registered identity sources`
          : "no registered identity sources for this tenant",
      );
    }

    // Scan targets per source: approved entity types whose system_map
    // declares the source system (U3's persisted linkage), restricted to
    // types with identity rules.
    const typeRows = await db
      .select({
        slug: ontologyEntityTypes.slug,
        identity_rules: ontologyEntityTypes.identity_rules,
        system_map: ontologyEntityTypes.system_map,
      })
      .from(ontologyEntityTypes)
      .where(
        and(
          eq(ontologyEntityTypes.tenant_id, args.tenantId),
          eq(ontologyEntityTypes.lifecycle_status, "approved"),
        ),
      );
    const rulesByType = new Map<string, IdentityRule[]>();
    const typesBySource = new Map<string, string[]>();
    for (const row of typeRows) {
      const rules = parseIdentityRules(row.identity_rules);
      rulesByType.set(
        row.slug,
        rules.length > 0 ? rules : defaultIdentityRules(),
      );
      const entries = Array.isArray(row.system_map)
        ? (row.system_map as Array<Record<string, unknown>>)
        : [];
      for (const entry of entries) {
        const source =
          typeof entry?.sourceSystem === "string" ? entry.sourceSystem : null;
        if (!source) continue;
        const list = typesBySource.get(source) ?? [];
        if (!list.includes(row.slug)) list.push(row.slug);
        typesBySource.set(source, list);
      }
    }

    const priorCursors =
      ((job.result as Record<string, unknown> | null)?.cursors as
        | Record<string, unknown>
        | undefined) ?? {};
    const nextCursors: Record<string, unknown> = {};
    const undrained: string[] = [];
    let remaining = maxRecords;

    for (const target of targets) {
      const entityTypeSlugs = (
        typesBySource.get(target.sourceSystem) ?? []
      ).sort();
      if (entityTypeSlugs.length === 0) {
        warnings.push(
          `source "${target.sourceSystem}" has no approved entity type declaring it in system_map — nothing to scan`,
        );
        continue;
      }
      if (remaining <= 0) {
        undrained.push(target.sourceSystem);
        const prior = priorCursors[target.sourceSystem];
        if (prior !== undefined) nextCursors[target.sourceSystem] = prior;
        continue;
      }

      let fetch: SourceFetchResult;
      try {
        fetch = await fetchSourceRecords({
          tenantId: args.tenantId,
          jobId: args.jobId,
          sourceSystem: target.sourceSystem,
          connectorSlug: target.connectorSlug,
          entityTypeSlugs,
          rulesByType,
          cursor:
            (priorCursors[target.sourceSystem] as Record<
              string,
              unknown
            > | null) ?? null,
          limit: remaining,
        });
      } catch (err) {
        recordError(
          `source "${target.sourceSystem}" fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      for (const warning of fetch.warnings ?? []) {
        warnings.push(`[${target.sourceSystem}] ${warning}`);
      }
      remaining -= fetch.records.length;

      const seen = new Set<string>();
      for (const record of fetch.records) {
        metrics.scanned += 1;
        seen.add(`${record.namespace ?? ""} ${record.externalId}`);
        try {
          await processSourceRecord({
            db,
            tenantId: args.tenantId,
            jobId: args.jobId,
            sourceSystem: target.sourceSystem,
            record,
            rules:
              rulesByType.get(record.entityTypeSlug) ?? defaultIdentityRules(),
            matchEntity,
            openCase,
            enforceBudgets,
            metrics,
          });
        } catch (err) {
          recordError(
            `record ${target.sourceSystem}:${record.externalId} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (!fetch.drained) {
        undrained.push(target.sourceSystem);
        if (fetch.cursor) nextCursors[target.sourceSystem] = fetch.cursor;
        continue;
      }

      // Stale detection (R10 / AE4): a mapping whose source record no
      // longer appears in a fully-drained scan files a case — NEVER an
      // auto-revoke. Only meaningful when this run saw the whole source
      // (a continuation chain covers the tail on its own drained pass).
      const startedFresh = priorCursors[target.sourceSystem] == null;
      if (startedFresh) {
        try {
          await fileStaleMappingCases({
            db,
            tenantId: args.tenantId,
            sourceSystem: target.sourceSystem,
            seen,
            openCase,
            enforceBudgets,
            metrics,
          });
        } catch (err) {
          recordError(
            `stale-mapping sweep for "${target.sourceSystem}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Continuation: derive the next dedupe key from THIS job's key (never
    // wall-clock) and seed the child with the surviving cursors. A dedupe
    // collision is surfaced in metrics instead of silently dropping the
    // chain.
    if (undrained.length > 0 && job.dedupe_key) {
      const continuationKey = deriveContinuationDedupeKey(job.dedupe_key);
      const child = await startContinuation({
        tenantId: args.tenantId,
        trigger: job.trigger,
        dedupeKey: continuationKey,
        sourceSystems: undrained,
        seedResult: { continuationOf: args.jobId, cursors: nextCursors },
        db,
      });
      const childResult = (child.result ?? {}) as Record<string, unknown>;
      if (childResult.deduped === true) {
        warnings.push(
          `continuation dedupe collision on key ${continuationKey} — an existing job already occupies it`,
        );
      } else {
        metrics.continuationEnqueued = 1;
      }
    } else if (undrained.length > 0) {
      warnings.push(
        "sources remain undrained but the job has no dedupe key — cannot derive a continuation key",
      );
    }

    await updateMatchJob(db, args.jobId, {
      status: "succeeded",
      finished_at: new Date(),
      metrics: metrics as unknown as Record<string, unknown>,
      result: {
        ...((job.result as Record<string, unknown>) ?? {}),
        cursors: nextCursors,
        undrained,
        warnings,
        ...(errorSamples.length > 0 ? { errorSamples } : {}),
      },
    });
    return {
      jobId: args.jobId,
      tenantId: args.tenantId,
      status: "succeeded",
      metrics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateMatchJob(db, args.jobId, {
      status: "failed",
      finished_at: new Date(),
      error: message,
      metrics: metrics as unknown as Record<string, unknown>,
    });
    return {
      jobId: args.jobId,
      tenantId: args.tenantId,
      status: "failed",
      metrics,
      error: message,
    };
  }
}

async function processSourceRecord(args: {
  db: IdentityDbClient;
  tenantId: string;
  jobId: string;
  sourceSystem: string;
  record: IdentitySourceRecord;
  rules: IdentityRule[];
  matchEntity: NonNullable<RunIdentityMatchDeps["matchEntity"]>;
  openCase: NonNullable<RunIdentityMatchDeps["openCase"]>;
  enforceBudgets: NonNullable<RunIdentityMatchDeps["enforceBudgets"]>;
  metrics: IdentityMatchMetrics;
}): Promise<void> {
  const { db, record, metrics } = args;
  const sourceKey = {
    sourceSystem: args.sourceSystem,
    namespace: record.namespace ?? "",
    externalId: record.externalId,
  };
  const request: MatchRequest = {
    tenantId: args.tenantId,
    entityTypeSlug: record.entityTypeSlug,
    displayName: record.displayName,
    visibility: "tenant",
    sourceKeys: [sourceKey],
    naturalKeys: record.naturalKeys,
  };
  const verdict = await args.matchEntity(db, request, args.rules);
  const normalizedKeys = normalizeNaturalKeys(request, args.rules);
  const identityKeys = normalizedKeys.map((key) => ({
    keyKind: key.keyKind,
    normalizedValue: key.normalizedValue,
  }));

  switch (verdict.kind) {
    case "exact":
      metrics.alreadyMapped += 1;
      return;
    case "auto_link": {
      await attachIdentityEvidence(db, {
        tenantId: args.tenantId,
        canonicalEntityId: verdict.canonicalEntityId,
        createdBy: "rule",
        sourceKeys: [sourceKey],
        identityKeys: identityKeys.map((key) => ({
          ...key,
          ruleSlug: verdict.ruleSlug,
        })),
      });
      await appendResolutionEvent(db, {
        tenantId: args.tenantId,
        caseId: null,
        canonicalEntityId: verdict.canonicalEntityId,
        eventType: "link",
        actorUserId: null,
        payload: {
          jobId: args.jobId,
          sourceSystem: args.sourceSystem,
          externalId: record.externalId,
          ruleSlug: verdict.ruleSlug,
          createdBy: "rule",
        },
      });
      metrics.autoLinked += 1;
      return;
    }
    case "new": {
      await createCanonicalEntity(db, {
        tenantId: args.tenantId,
        entityTypeSlug: record.entityTypeSlug,
        displayName: record.displayName,
        createdBy: "rule",
        sourceKeys: [sourceKey],
        identityKeys,
      });
      metrics.created += 1;
      return;
    }
    case "private_unmapped":
      // Unreachable with visibility 'tenant'; guard defensively.
      return;
    case "suggestion":
    case "ambiguous": {
      // Observe budget enforcement HERE so displacement lands in metrics
      // (F4 — the silent oldest-expiry in resolution.ts becomes visible).
      const budget = await args.enforceBudgets(db, args.tenantId);
      metrics.casesExpired += budget.expiredStale + budget.expiredOverBudget;
      metrics.casesExpiredOverBudget += budget.expiredOverBudget;

      const signatureKeys =
        identityKeys.length > 0
          ? identityKeys
          : [
              {
                keyKind: "source",
                normalizedValue: `${sourceKey.sourceSystem}:${sourceKey.namespace}:${sourceKey.externalId}`,
              },
            ];
      const candidates =
        verdict.kind === "ambiguous"
          ? verdict.candidates.map((candidate) => ({
              canonicalEntityId: candidate.canonicalEntityId,
              displayName: candidate.displayName,
              matchedKeyKinds: candidate.matchedKeyKinds,
            }))
          : [
              {
                canonicalEntityId: verdict.canonicalEntityId,
                displayName: null,
                matchedKeyKinds: verdict.matchedKeyKinds,
              },
            ];
      const opened = await args.openCase(db, {
        tenantId: args.tenantId,
        signatureHash: computeIdentitySignature({
          entityTypeSlug: record.entityTypeSlug,
          keys: signatureKeys,
        }),
        entityTypeSlug: record.entityTypeSlug,
        displayHint: record.displayName,
        candidates,
        conflictingClaims: [],
        impactSummary: {
          jobId: args.jobId,
          sourceSystem: args.sourceSystem,
          externalId: record.externalId,
          namespace: sourceKey.namespace,
        },
        pendingKeys: identityKeys,
      });
      if (opened.coalesced) metrics.casesCoalesced += 1;
      else metrics.casesFiled += 1;
      return;
    }
  }
}

/**
 * File a case for every mapping whose source record was NOT seen in a
 * fully-drained scan (deleted/archived upstream). The mapping is flagged in
 * the case payload — never auto-revoked; revoke is an operator decision.
 */
async function fileStaleMappingCases(args: {
  db: IdentityDbClient;
  tenantId: string;
  sourceSystem: string;
  seen: Set<string>;
  openCase: NonNullable<RunIdentityMatchDeps["openCase"]>;
  enforceBudgets: NonNullable<RunIdentityMatchDeps["enforceBudgets"]>;
  metrics: IdentityMatchMetrics;
}): Promise<void> {
  const rows = await args.db
    .select({
      id: entitySourceMappings.id,
      namespace: entitySourceMappings.namespace,
      external_id: entitySourceMappings.external_id,
      canonical_entity_id: entitySourceMappings.canonical_entity_id,
    })
    .from(entitySourceMappings)
    .where(
      and(
        eq(entitySourceMappings.tenant_id, args.tenantId),
        eq(entitySourceMappings.source_system, args.sourceSystem),
        eq(entitySourceMappings.visibility, "tenant"),
      ),
    );
  let filed = 0;
  for (const row of rows) {
    if (filed >= MAX_STALE_CASES_PER_RUN) break;
    if (args.seen.has(`${row.namespace} ${row.external_id}`)) continue;

    const budget = await args.enforceBudgets(args.db, args.tenantId);
    args.metrics.casesExpired += budget.expiredStale + budget.expiredOverBudget;
    args.metrics.casesExpiredOverBudget += budget.expiredOverBudget;

    const opened = await args.openCase(args.db, {
      tenantId: args.tenantId,
      signatureHash: computeIdentitySignature({
        entityTypeSlug: "__stale_mapping__",
        keys: [
          {
            keyKind: "source",
            normalizedValue: `${args.sourceSystem}:${row.namespace}:${row.external_id}`,
          },
        ],
      }),
      entityTypeSlug: "__stale_mapping__",
      displayHint: `${args.sourceSystem} record ${row.external_id} no longer exists`,
      candidates: [
        { canonicalEntityId: row.canonical_entity_id, displayName: null },
      ],
      conflictingClaims: [],
      impactSummary: {
        staleMapping: true,
        mappingId: row.id,
        sourceSystem: args.sourceSystem,
        namespace: row.namespace,
        externalId: row.external_id,
      },
    });
    args.metrics.staleMappings += 1;
    if (opened.coalesced) args.metrics.casesCoalesced += 1;
    else args.metrics.casesFiled += 1;
    filed += 1;
  }
}
