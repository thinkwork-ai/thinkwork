/**
 * Pending-question answer context — dispatch-payload plumbing
 * (plan 2026-06-09-005 U3).
 *
 * Exactly ONE turn carries the answer context, whichever route answered:
 *
 *   - card  → answerUserQuestion enqueues a `question_answer` wakeup whose
 *     payload carries these fields top-level (plus `threadId`, the exact
 *     key promoteNextDeferredWakeup() matches on); wakeup-processor
 *     forwards them to the runtime.
 *   - reply → sendMessage consumes and attaches `pendingQuestionAnswers`
 *     to the dispatch it already fires (default-agent-routing →
 *     invokeChatAgent → chat-agent-invoke). NO second wakeup.
 *
 * Both handlers convert to the snake_case `pending_user_questions` field
 * on the runtime invoke payload (same casing boundary as
 * `message_attachments`). U4 renders the actual prompt block from it —
 * this module only delivers the field.
 */

export interface PendingQuestionAnswersPayload {
  questionId: string;
  /** The validated tool payload from the pending_user_questions row. */
  questions: unknown;
  /** Structured card answers; null for reply-consumed batches. */
  answers?: unknown | null;
  answeredVia: "card" | "reply";
  /** users.id of the answering participant, when resolved. */
  answeredBy?: string | null;
  /** The consuming message (reply route only). */
  replyMessageId?: string | null;
  /** The consuming message's text (reply route only). */
  replyText?: string | null;
  /** Specialist escalation context persisted on the question row. */
  delegationContext?: unknown | null;
}

/**
 * Snake_case runtime shape for the `pending_user_questions` invoke-payload
 * field (stable casing for the runtime adapter, like message_attachments).
 */
export function toRuntimePendingUserQuestions(
  input: PendingQuestionAnswersPayload,
): Record<string, unknown> {
  return {
    question_id: input.questionId,
    questions: input.questions ?? null,
    answers: input.answers ?? null,
    answered_via: input.answeredVia,
    answered_by: input.answeredBy ?? null,
    reply_message_id: input.replyMessageId ?? null,
    reply_text: input.replyText ?? null,
    delegation_context: input.delegationContext ?? null,
  };
}

/**
 * Parse a wakeup-payload / dispatch-payload blob back into the typed
 * shape (used by wakeup-processor for `question_answer` wakeups and the
 * chat_message fallback's nested `pendingQuestionAnswers`).
 */
export function pendingQuestionAnswersFromPayload(
  value: unknown,
): PendingQuestionAnswersPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const questionId =
    typeof record.questionId === "string" ? record.questionId : null;
  const answeredVia =
    record.answeredVia === "card" || record.answeredVia === "reply"
      ? record.answeredVia
      : null;
  if (!questionId || !answeredVia) return null;
  return {
    questionId,
    questions: record.questions ?? null,
    answers: record.answers ?? null,
    answeredVia,
    answeredBy:
      typeof record.answeredBy === "string" ? record.answeredBy : null,
    replyMessageId:
      typeof record.replyMessageId === "string" ? record.replyMessageId : null,
    replyText: typeof record.replyText === "string" ? record.replyText : null,
    delegationContext: record.delegationContext ?? null,
  };
}
