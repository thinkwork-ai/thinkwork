import type {
  MemoryItem,
  MemoryProvider,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryReflectRequest,
  MemoryReflectResult,
} from "@thinkwork/pi-runtime-core";

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
  /** Per-attempt request timeout in ms (default 30_000). */
  timeoutMs?: number;
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

function bankFor(userId: string): string {
  return `user_${userId}`;
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

/** Normalize a raw Hindsight recall response into structured memory items. */
function toMemoryItems(data: unknown): MemoryItem[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const raw = record.memory_units ?? record.memories ?? record.results ?? [];
  if (!Array.isArray(raw)) return [];
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
      // Observation signals (fact type, freshness trend, proof count) are
      // parsed defensively — field names are verified empirically against the
      // deployed Hindsight (wire-format rule); absent fields stay undefined.
      const meta = (
        u.metadata && typeof u.metadata === "object" ? u.metadata : {}
      ) as Record<string, unknown>;
      const factType =
        typeof u.fact_type === "string"
          ? u.fact_type
          : typeof meta.fact_type === "string"
            ? meta.fact_type
            : undefined;
      const freshness = [u.freshness, u.trend, meta.freshness, meta.trend].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      const proofCount = [
        u.proof_count,
        u.evidence_count,
        meta.proof_count,
      ].find((v): v is number => typeof v === "number" && Number.isFinite(v));
      return {
        id,
        content: text,
        ...(score !== undefined ? { score } : {}),
        ...(factType !== undefined ? { factType } : {}),
        ...(freshness !== undefined ? { freshness } : {}),
        ...(proofCount !== undefined ? { proofCount } : {}),
      };
    })
    .filter((item): item is MemoryItem => item !== null);
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
  const bankId = bankFor(options.userId);
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
      const data = await postJson(
        options,
        `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
        {
          query,
          budget: "low",
          max_tokens: RECALL_MAX_TOKENS,
          include: { entities: null },
          types: ["world", "experience", "observation"],
        },
        signal,
      );
      const memories = toMemoryItems(data);
      return {
        memories: request.limit ? memories.slice(0, request.limit) : memories,
        usage:
          data && typeof data === "object"
            ? (data as Record<string, unknown>).usage
            : undefined,
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
      const data = await postJson(
        options,
        `/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
        { query, budget: "mid" },
        signal,
      );
      return {
        ok: true,
        text: toReflectText(data),
        usage:
          data && typeof data === "object"
            ? (data as Record<string, unknown>).usage
            : undefined,
      };
    },
  };
}
