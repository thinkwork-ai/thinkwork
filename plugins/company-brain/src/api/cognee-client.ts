export interface KnowledgeGraphOntologyExport {
  mechanism: "cognee_owl_ontology" | "custom_prompt";
  entityTypes: unknown[];
  relationshipTypes: unknown[];
  customPrompt: string;
  ontologyKey: string | null;
  ontologyOwlXml: string | null;
}

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
  pipelineRunId: string | null;
  raw: unknown;
}

export type CogneeDatasetStatus =
  | "completed"
  | "errored"
  | "running"
  | "unknown";

export interface CogneeDatasetStatusSnapshot {
  status: CogneeDatasetStatus;
  rawStatus: string | null;
  raw: unknown;
}

export interface CogneeDatasetWaitResult {
  status: CogneeDatasetStatus;
  rawStatus: string | null;
  attempts: number;
  elapsedMs: number;
  samples: CogneeDatasetStatusSnapshot[];
}

export type CogneeDocumentSourceKind =
  | "thread"
  | "wiki"
  | "brain"
  | "observations"
  | "user_memory"
  | "space_memory";

export interface CogneeDocumentIngestArgs {
  tenantId: string;
  sourceKind: CogneeDocumentSourceKind;
  sourceRef: string;
  datasetName: string;
  document: string;
  filename: string;
  ontology: KnowledgeGraphOntologyExport;
  customPrompt?: string | null;
}

export interface CogneeSearchArgs {
  query: string;
  searchType?: string;
  datasets?: string[];
  datasetIds?: string[];
  nodeNames?: string[];
  nodeNameFilterOperator?: "AND" | "OR";
  topK?: number;
  includeReferences?: boolean;
  systemPrompt?: string | null;
}

export class CogneeClientError extends Error {
  /** HTTP status when the error originated from a non-2xx Cognee response. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CogneeClientError";
    this.status = status;
  }
}

export class CogneeClient {
  private readonly endpoint: string;
  private readonly token: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly mode: "remember" | "add_cognify";
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly indexPollMs: number;
  private readonly indexTimeoutMs: number;

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
    this.indexPollMs = readPositiveIntEnv("COGNEE_INDEX_POLL_MS", 5_000);
    this.indexTimeoutMs = readPositiveIntEnv(
      "COGNEE_INDEX_TIMEOUT_MS",
      240_000,
    );
  }

  async ingestThread(args: {
    tenantId: string;
    threadId: string;
    datasetName: string;
    transcript: string;
    ontology: KnowledgeGraphOntologyExport;
  }): Promise<CogneeIngestResult> {
    return this.ingestDocument({
      tenantId: args.tenantId,
      sourceKind: "thread",
      sourceRef: args.threadId,
      datasetName: args.datasetName,
      document: args.transcript,
      filename: "thinkwork-thread.md",
      ontology: args.ontology,
    });
  }

  async ingestDocument(
    args: CogneeDocumentIngestArgs,
  ): Promise<CogneeIngestResult> {
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

  async search(args: CogneeSearchArgs): Promise<unknown> {
    return this.requestJson(
      "/api/v1/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          search_type: args.searchType ?? "GRAPH_COMPLETION",
          ...(args.datasets?.length ? { datasets: args.datasets } : {}),
          ...(args.datasetIds?.length ? { dataset_ids: args.datasetIds } : {}),
          ...(args.nodeNames?.length ? { node_name: args.nodeNames } : {}),
          ...(args.nodeNameFilterOperator
            ? { node_name_filter_operator: args.nodeNameFilterOperator }
            : {}),
          ...(args.topK ? { top_k: args.topK } : {}),
          ...(args.includeReferences !== undefined
            ? { include_references: args.includeReferences }
            : {}),
          ...(args.systemPrompt ? { system_prompt: args.systemPrompt } : {}),
        }),
      },
      { retryTransient: true },
    );
  }

  /** List datasets currently known to Cognee (id + name pairs). */
  async listDatasets(): Promise<Array<{ id: string; name: string }>> {
    const payload = await this.requestJson(
      "/api/v1/datasets",
      { method: "GET" },
      { retryTransient: true },
    );
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as Record<string, unknown>)?.datasets)
        ? ((payload as Record<string, unknown>).datasets as unknown[])
        : [];
    return rows
      .map((row) => row as Record<string, unknown>)
      .filter(
        (row) =>
          row && (row.id ?? row.dataset_id) && (row.name ?? row.dataset_name),
      )
      .map((row) => ({
        id: String(row.id ?? row.dataset_id),
        name: String(row.name ?? row.dataset_name),
      }));
  }

  /**
   * Delete every Cognee dataset whose name matches `datasetName`, so a
   * fullRebuild starts from an empty graph for that source instead of
   * appending to the accumulated one. Idempotent — a missing dataset is a
   * no-op. Returns the number of datasets deleted.
   */
  async deleteDatasetByName(datasetName: string): Promise<number> {
    let datasets: Array<{ id: string; name: string }>;
    try {
      datasets = await this.listDatasets();
    } catch {
      return 0;
    }
    const matches = datasets.filter((d) => d.name === datasetName);
    let deleted = 0;
    for (const match of matches) {
      await this.requestJson(
        `/api/v1/datasets/${encodeURIComponent(match.id)}`,
        { method: "DELETE" },
        { retryTransient: true },
      );
      deleted += 1;
    }
    return deleted;
  }

  /**
   * Nuclear clear of the entire Cognee store (all datasets + system graph).
   * Only safe in single-tenant/dev contexts — callers gate this behind an
   * explicit flag. Returns true on success.
   */
  async pruneAll(): Promise<boolean> {
    await this.requestJson(
      "/api/v1/prune",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
      { retryTransient: true },
    );
    return true;
  }

  async waitForDatasetIndexing(
    datasetId: string,
  ): Promise<CogneeDatasetWaitResult> {
    const started = Date.now();
    const samples: CogneeDatasetStatusSnapshot[] = [];
    let attempts = 0;
    let transientStatusErrors = 0;

    for (;;) {
      attempts += 1;
      // The single dogfood Cognee task makes the /datasets/status endpoint
      // briefly unavailable (502/503/504) while it writes the graph — but the
      // cognify pipeline still completes. Treat a transient status error as
      // "not ready yet, keep polling" within the index-timeout budget rather
      // than failing the whole run on a flaky window.
      let snapshot: CogneeDatasetStatusSnapshot;
      try {
        snapshot = await this.fetchDatasetStatus(datasetId);
      } catch (err) {
        const transient =
          err instanceof CogneeClientError &&
          (err.status === undefined || isTransientStatus(err.status));
        if (!transient || Date.now() - started >= this.indexTimeoutMs) {
          // Budget exhausted (or a non-transient error): before giving up,
          // probe the graph directly — if cognify finished during a status
          // outage, the graph has nodes and the run should proceed.
          const probed = await this.probeGraphComplete(datasetId);
          if (probed) {
            return {
              status: "completed",
              rawStatus: "completed_via_graph_probe",
              attempts,
              elapsedMs: Date.now() - started,
              samples: compactStatusSamples(samples),
            };
          }
          throw err;
        }
        transientStatusErrors += 1;
        await sleep(this.indexPollMs);
        continue;
      }
      samples.push(snapshot);

      if (snapshot.status === "completed") {
        return {
          status: "completed",
          rawStatus: snapshot.rawStatus,
          attempts,
          elapsedMs: Date.now() - started,
          samples: compactStatusSamples(samples),
        };
      }
      if (snapshot.status === "errored") {
        throw new CogneeClientError(
          `Cognee dataset ${datasetId} indexing failed with status ${snapshot.rawStatus ?? "errored"}`,
        );
      }
      if (Date.now() - started >= this.indexTimeoutMs) {
        // Timed out waiting for "completed" — but a flaky status endpoint can
        // report STARTED long after the pipeline actually finished. Probe the
        // graph before failing.
        const probed = await this.probeGraphComplete(datasetId);
        if (probed) {
          return {
            status: "completed",
            rawStatus: "completed_via_graph_probe",
            attempts,
            elapsedMs: Date.now() - started,
            samples: compactStatusSamples(samples),
          };
        }
        throw new CogneeClientError(
          `Cognee dataset ${datasetId} indexing did not complete within ${this.indexTimeoutMs}ms; latest status ${snapshot.rawStatus ?? "unknown"} (transient status errors: ${transientStatusErrors})`,
        );
      }

      await sleep(this.indexPollMs);
    }
  }

  /**
   * Best-effort check that a dataset's graph is populated, used as a fallback
   * when the status endpoint is flaky but the cognify pipeline may have
   * finished. Returns true only when the graph fetch succeeds with >=1 node.
   */
  private async probeGraphComplete(datasetId: string): Promise<boolean> {
    try {
      const graph = await this.fetchDatasetGraph(datasetId);
      return graph.nodes.length > 0;
    } catch {
      return false;
    }
  }

  async fetchDatasetStatus(
    datasetId: string,
  ): Promise<CogneeDatasetStatusSnapshot> {
    const payload = await this.requestJson(
      `/api/v1/datasets/status?dataset=${encodeURIComponent(datasetId)}`,
      { method: "GET" },
      { retryTransient: true },
    );
    return parseDatasetStatus(payload, datasetId);
  }

  private async remember(args: {
    tenantId: string;
    sourceKind: CogneeDocumentSourceKind;
    sourceRef: string;
    datasetName: string;
    document: string;
    filename: string;
    ontology: KnowledgeGraphOntologyExport;
    customPrompt?: string | null;
  }): Promise<CogneeIngestResult> {
    const body = buildDocumentForm(args, { runInBackground: true });
    const raw = await this.requestJson("/api/v1/remember", {
      method: "POST",
      body,
    });
    return {
      datasetId: extractDatasetId(raw),
      datasetName: args.datasetName,
      mode: "remember",
      pipelineRunId: extractPipelineRunId(raw),
      raw,
    };
  }

  private async addAndCognify(args: {
    tenantId: string;
    sourceKind: CogneeDocumentSourceKind;
    sourceRef: string;
    datasetName: string;
    document: string;
    filename: string;
    ontology: KnowledgeGraphOntologyExport;
    customPrompt?: string | null;
  }): Promise<CogneeIngestResult> {
    const addRaw = await this.requestJson("/api/v1/add", {
      method: "POST",
      body: buildDocumentForm(args, { runInBackground: false }),
    });
    const cognifyRaw = await this.requestJson("/api/v1/cognify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        datasets: [args.datasetName],
        run_in_background: true,
        custom_prompt: buildCustomPrompt(args),
        ...(args.ontology.ontologyKey
          ? { ontology_key: [args.ontology.ontologyKey] }
          : {}),
      }),
    });
    return {
      datasetId: extractDatasetId(cognifyRaw) ?? extractDatasetId(addRaw),
      datasetName: args.datasetName,
      mode: "add_cognify",
      pipelineRunId: extractPipelineRunId(cognifyRaw),
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
          response.status,
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

function buildDocumentForm(
  args: {
    tenantId: string;
    sourceKind: CogneeDocumentSourceKind;
    sourceRef: string;
    datasetName: string;
    document: string;
    filename: string;
    ontology: KnowledgeGraphOntologyExport;
    customPrompt?: string | null;
  },
  opts: { runInBackground: boolean },
): FormData {
  const form = new FormData();
  form.append(
    "data",
    new Blob([args.document], { type: "text/markdown" }),
    args.filename,
  );
  form.append("datasetName", args.datasetName);
  form.append("run_in_background", opts.runInBackground ? "true" : "false");
  for (const nodeSet of buildNodeSets(
    args.tenantId,
    args.sourceKind,
    args.sourceRef,
  )) {
    form.append("node_set", nodeSet);
  }
  if (args.ontology.ontologyKey) {
    form.append("ontology_key", args.ontology.ontologyKey);
  }
  form.append("custom_prompt", buildCustomPrompt(args));
  return form;
}

function buildNodeSets(
  tenantId: string,
  sourceKind: CogneeDocumentSourceKind,
  sourceRef: string,
): string[] {
  if (sourceKind === "user_memory" || sourceKind === "space_memory") {
    const scopeKind = sourceKind === "user_memory" ? "user" : "space";
    return [
      "thinkwork_memory",
      "thinkwork_memory_v1",
      `thinkwork_${scopeKind}_memory`,
      `tenant_${scopeToken(tenantId)}`,
      `${scopeKind}_${scopeToken(sourceRef)}`,
    ];
  }

  return [
    `thinkwork_${sourceKind}`,
    `tenant_${scopeToken(tenantId)}`,
    `${sourceKind}_${scopeToken(sourceRef)}`,
  ];
}

function buildCustomPrompt(args: {
  sourceKind: CogneeDocumentSourceKind;
  ontology: KnowledgeGraphOntologyExport;
  customPrompt?: string | null;
}): string {
  const sourcePrompt =
    args.sourceKind === "thread"
      ? ""
      : [
          "",
          "Source packet instructions:",
          "- Prefer declared entity titles and ontology_type_slug fields over invented generic labels.",
          "- Preserve source_packet, citation, page, and section identifiers in properties.",
          "- Treat relationship_hint lines as candidate relationships only when the label matches the approved ontology.",
        ].join("\n");
  return [args.ontology.customPrompt, args.customPrompt, sourcePrompt]
    .filter(Boolean)
    .join("\n\n");
}

function scopeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function extractPipelineRunId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["pipeline_run_id", "pipelineRunId", "run_id", "runId"]) {
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

function parseDatasetStatus(
  payload: unknown,
  datasetId: string,
): CogneeDatasetStatusSnapshot {
  const rawStatus =
    findDatasetStatusString(payload, datasetId) ?? findStatusString(payload);
  return {
    status: normalizeDatasetStatus(rawStatus),
    rawStatus,
    raw: payload,
  };
}

function findDatasetStatusString(
  payload: unknown,
  datasetId: string,
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const datasetValue = record[datasetId];
  if (typeof datasetValue === "string") return datasetValue;
  if (datasetValue && typeof datasetValue === "object") {
    return findStatusString(datasetValue);
  }
  return null;
}

function findStatusString(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["status", "pipeline_status", "run_status"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key];
      }
    }
    for (const nested of Object.values(record)) {
      if (typeof nested === "string" && /PROCESSING|PIPELINE/i.test(nested)) {
        return nested;
      }
      const found = visit(nested);
      if (found) return found;
    }
    return null;
  };
  return typeof payload === "string" ? payload : visit(payload);
}

function normalizeDatasetStatus(status: string | null): CogneeDatasetStatus {
  if (!status) return "unknown";
  const normalized = status.toUpperCase();
  if (/COMPLETED|ALREADY_COMPLETED|SUCCESS|SUCCEEDED/.test(normalized)) {
    return "completed";
  }
  if (/ERRORED|ERROR|FAILED|FAILURE/.test(normalized)) return "errored";
  if (/INITIATED|STARTED|RUNNING|PROCESSING|QUEUED|YIELD/.test(normalized)) {
    return "running";
  }
  return "unknown";
}

function compactStatusSamples(
  samples: CogneeDatasetStatusSnapshot[],
): CogneeDatasetStatusSnapshot[] {
  const compacted: CogneeDatasetStatusSnapshot[] = [];
  for (const sample of samples) {
    const previous = compacted[compacted.length - 1];
    if (
      previous?.status === sample.status &&
      previous.rawStatus === sample.rawStatus
    ) {
      continue;
    }
    compacted.push(sample);
  }
  return compacted.slice(-8);
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
