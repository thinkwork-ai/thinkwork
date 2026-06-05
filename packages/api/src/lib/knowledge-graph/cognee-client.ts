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
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    opts: {
      endpoint?: string | null;
      token?: string | null;
      fetchFn?: typeof fetch;
      mode?: "remember" | "add_cognify" | null;
      retryAttempts?: number;
      retryDelayMs?: number;
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
    this.retryAttempts =
      opts.retryAttempts ?? readPositiveIntEnv("COGNEE_HTTP_RETRY_ATTEMPTS", 3);
    this.retryDelayMs =
      opts.retryDelayMs ??
      readPositiveIntEnv("COGNEE_HTTP_RETRY_DELAY_MS", 250);
  }

  async ingestThread(args: {
    tenantId: string;
    threadId: string;
    datasetName: string;
    transcript: string;
    ontology: KnowledgeGraphOntologyExport;
  }): Promise<CogneeIngestResult> {
    await this.ensureOntology(args.ontology);
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
      { retryTransient: true },
    );
    return parseGraphPayload(payload);
  }

  private async remember(args: {
    tenantId: string;
    threadId: string;
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
    tenantId: string;
    threadId: string;
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
        run_in_background: false,
        custom_prompt: args.ontology.customPrompt,
        ...(args.ontology.ontologyKey
          ? { ontology_key: [args.ontology.ontologyKey] }
          : {}),
      }),
    });
    return {
      datasetId: extractDatasetId(cognifyRaw) ?? extractDatasetId(addRaw),
      datasetName: args.datasetName,
      mode: "add_cognify",
      raw: { add: addRaw, cognify: cognifyRaw },
    };
  }

  private async ensureOntology(
    ontology: KnowledgeGraphOntologyExport,
  ): Promise<void> {
    if (!ontology.ontologyKey || !ontology.ontologyOwlXml) return;
    const existing = await this.requestJson(
      "/api/v1/ontologies",
      {
        method: "GET",
      },
      { retryTransient: true },
    );
    if (hasOntologyKey(existing, ontology.ontologyKey)) return;

    const form = new FormData();
    form.append("ontology_key", ontology.ontologyKey);
    form.append(
      "ontology_file",
      new Blob([ontology.ontologyOwlXml], { type: "application/xml" }),
      `${ontology.ontologyKey}.owl`,
    );
    form.append(
      "description",
      "ThinkWork approved ontology export for thread graph extraction",
    );

    try {
      await this.requestJson("/api/v1/ontologies", {
        method: "POST",
        body: form,
      });
    } catch (err) {
      if (isDuplicateOntologyError(err, ontology.ontologyKey)) return;
      throw err;
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    opts: { retryTransient?: boolean } = {},
  ): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      try {
        const response = await this.fetchFn(`${this.endpoint}${path}`, {
          ...init,
          headers: {
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...(init.headers ?? {}),
          },
        });
        const text = await response.text();
        const payload = text ? safeJson(text) : {};
        if (response.ok) return payload;
        const error = new CogneeClientError(
          `Cognee ${path} failed with ${response.status}: ${summarizePayload(payload)}`,
        );
        if (
          !opts.retryTransient ||
          !isTransientStatus(response.status) ||
          attempt >= this.retryAttempts - 1
        ) {
          throw error;
        }
      } catch (err) {
        if (
          !opts.retryTransient ||
          err instanceof CogneeClientError ||
          attempt >= this.retryAttempts - 1
        ) {
          throw err;
        }
      }
      attempt += 1;
      await sleep(this.retryDelayMs * attempt);
    }
  }
}

function buildTranscriptForm(args: {
  tenantId: string;
  threadId: string;
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
  for (const nodeSet of buildThreadNodeSets(args.tenantId, args.threadId)) {
    form.append("node_set", nodeSet);
  }
  if (args.ontology.ontologyKey) {
    form.append("ontology_key", args.ontology.ontologyKey);
  }
  form.append("custom_prompt", args.ontology.customPrompt);
  return form;
}

function buildThreadNodeSets(tenantId: string, threadId: string): string[] {
  return [
    "thinkwork_threads",
    `tenant_${tenantId.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`,
    `thread_${threadId.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`,
  ];
}

function parseGraphPayload(payload: unknown): CogneeGraphPayload {
  const record = payload as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];
  return {
    nodes: nodes
      .map((node) => node as Record<string, unknown>)
      .filter((node) => node.id && node.label)
      .map((node) => {
        const {
          id: _id,
          label: _label,
          type: _type,
          properties,
          ...rest
        } = node;
        return {
          id: String(node.id),
          label: String(node.label),
          type: typeof node.type === "string" ? node.type : null,
          properties: mergeProperties(rest, properties),
        };
      }),
    edges: edges
      .map((edge) => edge as Record<string, unknown>)
      .filter((edge) => edge.source && edge.target && coerceEdgeLabel(edge))
      .map((edge) => {
        const {
          id: _id,
          source: _source,
          target: _target,
          label: _label,
          type: _type,
          properties,
          ...rest
        } = edge;
        const edgeLabel = coerceEdgeLabel(edge)!;
        return {
          id: edge.id ? String(edge.id) : null,
          source: String(edge.source),
          target: String(edge.target),
          label: edgeLabel,
          type:
            typeof edge.type === "string"
              ? edge.type
              : typeof edge.relationship_type === "string"
                ? edge.relationship_type
                : null,
          properties: mergeProperties(rest, properties),
        };
      }),
  };
}

function coerceEdgeLabel(edge: Record<string, unknown>): string | null {
  for (const key of ["label", "relationship_type", "type"]) {
    if (typeof edge[key] === "string" && edge[key].trim()) {
      return edge[key];
    }
  }
  return null;
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

function isDuplicateOntologyError(err: unknown, ontologyKey: string): boolean {
  const message = (err as Error)?.message ?? "";
  return (
    /\b400\b/.test(message) &&
    message.includes("already exists") &&
    message.includes(ontologyKey)
  );
}

function hasOntologyKey(payload: unknown, ontologyKey: string): boolean {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(payload, ontologyKey),
  );
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

function mergeProperties(
  topLevel: Record<string, unknown>,
  properties: unknown,
): Record<string, unknown> {
  return { ...topLevel, ...asRecord(properties) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function summarizePayload(payload: unknown): string {
  const rawText =
    typeof payload === "string"
      ? payload
      : payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).text === "string"
        ? String((payload as Record<string, unknown>).text)
        : null;
  if (rawText) {
    const htmlSummary = summarizeHtml(rawText);
    return (htmlSummary ?? rawText).slice(0, 500);
  }
  return JSON.stringify(payload ?? {}).slice(0, 500);
}

function summarizeHtml(text: string): string | null {
  if (!/<html[\s>]/i.test(text) && !/<body[\s>]/i.test(text)) return null;
  const title =
    text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] ??
    text.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] ??
    null;
  return title ? stripHtml(title).trim() : "HTML error response";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function isTransientStatus(status: number): boolean {
  return [502, 503, 504].includes(status);
}

function sleep(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
