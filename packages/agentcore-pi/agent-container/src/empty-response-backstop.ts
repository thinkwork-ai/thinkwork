/**
 * Empty-turn backstop (THINK-145 / Living Artifacts).
 *
 * Live evidence (dev thread 3bf17708, turn 991ff6c3): an agent turn completed
 * with status `succeeded` and `result_json = {"runtime":"pi","response":""}` —
 * no assistant text, no UI emission, nothing user-visible. The user saw dead
 * silence. This module detects that terminal state and forces exactly ONE
 * continuation to coax a final answer; if the continuation is still empty, the
 * turn is failed loudly (via {@link EmptyResponseError}) rather than reported as
 * a bare success with an empty response.
 */
import { EMIT_DOCUMENT_TOOL_NAME } from "@thinkwork/pi-extensions";
import type { RunAgentLoopResult } from "@thinkwork/pi-runtime-core";

import { turnAlreadyAskedUserQuestion } from "./ask-user-question-rescue.js";

/** The forced-continuation user message appended when a turn produced nothing
 *  user-visible. Deliberately plain so any model can act on it. */
export const EMPTY_RESPONSE_CONTINUATION_PROMPT =
  "You have not produced any user-visible reply. Provide your final answer to " +
  "the user now, summarizing what you found or did.";

/**
 * Thrown when a turn produced no user-visible output AND the single forced
 * continuation also produced nothing. Routed through the runtime's existing
 * error path (server.ts sets `runError` → finalize/completion callback
 * `status:"error"`), so the platform marks the thread turn failed instead of
 * recording a bare empty success. The `code` + message carry `empty_response`
 * for CloudWatch/grep counting.
 */
export class EmptyResponseError extends Error {
  readonly code = "empty_response";
  constructor() {
    super(
      "empty_response: Pi agent produced no user-visible reply after a forced continuation",
    );
    this.name = "EmptyResponseError";
  }
}

/**
 * True when the turn produced NOTHING a user can see. Signals available at the
 * result-assembly seam:
 *  - assistant text (`content`),
 *  - structured UI parts (`uiMessageParts`: GenUI + MCP app cards),
 *  - a successful `ask_user_question` (posts a question card directly to the
 *    API — never rides content/uiMessageParts),
 *  - a successful `emit_document` (posts a document card directly to the API —
 *    same: never rides content/uiMessageParts).
 *
 * Tool calls alone do NOT count as user-visible. Guarding against the two
 * direct-POST tools above is what keeps a document-only or question-only turn
 * (legitimately prose-free) from false-triggering the backstop.
 */
export function turnProducedNoUserVisibleOutput(
  runResult: RunAgentLoopResult,
): boolean {
  if (runResult.content.trim().length > 0) return false;
  if ((runResult.uiMessageParts ?? []).length > 0) return false;
  if (turnAlreadyAskedUserQuestion(runResult.toolInvocations)) return false;
  for (const invocation of runResult.toolInvocations) {
    const name = invocation.tool_name || invocation.name;
    if (
      name === EMIT_DOCUMENT_TOOL_NAME &&
      invocation.is_error !== true &&
      invocation.status !== "error"
    ) {
      return false;
    }
  }
  return true;
}

/** Structured backstop observability line (host-compatible with LogFields). */
export interface EmptyResponseBackstopLogEntry {
  level: "warn" | "error";
  event: "empty_response_backstop";
  phase: "detected" | "recovered" | "failed";
  threadId?: string;
  threadTurnId?: string;
  // Index signature keeps this assignable to the host's LogFields sink.
  [key: string]: unknown;
}

export interface EmptyResponseBackstopInput {
  runResult: RunAgentLoopResult;
  /** Runs exactly ONE forced continuation (a fresh model iteration seeded with
   *  {@link EMPTY_RESPONSE_CONTINUATION_PROMPT}); returns its result. */
  retry: () => Promise<RunAgentLoopResult>;
  /** Structured logger (host binds tenant/thread context). */
  log?: (entry: EmptyResponseBackstopLogEntry) => void;
  threadId?: string;
  threadTurnId?: string;
}

/**
 * Apply the empty-turn backstop. Returns the original result when the turn is
 * already user-visible, the retried result when the forced continuation
 * recovers, and THROWS {@link EmptyResponseError} when the retry is still empty.
 * At most one continuation is ever issued.
 */
export async function applyEmptyResponseBackstop(
  input: EmptyResponseBackstopInput,
): Promise<RunAgentLoopResult> {
  const { runResult, retry, log, threadId, threadTurnId } = input;
  if (!turnProducedNoUserVisibleOutput(runResult)) return runResult;

  log?.({
    level: "warn",
    event: "empty_response_backstop",
    phase: "detected",
    threadId,
    threadTurnId,
  });

  const retried = await retry();
  if (!turnProducedNoUserVisibleOutput(retried)) {
    log?.({
      level: "warn",
      event: "empty_response_backstop",
      phase: "recovered",
      threadId,
      threadTurnId,
    });
    return retried;
  }

  log?.({
    level: "error",
    event: "empty_response_backstop",
    phase: "failed",
    threadId,
    threadTurnId,
  });
  throw new EmptyResponseError();
}
