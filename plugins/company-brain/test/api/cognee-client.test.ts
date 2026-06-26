import { describe, expect, it, vi } from "vitest";
import { CogneeClient } from "../../src/api/cognee-client.js";
import { buildCogneeMemoryScope } from "../../src/api/cognee-memory-scope.js";

const ontology = {
  mechanism: "cognee_owl_ontology" as const,
  entityTypes: [],
  relationshipTypes: [],
  customPrompt: "Extract the graph.",
  ontologyKey: "thinkwork_tenant_abc123",
  ontologyOwlXml: "<rdf:RDF></rdf:RDF>",
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe("CogneeClient", () => {
  it("uses remember and fetches a dataset graph", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(
        response(200, {
          uploaded_ontologies: [{ ontology_key: ontology.ontologyKey }],
        }),
      )
      .mockResolvedValueOnce(
        response(200, { dataset_id: "11111111-1111-4111-8111-111111111111" }),
      )
      .mockResolvedValueOnce(
        response(200, {
          nodes: [{ id: "n1", label: "Acme", type: "Company" }],
          edges: [{ source: "n1", target: "n1", label: "mentions" }],
        }),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local/",
      token: "token",
      fetchFn,
    });

    const ingest = await client.ingestThread({
      tenantId: "tenant-1",
      threadId: "thread-1",
      datasetName: "thinkwork:t:thread:x",
      transcript: "Acme",
      ontology,
    });
    const graph = await client.fetchDatasetGraph(ingest.datasetId!);

    expect(ingest).toEqual(
      expect.objectContaining({
        datasetId: "11111111-1111-4111-8111-111111111111",
        mode: "remember",
      }),
    );
    expect(fetchFn.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://cognee.local/api/v1/ontologies",
      "http://cognee.local/api/v1/ontologies",
      "http://cognee.local/api/v1/remember",
      "http://cognee.local/api/v1/datasets/11111111-1111-4111-8111-111111111111/graph",
    ]);
    const uploadBody = fetchFn.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect(Object.fromEntries(uploadBody as FormData)).toEqual(
      expect.objectContaining({
        ontology_key: ontology.ontologyKey,
      }),
    );
    const rememberBody = fetchFn.mock.calls[2]?.[1]?.body;
    expect(rememberBody).toBeInstanceOf(FormData);
    expect(Array.from((rememberBody as FormData).keys()).sort()).toEqual([
      "custom_prompt",
      "data",
      "datasetName",
      "node_set",
      "node_set",
      "node_set",
      "ontology_key",
      "run_in_background",
    ]);
    expect((rememberBody as FormData).getAll("node_set")).toEqual([
      "thinkwork_thread",
      "tenant_tenant_1",
      "thread_thread_1",
    ]);
    expect((rememberBody as FormData).get("ontology_key")).toBe(
      ontology.ontologyKey,
    );
    expect((rememberBody as FormData).get("run_in_background")).toBe("true");
    expect(graph.nodes).toEqual([
      {
        id: "n1",
        label: "Acme",
        type: "Company",
        properties: {},
      },
    ]);
  });

  it("posts user and space memory documents into separate Cognee scopes", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { [ontology.ontologyKey]: {} }))
      .mockResolvedValueOnce(
        response(200, { dataset_id: "11111111-1111-4111-8111-111111111111" }),
      )
      .mockResolvedValueOnce(response(200, { [ontology.ontologyKey]: {} }))
      .mockResolvedValueOnce(
        response(200, { dataset_id: "22222222-2222-4222-8222-222222222222" }),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
    });
    const userScope = buildCogneeMemoryScope({
      tenantId: "tenant-1",
      kind: "user",
      userId: "user-1",
    });
    const spaceScope = buildCogneeMemoryScope({
      tenantId: "tenant-1",
      kind: "space",
      spaceId: "space-1",
    });

    await client.ingestDocument({
      tenantId: userScope.tenantId,
      sourceKind: userScope.sourceKind,
      sourceRef: userScope.sourceRef,
      datasetName: userScope.datasetName,
      document: "User memory",
      filename: "thinkwork-user-memory.md",
      ontology,
    });
    await client.ingestDocument({
      tenantId: spaceScope.tenantId,
      sourceKind: spaceScope.sourceKind,
      sourceRef: spaceScope.sourceRef,
      datasetName: spaceScope.datasetName,
      document: "Space memory",
      filename: "thinkwork-space-memory.md",
      ontology,
    });

    const userBody = fetchFn.mock.calls[1]?.[1]?.body as FormData;
    const spaceBody = fetchFn.mock.calls[3]?.[1]?.body as FormData;
    expect(userBody.get("datasetName")).toBe(
      "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
    );
    expect(userBody.getAll("node_set")).toEqual([
      "thinkwork_memory",
      "thinkwork_memory_v1",
      "thinkwork_user_memory",
      "tenant_tenant_1",
      "user_user_1",
    ]);
    expect(spaceBody.get("datasetName")).toBe(
      "thinkwork:memory:v1:tenant:tenant_1:space:space_1",
    );
    expect(spaceBody.getAll("node_set")).toEqual([
      "thinkwork_memory",
      "thinkwork_memory_v1",
      "thinkwork_space_memory",
      "tenant_tenant_1",
      "space_space_1",
    ]);
  });

  it("posts scoped Cognee search requests", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { results: [{ text: "Use concise summaries." }] }),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
    });

    const result = await client.search({
      query: "summary preference",
      searchType: "CHUNKS",
      datasets: ["thinkwork:memory:v1:tenant:tenant_1:user:user_1"],
      nodeNames: ["thinkwork_user_memory", "user_user_1"],
      includeReferences: true,
      systemPrompt: "Use memory only.",
    });

    expect(result).toEqual({
      results: [{ text: "Use concise summaries." }],
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://cognee.local/api/v1/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "summary preference",
          search_type: "CHUNKS",
          datasets: ["thinkwork:memory:v1:tenant:tenant_1:user:user_1"],
          node_name: ["thinkwork_user_memory", "user_user_1"],
          include_references: true,
          system_prompt: "Use memory only.",
        }),
      }),
    );
  });

  it("falls back to add plus cognify when remember is unsupported", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { [ontology.ontologyKey]: {} }))
      .mockResolvedValueOnce(response(404, { detail: "missing" }))
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(
        response(200, { datasetId: "22222222-2222-4222-8222-222222222222" }),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
    });

    const ingest = await client.ingestThread({
      tenantId: "tenant-1",
      threadId: "thread-1",
      datasetName: "thinkwork:t:thread:x",
      transcript: "Acme",
      ontology,
    });

    expect(ingest).toEqual(
      expect.objectContaining({
        datasetId: "22222222-2222-4222-8222-222222222222",
        mode: "add_cognify",
      }),
    );
    expect(fetchFn.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://cognee.local/api/v1/ontologies",
      "http://cognee.local/api/v1/remember",
      "http://cognee.local/api/v1/add",
      "http://cognee.local/api/v1/cognify",
    ]);
    expect(JSON.parse(String(fetchFn.mock.calls[3]?.[1]?.body))).toEqual({
      datasets: ["thinkwork:t:thread:x"],
      run_in_background: true,
      custom_prompt: ontology.customPrompt,
      ontology_key: [ontology.ontologyKey],
    });
  });

  it("polls dataset status until Cognee indexing completes", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          "11111111-1111-4111-8111-111111111111": "DATASET_PROCESSING_STARTED",
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          "11111111-1111-4111-8111-111111111111":
            "DATASET_PROCESSING_COMPLETED",
        }),
      );

    vi.stubEnv("COGNEE_INDEX_POLL_MS", "1");
    try {
      const client = new CogneeClient({
        endpoint: "http://cognee.local",
        fetchFn,
        retryDelayMs: 0,
      });
      const status = await client.waitForDatasetIndexing(
        "11111111-1111-4111-8111-111111111111",
      );

      expect(status).toEqual(
        expect.objectContaining({
          status: "completed",
          rawStatus: "DATASET_PROCESSING_COMPLETED",
          attempts: 2,
        }),
      );
      expect(status.samples.map((sample) => sample.status)).toEqual([
        "running",
        "completed",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("preserves Cognee ontology metadata from graph payloads", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(200, {
        nodes: [
          {
            id: "n1",
            label: "Acme",
            type: "Entity",
            is_a: { name: "Company" },
            ontology_valid: true,
          },
        ],
        edges: [
          {
            id: "e1",
            source: "n1",
            target: "n1",
            relationship_type: "Uses",
            ontology_valid: true,
          },
        ],
      }),
    );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
      retryDelayMs: 0,
    });

    const graph = await client.fetchDatasetGraph(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: "n1",
        label: "Acme",
        type: "Entity",
        properties: {
          is_a: { name: "Company" },
          ontology_valid: true,
        },
      }),
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: "e1",
        label: "Uses",
        type: "Uses",
        properties: { relationship_type: "Uses", ontology_valid: true },
      }),
    ]);
  });

  it("summarizes Cognee HTML errors without leaking markup", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        textResponse(
          503,
          "<html><head><title>503 Service Temporarily Unavailable</title></head><body></body></html>",
        ),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
      retryAttempts: 1,
      retryDelayMs: 0,
    });

    await expect(
      client.ingestThread({
        tenantId: "tenant-1",
        threadId: "thread-1",
        datasetName: "thinkwork:t:thread:x",
        transcript: "Acme",
        ontology,
      }),
    ).rejects.toThrow(
      "Cognee /api/v1/ontologies failed with 503: 503 Service Temporarily Unavailable",
    );
  });

  it("rides through a transient 503 on the status endpoint and completes", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          "11111111-1111-4111-8111-111111111111": "DATASET_PROCESSING_STARTED",
        }),
      )
      .mockResolvedValueOnce(response(503, { detail: "Service Unavailable" }))
      .mockResolvedValueOnce(response(503, { detail: "Service Unavailable" }))
      .mockResolvedValueOnce(
        response(200, {
          "11111111-1111-4111-8111-111111111111":
            "DATASET_PROCESSING_COMPLETED",
        }),
      );

    vi.stubEnv("COGNEE_INDEX_POLL_MS", "1");
    try {
      const client = new CogneeClient({
        endpoint: "http://cognee.local",
        fetchFn,
        retryDelayMs: 0,
        retryAttempts: 1,
      });
      const status = await client.waitForDatasetIndexing(
        "11111111-1111-4111-8111-111111111111",
      );
      expect(status.status).toBe("completed");
      expect(status.rawStatus).toBe("DATASET_PROCESSING_COMPLETED");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to a graph probe when status stays unavailable past timeout", async () => {
    // status endpoint always 503; the graph probe finds nodes (pipeline done)
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("/datasets/status")) {
        return response(503, { detail: "Service Unavailable" });
      }
      if (String(url).includes("/graph")) {
        return response(200, {
          nodes: [{ id: "n1", label: "Acme", type: "Company" }],
          edges: [],
        });
      }
      return response(200, {});
    });

    vi.stubEnv("COGNEE_INDEX_POLL_MS", "1");
    vi.stubEnv("COGNEE_INDEX_TIMEOUT_MS", "5");
    try {
      const client = new CogneeClient({
        endpoint: "http://cognee.local",
        fetchFn,
        retryDelayMs: 0,
        retryAttempts: 1,
      });
      const status = await client.waitForDatasetIndexing(
        "11111111-1111-4111-8111-111111111111",
      );
      expect(status.status).toBe("completed");
      expect(status.rawStatus).toBe("completed_via_graph_probe");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws past timeout when status is unavailable AND the graph is empty", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("/datasets/status")) {
        return response(503, { detail: "Service Unavailable" });
      }
      if (String(url).includes("/graph")) {
        return response(200, { nodes: [], edges: [] });
      }
      return response(200, {});
    });

    vi.stubEnv("COGNEE_INDEX_POLL_MS", "1");
    vi.stubEnv("COGNEE_INDEX_TIMEOUT_MS", "5");
    try {
      const client = new CogneeClient({
        endpoint: "http://cognee.local",
        fetchFn,
        retryDelayMs: 0,
        retryAttempts: 1,
      });
      await expect(
        client.waitForDatasetIndexing("11111111-1111-4111-8111-111111111111"),
      ).rejects.toThrow(/did not complete|failed with 503/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("deleteDatasetByName finds matching datasets and deletes them", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          datasets: [
            { id: "ds-1", name: "thinkwork:t:observations" },
            { id: "ds-2", name: "thinkwork:t:thread:x" },
            { id: "ds-3", name: "thinkwork:t:observations" },
          ],
        }),
      )
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(response(200, {}));
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
      retryDelayMs: 0,
    });
    const deleted = await client.deleteDatasetByName(
      "thinkwork:t:observations",
    );
    expect(deleted).toBe(2);
    const calls = fetchFn.mock.calls.map((c) => [String(c[0]), c[1]?.method]);
    expect(calls[0]).toEqual(["http://cognee.local/api/v1/datasets", "GET"]);
    expect(calls).toContainEqual([
      "http://cognee.local/api/v1/datasets/ds-1",
      "DELETE",
    ]);
    expect(calls).toContainEqual([
      "http://cognee.local/api/v1/datasets/ds-3",
      "DELETE",
    ]);
    // ds-2 (a thread dataset) must NOT be deleted
    expect(calls).not.toContainEqual([
      "http://cognee.local/api/v1/datasets/ds-2",
      "DELETE",
    ]);
  });

  it("deleteDatasetByName is a no-op when no dataset matches", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { datasets: [{ id: "ds-2", name: "other" }] }),
      );
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
      retryDelayMs: 0,
    });
    expect(await client.deleteDatasetByName("missing")).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("pruneAll POSTs to the prune endpoint", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, {}));
    const client = new CogneeClient({
      endpoint: "http://cognee.local",
      fetchFn,
      retryDelayMs: 0,
    });
    expect(await client.pruneAll()).toBe(true);
    expect(String(fetchFn.mock.calls[0][0])).toBe(
      "http://cognee.local/api/v1/prune",
    );
    expect(fetchFn.mock.calls[0][1]?.method).toBe("POST");
  });
});
