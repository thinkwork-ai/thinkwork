import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertSafeN8nWorkflowLocation,
  fetchN8nWorkflow,
  parseN8nWorkflowLocation,
} from "./workflow-importer.js";

describe("parseN8nWorkflowLocation", () => {
  it("extracts a workflow id from editor URLs", () => {
    expect(
      parseN8nWorkflowLocation(
        "https://n8n.lastmile-tei.com/workflow/_JUTpWjHOd4jtUSQ66sYr",
      ),
    ).toEqual({
      baseUrl: "https://n8n.lastmile-tei.com",
      workflowId: "_JUTpWjHOd4jtUSQ66sYr",
    });
  });

  it("extracts a workflow id from API URLs", () => {
    expect(
      parseN8nWorkflowLocation(
        "https://n8n.lastmile-tei.com/api/v1/workflows/workflow-1",
      ),
    ).toEqual({
      baseUrl: "https://n8n.lastmile-tei.com",
      workflowId: "workflow-1",
    });
  });
});

describe("fetchN8nWorkflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pulls from the public API endpoint with the tenant n8n API key", async () => {
    const workflow = {
      id: "workflow-1",
      name: "PDI Fuel Order",
      nodes: [],
      connections: {},
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: workflow }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchN8nWorkflow({
      workflowUrl: "https://n8n.lastmile-tei.com/workflow/workflow-1",
      auth: { apiKey: "n8n_api_key" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.lastmile-tei.com/api/v1/workflows/workflow-1",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "x-n8n-api-key": "n8n_api_key",
        },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.workflow).toEqual(workflow);
  });

  it("falls back to the legacy rest endpoint", async () => {
    const workflow = {
      id: "workflow-1",
      name: "PDI Fuel Order",
      nodes: [],
      connections: {},
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(workflow),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchN8nWorkflow({
      workflowUrl: "https://n8n.lastmile-tei.com/workflow/workflow-1",
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://n8n.lastmile-tei.com/rest/workflows/workflow-1",
      expect.objectContaining({
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.workflow).toEqual(workflow);
  });
});

describe("assertSafeN8nWorkflowLocation", () => {
  it("requires HTTPS", () => {
    expect(() =>
      assertSafeN8nWorkflowLocation({
        baseUrl: "http://n8n.lastmile-tei.com",
        workflowId: "workflow-1",
      }),
    ).toThrow("HTTPS");
  });

  it("rejects private and local hosts", () => {
    expect(() =>
      assertSafeN8nWorkflowLocation({
        baseUrl: "https://127.0.0.1",
        workflowId: "workflow-1",
      }),
    ).toThrow("private or local hosts");
    expect(() =>
      assertSafeN8nWorkflowLocation({
        baseUrl: "https://169.254.169.254",
        workflowId: "workflow-1",
      }),
    ).toThrow("private or local hosts");
    expect(() =>
      assertSafeN8nWorkflowLocation({
        baseUrl: "https://n8n",
        workflowId: "workflow-1",
      }),
    ).toThrow("private or local hosts");
  });

  it("requires the workflow URL to match the credential base URL", () => {
    expect(() =>
      assertSafeN8nWorkflowLocation(
        {
          baseUrl: "https://attacker.example.com",
          workflowId: "workflow-1",
        },
        { allowedBaseUrl: "https://n8n.lastmile-tei.com" },
      ),
    ).toThrow("configured credential base URL");
  });
});
