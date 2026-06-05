import type { Database } from "../lib/db.js";
import { db as defaultDb } from "../lib/db.js";
import { CogneeClient } from "../lib/knowledge-graph/cognee-client.js";
import { normalizeCogneeGraph } from "../lib/knowledge-graph/normalizer.js";
import { loadApprovedOntologyExport } from "../lib/knowledge-graph/ontology-export.js";
import {
  loadKnowledgeGraphIngestRun,
  markKnowledgeGraphRunFailed,
  markKnowledgeGraphRunRunning,
  replaceKnowledgeGraphSnapshot,
} from "../lib/knowledge-graph/repository.js";
import {
  loadThreadTranscript,
  renderThreadTranscript,
} from "../lib/knowledge-graph/thread-transcript.js";

export interface KnowledgeGraphThreadIngestEvent {
  runId?: string;
  tenantId?: string;
  threadId?: string;
}

export interface KnowledgeGraphThreadIngestResult {
  ok: boolean;
  runId?: string;
  status: "succeeded" | "failed";
  metrics?: Record<string, unknown>;
  error?: string;
}

interface KnowledgeGraphThreadIngestDeps {
  db?: Database;
  cogneeClient?: Pick<CogneeClient, "ingestThread" | "fetchDatasetGraph">;
}

export async function handler(
  event: KnowledgeGraphThreadIngestEvent,
): Promise<KnowledgeGraphThreadIngestResult> {
  return processKnowledgeGraphThreadIngest(event);
}

export async function processKnowledgeGraphThreadIngest(
  event: KnowledgeGraphThreadIngestEvent,
  deps: KnowledgeGraphThreadIngestDeps = {},
): Promise<KnowledgeGraphThreadIngestResult> {
  validateEvent(event);
  const database = deps.db ?? defaultDb;
  const startedAt = new Date();
  const run = await loadKnowledgeGraphIngestRun({
    db: database,
    runId: event.runId!,
    tenantId: event.tenantId!,
    threadId: event.threadId!,
  });
  if (!run) {
    return {
      ok: false,
      runId: event.runId,
      status: "failed",
      error: "Knowledge Graph ingest run not found",
    };
  }

  try {
    await markKnowledgeGraphRunRunning({ db: database, runId: run.id });
    const [transcript, ontology] = await Promise.all([
      loadThreadTranscript({
        db: database,
        tenantId: run.tenant_id,
        threadId: run.thread_id,
      }),
      loadApprovedOntologyExport({ db: database, tenantId: run.tenant_id }),
    ]);
    if (transcript.length === 0) {
      throw new Error("Knowledge Graph ingest found no text-bearing messages");
    }

    const client = deps.cogneeClient ?? new CogneeClient();
    const ingest = await client.ingestThread({
      tenantId: run.tenant_id,
      threadId: run.thread_id,
      datasetName: run.cognee_dataset_name,
      transcript: renderThreadTranscript(transcript),
      ontology,
    });
    if (!ingest.datasetId) {
      throw new Error(
        "Cognee ingest did not return a dataset id for graph retrieval",
      );
    }
    const graph = await client.fetchDatasetGraph(ingest.datasetId);
    const snapshot = normalizeCogneeGraph({ graph, transcript, ontology });
    await replaceKnowledgeGraphSnapshot({
      db: database,
      run,
      snapshot,
      cogneeDatasetId: ingest.datasetId,
      startedAt,
      ingestMode: ingest.mode,
      ontologyMechanism: ontology.mechanism,
    });

    return {
      ok: true,
      runId: run.id,
      status: "succeeded",
      metrics: {
        entityCount: snapshot.entities.length,
        relationshipCount: snapshot.relationships.length,
        evidenceCount: snapshot.evidence.length,
        ingestMode: ingest.mode,
      },
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    await markKnowledgeGraphRunFailed({
      db: database,
      runId: run.id,
      startedAt,
      error: message,
    });
    console.error("[knowledge-graph-thread-ingest] failed", {
      runId: run.id,
      tenantId: run.tenant_id,
      threadId: run.thread_id,
      error: message,
    });
    return {
      ok: false,
      runId: run.id,
      status: "failed",
      error: message,
    };
  }
}

function validateEvent(
  event: KnowledgeGraphThreadIngestEvent,
): asserts event is Required<KnowledgeGraphThreadIngestEvent> {
  if (!event.runId || !event.tenantId || !event.threadId) {
    throw new Error("runId, tenantId, and threadId are required");
  }
}
