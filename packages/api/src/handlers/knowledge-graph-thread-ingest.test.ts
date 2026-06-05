import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchDatasetGraphMock,
  ingestThreadMock,
  loadApprovedOntologyExportMock,
  loadKnowledgeGraphIngestRunMock,
  loadThreadTranscriptMock,
  markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunningMock,
  replaceKnowledgeGraphSnapshotMock,
} = vi.hoisted(() => ({
  fetchDatasetGraphMock: vi.fn(),
  ingestThreadMock: vi.fn(),
  loadApprovedOntologyExportMock: vi.fn(),
  loadKnowledgeGraphIngestRunMock: vi.fn(),
  loadThreadTranscriptMock: vi.fn(),
  markKnowledgeGraphRunFailedMock: vi.fn(),
  markKnowledgeGraphRunRunningMock: vi.fn(),
  replaceKnowledgeGraphSnapshotMock: vi.fn(),
}));

vi.mock("../lib/knowledge-graph/cognee-client.js", () => ({
  CogneeClient: vi.fn(() => ({
    fetchDatasetGraph: fetchDatasetGraphMock,
    ingestThread: ingestThreadMock,
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

vi.mock("../lib/knowledge-graph/repository.js", () => ({
  loadKnowledgeGraphIngestRun: loadKnowledgeGraphIngestRunMock,
  markKnowledgeGraphRunFailed: markKnowledgeGraphRunFailedMock,
  markKnowledgeGraphRunRunning: markKnowledgeGraphRunRunningMock,
  replaceKnowledgeGraphSnapshot: replaceKnowledgeGraphSnapshotMock,
}));

vi.mock("../lib/knowledge-graph/thread-transcript.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/knowledge-graph/thread-transcript.js")
  >("../lib/knowledge-graph/thread-transcript.js");
  return {
    ...actual,
    loadThreadTranscript: loadThreadTranscriptMock,
  };
});

import { processKnowledgeGraphThreadIngest } from "./knowledge-graph-thread-ingest.js";

const db = { marker: "db" } as any;
const run = {
  id: "run-1",
  tenant_id: "tenant-1",
  thread_id: "thread-1",
  cognee_dataset_name: "thinkwork:tenant-1:thread:thread-1",
};
const transcript = [
  {
    id: "message-1",
    role: "user",
    senderType: "user",
    senderId: "user-1",
    speakerLabel: "User",
    text: "Acme uses Delta.",
    createdAt: new Date("2026-06-04T12:00:00.000Z"),
    ordinal: 0,
  },
];
const ontology = {
  mechanism: "cognee_owl_ontology" as const,
  entityTypes: [],
  relationshipTypes: [],
  customPrompt: "Extract",
  ontologyKey: "thinkwork_tenant_abc123",
  ontologyOwlXml: "<rdf:RDF></rdf:RDF>",
};

beforeEach(() => {
  loadKnowledgeGraphIngestRunMock.mockReset().mockResolvedValue(run);
  markKnowledgeGraphRunRunningMock.mockReset().mockResolvedValue(undefined);
  markKnowledgeGraphRunFailedMock.mockReset().mockResolvedValue(undefined);
  replaceKnowledgeGraphSnapshotMock.mockReset().mockResolvedValue(undefined);
  loadThreadTranscriptMock.mockReset().mockResolvedValue(transcript);
  loadApprovedOntologyExportMock.mockReset().mockResolvedValue(ontology);
  ingestThreadMock.mockReset().mockResolvedValue({
    datasetId: "11111111-1111-4111-8111-111111111111",
    datasetName: run.cognee_dataset_name,
    mode: "remember",
    raw: {},
  });
  fetchDatasetGraphMock.mockReset().mockResolvedValue({
    nodes: [{ id: "acme", label: "Acme", type: "Company", properties: {} }],
    edges: [],
  });
});

describe("knowledge-graph-thread-ingest handler", () => {
  it("processes a run and persists the normalized snapshot", async () => {
    const result = await processKnowledgeGraphThreadIngest(
      { runId: "run-1", tenantId: "tenant-1", threadId: "thread-1" },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        runId: "run-1",
        status: "succeeded",
      }),
    );
    expect(markKnowledgeGraphRunRunningMock).toHaveBeenCalledWith({
      db,
      runId: "run-1",
    });
    expect(ingestThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: run.tenant_id,
        threadId: run.thread_id,
        datasetName: run.cognee_dataset_name,
        ontology,
      }),
    );
    expect(replaceKnowledgeGraphSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        run,
        cogneeDatasetId: "11111111-1111-4111-8111-111111111111",
        ingestMode: "remember",
        ontologyMechanism: "cognee_owl_ontology",
      }),
    );
  });

  it("marks the run failed when Cognee returns no dataset id", async () => {
    ingestThreadMock.mockResolvedValueOnce({
      datasetId: null,
      datasetName: run.cognee_dataset_name,
      mode: "remember",
      raw: {},
    });

    const result = await processKnowledgeGraphThreadIngest(
      { runId: "run-1", tenantId: "tenant-1", threadId: "thread-1" },
      { db },
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.stringContaining("dataset id"),
      }),
    );
    expect(markKnowledgeGraphRunFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        runId: "run-1",
        error: expect.stringContaining("dataset id"),
      }),
    );
    expect(replaceKnowledgeGraphSnapshotMock).not.toHaveBeenCalled();
  });

  it("rejects malformed worker envelopes", async () => {
    await expect(
      processKnowledgeGraphThreadIngest({ runId: "run-1" }, { db }),
    ).rejects.toThrow(/tenantId/);
  });
});
