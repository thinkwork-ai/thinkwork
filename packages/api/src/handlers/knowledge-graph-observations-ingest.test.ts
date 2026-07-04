import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  extractorMock,
  loadApprovedOntologyExportMock,
  loadKnowledgeGraphIngestRunMock,
  loadObservationsKnowledgeGraphSourceMock,
  markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunningMock,
  markKnowledgeGraphRunStaleNoopMock,
  mergeKnowledgeGraphSnapshotMock,
  purgeKnowledgeGraphSourceMock,
  createKnowledgeGraphObservationsIngestRunMock,
  reapStaleObservationIngestRunsMock,
} = vi.hoisted(() => ({
  extractorMock: vi.fn(),
  loadApprovedOntologyExportMock: vi.fn(),
  loadKnowledgeGraphIngestRunMock: vi.fn(),
  loadObservationsKnowledgeGraphSourceMock: vi.fn(),
  markKnowledgeGraphRunFailedMock: vi.fn(),
  markKnowledgeGraphRunRunningMock: vi.fn(),
  markKnowledgeGraphRunStaleNoopMock: vi.fn(),
  mergeKnowledgeGraphSnapshotMock: vi.fn(),
  purgeKnowledgeGraphSourceMock: vi.fn(),
  createKnowledgeGraphObservationsIngestRunMock: vi.fn(),
  reapStaleObservationIngestRunsMock: vi.fn(),
}));

vi.mock("../lib/knowledge-graph/bedrock-graph-extractor.js", () => ({
  extractGraphFromPackets: extractorMock,
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
  loadKnowledgeGraphIngestRun: loadKnowledgeGraphIngestRunMock,
  markKnowledgeGraphRunFailed: markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunning: markKnowledgeGraphRunRunningMock,
  markKnowledgeGraphRunStaleNoop: markKnowledgeGraphRunStaleNoopMock,
  mergeKnowledgeGraphSnapshot: mergeKnowledgeGraphSnapshotMock,
  purgeKnowledgeGraphSource: purgeKnowledgeGraphSourceMock,
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

import { processKnowledgeGraphObservationsIngest } from "./knowledge-graph-observations-ingest.js";

const TENANT_ID = "tenant-1";
const run = {
  id: "run-1",
  tenant_id: TENANT_ID,
  thread_id: null,
  source_kind: "observations",
  source_ref: `tenant:${TENANT_ID}:observations`,
  source_label: "Hindsight observations",
  source_dataset_name: `thinkwork:${TENANT_ID}:observations`,
  input: { source: "observations", fullRebuild: false },
  metadata: {},
};
const ontology = {
  mechanism: "custom_prompt" as const,
  // "Company" is approved so the extracted node grounds through the REAL
  // normalizer (unapproved-type nodes are dropped).
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
  ontologyOwlXml: null,
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
      document: "# Hindsight observations",
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
        classifierModelId: "moonshotai.kimi-k2.5",
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

function makeExtraction(
  overrides: Partial<{
    batchesDropped: number;
    batchesTruncated: number;
    nodes: unknown[];
    edges: unknown[];
  }> = {},
) {
  return {
    payload: {
      // "Acme" is a verbatim substring of the evidence text, so the real
      // normalizer grounds it strong under the approved "company" type.
      nodes: overrides.nodes ?? [
        { id: "b0:acme", label: "Acme", type: "company", properties: null },
      ],
      edges: overrides.edges ?? [],
    },
    batchesTotal: 1,
    batchesDropped: overrides.batchesDropped ?? 0,
    batchesTruncated: overrides.batchesTruncated ?? 0,
    inputTokens: 120,
    outputTokens: 340,
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
  mergeKnowledgeGraphSnapshotMock.mockReset().mockResolvedValue(undefined);
  purgeKnowledgeGraphSourceMock.mockReset().mockResolvedValue(undefined);
  loadApprovedOntologyExportMock.mockReset().mockResolvedValue(ontology);
  loadObservationsKnowledgeGraphSourceMock
    .mockReset()
    .mockResolvedValue(makeSourceResult());
  extractorMock.mockReset().mockResolvedValue(makeExtraction());
  delete process.env.KG_OBS_MAX_CANDIDATES_PER_RUN;
  delete process.env.BRAIN_ARTIFACTS_BUCKET;
});

describe("knowledge-graph-observations-ingest handler", () => {
  it("extracts promoted packets and merges snapshot + cursors + audit together", async () => {
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
    // Extraction runs over the promoted packets (no external graph round-trip).
    expect(extractorMock).toHaveBeenCalledTimes(1);
    expect(extractorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        packets: expect.arrayContaining([
          expect.objectContaining({ id: "obs-1" }),
        ]),
        ontology,
      }),
    );

    // Merge-upsert (not replace) + cursor advance + run completion ride ONE
    // call into the repository transaction.
    expect(mergeKnowledgeGraphSnapshotMock).toHaveBeenCalledTimes(1);
    const mergeArgs = mergeKnowledgeGraphSnapshotMock.mock.calls[0]![0];
    expect(mergeArgs).toEqual(
      expect.objectContaining({
        db,
        run,
        ingestMode: "bedrock_extraction",
        runMetadata: undefined,
        sourceMetrics: expect.objectContaining({
          candidateCount: 3,
          promotedIds: ["obs-1", "obs-2", "obs-3"],
          extraction: expect.objectContaining({ batchesTotal: 1 }),
        }),
      }),
    );
    // The grounded, verbatim-provenance entity survived the real normalizer.
    expect(mergeArgs.snapshot.entities).toHaveLength(1);
    expect(mergeArgs.snapshot.entities[0].groundingStatus).toBe("grounded");
    expect(mergeArgs.snapshot.entities[0].provenanceStatus).toBe("strong");

    // Cursor advance happens via extraWork inside the same transaction.
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const tx = { insert: vi.fn(() => ({ values })) };
    await mergeArgs.extraWork(tx);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        bank_id: "user_aaa",
        last_record_id: "obs-3",
      }),
    );
    expect(markKnowledgeGraphRunFailedMock).not.toHaveBeenCalled();
  });

  it("finishes as stale_noop without extracting or merging when no candidates exist", async () => {
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
    expect(extractorMock).not.toHaveBeenCalled();
    expect(mergeKnowledgeGraphSnapshotMock).not.toHaveBeenCalled();
    expect(cursorDelete.delete).not.toHaveBeenCalled();
  });

  it("fails the run WITHOUT merging or advancing cursors when a batch drops (AE2)", async () => {
    const { db } = makeDb();
    extractorMock.mockResolvedValueOnce(
      makeExtraction({ batchesDropped: 1, batchesTruncated: 1 }),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.stringContaining("extraction dropped"),
      }),
    );
    // No mirror write and no cursor advance — the next sweep re-reads the
    // same candidates instead of skipping the unextracted observations.
    expect(mergeKnowledgeGraphSnapshotMock).not.toHaveBeenCalled();
    expect(markKnowledgeGraphRunFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        runId: "run-1",
        metrics: expect.objectContaining({
          extraction: expect.objectContaining({
            batchesDropped: 1,
            batchesTruncated: 1,
          }),
        }),
      }),
    );
  });

  it("does not advance cursors when the merge transaction fails", async () => {
    const { db } = makeDb();
    mergeKnowledgeGraphSnapshotMock.mockRejectedValueOnce(
      new Error("merge transaction failed"),
    );

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.stringContaining("merge transaction failed"),
      }),
    );
    expect(markKnowledgeGraphRunFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ db, runId: "run-1" }),
    );
    // Cursor writes live inside the merge transaction; nothing else writes
    // them, so a failed merge leaves cursors put.
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

  it("full rebuild resets cursors and purges the mirror before reading", async () => {
    const { db, cursorDelete } = makeDb();

    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, fullRebuild: true },
      { db },
    );

    expect(result.status).toBe("succeeded");
    expect(cursorDelete.delete).toHaveBeenCalledTimes(1);
    expect(purgeKnowledgeGraphSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        tenantId: TENANT_ID,
        sourceKind: "observations",
        sourceRef: run.source_ref,
      }),
    );
    // Purge before the source read (which drives extraction).
    expect(
      purgeKnowledgeGraphSourceMock.mock.invocationCallOrder[0]!,
    ).toBeLessThan(
      loadObservationsKnowledgeGraphSourceMock.mock.invocationCallOrder[0]!,
    );
    expect(mergeKnowledgeGraphSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ runMetadata: { fullRebuild: true } }),
    );
  });

  it("fullRebuild purges the mirror and resets cursors", async () => {
    const { db, cursorDelete } = makeDb();
    const result = await processKnowledgeGraphObservationsIngest(
      { tenantId: TENANT_ID, fullRebuild: true },
      { db },
    );
    expect(result.status).toBe("succeeded");
    expect(cursorDelete.delete).toHaveBeenCalledTimes(1);
    expect(purgeKnowledgeGraphSourceMock).toHaveBeenCalledTimes(1);
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
    expect(extractorMock).not.toHaveBeenCalled();
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
    mergeKnowledgeGraphSnapshotMock.mockRejectedValueOnce(
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
