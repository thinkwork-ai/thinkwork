/**
 * activity-client — posts live mid-turn activity to the chat-agent-activity
 * endpoint so the Spaces thread can stream steps while the turn runs
 * (plan 2026-06-03-001).
 *
 * Best-effort by contract (D1): emission never throws into the turn and never
 * blocks it. The durable + authoritative record is the finalize callback;
 * these POSTs are a latency optimization for the live view, and a dropped POST
 * is backfilled by finalize's complete tool_invocations. To avoid the
 * Lambda-Web-Adapter unawaited-promise flush gap, in-flight POSTs are tracked
 * and `drain()`ed by the host AFTER the turn completes (the turn is already
 * done, so draining doesn't extend its wall-clock).
 *
 * Credentials (url/secret/api-url) are snapshotted into the config at coroutine
 * entry by the host and never re-read from the environment mid-turn — see
 * docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md.
 */

import { asString } from "./history.js";
import type { ActivityEmitEvent } from "./agent-loop.js";
import type { PiRuntimeLogEntry } from "./types.js";

const DEFAULT_ATTEMPT_TIMEOUT_MS = 4_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 3_000;

export interface ActivityCallbackConfig {
  url: string;
  secret: string;
  threadTurnId: string;
  tenantId: string;
  threadId: string;
  agentId?: string | null;
  /** Same-origin guard against the deployed API base. */
  apiUrl: string;
}

export interface ActivityEmitter {
  /** Fire-and-forget a single-event POST. Never throws. */
  emit(event: ActivityEmitEvent): void;
  /** Await in-flight POSTs (best-effort, bounded) at end-of-turn. */
  drain(timeoutMs?: number): Promise<void>;
}

/**
 * Reads the activity-callback config off the Pi invoke payload. Returns null
 * when the host did not opt in (eval/direct paths) or the turn has no
 * thread_turn_id.
 */
export function readActivityCallbackConfig(
  payload: Record<string, unknown>,
): ActivityCallbackConfig | null {
  const url = asString(payload.activity_callback_url);
  const secret = asString(payload.activity_callback_secret);
  const threadTurnId = asString(payload.thread_turn_id);
  const tenantId = asString(payload.tenant_id);
  const threadId = asString(payload.thread_id);
  if (!url || !secret || !threadTurnId || !tenantId || !threadId) return null;
  return {
    url,
    secret,
    threadTurnId,
    tenantId,
    threadId,
    agentId: asString(payload.agent_id) || null,
    apiUrl: asString(payload.thinkwork_api_url),
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

export interface ActivityEmitterDeps {
  fetchImpl?: typeof fetch;
  logger?: (entry: PiRuntimeLogEntry) => void;
  attemptTimeoutMs?: number;
}

/**
 * Build an emitter bound to a snapshotted config. When the config is null or
 * the URL fails the same-origin/https guard, returns a no-op emitter so callers
 * never branch on configuration.
 */
export function createActivityEmitter(
  config: ActivityCallbackConfig | null,
  deps: ActivityEmitterDeps = {},
): ActivityEmitter {
  if (!config || !callbackUrlAllowed(config.url, config.apiUrl)) {
    return { emit: () => {}, drain: async () => {} };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const inFlight = new Set<Promise<void>>();

  function post(event: ActivityEmitEvent): Promise<void> {
    const body = JSON.stringify({
      thread_turn_id: config!.threadTurnId,
      tenant_id: config!.tenantId,
      thread_id: config!.threadId,
      agent_id: config!.agentId ?? undefined,
      events: [
        {
          event_type: event.eventType,
          stream: event.stream ?? "step",
          level: event.level,
          color: event.color,
          message: event.message,
          payload: event.payload,
        },
      ],
    });
    return fetchImpl(config!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config!.secret}`,
      },
      body,
      signal: AbortSignal.timeout(attemptTimeoutMs),
    })
      .then((response) => {
        if (!response.ok) {
          deps.logger?.({
            level: response.status >= 500 ? "warn" : "error",
            event: "activity_callback_non_2xx",
            tenantId: config!.tenantId,
            threadId: config!.threadId,
            statusCode: response.status,
          });
        }
      })
      .catch((err) => {
        // Swallowed — a dropped live step is backfilled by finalize.
        deps.logger?.({
          level: "warn",
          event: "activity_callback_failed",
          tenantId: config!.tenantId,
          threadId: config!.threadId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return {
    emit(event) {
      const p = post(event).finally(() => inFlight.delete(p));
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
