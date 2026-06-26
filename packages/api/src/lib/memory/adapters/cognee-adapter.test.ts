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
      searchType: "CHUNKS",
      datasets: ["thinkwork:memory:v1:tenant:tenant_1:user:user_1"],
      nodeNames: [
        "thinkwork_memory",
        "thinkwork_memory_v1",
        "thinkwork_user_memory",
        "tenant_tenant_1",
        "user_user_1",
      ],
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

  it("rejects space owners until the explicit space-memory unit wires policy", async () => {
    const adapter = new CogneeAdapter({
      endpoint: "http://cognee.local",
      client: { ingestDocument: vi.fn(), search: vi.fn() },
      ontology,
    });

    await expect(
      adapter.recall({
        tenantId: "tenant-1",
        ownerType: "space" as "user",
        ownerId: "space-1",
        query: "decision",
      }),
    ).rejects.toThrow("Cognee recall supports user memory only in this unit");
  });
});
