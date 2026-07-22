/**
 * tool-execution-client — posts tool-execution ledger events to the
 * /api/runtime/tool-executions endpoint (THINK-324 Wave-3 C17).
 *
 * Best-effort by the same contract as activity-client: emission never throws
 * into the turn and never blocks it; in-flight POSTs are `drain()`ed by the
 * host AFTER the turn completes. The ledger endpoint is idempotent and
 * tolerates a dropped `started` row, so partial delivery degrades to missing
 * evidence, never to a broken turn.
 *
 * Config is snapshotted at coroutine entry from the invoke payload (same
 * env-shadowing guard as activity-client). The endpoint URL is derived from
 * `thinkwork_api_url` — no new payload fields — and rides the same
 * Bearer(API_AUTH_SECRET) secret as the activity callback.
 */

import { asString } from "./history.js";
import type { PiRuntimeLogEntry } from "./types.js";

const DEFAULT_ATTEMPT_TIMEOUT_MS = 4_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 3_000;

export type ToolExecutionEventType =
  | "started"
  | "completed"
  | "failed"
  | "uncertain";

export interface ToolExecutionEmitEvent {
  eventType: ToolExecutionEventType;
  toolUseId: string;
  operation: string;
  inputPreview?: Record<string, unknown>;
  outputPreview?: Record<string, unknown>;
  errorPreview?: Record<string, unknown>;
  durationMs?: number;
  providerCostUsd?: number;
}

export interface ToolExecutionCallbackConfig {
  url: string;
  secret: string;
  threadTurnId: string;
  tenantId: string;
  threadId: string;
  principalType: "user" | "service";
  principalId: string;
  /** Same-origin guard against the deployed API base. */
  apiUrl: string;
  /** KMS-signed turn identity (THINK-324 C18), echoed verbatim as the
   *  x-thinkwork-turn-assertion header. Null when dispatch minted none. */
  turnAssertion: string | null;
}

export interface ToolExecutionEmitter {
  /** Fire-and-forget a single-event POST. Never throws. */
  emit(event: ToolExecutionEmitEvent): void;
  /** Await in-flight POSTs (best-effort, bounded) at end-of-turn. */
  drain(timeoutMs?: number): Promise<void>;
}

/**
 * Reads the ledger-callback config off the Pi invoke payload. Returns null
 * when the host did not opt in to callbacks (eval/direct paths), the turn has
 * no thread_turn_id, or no API base URL is available to derive the endpoint.
 */
export function readToolExecutionCallbackConfig(
  payload: Record<string, unknown>,
): ToolExecutionCallbackConfig | null {
  const secret = asString(payload.activity_callback_secret);
  const threadTurnId = asString(payload.thread_turn_id);
  const tenantId = asString(payload.tenant_id);
  const threadId = asString(payload.thread_id);
  const apiUrl = asString(payload.thinkwork_api_url);
  if (!secret || !threadTurnId || !tenantId || !threadId || !apiUrl) {
    return null;
  }
  const userId = asString(payload.user_id);
  return {
    url: `${apiUrl.replace(/\/+$/, "")}/api/runtime/tool-executions`,
    secret,
    threadTurnId,
    tenantId,
    threadId,
    principalType: userId ? "user" : "service",
    principalId: userId || "pi-runtime",
    apiUrl,
    turnAssertion: asString(payload.turn_assertion) || null,
  };
}

function callbackUrlAllowed(callbackUrl: string, apiUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return false;
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocalhost) return false;
  const trimmedApiUrl = apiUrl.trim();
  if (!trimmedApiUrl) return false;
  try {
    const parsedApiUrl = new URL(trimmedApiUrl);
    const apiIsLocalhost =
      parsedApiUrl.hostname === "localhost" ||
      parsedApiUrl.hostname === "127.0.0.1";
    if (parsedApiUrl.protocol !== "https:" && !apiIsLocalhost) return false;
    if (!apiIsLocalhost && parsed.origin !== parsedApiUrl.origin) return false;
  } catch {
    return false;
  }
  return true;
}

export interface ToolExecutionEmitterDeps {
  fetchImpl?: typeof fetch;
  logger?: (entry: PiRuntimeLogEntry) => void;
  attemptTimeoutMs?: number;
}

/**
 * Build an emitter bound to a snapshotted config. When the config is null or
 * the URL fails the same-origin/https guard, returns a no-op emitter so
 * callers never branch on configuration.
 */
export function createToolExecutionEmitter(
  config: ToolExecutionCallbackConfig | null,
  deps: ToolExecutionEmitterDeps = {},
): ToolExecutionEmitter {
  if (!config || !callbackUrlAllowed(config.url, config.apiUrl)) {
    return { emit: () => {}, drain: async () => {} };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const inFlight = new Set<Promise<void>>();
  // Per-tool-call ordering: a fast tool's terminal event can otherwise race
  // its own `started` POST and lose (the ledger's correlation trigger then
  // skips the orphan terminal — observed live on an 8ms read). Chain each
  // terminal POST behind its started POST; the chain never rejects because
  // post() swallows failures.
  const startedPosts = new Map<string, Promise<void>>();

  function post(event: ToolExecutionEmitEvent): Promise<void> {
    const isStarted = event.eventType === "started";
    const body = JSON.stringify({
      tenant_id: config!.tenantId,
      thread_id: config!.threadId,
      turn_id: config!.threadTurnId,
      principal_type: config!.principalType,
      principal_id: config!.principalId,
      events: [
        {
          event_type: event.eventType,
          tool_use_id: event.toolUseId,
          operation: event.operation,
          idempotency_key: `pi:${config!.threadTurnId}:${event.toolUseId}`,
          ...(isStarted
            ? { input_preview: event.inputPreview ?? {} }
            : {
                output_preview: event.outputPreview,
                error_preview: event.errorPreview,
                duration_ms: event.durationMs,
                provider_cost_usd: event.providerCostUsd,
              }),
        },
      ],
    });
    return fetchImpl(config!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config!.secret}`,
        ...(config!.turnAssertion
          ? { "x-thinkwork-turn-assertion": config!.turnAssertion }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(attemptTimeoutMs),
    })
      .then((response) => {
        if (!response.ok) {
          deps.logger?.({
            level: response.status >= 500 ? "warn" : "error",
            event: "tool_execution_callback_non_2xx",
            tenantId: config!.tenantId,
            threadId: config!.threadId,
            statusCode: response.status,
          });
        }
      })
      .catch((err) => {
        // Swallowed — the ledger is evidence, not control flow.
        deps.logger?.({
          level: "warn",
          event: "tool_execution_callback_failed",
          tenantId: config!.tenantId,
          threadId: config!.threadId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return {
    emit(event) {
      const prior =
        event.eventType === "started"
          ? Promise.resolve()
          : (startedPosts.get(event.toolUseId) ?? Promise.resolve());
      const p = prior
        .then(() => post(event))
        .finally(() => inFlight.delete(p));
      if (event.eventType === "started") {
        startedPosts.set(event.toolUseId, p);
      } else {
        void p.finally(() => startedPosts.delete(event.toolUseId));
      }
      inFlight.add(p);
    },
    async drain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS) {
      if (inFlight.size === 0) return;
      const all = Promise.allSettled([...inFlight]).then(() => {});
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, timeoutMs),
      );
      await Promise.race([all, timeout]);
    },
  };
}
