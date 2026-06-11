import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchDatasetGraphMock,
  ingestDocumentMock,
  waitForDatasetIndexingMock,
  deleteDatasetByNameMock,
  pruneAllMock,
  loadApprovedOntologyExportMock,
  loadKnowledgeGraphIngestRunMock,
  loadObservationsKnowledgeGraphSourceMock,
  countKnowledgeGraphEntitiesForSourceMock,
  markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunningMock,
  markKnowledgeGraphRunStaleNoopMock,
  replaceKnowledgeGraphSnapshotMock,
  createKnowledgeGraphObservationsIngestRunMock,
  reapStaleObservationIngestRunsMock,
  maybeEnqueueGraphWikiCompileMock,
} = vi.hoisted(() => ({
  fetchDatasetGraphMock: vi.fn(),
  ingestDocumentMock: vi.fn(),
  waitForDatasetIndexingMock: vi.fn(),
  deleteDatasetByNameMock: vi.fn(),
  pruneAllMock: vi.fn(),
  loadApprovedOntologyExportMock: vi.fn(),
  loadKnowledgeGraphIngestRunMock: vi.fn(),
  loadObservationsKnowledgeGraphSourceMock: vi.fn(),
  countKnowledgeGraphEntitiesForSourceMock: vi.fn(),
  markKnowledgeGraphRunFailedMock: vi.fn(),
  markKnowledgeGraphRunRunningMock: vi.fn(),
  markKnowledgeGraphRunStaleNoopMock: vi.fn(),
  replaceKnowledgeGraphSnapshotMock: vi.fn(),
  createKnowledgeGraphObservationsIngestRunMock: vi.fn(),
  reapStaleObservationIngestRunsMock: vi.fn(),
  maybeEnqueueGraphWikiCompileMock: vi.fn(),
}));

vi.mock("../lib/knowledge-graph/cognee-client.js", () => ({
  CogneeClient: vi.fn(() => ({
    fetchDatasetGraph: fetchDatasetGraphMock,
    ingestDocument: ingestDocumentMock,
    waitForDatasetIndexing: waitForDatasetIndexingMock,
    deleteDatasetByName: deleteDatasetByNameMock,
    pruneAll: pruneAllMock,
  })),
}));

vi.mock("../lib/knowledge-graph/ontology-export.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/knowledge-graph/ontology-export.js")
  >("../lib/knowledge-graph/ontology-export.js");
  return {
    ...actual,
    loadApprovedOntologyExport: loadApprovedOntologyExportMock,
  };
});

vi.mock("../lib/knowledge-graph/observations-source.js", () => ({
  loadObservationsKnowledgeGraphSource:
    loadObservationsKnowledgeGraphSourceMock,
}));

vi.mock("../lib/knowledge-graph/repository.js", () => ({
  countKnowledgeGraphEntitiesForSource:
    countKnowledgeGraphEntitiesForSourceMock,
  loadKnowledgeGraphIngestRun: loadKnowledgeGraphIngestRunMock,
  markKnowledgeGraphRunFailed: markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunning: markKnowledgeGraphRunRunningMock,
  markKnowledgeGraphRunStaleNoop: markKnowledgeGraphRunStaleNoopMock,
  replaceKnowledgeGraphSnapshot: replaceKnowledgeGraphSnapshotMock,
}));

vi.mock("../lib/knowledge-graph/runs.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/knowledge-graph/runs.js")
  >("../lib/knowledge-graph/runs.js");
  return {
    ...actual,
    createKnowledgeGraphObservationsIngestRun:
      createKnowledgeGraphObservationsIngestRunMock,
    reapStaleObservationIngestRuns: reapStaleObservationIngestRunsMock,
  };
});

vi.mock("../lib/wiki/enqueue.js", () => ({
  maybeEnqueueGraphWikiCompile: maybeEnqueueGraphWikiCompileMock,
}));

import { processKnowledgeGraphObservationsIngest } from "./knowledge-graph-observations-ingest.js";

const TENANT_ID = "tenant-1";
const run = {
  id: "run-1",
  tenant_id: TENANT_ID,
  thread_id: null,
  source_kind: "observations",
  source_ref: `tenant:${TENANT_ID}:observations`,
  source_label: "Hindsight observations",
  cognee_dataset_name: `thinkwork:${TENANT_ID}:observations`,
  input: { source: "observations", fullRebuild: false },
  metadata: {},
};
const ontology = {
  mechanism: "cognee_owl_ontology" as const,
  // "Company" is approved so the fake graph node grounds (the real
  // normalizer drops unapproved-type nodes — entity counts matter to the
  // shrink-guard assertions below).
  entityTypes: [
    {
      id: "type-company",
      slug: "company",
      name: "Company",
      description: null,
      aliases: [],
    },
  ],
  relationshipTypes: [],
  customPrompt: "Extract",
  ontologyKey: "thinkwork_tenant_abc123",
  ontologyOwlXml: "<rdf:RDF></rdf:RDF>",
};

function makeCursorDeleteChain() {
  const where = vi.fn(async () => undefined);
  return { delete: vi.fn(() => ({ where })), where };
}

function makeDb() {
  const chains = makeCursorDeleteChain();
  return {
    db: { marker: "db", delete: chains.delete } as any,
    cursorDelete: chains,
  };
}

function makeSourceResult(
  overrides: Partial<{
    candidateCount: number;
    truncated: boolean;
    promotedIds: string[];
  }> = {},
) {
  const promotedIds = overrides.promotedIds ?? ["obs-1", "obs-2", "obs-3"];
  const now = new Date("2026-06-09T03:00:00.000Z");
  return {
    bundle: {
      sourceKind: "observations" as const,
      sourceRef: run.source_ref,
      sourceLabel: "Hindsight observations",
      document: [
        "# Hindsight observations",
        ...promotedIds.map(
          (id) =>
            `<!-- source_packet:${id} trusted_ontology_type:false -->\nAcme uses Delta.`,
        ),
      ].join("\n\n"),
      evidence: promotedIds.map((id, ordinal) => ({
        id,
        role: "source",
        senderType: "observation",
        senderId: null,
        speakerLabel: "Observation (1 supporting facts)",
        text: "Acme uses Delta.",
        createdAt: now,
        ordinal,
        evidenceSourceKind: "hindsight_observation",
        evidenceSourceRef: id,
        evidenceMetadata: { observationId: id },
      })),
      packets: promotedIds.map((id, index) => ({
        id,
        title: `Observation ${index + 1}`,
        entityTypeSlug: null,
        trustedOntologyType: false,
        text: "Acme uses Delta.",
        metadata: { observationId: id },
      })),
      relationships: [],
      packetCount: promotedIds.length,
      skippedCount: 0,
      diagnostics: {},
    },
    gate: {
      promoted: [],
      excluded: [],
      audit: {
        classifierModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        classifierPromptVersion: "v1",
        promotedIds,
        excludedCounts: {
          non_shared_context: 0,
          secret_scan: 0,
          classified_personal: 0,
          classifier_unverifiable: 0,
        },
      },
    },
    nextCursors: new Map([
      [
        "user_aaa",
        { updatedAt: new Date("2026-06-09T03:00:00.000Z"), recordId: "obs-3" },
      ],
      [
        "user_bbb",
        { updatedAt: new Date("2026-06-09T02:00:00.000Z"), recordId: "obs-2" },
      ],
    ]),
    truncated: overrides.truncated ?? false,
    candidateCount: overrides.candidateCount ?? promotedIds.length,
  };
}

beforeEach(() => {
  reapStaleObservationIngestRunsMock.mockReset().mockResolvedValue(0);
  createKnowledgeGraphObservationsIngestRunMock
    .mockReset()
    .mockResolvedValue({ run, inserted: true });
  loadKnowledgeGraphIngestRunMock.mockReset().mockResolvedValue(run);
  markKnowledgeGraphRunRunningMock.mockReset().mockResolvedValue(undefined);
  markKnowledgeGraphRunFailedMock.mockReset().mockResolvedValue(undefined);
  markKnowledgeGraphRunStaleNoopMock.mockReset().mockResolvedValue(undefined);
  replaceKnowledgeGraphSnapshotMock.mockReset().mockResolvedValue(undefined);
  countKnowledgeGraphEntitiesForSourceMock.mockReset().mockResolvedValue(0);
  deleteDatasetByNameMock.mockReset().mockResolvedValue(1);
  pruneAllMock.mockReset().mockResolvedValue(true);
  loadApprovedOntologyExportMock.mockReset().mockResolvedValue(ontology);
  loadObservationsKnowledgeGraphSourceMock
    .mockReset()
    .mockResolvedValue(makeSourceResult());
  ingestDocumentMock.mockReset().mockResolvedValue({
    datasetId: "11111111-1111-4111-8111-111111111111",
    datasetName: run.cognee_dataset_name,
    mode: "add_cognify",
    pipelineRunId: "22222222-2222-4222-8222-222222222222",
    raw: {},
  });
  waitForDatasetIndexingMock.mockReset().mockResolvedValue({
    status: "completed",
    rawStatus: "DATASET_PROCESSING_COMPLETED",
    attempts: 2,
    elapsedMs: 5000,
    samples: [],
  });
  fetchDatasetGraphMock.mockReset().mockResolvedValue({
    nodes: [{ id: "acme", label: "Acme", type: "Company", properties: {} }],
    edges: [],
  });
  maybeEnqueueGraphWikiCompileMock
    .mockReset()
    .mockResolvedValue({ status: "enqueued", jobId: "wjob-1" });
  delete process.env.KG_OBS_MAX_CANDIDATES_PER_RUN;
});

describe("knowledge-graph-observations-ingest handler", () => {
  it("ingests an incremental bundle into the stable dataset and commits snapshot + cursors + audit together", async () => {
    const { db } = makeDb();

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, trigger: "scheduled" },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        runId: "run-1",
        status: "succeeded",
      }),
    );
    // Reap before claim — a stranded running row on the stable source_ref
    // would otherwise block every future run for the tenant.
    expect(
      reapStaleObservationIngestRunsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      createKnowledgeGraphObservationsIngestRunMock.mock
        .invocationCallOrder[0]!,
    );
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
    expect(ingestDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        sourceKind: "observations",
        sourceRef: run.source_ref,
        datasetName: `thinkwork:${TENANT_ID}:observations`,
        filename: "thinkwork-observations.md",
        ontology,
      }),
    );

    // Snapshot replace + cursor advance + run completion ride ONE call into
    // the repository transaction.
    expect(replaceKnowledgeGraphSnapshotMock).toHaveBeenCalledTimes(1);
    const replaceArgs = replaceKnowledgeGraphSnapshotMock.mock.calls[0]![0];
    expect(replaceArgs).toEqual(
      expect.objectContaining({
        db,
        run,
        cogneeDatasetId: "11111111-1111-4111-8111-111111111111",
        ingestMode: "add_cognify",
        runMetadata: undefined,
        sourceMetrics: expect.objectContaining({
          candidateCount: 3,
          truncated: false,
          promotedIds: ["obs-1", "obs-2", "obs-3"],
          classifierModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
          classifierPromptVersion: "v1",
          newestCandidateCursorAt: "2026-06-09T03:00:00.000Z",
        }),
      }),
    );

    // Cursor advance happens via extraWork inside the same transaction.
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const tx = { insert: vi.fn(() => ({ values })) };
    await replaceArgs.extraWork(tx);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        bank_id: "user_aaa",
        last_record_id: "obs-3",
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        bank_id: "user_bbb",
        last_record_id: "obs-2",
      }),
    );
    expect(markKnowledgeGraphRunFailedMock).not.toHaveBeenCalled();
  });

  it("finishes as stale_noop without touching cursors when no candidates exist", async () => {
    const { db, cursorDelete } = makeDb();
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce({
      ...makeSourceResult({ promotedIds: [] }),
      candidateCount: 0,
      nextCursors: new Map(),
    });

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, status: "stale_noop" }),
    );
    expect(markKnowledgeGraphRunStaleNoopMock).toHaveBeenCalledWith(
      expect.objectContaining({ db, runId: "run-1" }),
    );
    expect(ingestDocumentMock).not.toHaveBeenCalled();
    expect(replaceKnowledgeGraphSnapshotMock).not.toHaveBeenCalled();
    expect(cursorDelete.delete).not.toHaveBeenCalled();
  });

  it("does not advance cursors when the snapshot transaction fails", async () => {
    const { db } = makeDb();
    replaceKnowledgeGraphSnapshotMock.mockRejectedValueOnce(
      new Error("snapshot transaction failed"),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.stringContaining("snapshot transaction failed"),
      }),
    );
    expect(markKnowledgeGraphRunFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ db, runId: "run-1" }),
    );
    // Cursor writes live inside replaceKnowledgeGraphSnapshot's transaction;
    // nothing else writes them, so a failed replace leaves cursors put.
    expect(db.delete as any).not.toHaveBeenCalled();
  });

  it("reaps stale runs before claiming so a stranded row cannot block the tenant", async () => {
    const { db } = makeDb();
    reapStaleObservationIngestRunsMock.mockResolvedValueOnce(1);

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(reapStaleObservationIngestRunsMock).toHaveBeenCalledWith({
      db,
      tenantId: TENANT_ID,
    });
    expect(createKnowledgeGraphObservationsIngestRunMock).toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
  });

  it("refuses to replace the mirror when the new snapshot shrinks beyond the threshold", async () => {
    const { db } = makeDb();
    // Prior snapshot had 10 entities; the new graph normalizes to 1.
    countKnowledgeGraphEntitiesForSourceMock.mockResolvedValueOnce(10);

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.stringContaining("shrink guard"),
      }),
    );
    expect(replaceKnowledgeGraphSnapshotMock).not.toHaveBeenCalled();
    expect(markKnowledgeGraphRunFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        runId: "run-1",
        error: expect.stringContaining("shrink guard"),
        metrics: expect.objectContaining({
          shrinkGuard: expect.objectContaining({
            priorEntityCount: 10,
            newEntityCount: 1,
          }),
        }),
      }),
    );
  });

  it("full rebuild resets cursors before reading and bypasses the shrink guard", async () => {
    const { db, cursorDelete } = makeDb();
    countKnowledgeGraphEntitiesForSourceMock.mockResolvedValueOnce(10);

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, fullRebuild: true },
      { db },
    );

    expect(result.status).toBe("succeeded");
    expect(cursorDelete.delete).toHaveBeenCalledTimes(1);
    expect((db.delete as any).mock.invocationCallOrder[0]).toBeLessThan(
      loadObservationsKnowledgeGraphSourceMock.mock.invocationCallOrder[0]!,
    );
    expect(replaceKnowledgeGraphSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runMetadata: { shrinkGuardBypassed: true },
      }),
    );
  });

  it("full rebuild purges this tenant's Cognee dataset before re-ingest", async () => {
    const { db } = makeDb();
    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, fullRebuild: true },
      { db },
    );
    expect(result.status).toBe("succeeded");
    expect(deleteDatasetByNameMock).toHaveBeenCalledWith(
      run.cognee_dataset_name,
    );
    expect(pruneAllMock).not.toHaveBeenCalled();
    // purge happens before the re-ingest
    expect(deleteDatasetByNameMock.mock.invocationCallOrder[0]!).toBeLessThan(
      ingestDocumentMock.mock.invocationCallOrder[0]!,
    );
  });

  it("cogneePruneAll wipes the whole store instead of one dataset", async () => {
    const { db } = makeDb();
    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, cogneePruneAll: true },
      { db },
    );
    expect(result.status).toBe("succeeded");
    expect(pruneAllMock).toHaveBeenCalledTimes(1);
    expect(deleteDatasetByNameMock).not.toHaveBeenCalled();
  });

  it("a Cognee purge failure does not abort the rebuild", async () => {
    const { db } = makeDb();
    deleteDatasetByNameMock.mockRejectedValueOnce(new Error("cognee 503"));
    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, fullRebuild: true },
      { db },
    );
    expect(result.status).toBe("succeeded");
    expect(ingestDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("drops a concurrent start when an active run already holds the dedupe key", async () => {
    const { db } = makeDb();
    createKnowledgeGraphObservationsIngestRunMock.mockResolvedValueOnce({
      run,
      inserted: false,
    });

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, status: "skipped", runId: "run-1" }),
    );
    expect(markKnowledgeGraphRunRunningMock).not.toHaveBeenCalled();
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("loads an existing run when invoked with a runId from the mutation", async () => {
    const { db } = makeDb();

    const result = await processKnowledgeGraphObservationsIngest(
      { runId: "run-1", tenantId: TENANT_ID },
      { db },
    );

    expect(loadKnowledgeGraphIngestRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        runId: "run-1",
        tenantId: TENANT_ID,
        sourceKind: "observations",
      }),
    );
    expect(
      createKnowledgeGraphObservationsIngestRunMock,
    ).not.toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
  });

  it("rejects malformed worker envelopes", async () => {
    const { db } = makeDb();
    await expect(
      processKnowledgeGraphObservationsIngest({}, { db }),
    ).rejects.toThrow(/tenantId/);
  });

  it("fires the graph wiki-compile enqueue after a successful run (plan 2026-06-09-004 U10)", async () => {
    const { db } = makeDb();

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result.status).toBe("succeeded");
    expect(maybeEnqueueGraphWikiCompileMock).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
    });
  });

  it("does not fire the wiki enqueue on a stale_noop run", async () => {
    const { db } = makeDb();
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce({
      ...makeSourceResult({ promotedIds: [] }),
      candidateCount: 0,
      nextCursors: new Map(),
    });

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result.status).toBe("stale_noop");
    expect(maybeEnqueueGraphWikiCompileMock).not.toHaveBeenCalled();
  });

  it("a degraded wiki enqueue never fails the ingest run (best-effort)", async () => {
    const { db } = makeDb();
    maybeEnqueueGraphWikiCompileMock.mockResolvedValueOnce({
      status: "error",
      error: "lambda unreachable",
    });

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(markKnowledgeGraphRunFailedMock).not.toHaveBeenCalled();
  });
});

// ─── Backlog throughput: per-run candidate cap + self-invoke drain ───────────

describe("knowledge-graph-observations-ingest backlog throughput", () => {
  it("passes the default per-run candidate cap (100) to the source loader", async () => {
    const { db } = makeDb();

    await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(loadObservationsKnowledgeGraphSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxCandidates: 100 }),
    );
  });

  it("honors KG_OBS_MAX_CANDIDATES_PER_RUN (env read at call time)", async () => {
    process.env.KG_OBS_MAX_CANDIDATES_PER_RUN = "25";
    const { db } = makeDb();

    await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(loadObservationsKnowledgeGraphSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxCandidates: 25 }),
    );
  });

  it("falls back to the default cap on a malformed env value", async () => {
    process.env.KG_OBS_MAX_CANDIDATES_PER_RUN = "not-a-number";
    const { db } = makeDb();

    await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(loadObservationsKnowledgeGraphSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxCandidates: 100 }),
    );
  });

  it("self-invokes (fire-and-forget) after a truncated run that made progress", async () => {
    const { db } = makeDb();
    const selfInvoke = vi.fn().mockResolvedValue(undefined);
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce(
      makeSourceResult({ truncated: true }),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, trigger: "scheduled" },
      { db, selfInvoke },
    );

    expect(result.status).toBe("succeeded");
    expect(selfInvoke).toHaveBeenCalledTimes(1);
    expect(selfInvoke).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      trigger: "scheduled",
    });
    expect(result.metrics).toEqual(
      expect.objectContaining({ selfInvoked: true }),
    );
  });

  it("does not self-invoke when the run was not truncated", async () => {
    const { db } = makeDb();
    const selfInvoke = vi.fn();

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db, selfInvoke },
    );

    expect(result.status).toBe("succeeded");
    expect(selfInvoke).not.toHaveBeenCalled();
    expect(result.metrics).toEqual(
      expect.objectContaining({ selfInvoked: false }),
    );
  });

  it("loop guard: does not self-invoke on a truncated run with zero progress", async () => {
    const { db } = makeDb();
    const selfInvoke = vi.fn();
    // Truncated but nothing promoted AND no cursor advanced — re-invoking
    // would re-read the same candidates forever.
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce({
      ...makeSourceResult({ truncated: true }),
      nextCursors: new Map(),
    });

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db, selfInvoke },
    );

    expect(result.status).toBe("succeeded");
    expect(selfInvoke).not.toHaveBeenCalled();
  });

  it("a failed self-invoke never fails the run (sweep remains the backstop)", async () => {
    const { db } = makeDb();
    const selfInvoke = vi.fn().mockRejectedValue(new Error("denied"));
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce(
      makeSourceResult({ truncated: true }),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db, selfInvoke },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.metrics).toEqual(
      expect.objectContaining({ selfInvoked: false }),
    );
    expect(markKnowledgeGraphRunFailedMock).not.toHaveBeenCalled();
  });

  it("does not self-invoke when the run fails", async () => {
    const { db } = makeDb();
    const selfInvoke = vi.fn();
    loadObservationsKnowledgeGraphSourceMock.mockResolvedValueOnce(
      makeSourceResult({ truncated: true }),
    );
    replaceKnowledgeGraphSnapshotMock.mockRejectedValueOnce(
      new Error("tx failed"),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db, selfInvoke },
    );

    expect(result.status).toBe("failed");
    expect(selfInvoke).not.toHaveBeenCalled();
  });
});
