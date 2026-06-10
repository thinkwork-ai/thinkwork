/**
 * Observations → Knowledge Graph ingest worker.
 *
 * Reads engine-synthesized Hindsight observations across the tenant's user
 * banks (U4 loader + layered promotion gate), ingests the promoted bundle
 * into the tenant's STABLE Cognee dataset, and refreshes the Aurora mirror
 * crash-safely: mirror replace, cursor advance, promotion audit, and run
 * completion all commit in ONE transaction. Cognee writes are at-least-once;
 * the rendered document embeds each observation's Hindsight id
 * (`<!-- source_packet:<id> ... -->`), so a crash between cognify and
 * snapshot re-sends identical content on the re-read instead of duplicating.
 */

import { eq } from "drizzle-orm";
import {
  knowledgeGraphObservationCursors,
  tenants,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../lib/db.js";
import { db as defaultDb } from "../lib/db.js";
import { CogneeClient } from "../lib/knowledge-graph/cognee-client.js";
import { normalizeCogneeGraph } from "../lib/knowledge-graph/normalizer.js";
import { loadApprovedOntologyExport } from "../lib/knowledge-graph/ontology-export.js";
import { loadObservationsKnowledgeGraphSource } from "../lib/knowledge-graph/observations-source.js";
import {
  countKnowledgeGraphEntitiesForSource,
  loadKnowledgeGraphIngestRun,
  markKnowledgeGraphRunFailed,
  markKnowledgeGraphRunRunning,
  markKnowledgeGraphRunStaleNoop,
  replaceKnowledgeGraphSnapshot,
  type DatabaseTransaction,
} from "../lib/knowledge-graph/repository.js";
import {
  createKnowledgeGraphObservationsIngestRun,
  reapStaleObservationIngestRuns,
} from "../lib/knowledge-graph/runs.js";
import { applySourceDeclaredFallback } from "../lib/knowledge-graph/source-fallback.js";

export interface KnowledgeGraphObservationsIngestEvent {
  runId?: string;
  tenantId?: string;
  /** Scheduled drainer mode — enumerate all tenants and run each. */
  sweep?: boolean;
  fullRebuild?: boolean;
  trigger?: "manual" | "scheduled";
}

export interface KnowledgeGraphObservationsIngestResult {
  ok: boolean;
  status: "succeeded" | "failed" | "stale_noop" | "skipped" | "sweep";
  runId?: string;
  tenantId?: string;
  metrics?: Record<string, unknown>;
  error?: string;
  results?: KnowledgeGraphObservationsIngestResult[];
}

interface KnowledgeGraphObservationsIngestDeps {
  db?: Database;
  cogneeClient?: Pick<
    CogneeClient,
    "ingestDocument" | "waitForDatasetIndexing" | "fetchDatasetGraph"
  >;
}

const DEFAULT_SHRINK_GUARD_RATIO = 0.5;

function shrinkGuardRatio(): number {
  const raw = process.env.KG_OBS_SHRINK_GUARD_RATIO;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : DEFAULT_SHRINK_GUARD_RATIO;
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
        await processTenantObservationsIngest(
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
  return processTenantObservationsIngest(
    {
      tenantId: event.tenantId,
      runId: event.runId,
      fullRebuild: event.fullRebuild,
      trigger: event.trigger ?? "manual",
    },
    deps,
    database,
  );
}

async function processTenantObservationsIngest(
  args: {
    tenantId: string;
    runId?: string;
    fullRebuild?: boolean;
    trigger: "manual" | "scheduled";
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

  const fullRebuild =
    args.fullRebuild === true ||
    (run.input as Record<string, unknown> | null)?.fullRebuild === true;

  try {
    await markKnowledgeGraphRunRunning({ db: database, runId: run.id });

    if (fullRebuild) {
      // Reset cursors to epoch BEFORE reading so the whole corpus re-reads.
      await database
        .delete(knowledgeGraphObservationCursors)
        .where(eq(knowledgeGraphObservationCursors.tenant_id, args.tenantId));
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
    });

    const auditMetrics = {
      sourceKind: run.source_kind,
      sourceRef: run.source_ref,
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

    const client = deps.cogneeClient ?? new CogneeClient();
    const ingest = await client.ingestDocument({
      tenantId: run.tenant_id,
      sourceKind: "observations",
      sourceRef: run.source_ref,
      datasetName: run.cognee_dataset_name,
      document: source.bundle.document,
      filename: "thinkwork-observations.md",
      ontology,
    });
    if (!ingest.datasetId) {
      throw new Error(
        "Cognee ingest did not return a dataset id for graph retrieval",
      );
    }
    const indexing = await client.waitForDatasetIndexing(ingest.datasetId);
    const graph = await client.fetchDatasetGraph(ingest.datasetId);
    const normalizedSnapshot = normalizeCogneeGraph({
      graph,
      transcript: source.bundle.evidence,
      ontology,
    });
    const snapshot = applySourceDeclaredFallback({
      snapshot: normalizedSnapshot,
      source: source.bundle,
      ontology,
    });

    // Shrink guard: one poisoned normalization otherwise replaces the
    // entire tenant graph in a single full-snapshot swap.
    const priorEntityCount = await countKnowledgeGraphEntitiesForSource({
      db: database,
      tenantId: run.tenant_id,
      sourceKind: run.source_kind,
      sourceRef: run.source_ref,
    });
    const ratio = shrinkGuardRatio();
    if (
      !fullRebuild &&
      priorEntityCount > 0 &&
      snapshot.entities.length < priorEntityCount * ratio
    ) {
      const error =
        `shrink guard: refusing to replace ${priorEntityCount} mirror entities ` +
        `with ${snapshot.entities.length} (ratio threshold ${ratio}); ` +
        "flagged for operator review";
      await markKnowledgeGraphRunFailed({
        db: database,
        runId: run.id,
        startedAt,
        error,
        metrics: {
          ...auditMetrics,
          shrinkGuard: {
            priorEntityCount,
            newEntityCount: snapshot.entities.length,
            ratio,
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

    await replaceKnowledgeGraphSnapshot({
      db: database,
      run,
      snapshot,
      cogneeDatasetId: ingest.datasetId,
      startedAt,
      ingestMode: ingest.mode,
      ontologyMechanism: ontology.mechanism,
      sourceMetrics: {
        ...auditMetrics,
        sourceLabel: run.source_label,
        sourcePacketCount: source.bundle.packetCount,
        skippedSourceCount: source.bundle.skippedCount,
        sourceDiagnostics: source.bundle.diagnostics,
        cogneePipelineRunId: ingest.pipelineRunId,
        cogneeIndexStatus: indexing.status,
        cogneeIndexRawStatus: indexing.rawStatus,
        cogneeIndexAttempts: indexing.attempts,
        cogneeIndexElapsedMs: indexing.elapsedMs,
        cogneeIndexSamples: indexing.samples.map((sample) => ({
          status: sample.status,
          rawStatus: sample.rawStatus,
        })),
      },
      runMetadata: fullRebuild ? { shrinkGuardBypassed: true } : undefined,
      extraWork: async (tx) =>
        upsertObservationCursors(tx, run.tenant_id, source.nextCursors),
    });

    return {
      ok: true,
      runId: run.id,
      tenantId: args.tenantId,
      status: "succeeded",
      metrics: {
        ...auditMetrics,
        entityCount: snapshot.entities.length,
        relationshipCount: snapshot.relationships.length,
        evidenceCount: snapshot.evidence.length,
        ingestMode: ingest.mode,
        cogneePipelineRunId: ingest.pipelineRunId,
        cogneeIndexStatus: indexing.status,
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
        sourceRef: run.source_ref,
      },
    });
    console.error("[knowledge-graph-observations-ingest] failed", {
      runId: run.id,
      tenantId: run.tenant_id,
      sourceRef: run.source_ref,
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

async function upsertObservationCursors(
  tx: DatabaseTransaction,
  tenantId: string,
  nextCursors: Map<string, { updatedAt: Date | null; recordId: string | null }>,
): Promise<void> {
  const now = new Date();
  for (const [bankId, cursor] of nextCursors) {
    await tx
      .insert(knowledgeGraphObservationCursors)
      .values({
        tenant_id: tenantId,
        bank_id: bankId,
        last_record_updated_at: cursor.updatedAt,
        last_record_id: cursor.recordId,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          knowledgeGraphObservationCursors.tenant_id,
          knowledgeGraphObservationCursors.bank_id,
        ],
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
