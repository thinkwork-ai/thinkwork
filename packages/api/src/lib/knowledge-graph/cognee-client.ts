import type { KnowledgeGraphOntologyExport } from "./ontology-export.js";

export interface CogneeGraphNode {
  id: string;
  label: string;
  type?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface CogneeGraphEdge {
  id?: string | null;
  source: string;
  target: string;
  label: string;
  type?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface CogneeGraphPayload {
  nodes: CogneeGraphNode[];
  edges: CogneeGraphEdge[];
}

export interface CogneeIngestResult {
  datasetId: string | null;
  datasetName: string;
  mode: "remember" | "add_cognify";
  raw: unknown;
}

export class CogneeClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CogneeClientError";
  }
}

export class CogneeClient {
  private readonly endpoint: string;
  private readonly token: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly mode: "remember" | "add_cognify";

  constructor(
    opts: {
      endpoint?: string | null;
      token?: string | null;
      fetchFn?: typeof fetch;
      mode?: "remember" | "add_cognify" | null;
    } = {},
  ) {
    const endpoint = opts.endpoint ?? process.env.COGNEE_ENDPOINT;
    if (!endpoint) {
      throw new CogneeClientError("COGNEE_ENDPOINT is not configured");
    }
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.token = opts.token ?? process.env.COGNEE_API_KEY ?? null;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.mode =
      opts.mode ??
      (process.env.COGNEE_INGEST_MODE === "add_cognify"
        ? "add_cognify"
        : "remember");
  }

  async ingestThread(args: {
    datasetName: string;
    transcript: string;
    ontology: KnowledgeGraphOntologyExport;
  }): Promise<CogneeIngestResult> {
    if (this.mode === "add_cognify") {
      return this.addAndCognify(args);
    }
    try {
      return await this.remember(args);
    } catch (err) {
      if (!isUnsupportedRememberError(err)) throw err;
      return this.addAndCognify(args);
    }
  }

  async fetchDatasetGraph(datasetId: string): Promise<CogneeGraphPayload> {
    const payload = await this.requestJson(
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/graph`,
      { method: "GET" },
    );
    return parseGraphPayload(payload);
  }

  private async remember(args: {
    datasetName: string;
    transcript: string;
    ontology: KnowledgeGraphOntologyExport;
  }): Promise<CogneeIngestResult> {
    const body = buildTranscriptForm(args);
    const raw = await this.requestJson("/api/v1/remember", {
      method: "POST",
      body,
    });
    return {
      datasetId: extractDatasetId(raw),
      datasetName: args.datasetName,
      mode: "remember",
      raw,
    };
  }

  private async addAndCognify(args: {
    datasetName: string;
    transcript: string;
    ontology: KnowledgeGraphOntologyExport;
  }): Promise<CogneeIngestResult> {
    const addRaw = await this.requestJson("/api/v1/add", {
      method: "POST",
      body: buildTranscriptForm(args),
    });
    const cognifyRaw = await this.requestJson("/api/v1/cognify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        datasets: [args.datasetName],
        runInBackground: false,
        customPrompt: args.ontology.customPrompt,
      }),
    });
    return {
      datasetId: extractDatasetId(cognifyRaw) ?? extractDatasetId(addRaw),
      datasetName: args.datasetName,
      mode: "add_cognify",
      raw: { add: addRaw, cognify: cognifyRaw },
    };
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchFn(`${this.endpoint}${path}`, {
      ...init,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const payload = text ? safeJson(text) : {};
    if (!response.ok) {
      throw new CogneeClientError(
        `Cognee ${path} failed with ${response.status}: ${summarizePayload(payload)}`,
      );
    }
    return payload;
  }
}

function buildTranscriptForm(args: {
  datasetName: string;
  transcript: string;
  ontology: KnowledgeGraphOntologyExport;
}): FormData {
  const form = new FormData();
  form.append(
    "data",
    new Blob([args.transcript], { type: "text/markdown" }),
    "thinkwork-thread.md",
  );
  form.append("datasetName", args.datasetName);
  form.append("run_in_background", "false");
  form.append("content_type", "text/markdown");
  form.append("custom_prompt", args.ontology.customPrompt);
  return form;
}

function parseGraphPayload(payload: unknown): CogneeGraphPayload {
  const record = payload as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];
  return {
    nodes: nodes
      .map((node) => node as Record<string, unknown>)
      .filter((node) => node.id && node.label)
      .map((node) => ({
        id: String(node.id),
        label: String(node.label),
        type: typeof node.type === "string" ? node.type : null,
        properties: asRecord(node.properties),
      })),
    edges: edges
      .map((edge) => edge as Record<string, unknown>)
      .filter((edge) => edge.source && edge.target && edge.label)
      .map((edge) => ({
        id: edge.id ? String(edge.id) : null,
        source: String(edge.source),
        target: String(edge.target),
        label: String(edge.label),
        type: typeof edge.type === "string" ? edge.type : null,
        properties: asRecord(edge.properties),
      })),
  };
}

function extractDatasetId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["dataset_id", "datasetId", "id"]) {
      if (typeof record[key] === "string" && looksLikeUuid(record[key])) {
        return record[key];
      }
    }
    for (const nested of Object.values(record)) {
      const found = visit(nested);
      if (found) return found;
    }
    return null;
  };
  return visit(payload);
}

function isUnsupportedRememberError(err: unknown): boolean {
  const message = (err as Error)?.message ?? "";
  return /\b(404|405|501)\b/.test(message);
}

function looksLikeUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function summarizePayload(payload: unknown): string {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return text.slice(0, 500);
}
