/**
 * Per-turn auto-retain — fire-and-forget invoke of the `memory-retain` Lambda
 * after each agent turn, so the API's normalized memory layer can persist the
 * conversation transcript through the active engine (Hindsight or AgentCore).
 *
 * TypeScript port of Strands' `api_memory_client.retain_conversation`
 * (`packages/agentcore-strands/agent-container/container-sources/api_memory_client.py:40-93`).
 * Adapted to Flue's identity + env snapshot shape:
 *   - Identity comes from `IdentitySnapshot` validated at /invocations entry
 *     (`handler-context.ts:62-91`); we never re-extract from a loose payload.
 *   - The receiving Lambda name comes from `RuntimeEnvSnapshot.memoryRetainFnName`,
 *     populated from `MEMORY_RETAIN_FN_NAME` by `snapshotRuntimeEnv` at entry.
 *     Per `feedback_completion_callback_snapshot_pattern`, this module never
 *     reads `process.env` directly — values are threaded in as parameters.
 *
 * The receiving Lambda
 * (`packages/api/src/handlers/memory-retain.ts`) merges this transcript with
 * the canonical DB transcript via longest-suffix-prefix overlap before
 * calling `adapter.retainConversation`, so we ship the latest tail rather
 * than the full DB-backed history.
 *
 * Failure semantics: never throws, never blocks the user response. All
 * outcomes resolve to `{ retained, error? }`.
 *
 * Lambda async retry: invoked with `InvocationType=Event`. AWS Lambda's
 * default async retry policy is 2 attempts; the deploy-time configuration
 * for the receiving Lambda must set `MaximumRetryAttempts=0` (or the
 * handler must be idempotent on `(tenantId, threadId)`) — see plan §U3.
 */

import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";

import type {
  IdentitySnapshot,
  RuntimeEnvSnapshot,
} from "../../handler-context.js";

export interface RetainTranscriptEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * Loose payload shape covering the fields this client cares about. The
 * caller's full payload is passed in unchanged so adding a field here can
 * be flagged by the field-passthrough tests rather than silently dropped
 * by a hand-curated subset dict (see `apply-invocation-env-field-passthrough`
 * institutional learning).
 */
export interface RetainPayloadInput {
  /** Honors `payload.use_memory === true` as opt-in. Anything else (false / missing) skips retain. */
  use_memory?: unknown;
  /** Latest user turn message; appended to the transcript as the final user entry. */
  message?: unknown;
  /** Prior turn history; filtered to user/assistant entries with non-empty string content. */
  messages_history?: unknown;
}

export interface MemoryRetainRequest {
  tenantId: string;
  userId: string;
  threadId: string;
  transcript: RetainTranscriptEntry[];
}

export interface RetainConversationResult {
  retained: boolean;
  error?: string;
}

/**
 * Build the per-turn transcript: history (filtered to user/assistant with
 * non-empty content) + [user message, assistant response].
 *
 * Mirrors Strands' `_build_full_thread_transcript`
 * (`packages/agentcore-strands/agent-container/container-sources/server.py:1782-1809`)
 * exactly; the receiving Lambda does longest-suffix-prefix merge against the
 * canonical DB transcript so this tail is sufficient.
 */
export function buildRetainTranscript(
  payload: RetainPayloadInput,
  assistantContent: string,
): RetainTranscriptEntry[] {
  const transcript: RetainTranscriptEntry[] = [];
  const history = payload.messages_history;
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (!entry || typeof entry !== "object") continue;
      const role = (entry as { role?: unknown }).role;
      const content = (entry as { content?: unknown }).content;
      if (
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim().length > 0
      ) {
        transcript.push({ role, content });
      }
    }
  }
  const userMessage =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (userMessage) transcript.push({ role: "user", content: userMessage });
  if (assistantContent && assistantContent.trim().length > 0) {
    transcript.push({ role: "assistant", content: assistantContent });
  }
  return transcript;
}

/**
 * Construct the request envelope for the `memory-retain` Lambda. Pure helper
 * — separately testable so a field-passthrough test can pin every required
 * field without going through the LambdaClient.
 */
export function buildMemoryRetainRequest(
  payload: RetainPayloadInput,
  identity: IdentitySnapshot,
  assistantContent: string,
): MemoryRetainRequest {
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    threadId: identity.threadId,
    transcript: buildRetainTranscript(payload, assistantContent),
  };
}

export interface RetainConversationArgs {
  /** Raw payload from the /invocations request. Used for opt-out + transcript build. */
  payload: RetainPayloadInput;
  /** Identity snapshot from `snapshotIdentity`. Required fields are pre-validated. */
  identity: IdentitySnapshot;
  /** Env snapshot from `snapshotRuntimeEnv`. Carries `memoryRetainFnName` + `awsRegion`. */
  env: RuntimeEnvSnapshot;
  /** Final assistant response text for this turn, appended to the transcript. */
  assistantContent: string;
  /** Lambda client. Injected by the caller; tests pass a mock. */
  lambdaClient: LambdaClient;
}

/**
 * Fire-and-forget invoke of the `memory-retain` Lambda with the per-turn
 * transcript. Honors `payload.use_memory === true` as the opt-in (anything
 * else, including missing, skips retain — defensive default).
 *
 * Returns `{ retained: false }` for any precondition that prevents retain
 * (opt-out, missing identity, missing function name, empty transcript).
 * Returns `{ retained: false, error }` if the Lambda invoke itself throws.
 * Never throws — the caller's response path must not block on retain.
 */
export async function retainConversation(
  args: RetainConversationArgs,
): Promise<RetainConversationResult> {
  const { payload, identity, env, assistantContent, lambdaClient } = args;

  // Opt-in only: missing or false → skip. Conservative default mirrors Pi
  // (which uses `optionalBoolean(payload.use_memory)` returning false unless
  // the value is exactly `true` or the string `"true"`).
  if (payload.use_memory !== true && payload.use_memory !== "true") {
    return { retained: false };
  }

  if (!env.memoryRetainFnName) return { retained: false };
  if (!identity.tenantId || !identity.userId || !identity.threadId) {
    return { retained: false };
  }

  const request = buildMemoryRetainRequest(payload, identity, assistantContent);
  if (request.transcript.length === 0) return { retained: false };

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: env.memoryRetainFnName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(request)),
      }),
    );
    return { retained: true };
  } catch (err) {
    return {
      retained: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
