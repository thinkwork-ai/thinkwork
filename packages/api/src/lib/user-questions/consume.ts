/**
 * Pending-question consumption — the single CAS seam both answer routes
 * converge on (plan 2026-06-09-005 U3, R22).
 *
 * `consumePendingQuestions` flips EVERY `pending` row for the thread to
 * `answered` in one UPDATE … RETURNING. Clearing ALL pending rows (not one
 * by id) is deliberately defensive: an orphan row — e.g. created in the
 * window before the hand-applied partial unique index landed — can never
 * wedge the AWAITING_USER badge.
 *
 * The `status = 'pending'` predicate is the compare-and-swap: when two
 * consumers race (card double-click, card vs plain reply), exactly one
 * UPDATE matches rows; the loser gets an empty array back and must treat
 * it as "nothing was pending / lost the race" — no error is thrown here.
 *
 * Answer-state recording:
 *   - card  → `answers` carries the structured payload the card submitted.
 *   - reply → `answers` carries ONLY a reference to the consuming message
 *     ({ replyMessageId }) — never a copy of its text. The resume turn
 *     reads the reply from the thread itself (KD: "plain-reply consumption
 *     records answeredVia 'reply' plus a reference to the consuming
 *     message").
 */

import { and, eq } from "drizzle-orm";
import type { getDb } from "@thinkwork/database-pg";
import { pendingUserQuestions } from "@thinkwork/database-pg/schema";

/** A drizzle db handle OR an in-flight transaction — anything with .update(). */
export type UpdateExecutor = Pick<ReturnType<typeof getDb>, "update">;

export type PendingUserQuestionRow = typeof pendingUserQuestions.$inferSelect;

export interface ConsumePendingQuestionsInput {
  threadId: string;
  answeredVia: "card" | "reply";
  /** Structured card answers (card route). Ignored for the reply route. */
  answers?: unknown | null;
  /** The consuming message id (reply route). */
  replyMessageId?: string | null;
  /** users.id of the answering participant (null for unresolved senders). */
  answeredBy?: string | null;
}

/**
 * CAS-consume all pending question rows for a thread.
 * Returns the consumed rows; an empty array means nothing was pending
 * (or this caller lost the race) — callers decide what that means.
 */
export async function consumePendingQuestions(
  executor: UpdateExecutor,
  input: ConsumePendingQuestionsInput,
): Promise<PendingUserQuestionRow[]> {
  const answersValue =
    input.answeredVia === "card"
      ? (input.answers ?? null)
      : input.replyMessageId
        ? { replyMessageId: input.replyMessageId }
        : null;

  const rows = await executor
    .update(pendingUserQuestions)
    .set({
      status: "answered",
      answers: answersValue,
      answered_via: input.answeredVia,
      answered_by: input.answeredBy ?? null,
      answered_at: new Date(),
    })
    .where(
      and(
        eq(pendingUserQuestions.thread_id, input.threadId),
        eq(pendingUserQuestions.status, "pending"),
      ),
    )
    .returning();

  return rows as PendingUserQuestionRow[];
}

/**
 * Cancel hygiene: flip all pending rows for a thread to `cancelled`
 * (thread archive; thread delete is covered by the FK cascades on
 * thread_id/message_id). Same defensive all-pending shape as consume.
 */
export async function cancelPendingQuestions(
  executor: UpdateExecutor,
  input: { threadId: string },
): Promise<PendingUserQuestionRow[]> {
  const rows = await executor
    .update(pendingUserQuestions)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(pendingUserQuestions.thread_id, input.threadId),
        eq(pendingUserQuestions.status, "pending"),
      ),
    )
    .returning();
  return rows as PendingUserQuestionRow[];
}
