/**
 * Observations → Knowledge Graph ingest worker.
 *
 * Reads engine-synthesized Hindsight observations across the tenant's user
 * banks (U4 loader + layered promotion gate), ingests the promoted bundle
 * into the tenant's STABLE source dataset, and refreshes the Aurora mirror
 * crash-safely: mirror replace, cursor advance, promotion audit, and run
 * completion all commit in ONE transaction. extractor writes are at-least-once;
 * the rendered document embeds each observation's Hindsight id
 * (`<!-- source_packet:<id> ... -->`), so a crash between cognify and
 * snapshot re-sends identical content on the re-read instead of duplicating.
 */

import { eq, sql } from "drizzle-orm";
import {
  kgIngestRuns,
  kgObservationCursors,
  tenants,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../lib/db.js";
import { db as defaultDb } from "../lib/db.js";
import { extractGraphFromPackets } from "../lib/knowledge-graph/bedrock-graph-extractor.js";
import {
  redactedSourceRef,
  writeKnowledgeGraphIngestArtifacts,
} from "../lib/knowledge-graph/artifacts.js";
import { normalizeExtractedGraph } from "../lib/knowledge-graph/normalizer.js";
import { loadApprovedOntologyExport } from "../lib/knowledge-graph/ontology-export.js";
import { loadObservationsKnowledgeGraphSource } from "../lib/knowledge-graph/observations-source.js";
import {
  loadKnowledgeGraphIngestRun,
  markKnowledgeGraphRunFailed,
  markKnowledgeGraphRunRunning,
  markKnowledgeGraphRunStaleNoop,
  mergeKnowledgeGraphSnapshot,
  purgeKnowledgeGraphSource,
  type DatabaseTransaction,
} from "../lib/knowledge-graph/repository.js";
import {
  createKnowledgeGraphObservationsIngestRun,
  reapStaleObservationIngestRuns,
} from "../lib/knowledge-graph/runs.js";
import { applySourceDeclaredFallback } from "../lib/knowledge-graph/source-fallback.js";
import { resolveSnapshotCanonicalIdentity } from "../lib/entity-identity/snapshot-resolution.js";
import {
  enqueueGraphWikiCompileTx,
  invokeWikiCompile,
  type GraphCompileTxEnqueueResult,
} from "../lib/wiki/enqueue.js";

export interface KnowledgeGraphObservationsIngestEvent {
  runId?: string;
  tenantId?: string;
  /** Scheduled drainer mode — enumerate all tenants and run each. */
  sweep?: boolean;
  fullRebuild?: boolean;
  trigger?: "manual" | "scheduled";
  /**
   * Targeted shared-bank ingest (THINK-193 U4): restrict the read to these
   * banks. Only `space_*` / `tenant_*` are accepted — `user_*` rejects (the
   * estate sweep remains the personal-bank path).
   */
  bankIds?: string[];
}

export interface KnowledgeGraphObservationsIngestResult {
  ok: boolean;
  status: "succeeded" | "failed" | "stale_noop" | "skipped" | "sweep";
  runId?: string;
  tenantId?: string;
  metrics?: Record<string, unknown>;
  error?: string;
  results?: KnowledgeGraphObservationsIngestResult[];
  /** Internal drain signal: this sweep hit the per-run candidate cap AND
   * made forward progress, so more candidates are waiting. Consumed by the
   * in-process drain loop — never by cross-invocation recursion. */
  continueDrain?: boolean;
}

interface KnowledgeGraphObservationsIngestDeps {
  db?: Database;
  /** Bedrock graph extractor; injectable for tests. Defaults to the real
   * `extractGraphFromPackets`. */
  extractor?: typeof extractGraphFromPackets;
  /** Clock for the drain-loop budget; injectable for tests. */
  now?: () => number;
}

/**
 * Per-run candidate cap. A 500-candidate backlog times out a 480 s Lambda
 * (classifier batches dominate); 100 keeps one run comfortably inside the
 * budget and the in-process drain loop works through the rest. Env read
 * inside the function (Lambda env + vitest env-timing rule).
 */
const DEFAULT_MAX_CANDIDATES_PER_RUN = 100;

function maxCandidatesPerRun(): number {
  const raw = process.env.KG_OBS_MAX_CANDIDATES_PER_RUN;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CANDIDATES_PER_RUN;
}

/**
 * In-process drain budget. The Lambda timeout is 480 s; the loop starts a
 * new sweep only while elapsed time is under this budget, leaving headroom
 * for the final sweep to finish. NEVER replace this loop with a Lambda
 * self-invoke: Lambda's recursive-loop detection terminates worker-to-self
 * Event chains after 16 hops (AWS Health flagged exactly that on dev,
 * 2026-07-03) — the scheduled sweep is the only cross-invocation cadence.
 */
const DEFAULT_DRAIN_BUDGET_MS = 360_000;

function drainBudgetMs(): number {
  const raw = process.env.KG_OBS_DRAIN_BUDGET_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_DRAIN_BUDGET_MS;
}

export async function handler(
  event: KnowledgeGraphObservationsIngestEvent,
): Promise<KnowledgeGraphObservationsIngestResult> {
  return processKnowledgeGraphObservationsIngest(event);
}

export async function processKnowledgeGraphObservationsIngest(
  event: KnowledgeGraphObservationsIngestEvent,
  deps: KnowledgeGraphObservationsIngestDeps = {},
): Promise<KnowledgeGraphObservationsIngestResult> {
  const database = deps.db ?? defaultDb;

  if (event.sweep) {
    const tenantRows = await database.select({ id: tenants.id }).from(tenants);
    const results: KnowledgeGraphObservationsIngestResult[] = [];
    for (const tenant of tenantRows) {
      results.push(
        await drainTenantObservationsIngest(
          {
            tenantId: tenant.id,
            fullRebuild: event.fullRebuild,
            trigger: event.trigger ?? "scheduled",
          },
          deps,
          database,
        ),
      );
    }
    return {
      ok: results.every((result) => result.ok),
      status: "sweep",
      results,
    };
  }

  if (!event.tenantId) {
    throw new Error("tenantId is required unless sweep is set");
  }
  return drainTenantObservationsIngest(
    {
      tenantId: event.tenantId,
      runId: event.runId,
      fullRebuild: event.fullRebuild,
      trigger: event.trigger ?? "manual",
      bankIds: event.bankIds,
    },
    deps,
    database,
  );
}

/**
 * Drains a tenant's observation backlog with repeated sweeps INSIDE this
 * invocation, bounded by the drain budget. Replaces the retired Lambda
 * self-invoke chain (AWS recursive-loop detection dropped those chains at
 * 16 hops and flagged the account — see drainBudgetMs). The scheduled
 * 30-minute sweep remains the cross-invocation backstop for backlogs
 * larger than one budget's worth.
 */
async function drainTenantObservationsIngest(
  args: {
    tenantId: string;
    runId?: string;
    fullRebuild?: boolean;
    trigger: "manual" | "scheduled";
    bankIds?: string[];
  },
  deps: KnowledgeGraphObservationsIngestDeps,
  database: Database,
): Promise<KnowledgeGraphObservationsIngestResult> {
  const now = deps.now ?? Date.now;
  const drainStartedAt = now();
  const budget = drainBudgetMs();
  let sweeps = 0;
  for (;;) {
    const result = await processTenantObservationsIngest(
      {
        ...args,
        // Explicit runId and fullRebuild apply to the first sweep only:
        // follow-up sweeps are fresh runs, and re-purging would discard
        // the graph the first sweep just wrote.
        runId: sweeps === 0 ? args.runId : undefined,
        fullRebuild: sweeps === 0 ? args.fullRebuild : false,
      },
      deps,
      database,
    );
    sweeps += 1;
    const budgetExhausted = now() - drainStartedAt >= budget;
    if (!result.continueDrain || result.status !== "succeeded") {
      return { ...result, metrics: { ...result.metrics, drainSweeps: sweeps } };
    }
    if (budgetExhausted) {
      return {
        ...result,
        metrics: {
          ...result.metrics,
          drainSweeps: sweeps,
          drainBudgetExhausted: true,
        },
      };
    }
  }
}

async function processTenantObservationsIngest(
  args: {
    tenantId: string;
    runId?: string;
    fullRebuild?: boolean;
    trigger: "manual" | "scheduled";
    bankIds?: string[];
  },
  deps: KnowledgeGraphObservationsIngestDeps,
  database: Database,
): Promise<KnowledgeGraphObservationsIngestResult> {
  const startedAt = new Date();
  await reapStaleObservationIngestRuns({
    db: database,
    tenantId: args.tenantId,
  });

  let run;
  if (args.runId) {
    run = await loadKnowledgeGraphIngestRun({
      db: database,
      runId: args.runId,
      tenantId: args.tenantId,
      sourceKind: "observations",
    });
    if (!run) {
      return {
        ok: false,
        runId: args.runId,
        tenantId: args.tenantId,
        status: "failed",
        error: "Knowledge Graph observations ingest run not found",
      };
    }
  } else {
    const { run: created, inserted } =
      await createKnowledgeGraphObservationsIngestRun({
        db: database,
        tenantId: args.tenantId,
        requestedByUserId: null,
        trigger: args.trigger,
        fullRebuild: args.fullRebuild,
      });
    if (!inserted) {
      // Active run already exists — conflict-dropped by the unique index.
      return {
        ok: true,
        runId: created.id,
        tenantId: args.tenantId,
        status: "skipped",
      };
    }
    run = created;
  }

  const runInput = run.input as Record<string, unknown> | null;
  const fullRebuild =
    args.fullRebuild === true || runInput?.fullRebuild === true;

  try {
    await markKnowledgeGraphRunRunning({ db: database, runId: run.id });

    if (fullRebuild) {
      // Reset cursors to epoch BEFORE reading so the whole corpus re-reads,
      // and wipe the mirror for this source so the merge-upsert re-seeds
      // from empty (the merge path is additive and never deletes on absence,
      // so a rebuild must purge explicitly).
      await database
        .delete(kgObservationCursors)
        .where(eq(kgObservationCursors.tenant_id, args.tenantId));
      await purgeKnowledgeGraphSource({
        db: database,
        tenantId: run.tenant_id,
        sourceKind: run.source_kind,
        sourceRef: run.source_ref,
      });
    }

    const ontology = await loadApprovedOntologyExport({
      db: database,
      tenantId: run.tenant_id,
    });
    const source = await loadObservationsKnowledgeGraphSource({
      db: database,
      tenantId: run.tenant_id,
      sourceRef: run.source_ref,
      sourceLabel: run.source_label ?? "Hindsight observations",
      maxCandidates: maxCandidatesPerRun(),
      bankIds: args.bankIds,
      // THINK-245 U6: attribute classifier spend to the tenant/run.
      gateDeps: {
        costContext: { tenantId: run.tenant_id, runId: run.id },
      },
    });

    const auditMetrics = {
      sourceKind: run.source_kind,
      sourceRefHash: redactedSourceRef(run.source_ref),
      candidateCount: source.candidateCount,
      truncated: source.truncated,
      promotedIds: source.gate.audit.promotedIds,
      excludedCounts: source.gate.audit.excludedCounts,
      classifierModelId: source.gate.audit.classifierModelId,
      classifierPromptVersion: source.gate.audit.classifierPromptVersion,
      // Pipeline-lag signal (R9): newest candidate cursor timestamp.
      newestCandidateCursorAt: newestCursorTimestamp(source.nextCursors),
    };

    if (source.candidateCount === 0) {
      await markKnowledgeGraphRunStaleNoop({
        db: database,
        runId: run.id,
        startedAt,
        metrics: auditMetrics,
      });
      return {
        ok: true,
        runId: run.id,
        tenantId: args.tenantId,
        status: "stale_noop",
        metrics: auditMetrics,
      };
    }

    const artifactWrite = await writeKnowledgeGraphIngestArtifacts({
      db: database,
      run,
      source: source.bundle,
      ontology,
    });

    const extractor = deps.extractor ?? extractGraphFromPackets;
    const extraction = await extractor({
      packets: source.bundle.packets,
      ontology,
      // THINK-245 U6: attribute extraction spend to the tenant/run.
      costContext: { tenantId: run.tenant_id, runId: run.id },
    });

    // A batch that failed after the retry envelope means observations went
    // unextracted. Fail the run WITHOUT writing the mirror or advancing
    // cursors, so the next sweep re-reads the same candidates — advancing
    // past unextracted observations would be silent permanent knowledge
    // loss (R2/AE2). Transient flakes are already absorbed by the extractor's
    // per-batch retry envelope; a post-retry drop is worth re-running.
    if (extraction.batchesDropped > 0) {
      const error =
        `extraction dropped ${extraction.batchesDropped}/${extraction.batchesTotal} ` +
        `batch(es) after retries (${extraction.batchesTruncated} truncated); ` +
        "failing the run so cursors do not advance past unextracted observations";
      await markKnowledgeGraphRunFailed({
        db: database,
        runId: run.id,
        startedAt,
        error,
        metrics: {
          ...auditMetrics,
          extraction: {
            batchesTotal: extraction.batchesTotal,
            batchesDropped: extraction.batchesDropped,
            batchesTruncated: extraction.batchesTruncated,
          },
        },
      });
      return {
        ok: false,
        runId: run.id,
        tenantId: args.tenantId,
        status: "failed",
        error,
      };
    }

    const normalizedSnapshot = normalizeExtractedGraph({
      graph: extraction.payload,
      transcript: source.bundle.evidence,
      ontology,
      // The extractor emits only this source's nodes, so no NodeSet scoping
      // is needed (unlike the previous global-graph fetch).
    });
    const fallbackSnapshot = applySourceDeclaredFallback({
      snapshot: normalizedSnapshot,
      source: source.bundle,
      ontology,
    });

    // Canonical identity resolution (THINK-193 U4): runs between fallback
    // and merge. Resolved entities carry canonicalEntityId; unresolved
    // shared entities are EXCLUDED from the merged snapshot and recorded as
    // item-level deferrals with their resolution-case id. Cursors still
    // advance — a deferred item re-reads on later ingests only via its
    // signature coalescing onto the same open case.
    const identity = await resolveSnapshotCanonicalIdentity({
      db: database,
      tenantId: run.tenant_id,
      snapshot: fallbackSnapshot,
    });
    const snapshot = identity.snapshot;
    const dirtyCanonicalEntityIds = [
      ...new Set(
        snapshot.entities
          .map((entity) => entity.canonicalEntityId)
          .filter((id): id is string => !!id),
      ),
    ];
    const identityMetrics = {
      ...identity.metrics,
      identityDeferrals: identity.deferrals.slice(0, 50),
    };

    // Merge-upsert (not replace): the observations source shares one
    // source_ref across runs and each run sees only its cursor-gated new
    // packets — a full-snapshot replace would wipe the mirror to the newest
    // batch every sweep. The merge is additive, so the shrink guard is moot.
    //
    // The graph→wiki compile handoff (U4 dead-trigger fix) enqueues INSIDE
    // this transaction (outbox): a run can never commit as succeeded
    // without a compile-job outcome. The async invoke happens post-commit.
    let compileEnqueue: GraphCompileTxEnqueueResult | null = null;
    await mergeKnowledgeGraphSnapshot({
      db: database,
      run,
      snapshot,
      startedAt,
      ingestMode: "bedrock_extraction",
      ontologyMechanism: ontology.mechanism,
      sourceMetrics: {
        ...auditMetrics,
        ...identityMetrics,
        sourceLabel: run.source_label,
        sourcePacketCount: source.bundle.packetCount,
        skippedSourceCount: source.bundle.skippedCount,
        sourceDiagnostics: source.bundle.diagnostics,
        brainArtifactsEnabled: artifactWrite.enabled,
        sourceArtifactChecksum:
          artifactWrite.sourceArtifact?.checksumSha256 ?? null,
        ingestionManifestChecksum:
          artifactWrite.ingestionManifest?.checksumSha256 ?? null,
        extraction: {
          batchesTotal: extraction.batchesTotal,
          extractedNodeCount: extraction.payload.nodes.length,
          extractedEdgeCount: extraction.payload.edges.length,
          inputTokens: extraction.inputTokens,
          outputTokens: extraction.outputTokens,
        },
      },
      runMetadata: fullRebuild ? { fullRebuild: true } : undefined,
      extraWork: async (tx) => {
        await upsertObservationCursors(tx, run.tenant_id, source.nextCursors);
        compileEnqueue = await enqueueGraphWikiCompileTx(tx, {
          tenantId: run.tenant_id,
          dirtyCanonicalEntityIds,
        });
      },
    });

    // Post-commit: invoke wiki-compile for a freshly inserted job. Invoke
    // failure is non-fatal (the job row survives for the drainer) but is
    // surfaced in the run metrics rather than silently dropped.
    const enqueueOutcome = compileEnqueue as GraphCompileTxEnqueueResult | null;
    let wikiCompileEnqueue: Record<string, unknown> = {
      status: enqueueOutcome?.status ?? "error_not_attempted",
      ...(enqueueOutcome?.jobId ? { jobId: enqueueOutcome.jobId } : {}),
    };
    if (enqueueOutcome?.inserted && enqueueOutcome.jobId) {
      const invokeErr = await invokeWikiCompile(enqueueOutcome.jobId).catch(
        (err) => err as Error,
      );
      wikiCompileEnqueue = {
        ...wikiCompileEnqueue,
        status:
          invokeErr instanceof Error ? "enqueued_invoke_failed" : "enqueued",
        ...(invokeErr instanceof Error ? { error: invokeErr.message } : {}),
      };
    }
    await patchRunMetrics(database, run.id, { wikiCompileEnqueue });

    // Backlog signal: this run hit the per-run candidate cap AND made
    // forward progress (promoted something or advanced cursors), so more
    // candidates are waiting. The in-process drain loop in
    // drainTenantObservationsIngest consumes this; a run with zero
    // progress must not chain or it would re-read the same candidates
    // forever.
    const madeProgress =
      source.gate.promoted.length > 0 || source.nextCursors.size > 0;

    return {
      ok: true,
      runId: run.id,
      tenantId: args.tenantId,
      status: "succeeded",
      continueDrain: source.truncated && madeProgress,
      metrics: {
        ...auditMetrics,
        ...identityMetrics,
        entityCount: snapshot.entities.length,
        relationshipCount: snapshot.relationships.length,
        evidenceCount: snapshot.evidence.length,
        ingestMode: "bedrock_extraction",
        extractionBatchesTotal: extraction.batchesTotal,
        wikiCompileEnqueue,
      },
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    await markKnowledgeGraphRunFailed({
      db: database,
      runId: run.id,
      startedAt,
      error: message,
      metrics: {
        sourceKind: run.source_kind,
        sourceRefHash: redactedSourceRef(run.source_ref),
      },
    });
    console.error("[knowledge-graph-observations-ingest] failed", {
      runId: run.id,
      tenantId: run.tenant_id,
      sourceRefHash: redactedSourceRef(run.source_ref),
      error: message,
    });
    return {
      ok: false,
      runId: run.id,
      tenantId: args.tenantId,
      status: "failed",
      error: message,
    };
  }
}

/**
 * Merge a post-commit metrics fragment onto the run row (jsonb shallow
 * merge). Best-effort — a metrics-patch failure must not fail an already
 * committed run.
 */
async function patchRunMetrics(
  db: Database,
  runId: string,
  fragment: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .update(kgIngestRuns)
      .set({
        metrics: sql`COALESCE(${kgIngestRuns.metrics}, '{}'::jsonb) || ${JSON.stringify(fragment)}::jsonb`,
      })
      .where(eq(kgIngestRuns.id, runId));
  } catch (err) {
    console.warn("[knowledge-graph-observations-ingest] metrics patch failed", {
      runId,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

async function upsertObservationCursors(
  tx: DatabaseTransaction,
  tenantId: string,
  nextCursors: Map<string, { updatedAt: Date | null; recordId: string | null }>,
): Promise<void> {
  const now = new Date();
  for (const [bankId, cursor] of nextCursors) {
    await tx
      .insert(kgObservationCursors)
      .values({
        tenant_id: tenantId,
        bank_id: bankId,
        last_record_updated_at: cursor.updatedAt,
        last_record_id: cursor.recordId,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [kgObservationCursors.tenant_id, kgObservationCursors.bank_id],
        set: {
          last_record_updated_at: cursor.updatedAt,
          last_record_id: cursor.recordId,
          updated_at: now,
        },
      });
  }
}

function newestCursorTimestamp(
  nextCursors: Map<string, { updatedAt: Date | null; recordId: string | null }>,
): string | null {
  let newest: Date | null = null;
  for (const cursor of nextCursors.values()) {
    if (cursor.updatedAt && (!newest || cursor.updatedAt > newest)) {
      newest = cursor.updatedAt;
    }
  }
  return newest ? newest.toISOString() : null;
}
