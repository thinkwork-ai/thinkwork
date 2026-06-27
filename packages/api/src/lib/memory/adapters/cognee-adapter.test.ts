import { describe, expect, it, vi } from "vitest";

import { CogneeAdapter } from "./cognee-adapter.js";

const ontology = {
  mechanism: "custom_prompt" as const,
  entityTypes: [],
  relationshipTypes: [],
  customPrompt: "Extract memory.",
  ontologyKey: null,
  ontologyOwlXml: null,
};

describe("CogneeAdapter", () => {
  it("upserts user markdown into the stable Cognee user memory scope", async () => {
    const client = {
      ingestDocument: vi.fn().mockResolvedValue({
        datasetId: "dataset-1",
        datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
        mode: "remember",
        pipelineRunId: null,
        raw: {},
      }),
      waitForDatasetIndexing: vi.fn().mockResolvedValue({
        status: "completed",
        rawStatus: "DATASET_PROCESSING_COMPLETED",
        attempts: 1,
        elapsedMs: 1,
        samples: [],
      }),
      search: vi.fn(),
    };
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client,
      ontology,
    });

    await adapter.upsertMarkdownMemoryDocument({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
      threadId: "thread-1",
      path: "memory/MEMORY.md",
      content: "# Durable memory\n\nUse concise summaries.",
      documentId: "requester_memory:user-1:memory/MEMORY.md",
      context: "thinkwork_requester_memory",
      metadata: {
        runId: "run-1",
        evidenceMessageIds: ["msg-1"],
      },
    });

    expect(client.ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        sourceKind: "user_memory",
        sourceRef: "user-1",
        datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
        filename: "MEMORY.md",
        ontology,
      }),
    );
    const document = client.ingestDocument.mock.calls[0][0].document as string;
    expect(document).toContain("requester_memory:user-1:memory/MEMORY.md");
    expect(document).toContain('"thread_id":"thread-1"');
    expect(document).toContain('"evidenceMessageIds":["msg-1"]');
    expect(document).toContain("# Durable memory");
    expect(client.waitForDatasetIndexing).toHaveBeenCalledWith("dataset-1");
  });

  it("fails memory upsert when Cognee does not return a dataset id", async () => {
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client: {
        ingestDocument: vi.fn().mockResolvedValue({
          datasetId: null,
          datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
          mode: "remember",
          pipelineRunId: null,
          raw: {},
        }),
        search: vi.fn(),
      },
      ontology,
    });

    await expect(
      adapter.upsertMarkdownMemoryDocument({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-1",
        path: "memory/MEMORY.md",
        content: "Use concise summaries.",
        documentId: "requester_memory:user-1:memory/MEMORY.md",
        context: "thinkwork_requester_memory",
      }),
    ).rejects.toThrow(
      "Cognee memory ingest did not return a dataset id for indexing",
    );
  });

  it("does not fail capture when Cognee indexing is still pending", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client: {
        ingestDocument: vi.fn().mockResolvedValue({
          datasetId: "dataset-pending",
          datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
          mode: "add_cognify",
          pipelineRunId: "pipeline-1",
          raw: {},
        }),
        waitForDatasetIndexing: vi
          .fn()
          .mockRejectedValue(new Error("indexing did not complete in time")),
        search: vi.fn(),
      },
      ontology,
    });

    await expect(
      adapter.upsertMarkdownMemoryDocument({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-1",
        path: "memory/MEMORY.md",
        content: "Use concise summaries.",
        documentId: "requester_memory:user-1:memory/MEMORY.md",
        context: "thinkwork_requester_memory",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "[cognee-memory] indexing still pending after capture",
      expect.objectContaining({
        datasetId: "dataset-pending",
        error: "indexing did not complete in time",
      }),
    );
    warn.mockRestore();
  });

  it("recalls from the stable Cognee user memory dataset and node sets", async () => {
    const client = {
      ingestDocument: vi.fn(),
      search: vi.fn().mockResolvedValue({
        results: [
          {
            id: "hit-1",
            text: "Use concise summaries.",
            score: 0.92,
            createdAt: "2026-06-26T19:00:00.000Z",
            metadata: {
              belongs_to_set: [
                "thinkwork_memory",
                "thinkwork_user_memory",
                "tenant_tenant_1",
                "user_user_1",
              ],
            },
          },
        ],
      }),
    };
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client,
      ontology,
    });

    const hits = await adapter.recall({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-1",
      query: "summary preference",
      limit: 5,
    });

    expect(client.search).toHaveBeenCalledWith({
      query: "summary preference",
      searchType: "GRAPH_COMPLETION",
      datasets: ["thinkwork:memory:v1:tenant:tenant_1:user:user_1"],
      nodeNames: [
        "thinkwork_memory",
        "thinkwork_memory_v1",
        "thinkwork_user_memory",
        "tenant_tenant_1",
        "user_user_1",
      ],
      nodeNameFilterOperator: "AND",
      topK: 25,
      onlyContext: true,
      includeReferences: true,
    });
    expect(hits).toEqual([
      expect.objectContaining({
        backend: "cognee",
        score: 0.92,
        record: expect.objectContaining({
          id: "hit-1",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          content: { text: "Use concise summaries." },
          metadata: expect.objectContaining({
            datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
          }),
        }),
      }),
    ]);
  });

  it("upserts space markdown into the stable Cognee space memory scope", async () => {
    const client = {
      ingestDocument: vi.fn().mockResolvedValue({
        datasetId: "dataset-space",
        datasetName: "thinkwork:memory:v1:tenant:tenant_1:space:space_1",
        mode: "remember",
        pipelineRunId: null,
        raw: {},
      }),
      search: vi.fn(),
    };
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client,
      ontology,
    });

    await adapter.upsertMarkdownMemoryDocument({
      tenantId: "tenant-1",
      ownerType: "space",
      ownerId: "space-1",
      path: "memory/SPACE.md",
      content:
        "# Space decisions\n\nAll onboarding runs use the enterprise template.",
      documentId: "space_memory:space-1:memory/SPACE.md",
      context: "thinkwork_space_memory",
      metadata: {
        capturedByUserId: "user-1",
      },
    });

    expect(client.ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        sourceKind: "space_memory",
        sourceRef: "space-1",
        datasetName: "thinkwork:memory:v1:tenant:tenant_1:space:space_1",
        filename: "SPACE.md",
        ontology,
      }),
    );
    const call = client.ingestDocument.mock.calls[0][0];
    expect(call.customPrompt).toContain("stays with the space");
    expect(call.document).toContain('"owner_type":"space"');
    expect(call.document).toContain('"capturedByUserId":"user-1"');
  });

  it("recalls from the stable Cognee space memory dataset and node sets", async () => {
    const client = {
      ingestDocument: vi.fn(),
      search: vi.fn().mockResolvedValue({
        results: [
          {
            id: "space-hit-1",
            text: "All onboarding runs use the enterprise template.",
            score: 0.88,
            properties: {
              belongs_to_set: [
                "thinkwork_memory",
                "thinkwork_space_memory",
                "tenant_tenant_1",
                "space_space_1",
              ],
            },
          },
        ],
      }),
    };
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client,
      ontology,
    });

    const hits = await adapter.recall({
      tenantId: "tenant-1",
      ownerType: "space",
      ownerId: "space-1",
      query: "onboarding template",
      limit: 5,
    });

    expect(client.search).toHaveBeenCalledWith({
      query: "onboarding template",
      searchType: "GRAPH_COMPLETION",
      datasets: ["thinkwork:memory:v1:tenant:tenant_1:space:space_1"],
      nodeNames: [
        "thinkwork_memory",
        "thinkwork_memory_v1",
        "thinkwork_space_memory",
        "tenant_tenant_1",
        "space_space_1",
      ],
      nodeNameFilterOperator: "AND",
      topK: 25,
      onlyContext: true,
      includeReferences: true,
    });
    expect(hits[0]).toMatchObject({
      backend: "cognee",
      score: 0.88,
      record: {
        id: "space-hit-1",
        tenantId: "tenant-1",
        ownerType: "space",
        ownerId: "space-1",
        content: {
          text: "All onboarding runs use the enterprise template.",
        },
      },
    });
  });

  it("drops Cognee search rows that do not belong to the requested memory owner", async () => {
    const client = {
      ingestDocument: vi.fn(),
      search: vi.fn().mockResolvedValue({
        results: [
          {
            id: "wiki-hit",
            text: "Old wiki index content.",
            metadata: {
              belongs_to_set: [
                "thinkwork_wiki",
                "tenant_tenant_1",
                "wiki_owner_user_1_recent",
              ],
            },
          },
          {
            id: "space-hit",
            text: "All onboarding runs use the enterprise template.",
            metadata: {
              belongs_to_set: [
                "thinkwork_memory",
                "thinkwork_memory_v1",
                "thinkwork_space_memory",
                "tenant_tenant_1",
                "space_space_1",
              ],
            },
          },
        ],
      }),
    };
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client,
      ontology,
    });

    const hits = await adapter.recall({
      tenantId: "tenant-1",
      ownerType: "space",
      ownerId: "space-1",
      query: "onboarding template",
      limit: 5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].record.id).toBe("space-hit");
  });

  it("rejects agent owners until the runtime memory unit wires policy", async () => {
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client: { ingestDocument: vi.fn(), search: vi.fn() },
      ontology,
    });

    await expect(
      adapter.recall({
        tenantId: "tenant-1",
        ownerType: "agent",
        ownerId: "agent-1",
        query: "decision",
      }),
    ).rejects.toThrow(
      "Cognee scope supports user and space memory only in this pass",
    );
  });
});
