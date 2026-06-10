/**
 * Pending user questions — ask_user_question HITL batches.
 *
 * One row per question batch asked by the parent agent. The asking turn
 * ends `succeeded`; the thread's waiting state (AWAITING_USER) derives
 * from the existence of a `pending` row here, never from turn status.
 *
 * Answer state lives ONLY on this row (answers / answered_via /
 * answered_by / answered_at) — the question message's `parts` payload is
 * written once at intake and never mutated.
 *
 * A partial unique index enforcing one `pending` row per thread lives in
 * the hand-rolled migration at drizzle/0158_pending_user_questions.sql
 * (pending_user_questions_one_pending_per_thread); drizzle-kit cannot
 * express it, so do not expect `db:push` to create it.
 *
 * Plan: docs/plans/2026-06-09-005-feat-ask-user-question-plan.md (U1).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { threads } from "./threads";
import { messages } from "./messages";
import { threadTurns } from "./scheduled-jobs";

// ---------------------------------------------------------------------------
// pending_user_questions — ask_user_question batches + answer state
// ---------------------------------------------------------------------------

export const pendingUserQuestions = pgTable(
  "pending_user_questions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    // The assistant message carrying the question card (content + parts),
    // written in the same transaction as this row.
    message_id: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    // The asking turn (ends `succeeded`; kept for traceability).
    thread_turn_id: uuid("thread_turn_id")
      .references(() => threadTurns.id)
      .notNull(),
    status: text("status").notNull().default("pending"),
    // Validated tool payload (≤ 8 KB, capped at intake).
    questions: jsonb("questions").notNull(),
    answers: jsonb("answers"),
    answered_via: text("answered_via"),
    answered_by: text("answered_by"),
    answered_at: timestamp("answered_at", { withTimezone: true }),
    // Specialist escalation context: profile slug, original task,
    // escalation count (R20 budget is enforced from this).
    delegation_context: jsonb("delegation_context"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_pending_user_questions_tenant").on(table.tenant_id),
    index("idx_pending_user_questions_thread_status").on(
      table.thread_id,
      table.status,
    ),
    // Message.userQuestion lookups + the messages.id FK cascade path.
    index("idx_pending_user_questions_message").on(table.message_id),
    check(
      "pending_user_questions_status_allowed",
      sql`${table.status} IN ('pending','answered','cancelled')`,
    ),
    check(
      "pending_user_questions_answered_via_allowed",
      sql`${table.answered_via} IS NULL OR ${table.answered_via} IN ('card','reply')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const pendingUserQuestionsRelations = relations(
  pendingUserQuestions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [pendingUserQuestions.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [pendingUserQuestions.thread_id],
      references: [threads.id],
    }),
    message: one(messages, {
      fields: [pendingUserQuestions.message_id],
      references: [messages.id],
    }),
    threadTurn: one(threadTurns, {
      fields: [pendingUserQuestions.thread_turn_id],
      references: [threadTurns.id],
    }),
  }),
);
