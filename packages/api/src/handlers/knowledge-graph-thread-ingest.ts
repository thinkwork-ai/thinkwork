import type { Database } from "../lib/db.js";
import { db as defaultDb } from "../lib/db.js";
import { CogneeClient } from "../lib/knowledge-graph/cognee-client.js";
import {
  redactedSourceRef,
  writeKnowledgeGraphIngestArtifacts,
} from "../lib/knowledge-graph/artifacts.js";
import { normalizeCogneeGraph } from "../lib/knowledge-graph/normalizer.js";
import { loadApprovedOntologyExport } from "../lib/knowledge-graph/ontology-export.js";
import { applySourceDeclaredFallback } from "../lib/knowledge-graph/source-fallback.js";
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
import { loadWikiKnowledgeGraphSource } from "../lib/knowledge-graph/wiki-source.js";

export interface KnowledgeGraphThreadIngestEvent {
  runId?: string;
  tenantId?: string;
  threadId?: string;
  sourceKind?: "thread" | "wiki" | "brain";
  sourceRef?: string;
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
  cogneeClient?: Pick<
    CogneeClient,
    "ingestDocument" | "waitForDatasetIndexing" | "fetchDatasetGraph"
  >;
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
    threadId: event.threadId,
    sourceKind: event.sourceKind,
    sourceRef: event.sourceRef,
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
    const ontology = await loadApprovedOntologyExport({
      db: database,
      tenantId: run.tenant_id,
    });
    const source = await loadSourceBundle({ db: database, run, ontology });
    if (!source.document.trim() || source.evidence.length === 0) {
      throw new Error(
        `Knowledge Graph ${run.source_kind} ingest found no eligible source text`,
      );
    }
    const artifactWrite = await writeKnowledgeGraphIngestArtifacts({
      db: database,
      run,
      source,
      ontology,
    });

    const client = deps.cogneeClient ?? new CogneeClient();
    const ingest = await client.ingestDocument({
      tenantId: run.tenant_id,
      sourceKind: run.source_kind as "thread" | "wiki" | "brain",
      sourceRef: run.source_ref,
      datasetName: run.cognee_dataset_name,
      document: source.document,
      filename: `thinkwork-${run.source_kind}.md`,
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
      transcript: source.evidence,
      ontology,
    });
    const snapshot = applySourceDeclaredFallback({
      snapshot: normalizedSnapshot,
      source,
      ontology,
    });
    await replaceKnowledgeGraphSnapshot({
      db: database,
      run,
      snapshot,
      cogneeDatasetId: ingest.datasetId,
      startedAt,
      ingestMode: ingest.mode,
      ontologyMechanism: ontology.mechanism,
      sourceMetrics: {
        sourceKind: run.source_kind,
        sourceRefHash: redactedSourceRef(run.source_ref),
        sourceLabel: run.source_label,
        sourcePacketCount: source.packetCount,
        sourceRelationshipCount: source.relationships.length,
        skippedSourceCount: source.skippedCount,
        sourceDiagnostics: source.diagnostics,
        brainArtifactsEnabled: artifactWrite.enabled,
        sourceArtifactChecksum:
          artifactWrite.sourceArtifact?.checksumSha256 ?? null,
        ingestionManifestChecksum:
          artifactWrite.ingestionManifest?.checksumSha256 ?? null,
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
    });

    return {
      ok: true,
      runId: run.id,
      status: "succeeded",
      metrics: {
        sourceKind: run.source_kind,
        sourceRefHash: redactedSourceRef(run.source_ref),
        sourcePacketCount: source.packetCount,
        sourceRelationshipCount: source.relationships.length,
        skippedSourceCount: source.skippedCount,
        entityCount: snapshot.entities.length,
        relationshipCount: snapshot.relationships.length,
        evidenceCount: snapshot.evidence.length,
        ingestMode: ingest.mode,
        cogneePipelineRunId: ingest.pipelineRunId,
        cogneeIndexStatus: indexing.status,
        cogneeIndexRawStatus: indexing.rawStatus,
        cogneeIndexAttempts: indexing.attempts,
        cogneeIndexElapsedMs: indexing.elapsedMs,
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
    console.error("[knowledge-graph-thread-ingest] failed", {
      runId: run.id,
      tenantId: run.tenant_id,
      threadId: run.thread_id,
      sourceKind: run.source_kind,
      sourceRefHash: redactedSourceRef(run.source_ref),
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
): asserts event is KnowledgeGraphThreadIngestEvent & {
  runId: string;
  tenantId: string;
} {
  if (!event.runId || !event.tenantId) {
    throw new Error("runId and tenantId are required");
  }
}

async function loadSourceBundle(args: {
  db: Database;
  run: Awaited<ReturnType<typeof loadKnowledgeGraphIngestRun>> & {};
  ontology: Awaited<ReturnType<typeof loadApprovedOntologyExport>>;
}) {
  const input = asRecord(args.run.input);
  const pageIds = readStringArray(input.pageIds);
  if (args.run.source_kind === "thread") {
    if (!args.run.thread_id) {
      throw new Error("thread ingest run is missing thread_id");
    }
    const transcript = await loadThreadTranscript({
      db: args.db,
      tenantId: args.run.tenant_id,
      threadId: args.run.thread_id,
    });
    return {
      sourceKind: "thread" as const,
      sourceRef: args.run.source_ref,
      sourceLabel: args.run.source_label ?? "Thread transcript",
      document: renderThreadTranscript(transcript),
      evidence: transcript,
      packets: [],
      relationships: [],
      packetCount: transcript.length,
      skippedCount: 0,
      diagnostics: {},
    };
  }
  if (args.run.source_kind === "wiki") {
    const ownerUserId = stringValue(input.ownerUserId);
    if (!ownerUserId) {
      throw new Error("wiki ingest run is missing ownerUserId");
    }
    return loadWikiKnowledgeGraphSource({
      db: args.db,
      tenantId: args.run.tenant_id,
      ownerUserId,
      sourceRef: args.run.source_ref,
      sourceLabel: args.run.source_label ?? "Compounding Memory wiki",
      pageIds,
      ontology: args.ontology,
    });
  }
  throw new Error(
    `Unsupported Knowledge Graph source kind: ${args.run.source_kind}`,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
