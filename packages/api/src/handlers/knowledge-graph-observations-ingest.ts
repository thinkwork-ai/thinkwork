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
import { extractGraphFromPackets } from "../lib/knowledge-graph/bedrock-graph-extractor.js";
import {
  redactedSourceRef,
  writeKnowledgeGraphIngestArtifacts,
} from "../lib/knowledge-graph/artifacts.js";
import { normalizeCogneeGraph } from "../lib/knowledge-graph/normalizer.js";
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
import { resolveObservationsWorkerFunctionName } from "../lib/knowledge-graph/invoke-worker.js";
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
  /** Bedrock graph extractor; injectable for tests. Defaults to the real
   * `extractGraphFromPackets`. */
  extractor?: typeof extractGraphFromPackets;
  /** Fire-and-forget self re-invoke used to drain a truncated backlog.
   * Injectable for tests; the default issues an async Event invoke of this
   * same worker with the tenantId. */
  selfInvoke?: (args: {
    tenantId: string;
    trigger: "manual" | "scheduled";
  }) => Promise<void>;
}

/**
 * Per-run candidate cap. A 500-candidate backlog times out a 480 s Lambda
 * (classifier batches dominate); 100 keeps one run comfortably inside the
 * budget and the truncated→self-invoke chain drains the rest. Env read
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
 * Default self-invoke: async (Event) re-invoke of this worker for the same
 * tenant so a truncated backlog drains across successive runs instead of
 * waiting for the 30-minute sweep. Event (not RequestResponse) is correct
 * here — this is a worker-to-itself continuation, not a user-initiated
 * create/update. Errors are the caller's to swallow (best-effort).
 */
async function selfInvokeObservationsIngest(args: {
  tenantId: string;
  trigger: "manual" | "scheduled";
}): Promise<void> {
  const functionName = resolveObservationsWorkerFunctionName();
  if (!functionName) {
    throw new Error(
      "observations ingest worker function name is not configured (STAGE or KNOWLEDGE_GRAPH_OBSERVATIONS_INGEST_FUNCTION_NAME)",
    );
  }
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(
        JSON.stringify({ tenantId: args.tenantId, trigger: args.trigger }),
      ),
    }),
  );
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
        .delete(knowledgeGraphObservationCursors)
        .where(eq(knowledgeGraphObservationCursors.tenant_id, args.tenantId));
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

    const normalizedSnapshot = normalizeCogneeGraph({
      graph: extraction.payload,
      transcript: source.bundle.evidence,
      ontology,
      // The extractor emits only this source's nodes, so no NodeSet scoping
      // is needed (unlike Cognee's global-graph fetch).
    });
    const snapshot = applySourceDeclaredFallback({
      snapshot: normalizedSnapshot,
      source: source.bundle,
      ontology,
    });

    // Merge-upsert (not replace): the observations source shares one
    // source_ref across runs and each run sees only its cursor-gated new
    // packets — a full-snapshot replace would wipe the mirror to the newest
    // batch every sweep. The merge is additive, so the shrink guard is moot.
    await mergeKnowledgeGraphSnapshot({
      db: database,
      run,
      snapshot,
      startedAt,
      ingestMode: "bedrock_extraction",
      ontologyMechanism: ontology.mechanism,
      sourceMetrics: {
        ...auditMetrics,
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
      extraWork: async (tx) =>
        upsertObservationCursors(tx, run.tenant_id, source.nextCursors),
    });

    // Backlog drain: when this run hit the per-run candidate cap, more
    // observations are already waiting — re-invoke ourselves (fire-and-
    // forget) so the backlog drains in successive runs instead of waiting
    // for the 30-minute sweep. Loop guard: only chain when this run made
    // forward progress (promoted something or advanced cursors); a run
    // that promoted nothing AND moved no cursor would re-read the same
    // candidates forever.
    const madeProgress =
      source.gate.promoted.length > 0 || source.nextCursors.size > 0;
    let selfInvoked = false;
    if (source.truncated && madeProgress) {
      const selfInvoke = deps.selfInvoke ?? selfInvokeObservationsIngest;
      try {
        await selfInvoke({ tenantId: args.tenantId, trigger: args.trigger });
        selfInvoked = true;
      } catch (invokeErr) {
        // Best-effort: the scheduled sweep remains the backstop.
        console.warn(
          "[knowledge-graph-observations-ingest] backlog self-invoke failed",
          {
            tenantId: args.tenantId,
            error: (invokeErr as Error)?.message ?? String(invokeErr),
          },
        );
      }
    }

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
        ingestMode: "bedrock_extraction",
        extractionBatchesTotal: extraction.batchesTotal,
        selfInvoked,
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
