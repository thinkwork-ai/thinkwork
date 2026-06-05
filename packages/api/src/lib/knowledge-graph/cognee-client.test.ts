import { describe, expect, it, vi } from "vitest";
import { CogneeClient } from "./cognee-client.js";

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
      "thinkwork_threads",
      "tenant_tenant_1",
      "thread_thread_1",
    ]);
    expect((rememberBody as FormData).get("ontology_key")).toBe(
      ontology.ontologyKey,
    );
    expect(graph.nodes).toEqual([
      {
        id: "n1",
        label: "Acme",
        type: "Company",
        properties: {},
      },
    ]);
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
      run_in_background: false,
      custom_prompt: ontology.customPrompt,
      ontology_key: [ontology.ontologyKey],
    });
  });
});
