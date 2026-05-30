import { asString } from "./history.js";
import { collectToolCosts } from "./tool-costs.js";
import type {
  PiInvocationIdentity,
  PiRuntimeLogEntry,
  RunAgentLoopResult,
} from "./types.js";

const COMPLETION_RETRY_DELAYS_MS = [200, 600, 1500] as const;
const DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS = 15_000;

export interface FinalizeCallbackArgs {
  payload: Record<string, unknown>;
  identity: PiInvocationIdentity;
  systemPrompt?: string;
  result:
    | { status: "ok"; runResult: RunAgentLoopResult; latencyMs: number }
    | { status: "error"; error: unknown; latencyMs: number };
  fetchImpl: typeof fetch;
  attemptTimeoutMs?: number;
  logger?: (entry: PiRuntimeLogEntry) => void;
}

function usageNumber(usage: unknown, ...keys: string[]): number {
  if (!usage || typeof usage !== "object") return 0;
  const obj = usage as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function buildFinalizeBody(
  args: FinalizeCallbackArgs,
): Record<string, unknown> {
  const { payload, identity, result } = args;
  const runResult = result.status === "ok" ? result.runResult : null;
  const usage = runResult?.usage;
  const toolCosts =
    runResult?.toolCosts ??
    runResult?.toolInvocations.flatMap((invocation) =>
      collectToolCosts(invocation.result),
    ) ??
    [];
  const errorMessage =
    result.status === "error"
      ? result.error instanceof Error
        ? result.error.message
        : String(result.error)
      : undefined;

  return {
    thread_turn_id: asString(payload.thread_turn_id),
    tenant_id: identity.tenantId,
    agent_id: identity.agentId,
    thread_id: identity.threadId,
    trace_id: asString(payload.trace_id) || undefined,
    user_message: asString(payload.message),
    agent_model: runResult?.modelId || asString(payload.model) || null,
    runtime_type: "pi",
    composed_system_prompt: args.systemPrompt || null,
    agent_slug: asString(payload.instance_id) || null,
    agent_name: asString(payload.agent_name) || null,
    duration_ms: result.latencyMs,
    status: result.status === "ok" ? "completed" : "failed",
    error_message: errorMessage,
    computer_id: asString(payload.computer_id) || null,
    computer_task_id: asString(payload.computer_task_id) || null,
    usage: {
      model: runResult?.modelId || asString(payload.model) || null,
      input_tokens: usageNumber(usage, "inputTokens", "input", "prompt_tokens"),
      output_tokens: usageNumber(
        usage,
        "outputTokens",
        "output",
        "completion_tokens",
      ),
      cached_read_tokens: usageNumber(
        usage,
        "cachedReadTokens",
        "cacheRead",
        "cached_read_tokens",
      ),
      ...(runResult?.diagnostics ? { diagnostics: runResult.diagnostics } : {}),
    },
    response: runResult
      ? {
          composed_system_prompt: args.systemPrompt || null,
          content: runResult.content,
          runtime: "pi",
          runtime_host: asString(payload.runtime_host) || null,
          model: runResult.modelId,
          usage: runResult.usage,
          tools_called: runResult.toolsCalled,
          tool_invocations: runResult.toolInvocations,
          tool_costs: toolCosts,
          hindsight_usage: [],
          ...(runResult.diagnostics
            ? { diagnostics: runResult.diagnostics }
            : {}),
        }
      : {
          composed_system_prompt: args.systemPrompt || null,
          runtime: "pi",
          runtime_host: asString(payload.runtime_host) || null,
          tools_called: [],
          tool_invocations: [],
          hindsight_usage: [],
        },
  };
}

function callbackUrlAllowed(
  callbackUrl: string,
  apiUrl: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocalhost) {
    return { ok: false, reason: "insecure-url" };
  }

  const trimmedApiUrl = apiUrl.trim();
  if (!trimmedApiUrl) return { ok: false, reason: "missing-api-url" };

  try {
    const parsedApiUrl = new URL(trimmedApiUrl);
    const apiIsLocalhost =
      parsedApiUrl.hostname === "localhost" ||
      parsedApiUrl.hostname === "127.0.0.1";
    if (parsedApiUrl.protocol !== "https:" && !apiIsLocalhost) {
      return { ok: false, reason: "insecure-api-url" };
    }
    if (!apiIsLocalhost && parsed.origin !== parsedApiUrl.origin) {
      return { ok: false, reason: "origin-mismatch" };
    }
  } catch {
    return { ok: false, reason: "invalid-api-url" };
  }

  return { ok: true };
}

export function isFinalizeCallbackConfigured(
  payload: Record<string, unknown>,
): boolean {
  return Boolean(
    asString(payload.finalize_callback_url) &&
    asString(payload.finalize_callback_secret) &&
    asString(payload.thread_turn_id),
  );
}

export async function postFinalizeCallback(
  args: FinalizeCallbackArgs,
): Promise<boolean> {
  const { payload, identity, fetchImpl, logger } = args;
  const callbackUrl = asString(payload.finalize_callback_url);
  const callbackSecret = asString(payload.finalize_callback_secret);
  const threadTurnId = asString(payload.thread_turn_id);
  const attemptTimeoutMs =
    args.attemptTimeoutMs ?? DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS;

  if (!callbackUrl || !callbackSecret || !threadTurnId) return false;

  const urlCheck = callbackUrlAllowed(
    callbackUrl,
    asString(payload.thinkwork_api_url),
  );
  if (!urlCheck.ok) {
    logger?.({
      level: "error",
      event:
        urlCheck.reason === "invalid-url"
          ? "finalize_callback_invalid_url"
          : "finalize_callback_rejected_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      reason: urlCheck.reason,
    });
    return false;
  }

  const body = JSON.stringify(buildFinalizeBody(args));
  const totalAttempts = COMPLETION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${callbackSecret}`,
        },
        body,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.ok) return true;
      logger?.({
        level: response.status >= 500 ? "warn" : "error",
        event: "finalize_callback_non_2xx",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        statusCode: response.status,
        attempt,
      });
      if (response.status >= 400 && response.status < 500) return false;
    } catch (err) {
      logger?.({
        level: "warn",
        event: "finalize_callback_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < totalAttempts - 1) {
      const baseDelay = COMPLETION_RETRY_DELAYS_MS[attempt] ?? 0;
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + jitter));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger?.({
    level: "error",
    event: "finalize_callback_exhausted",
    tenantId: identity.tenantId,
    threadId: identity.threadId,
    threadTurnId,
    attempts: totalAttempts,
  });
  return false;
}
