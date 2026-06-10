/**
 * pending_user_questions row → GraphQL `UserQuestion` shape
 * (plan 2026-06-09-005 U3).
 *
 * Answer state derives from the question row, never from mutating the
 * question message's parts payload — this is the one conversion seam the
 * Message.userQuestion / Thread.pendingUserQuestion field resolvers and
 * the answerUserQuestion mutation all share.
 */

export interface UserQuestionGraphql {
  id: string;
  threadId: string;
  messageId: string;
  status: string;
  questions: string;
  answers: string | null;
  answeredVia: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
}

export function userQuestionToGraphql(row: {
  id: string;
  thread_id: string;
  message_id: string;
  status: string;
  questions: unknown;
  answers?: unknown | null;
  answered_via?: string | null;
  answered_by?: string | null;
  answered_at?: Date | string | null;
}): UserQuestionGraphql {
  return {
    id: row.id,
    threadId: row.thread_id,
    messageId: row.message_id,
    status: String(row.status).toUpperCase(),
    // AWSJSON scalars travel as strings (same convention as snakeToCamel).
    questions: JSON.stringify(row.questions ?? null),
    answers: row.answers == null ? null : JSON.stringify(row.answers),
    answeredVia: row.answered_via
      ? String(row.answered_via).toUpperCase()
      : null,
    answeredBy: row.answered_by ?? null,
    answeredAt:
      row.answered_at instanceof Date
        ? row.answered_at.toISOString()
        : (row.answered_at ?? null),
  };
}
