import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

/**
 * Plan §005 U6 — Hindsight `recall` + `reflect` ToolDefs.
 *
 * Ports `packages/agentcore-strands/agent-container/container-sources/
 * hindsight_tools.py` to TypeScript ToolDefs shaped for Flue's
 * `init({ tools })`.
 *
 * Async semantics (per `feedback_hindsight_async_tools`):
 * - Each invocation uses a fresh HTTP request (native `fetch`); no
 *   shared connection pool. The call site has no module-level state.
 * - Bounded retry on transient failures: 5xx and network errors retry
 *   on `[1s, 3s, 9s]` with ±0.5s jitter (matches Strands' SLA). 4xx
 *   is terminal — request shape problems should not retry.
 * - Each request carries an `AbortSignal.timeout(30s)`. The retry
 *   loop creates a fresh signal per attempt so the deadline applies
 *   per attempt, not across the entire retry chain.
 *
 * Recall→reflect chaining (per `feedback_hindsight_recall_reflect_pair`):
 * - The `recall` description ends with a REQUIRED FOLLOW-UP block
 *   pointing at `reflect`. Edit both descriptions together — they are
 *   load-bearing as a pair.
 *
 * Multi-tenant invariants (FR-4a):
 * - `tenantId` and `userId` come from the trusted-handler invocation
 *   scope. There is no agent-supplied override; missing values throw
 *   before any HTTP call.
 * - The Hindsight bank id is `user_<userId>` to match the Strands
 *   writer. Cross-runtime parity matters because a Strands user can
 *   flip to Flue and continue against the same Hindsight bank.
 *
 * Inert-ship (U6): nothing imports this yet. U9's handler shell wires
 * it into `init({ tools })`. The legacy pi-mono Hindsight tool at
 * `packages/agentcore-flue/agent-container/src/runtime/tools/hindsight.ts`
 * remains the live wiring until U9 swaps the registry.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;
const RETRY_JITTER_MS = 500;

export interface HindsightToolsContext {
  /** Hindsight HTTP endpoint (e.g. https://hindsight.dev.thinkwork.ai). */
  endpoint: string;
  /** Tenant id from invocation scope. Required. */
  tenantId: string;
  /** User id from invocation scope. Required. */
  userId: string;
  /** Per-attempt request timeout in ms (default 30_000). */
  timeoutMs?: number;
  /** Test seam: override the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

export class HindsightToolError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HindsightToolError";
  }
}

interface RecallParams {
  query: string;
}

interface ReflectParams {
  query: string;
}

function requireScope(context: HindsightToolsContext): void {
  if (!context.tenantId || !context.tenantId.trim()) {
    throw new HindsightToolError(
      "Hindsight tool invoked without a tenantId — the trusted handler must populate it.",
    );
  }
  if (!context.userId || !context.userId.trim()) {
    throw new HindsightToolError(
      "Hindsight tool invoked without a userId — the trusted handler must populate it.",
    );
  }
  if (!context.endpoint || !context.endpoint.trim()) {
    throw new HindsightToolError(
      "Hindsight tool invoked without an endpoint — the trusted handler must populate it.",
    );
  }
}

function bankFor(userId: string): string {
  return `user_${userId}`;
}

function jitter(): number {
  return (Math.random() * 2 - 1) * RETRY_JITTER_MS;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * POST a JSON payload to the Hindsight endpoint with bounded retry on
 * 5xx + transport errors. Returns the parsed JSON response on success
 * (HTTP 2xx). Throws `HindsightToolError` on terminal failure: any
 * 4xx, exhausted retries on 5xx, or network errors after retries.
 */
async function postJson(
  context: HindsightToolsContext,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const fetchImpl = context.fetchImpl ?? fetch;
  const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${context.endpoint.replace(/\/$/, "")}${path}`;
  const delays = [0, ...RETRY_DELAYS_MS];

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]! > 0) {
      const wait = Math.max(0, delays[attempt]! + jitter());
      try {
        await sleep(wait, signal);
      } catch {
        throw new HindsightToolError("Hindsight call aborted by caller signal");
      }
    }

    let response: Response;
    try {
      // Compose caller signal with per-attempt timeout so the docblock
      // "fresh signal per attempt" contract holds even when the caller
      // passes a signal: their cancellation still wins, but a hung
      // attempt still aborts after `timeoutMs`.
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
      // Caller-initiated abort is terminal — never retry. Detect by
      // checking the caller's signal directly; AbortSignal.any propagates
      // the abort without attribution, so signal.aborted is the truth.
      if (signal?.aborted) {
        throw new HindsightToolError("Hindsight call aborted by caller signal");
      }
      lastError =
        err instanceof Error
          ? err
          : new Error(typeof err === "string" ? err : "fetch failed");
      // Network/transport errors: retryable unless we're out of attempts.
      if (attempt < delays.length - 1) continue;
      throw new HindsightToolError(
        `Hindsight transport error after ${delays.length} attempts: ${lastError.message}`,
      );
    }

    const text = await response.text();
    if (response.ok) {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        // Body was not JSON. Surface the text under a `text` key so
        // callers can see what came back rather than failing silently.
        return { text };
      }
    }

    // 4xx: terminal — request shape is wrong, retry won't help.
    if (response.status >= 400 && response.status < 500) {
      throw new HindsightToolError(
        `Hindsight ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }

    // 5xx: retryable. If exhausted, fall through and throw.
    lastError = new HindsightToolError(
      `Hindsight ${response.status}: ${text.slice(0, 400)}`,
      response.status,
    );
    if (attempt >= delays.length - 1) {
      throw lastError;
    }
  }

  throw lastError ?? new HindsightToolError("Hindsight call exhausted retries");
}

function formatRecall(data: unknown): string {
  if (!data || typeof data !== "object") return "No relevant memories found.";
  const record = data as Record<string, unknown>;
  const memoriesRaw =
    record.memory_units ?? record.memories ?? record.results ?? [];
  if (!Array.isArray(memoriesRaw) || memoriesRaw.length === 0) {
    return "No relevant memories found.";
  }
  return memoriesRaw
    .slice(0, 10)
    .map((memory: unknown, index: number) => {
      if (!memory || typeof memory !== "object") {
        return `${index + 1}. ${JSON.stringify(memory)}`;
      }
      const m = memory as Record<string, unknown>;
      const text =
        typeof m.text === "string"
          ? m.text
          : typeof m.content === "string"
            ? m.content
            : typeof m.summary === "string"
              ? m.summary
              : JSON.stringify(memory);
      return `${index + 1}. ${text}`;
    })
    .join("\n");
}

function formatReflect(data: unknown): string {
  if (!data || typeof data !== "object") return JSON.stringify(data);
  const record = data as Record<string, unknown>;
  const text = record.text ?? record.response ?? record.summary;
  if (typeof text === "string" && text.trim()) return text;
  return JSON.stringify(data);
}

export function buildRecallTool(
  context: HindsightToolsContext,
): AgentTool<any> {
  return {
    name: "hindsight_recall",
    label: "Hindsight Recall",
    description:
      "Recall raw memory units from Hindsight for the current user. " +
      "Returns up to 10 ranked memory units matching the query.\n\n" +
      "REQUIRED FOLLOW-UP: after calling hindsight_recall, you MUST " +
      "call hindsight_reflect on the same query to synthesise the raw " +
      "units into a coherent answer. Returning recall output to the " +
      "user without reflect produces low-quality, fragmented responses.",
    parameters: Type.Object({
      query: Type.String({
        description: "Question or topic to recall from long-term memory.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      requireScope(context);
      const { query } = params as RecallParams;
      const trimmed = (query ?? "").trim();
      if (!trimmed) {
        throw new HindsightToolError(
          "hindsight_recall called with an empty query parameter.",
        );
      }
      const bankId = bankFor(context.userId);
      const data = await postJson(
        context,
        `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
        {
          query: trimmed,
          budget: "low",
          max_tokens: 1_500,
          include: { entities: null },
          types: ["world", "experience", "observation"],
        },
        signal,
      );
      return {
        content: [{ type: "text", text: formatRecall(data) }],
        details: {
          tenantId: context.tenantId,
          userId: context.userId,
          bankId,
          query: trimmed,
          phase: "recall",
        },
      };
    },
  };
}

export function buildReflectTool(
  context: HindsightToolsContext,
): AgentTool<any> {
  return {
    name: "hindsight_reflect",
    label: "Hindsight Reflect",
    description:
      "Synthesise Hindsight memory units into a coherent answer for " +
      "the current user. Call this AFTER hindsight_recall on the same " +
      "query — reflect performs the actual reasoning over recalled " +
      "units and returns the answer the user is asking for.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Question or topic to synthesise. Should match the query you " +
          "previously passed to hindsight_recall.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      requireScope(context);
      const { query } = params as ReflectParams;
      const trimmed = (query ?? "").trim();
      if (!trimmed) {
        throw new HindsightToolError(
          "hindsight_reflect called with an empty query parameter.",
        );
      }
      const bankId = bankFor(context.userId);
      const data = await postJson(
        context,
        `/v1/default/banks/${encodeURIComponent(bankId)}/reflect`,
        { query: trimmed, budget: "mid" },
        signal,
      );
      return {
        content: [{ type: "text", text: formatReflect(data) }],
        details: {
          tenantId: context.tenantId,
          userId: context.userId,
          bankId,
          query: trimmed,
          phase: "reflect",
        },
      };
    },
  };
}

/** Build both Hindsight ToolDefs: `[recall, reflect]`. */
export function buildHindsightTools(
  context: HindsightToolsContext,
): AgentTool<any>[] {
  return [buildRecallTool(context), buildReflectTool(context)];
}
