import type {
  MemoryBasedOnEvidence,
  MemoryEvidence,
  MemoryEvidenceSourceFact,
  MemoryItem,
  MemoryProvider,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryReflectRequest,
  MemoryReflectResult,
} from "@thinkwork/pi-runtime-core";
import {
  ExecuteStatementCommand,
  RDSDataClient,
  type ExecuteStatementCommandOutput,
  type Field,
} from "@aws-sdk/client-rds-data";

/**
 * Plan §004 U5 — Hindsight-backed {@link MemoryProvider}.
 *
 * The host (cloud or, later, desktop) constructs this per invocation with
 * identity snapshotted at loop entry, then hands it to the memory extension
 * through the provider bundle. The extension calls `recall`/`reflect`; only
 * THIS class knows Hindsight's HTTP shape, so the extension stays host-agnostic
 * (plan R3).
 *
 * Async semantics (feedback_hindsight_async_tools): each call issues a fresh
 * `fetch`; no shared connection pool, no module-level state. Bounded retry on
 * 5xx + transport errors at [1s, 3s, 9s] (±0.5s jitter); 4xx is terminal. Each
 * attempt carries a fresh per-attempt timeout so the deadline is per attempt,
 * not across the chain.
 *
 * Read-synthesis chain (feedback_hindsight_recall_reflect_pair): `recall`
 * returns raw memory units; `reflect` synthesizes them into a coherent answer.
 * Persisting what a turn learned is a separate host concern (end-of-turn
 * retain), not modeled here.
 *
 * This wraps the same Hindsight endpoints the legacy `src/tools/hindsight.ts`
 * AgentTools use; that module is retired from the live wiring in U5 and deleted
 * in U10. The provider is the new home for this capability.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;
const RETRY_JITTER_MS = 500;
const RECALL_MAX_TOKENS = 1_500;

export interface HindsightMemoryProviderOptions {
  /** Hindsight HTTP endpoint (e.g. https://hindsight.dev.thinkwork.ai). */
  endpoint: string;
  /** Tenant id from the invocation scope. Required. */
  tenantId: string;
  /** User id from the invocation scope (keys the memory bank). Required. */
  userId: string;
  /** Current Space id, when the invocation is scoped to a Space. */
  spaceId?: string | null;
  /** Per-attempt request timeout in ms (default 30_000). */
  timeoutMs?: number;
  /** Aurora DB cluster ARN for direct Hindsight high-confidence fact lookup. */
  dbClusterArn?: string;
  /** Aurora DB secret ARN for direct Hindsight high-confidence fact lookup. */
  dbSecretArn?: string;
  /** Aurora database name for direct Hindsight high-confidence fact lookup. */
  dbName?: string;
  /** Test seam: override the RDS Data API client. */
  rdsDataClient?: Pick<RDSDataClient, "send">;
  /** Test seam: override the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

export class HindsightMemoryProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HindsightMemoryProviderError";
  }
}

function userBankFor(userId: string): string {
  return `user_${userId}`;
}

function spaceBankFor(spaceId: string): string {
  return `space_${spaceId}`;
}

function jitter(): number {
  return (Math.random() * 2 - 1) * RETRY_JITTER_MS;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull a text field out of a raw Hindsight memory unit, tolerating shapes. */
function unitText(unit: unknown): string {
  if (typeof unit === "string") return unit.trim();
  if (!unit || typeof unit !== "object") return "";
  const record = unit as Record<string, unknown>;
  for (const key of ["text", "content", "summary", "value"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

type HindsightBankTarget = {
  bankId: string;
  sourceScope: "user" | "space";
};

/** Normalize a raw Hindsight recall response into structured memory items. */
function toMemoryItems(
  data: unknown,
  target: HindsightBankTarget,
): MemoryItem[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const raw = record.memory_units ?? record.memories ?? record.results ?? [];
  if (!Array.isArray(raw)) return [];
  const sourceFacts = parseSourceFacts(record.source_facts);
  return raw
    .map((unit, index): MemoryItem | null => {
      const text = unitText(unit);
      if (!text) return null;
      const u = (unit && typeof unit === "object" ? unit : {}) as Record<
        string,
        unknown
      >;
      const id =
        typeof u.id === "string"
          ? u.id
          : typeof u.memory_unit_id === "string"
            ? u.memory_unit_id
            : `unit-${index}`;
      const score = typeof u.score === "number" ? u.score : undefined;
      // Observation signals, verified empirically against deployed Hindsight
      // 0.5.0 (wire-format rule): recall responses carry the fact type as
      // `type` (not `fact_type`) and the proof set as `source_fact_ids`; no
      // freshness field is exposed yet (kept defensively for image bumps).
      const meta = (
        u.metadata && typeof u.metadata === "object" ? u.metadata : {}
      ) as Record<string, unknown>;
      const factType = [u.fact_type, u.type, meta.fact_type].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      const freshness = [u.freshness, u.trend, meta.freshness, meta.trend].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      const proofCount =
        [u.proof_count, u.evidence_count, meta.proof_count].find(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        ) ??
        (Array.isArray(u.source_fact_ids) && u.source_fact_ids.length > 0
          ? u.source_fact_ids.length
          : undefined);
      const sourceFactIds = stringArray(u.source_fact_ids);
      const evidence = sourceEvidence(sourceFactIds, sourceFacts);
      return {
        id,
        content: text,
        sourceScope: target.sourceScope,
        ...(score !== undefined ? { score } : {}),
        ...(factType !== undefined ? { factType } : {}),
        ...(freshness !== undefined ? { freshness } : {}),
        ...(proofCount !== undefined ? { proofCount } : {}),
        ...(evidence ? { evidence } : {}),
      };
    })
    .filter((item): item is MemoryItem => item !== null);
}

function toListedMemoryItems(
  data: unknown,
  target: HindsightBankTarget,
): MemoryItem[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>).items ?? [];
  if (!Array.isArray(raw)) return [];
  return toMemoryItems({ memory_units: raw }, target);
}

function mergeMemoryItems(...groups: MemoryItem[][]): MemoryItem[] {
  const seen = new Set<string>();
  const out: MemoryItem[] = [];
  for (const item of groups.flat()) {
    const key = item.id || `${item.sourceScope ?? "unknown"}:${item.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function fieldString(field: Field | undefined): string | undefined {
  if (!field || field.isNull) return undefined;
  if (typeof field.stringValue === "string") return field.stringValue;
  if (typeof field.longValue === "number") return String(field.longValue);
  if (typeof field.doubleValue === "number") return String(field.doubleValue);
  if (typeof field.booleanValue === "boolean")
    return String(field.booleanValue);
  return undefined;
}

/**
 * Map RDS Data API rows to memory items.
 * Column order must match the SELECT in {@link listHighConfidenceMemoryItems}:
 * 0: id, 1: bank_id, 2: document_id, 3: context, 4: fact_type, 5: text
 */
function highConfidenceRowsToMemoryItems(
  output: ExecuteStatementCommandOutput,
  target: HindsightBankTarget,
): MemoryItem[] {
  return (output.records ?? [])
    .map((row, index): MemoryItem | null => {
      const id = fieldString(row[0]) ?? `high-confidence-${index}`;
      const text = fieldString(row[5]);
      if (!text?.trim()) return null;
      const factType = fieldString(row[4]);
      return {
        id,
        content: text.trim(),
        sourceScope: target.sourceScope,
        score: 20_000 - index,
        ...(factType ? { factType } : {}),
        evidence: {
          sourceFacts: [
            {
              id,
              ...(fieldString(row[3]) ? { context: fieldString(row[3]) } : {}),
              ...(fieldString(row[2])
                ? { documentId: fieldString(row[2]) }
                : {}),
              ...(factType ? { type: factType } : {}),
            },
          ],
        },
      };
    })
    .filter((item): item is MemoryItem => item !== null);
}

function stripQuestionPreamble(query: string): string {
  return query
    .replace(
      /^\s*what\s+(?:do|does|did)\s+(?:you|this\s+space|the\s+space|we)\s+(?:remember|recall|know)\s+(?:about\s+)?/i,
      "",
    )
    .replace(/^\s*(?:what\s+is|what's|who\s+is|where\s+is|when\s+is)\s+/i, "")
    .replace(/^\s*tell\s+me(?:\s+again)?\s+(?:about\s+)?/i, "")
    .trim();
}

function listSearchQueries(query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, " ");
  const withoutAnswerDirective = trimmed
    .replace(/\s*[?!.]?\s*(?:answer|reply|respond)\b[\s\S]*$/i, "")
    .trim();
  const withoutPreamble = stripQuestionPreamble(withoutAnswerDirective);
  const withoutLeadingScope = withoutPreamble
    .replace(
      /^(?:my|mine|our|ours|the\s+shared|shared|this\s+space(?:'s)?|the)\s+/i,
      "",
    )
    .trim();

  return [
    trimmed,
    withoutAnswerDirective,
    withoutPreamble,
    withoutLeadingScope,
  ].filter((candidate, index, candidates) => {
    if (candidate.length < 2) return false;
    return candidates.findIndex((value) => value === candidate) === index;
  });
}

/** Extract the synthesized answer from a raw Hindsight reflect response. */
function toReflectText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["text", "response", "summary", "answer"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function parseSourceFacts(
  value: unknown,
): Map<string, MemoryEvidenceSourceFact> {
  const facts = new Map<string, MemoryEvidenceSourceFact>();
  const entries = Array.isArray(value)
    ? value.map((fact) => {
        const id =
          fact && typeof fact === "object"
            ? (fact as Record<string, unknown>).id
            : undefined;
        return [id, fact] as const;
      })
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
      : [];
  for (const [key, raw] of entries) {
    const fact = redactedSourceFact(raw, typeof key === "string" ? key : null);
    if (fact) facts.set(fact.id, fact);
  }
  return facts;
}

function redactedSourceFact(
  raw: unknown,
  fallbackId: string | null,
): MemoryEvidenceSourceFact | null {
  if (!raw || typeof raw !== "object") {
    return fallbackId ? { id: fallbackId } : null;
  }
  const record = raw as Record<string, unknown>;
  const id = stringField(record.id) ?? fallbackId;
  if (!id) return null;
  return {
    id,
    ...(stringField(record.type) ? { type: stringField(record.type) } : {}),
    ...(stringField(record.fact_type)
      ? { type: stringField(record.fact_type) }
      : {}),
    ...(stringField(record.context)
      ? { context: stringField(record.context) }
      : {}),
    ...(stringField(record.document_id)
      ? { documentId: stringField(record.document_id) }
      : {}),
    ...(stringField(record.documentId)
      ? { documentId: stringField(record.documentId) }
      : {}),
    ...(stringField(record.chunk_id)
      ? { chunkId: stringField(record.chunk_id) }
      : {}),
    ...(stringField(record.chunkId)
      ? { chunkId: stringField(record.chunkId) }
      : {}),
    ...(stringArray(record.tags).length > 0
      ? { tags: stringArray(record.tags) }
      : {}),
    ...(redactedMetadata(record.metadata)
      ? { metadata: redactedMetadata(record.metadata) }
      : {}),
  };
}

function sourceEvidence(
  sourceFactIds: string[],
  sourceFacts: Map<string, MemoryEvidenceSourceFact>,
): MemoryEvidence | null {
  if (sourceFactIds.length === 0 && sourceFacts.size === 0) return null;
  const matchingFacts = sourceFactIds
    .map((id) => sourceFacts.get(id))
    .filter((fact): fact is MemoryEvidenceSourceFact => Boolean(fact));
  return {
    ...(sourceFactIds.length > 0 ? { sourceFactIds } : {}),
    ...(matchingFacts.length > 0 ? { sourceFacts: matchingFacts } : {}),
  };
}

function basedOnEvidence(data: unknown): MemoryEvidence | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const basedOn = record.based_on ?? record.basedOn;
  if (!basedOn || typeof basedOn !== "object") return undefined;
  const b = basedOn as Record<string, unknown>;
  const evidence: MemoryBasedOnEvidence = {
    memoryIds: stringArray(b.memory_ids ?? b.memoryIds),
    mentalModelIds: stringArray(b.mental_model_ids ?? b.mentalModelIds),
    directiveIds: stringArray(b.directive_ids ?? b.directiveIds),
  };
  const memories = sourceFactArray(b.memories);
  const mentalModels = sourceFactArray(b.mental_models ?? b.mentalModels);
  const directives = sourceFactArray(b.directives);
  if (memories.length > 0) evidence.memories = memories;
  if (mentalModels.length > 0) evidence.mentalModels = mentalModels;
  if (directives.length > 0) evidence.directives = directives;
  if (
    evidence.memoryIds.length === 0 &&
    evidence.mentalModelIds.length === 0 &&
    evidence.directiveIds.length === 0 &&
    !evidence.memories &&
    !evidence.mentalModels &&
    !evidence.directives
  ) {
    return undefined;
  }
  return { basedOn: evidence };
}

function sourceFactArray(value: unknown): MemoryEvidenceSourceFact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => redactedSourceFact(item, null))
    .filter((item): item is MemoryEvidenceSourceFact => Boolean(item));
}

function redactedMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("text") ||
      normalized.includes("content") ||
      normalized.includes("chunk") ||
      normalized.includes("body")
    ) {
      continue;
    }
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean" ||
      raw === null
    ) {
      safe[key] = raw;
    } else if (
      Array.isArray(raw) &&
      raw.every((item) => typeof item === "string")
    ) {
      safe[key] = raw;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergeEvidence(items: MemoryEvidence[]): MemoryEvidence | undefined {
  const basedOnItems = items
    .map((item) => item.basedOn)
    .filter((item): item is MemoryBasedOnEvidence => Boolean(item));
  if (basedOnItems.length === 0) return undefined;
  const basedOn: MemoryBasedOnEvidence = {
    memoryIds: dedupe(basedOnItems.flatMap((item) => item.memoryIds)),
    mentalModelIds: dedupe(basedOnItems.flatMap((item) => item.mentalModelIds)),
    directiveIds: dedupe(basedOnItems.flatMap((item) => item.directiveIds)),
  };
  const memories = dedupeFacts(
    basedOnItems.flatMap((item) => item.memories ?? []),
  );
  const mentalModels = dedupeFacts(
    basedOnItems.flatMap((item) => item.mentalModels ?? []),
  );
  const directives = dedupeFacts(
    basedOnItems.flatMap((item) => item.directives ?? []),
  );
  if (memories.length > 0) basedOn.memories = memories;
  if (mentalModels.length > 0) basedOn.mentalModels = mentalModels;
  if (directives.length > 0) basedOn.directives = directives;
  return { basedOn };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeFacts(
  facts: MemoryEvidenceSourceFact[],
): MemoryEvidenceSourceFact[] {
  const seen = new Set<string>();
  const out: MemoryEvidenceSourceFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
  }
  return out;
}

function mergeUnknownValues(values: unknown[]): unknown {
  const present = values.filter(
    (value) => value !== undefined && value !== null,
  );
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : present;
}

function recallRequestBody(query: string, request: MemoryRecallRequest) {
  const queryTimestamp = request.queryTimestamp?.trim();
  return {
    query,
    budget: "low",
    max_tokens: RECALL_MAX_TOKENS,
    include: { entities: null, source_facts: {} },
    types: ["world", "experience", "observation"],
    ...(queryTimestamp ? { query_timestamp: queryTimestamp } : {}),
  };
}

function reflectQueryWithContext(request: MemoryReflectRequest): string {
  const query = request.query.trim();
  const context = request.context?.trim();
  if (!context) return query;
  return `${query}\n\nCurrent turn context:\n${context}`;
}

/**
 * POST JSON to Hindsight with bounded retry. Returns parsed JSON on 2xx;
 * throws {@link HindsightMemoryProviderError} on terminal failure (any 4xx,
 * exhausted 5xx retries, or transport errors after retries).
 */
async function postJson(
  options: HindsightMemoryProviderOptions,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.endpoint.replace(/\/$/, "")}${path}`;
  const delays = [0, ...RETRY_DELAYS_MS];

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    // A caller-initiated abort (turn cancel / grounding deadline) is terminal —
    // never sleep or retry past it.
    if (signal?.aborted) {
      throw new HindsightMemoryProviderError(
        "Hindsight call aborted by caller.",
      );
    }
    if (delays[attempt]! > 0) {
      await sleep(Math.max(0, delays[attempt]! + jitter()));
    }

    let response: Response;
    try {
      // Compose the caller's signal with a per-attempt timeout so the caller's
      // cancellation still wins, but a hung attempt also aborts after timeoutMs
      // (deadline is per attempt, not across the retry chain).
      const attemptSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: attemptSignal,
      });
    } catch (err) {
      // Caller-initiated abort is terminal — detect via the caller's signal
      // directly (AbortSignal.any propagates the abort without attribution).
      if (signal?.aborted) {
        throw new HindsightMemoryProviderError(
          "Hindsight call aborted by caller.",
        );
      }
      lastError =
        err instanceof Error
          ? err
          : new Error(typeof err === "string" ? err : "fetch failed");
      if (attempt < delays.length - 1) continue;
      throw new HindsightMemoryProviderError(
        `Hindsight transport error after ${delays.length} attempts: ${lastError.message}`,
      );
    }

    const text = await response.text();
    if (response.ok) {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return { text };
      }
    }
    // 4xx: terminal — request shape is wrong, retry won't help.
    if (response.status >= 400 && response.status < 500) {
      throw new HindsightMemoryProviderError(
        `Hindsight ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }
    // 5xx: retryable. If exhausted, fall through and throw.
    lastError = new HindsightMemoryProviderError(
      `Hindsight ${response.status}: ${text.slice(0, 400)}`,
      response.status,
    );
    if (attempt >= delays.length - 1) throw lastError;
  }

  throw (
    lastError ??
    new HindsightMemoryProviderError("Hindsight call exhausted retries")
  );
}

async function getJson(
  options: HindsightMemoryProviderOptions,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.endpoint.replace(/\/$/, "")}${path}`;
  const attemptSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    method: "GET",
    signal: attemptSignal,
  });
  const text = await response.text();
  if (response.ok) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { text };
    }
  }
  throw new HindsightMemoryProviderError(
    `Hindsight ${response.status}: ${text.slice(0, 400)}`,
    response.status,
  );
}

async function listMemoryItems(
  options: HindsightMemoryProviderOptions,
  target: HindsightBankTarget,
  query: string,
  signal?: AbortSignal,
): Promise<MemoryItem[]> {
  const params = new URLSearchParams({
    q: query,
    limit: "25",
    offset: "0",
  });
  try {
    const data = await getJson(
      options,
      `/v1/default/banks/${encodeURIComponent(target.bankId)}/memories/list?${params.toString()}`,
      signal,
    );
    return toListedMemoryItems(data, target).map((item, index) => ({
      ...item,
      score: Math.max(item.score ?? 0, 10_000 - index),
    }));
  } catch (err) {
    console.warn(
      "[hindsight-memory] list memory items failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function listHighConfidenceMemoryItems(
  options: HindsightMemoryProviderOptions,
  target: HindsightBankTarget,
  query: string,
): Promise<MemoryItem[]> {
  if (
    !options.dbClusterArn?.trim() ||
    !options.dbSecretArn?.trim() ||
    !query.trim()
  ) {
    return [];
  }
  const client = options.rdsDataClient ?? new RDSDataClient({});
  const sql = `
    SELECT id::text, bank_id, document_id, context, fact_type, text
    FROM hindsight.memory_units
    WHERE bank_id = :bank_id
      AND context = 'thinkwork_high_confidence_fact'
      AND text ILIKE :pattern
    ORDER BY created_at DESC
    LIMIT 10
  `;
  try {
    const output = await client.send(
      new ExecuteStatementCommand({
        resourceArn: options.dbClusterArn,
        secretArn: options.dbSecretArn,
        database: options.dbName || "thinkwork",
        sql,
        parameters: [
          { name: "bank_id", value: { stringValue: target.bankId } },
          {
            name: "pattern",
            value: {
              stringValue: `%${escapeIlikeMeta(query.trim())}%`,
            },
          },
        ],
      }),
    );
    return highConfidenceRowsToMemoryItems(output, target);
  } catch (err) {
    console.warn(
      "[hindsight-memory] high-confidence fact lookup failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

function escapeIlikeMeta(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function requireScope(options: HindsightMemoryProviderOptions): void {
  if (!options.endpoint?.trim()) {
    throw new HindsightMemoryProviderError(
      "Hindsight memory provider constructed without an endpoint.",
    );
  }
  // The endpoint is operator-set env (HINDSIGHT_ENDPOINT), never user/payload
  // derived, so there is no SSRF surface here. We validate the URL parses and
  // restrict to http/https, but we deliberately ALLOW http: — dev's Hindsight is
  // an internal ELB served over plaintext within the VPC, and the legacy
  // tools/hindsight.ts path (which this replaces) imposed no scheme requirement.
  // Hard-failing on http: would 500 every Pi turn on that environment.
  let parsed: URL;
  try {
    parsed = new URL(options.endpoint);
  } catch {
    throw new HindsightMemoryProviderError(
      `Hindsight memory provider endpoint is not a valid URL: ${options.endpoint}`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HindsightMemoryProviderError(
      `Hindsight memory provider endpoint must be http(s):// (got ${parsed.protocol}).`,
    );
  }
  if (!options.tenantId?.trim()) {
    throw new HindsightMemoryProviderError(
      "Hindsight memory provider constructed without a tenantId.",
    );
  }
  if (!options.userId?.trim()) {
    throw new HindsightMemoryProviderError(
      "Hindsight memory provider constructed without a userId.",
    );
  }
}

/**
 * Build a Hindsight-backed {@link MemoryProvider}. Identity (endpoint,
 * tenantId, userId) is captured here at construction time and never re-read
 * from the environment mid-turn (cred-snapshot-at-entry).
 */
export function createHindsightMemoryProvider(
  options: HindsightMemoryProviderOptions,
): MemoryProvider {
  requireScope(options);
  const targets: HindsightBankTarget[] = [
    { bankId: userBankFor(options.userId), sourceScope: "user" },
    ...(options.spaceId?.trim()
      ? [
          {
            bankId: spaceBankFor(options.spaceId.trim()),
            sourceScope: "space" as const,
          },
        ]
      : []),
  ];
  // Identity (endpoint/tenantId/userId) is captured in this closure at
  // construction time — cred-snapshot-at-entry; never re-read from env mid-turn.

  return {
    async recall(
      request: MemoryRecallRequest,
      signal?: AbortSignal,
    ): Promise<MemoryRecallResult> {
      const query = request.query?.trim();
      if (!query) {
        throw new HindsightMemoryProviderError(
          "recall called with an empty query.",
        );
      }
      const searchQueries = listSearchQueries(query);
      const highConfidenceBatches = await Promise.all(
        targets.map(async (target) => {
          const highConfidenceGroups = await Promise.all(
            searchQueries.map((listQuery) =>
              listHighConfidenceMemoryItems(options, target, listQuery),
            ),
          );
          return mergeMemoryItems(...highConfidenceGroups);
        }),
      );
      const highConfidenceMemories = mergeMemoryItems(
        ...highConfidenceBatches,
      ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      if (highConfidenceMemories.length > 0) {
        return {
          memories: request.limit
            ? highConfidenceMemories.slice(0, request.limit)
            : highConfidenceMemories,
          usage: undefined,
        };
      }

      const listedBatches = await Promise.all(
        targets.map(async (target) => {
          const listedGroups = await Promise.all(
            searchQueries.map((listQuery) =>
              listMemoryItems(options, target, listQuery, signal),
            ),
          );
          return mergeMemoryItems(...listedGroups);
        }),
      );
      const listedMemories = mergeMemoryItems(...listedBatches).sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
      );
      if (listedMemories.length > 0) {
        return {
          memories: request.limit
            ? listedMemories.slice(0, request.limit)
            : listedMemories,
          usage: undefined,
        };
      }

      const batches = await Promise.all(
        targets.map(async (target) => {
          return postJson(
            options,
            `/v1/default/banks/${encodeURIComponent(target.bankId)}/memories/recall`,
            recallRequestBody(query, request),
            signal,
          ).then(
            (data) => ({
              memories: toMemoryItems(data, target),
              usage:
                data && typeof data === "object"
                  ? (data as Record<string, unknown>).usage
                  : undefined,
              error: undefined,
            }),
            (error) => ({
              memories: [],
              usage: undefined,
              error,
            }),
          );
        }),
      );
      const memories = mergeMemoryItems(
        ...batches.map((batch) => batch.memories),
      ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      if (memories.length === 0) {
        const failed = batches.find((batch) => batch.error !== undefined);
        if (failed?.error) throw failed.error;
      }
      return {
        memories: request.limit ? memories.slice(0, request.limit) : memories,
        usage: mergeUnknownValues(batches.map((batch) => batch.usage)),
      };
    },

    async reflect(
      request: MemoryReflectRequest,
      signal?: AbortSignal,
    ): Promise<MemoryReflectResult> {
      const query = request.query?.trim();
      if (!query) {
        throw new HindsightMemoryProviderError(
          "reflect called with an empty query.",
        );
      }
      const reflectQuery = reflectQueryWithContext(request);
      const batches = await Promise.all(
        targets.map(async (target) => {
          const data = await postJson(
            options,
            `/v1/default/banks/${encodeURIComponent(target.bankId)}/reflect`,
            { query: reflectQuery, budget: "mid", include: { facts: {} } },
            signal,
          );
          return { target, data };
        }),
      );
      const texts = batches
        .map(({ target, data }) => {
          const text = toReflectText(data);
          return text ? { sourceScope: target.sourceScope, text } : null;
        })
        .filter(
          (item): item is { sourceScope: "user" | "space"; text: string } =>
            item !== null,
        );
      const evidence = mergeEvidence(
        batches
          .map(({ data }) => basedOnEvidence(data))
          .filter((item): item is MemoryEvidence => Boolean(item)),
      );
      return {
        ok: true,
        text:
          texts.length === 1
            ? texts[0]?.text
            : texts
                .map(
                  (item) =>
                    `${item.sourceScope === "space" ? "Space" : "User"} memory:\n${item.text}`,
                )
                .join("\n\n"),
        usage: mergeUnknownValues(
          batches.map(({ data }) =>
            data && typeof data === "object"
              ? (data as Record<string, unknown>).usage
              : undefined,
          ),
        ),
        ...(evidence ? { evidence } : {}),
        trace: mergeUnknownValues(
          batches.map(({ data }) =>
            data && typeof data === "object"
              ? (data as Record<string, unknown>).trace
              : undefined,
          ),
        ),
      };
    },
  };
}
