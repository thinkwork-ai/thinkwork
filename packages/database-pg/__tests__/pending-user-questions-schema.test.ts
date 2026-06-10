import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { pendingUserQuestions } from "../src/schema/pending-user-questions";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0158 = readFileSync(
  join(HERE, "..", "drizzle", "0158_pending_user_questions.sql"),
  "utf-8",
);

describe("Pending user questions schema", () => {
  it("models an ask_user_question batch with answer state on the row", () => {
    expect(getTableName(pendingUserQuestions)).toBe("pending_user_questions");

    const columns = getTableColumns(pendingUserQuestions);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.thread_id.notNull).toBe(true);
    expect(columns.message_id.notNull).toBe(true);
    expect(columns.thread_turn_id.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.status.default).toBeDefined();
    expect(columns.questions.notNull).toBe(true);
    // Answer state is nullable until the batch is consumed.
    expect(columns.answers.notNull).toBe(false);
    expect(columns.answered_via.notNull).toBe(false);
    expect(columns.answered_by.notNull).toBe(false);
    expect(columns.answered_at.notNull).toBe(false);
    // Specialist escalation context (R20) is optional.
    expect(columns.delegation_context.notNull).toBe(false);
    expect(columns.created_at.notNull).toBe(true);
  });

  it("declares manual migration markers for pending user question objects", () => {
    for (const marker of [
      "creates: public.pending_user_questions",
      "creates: public.pending_user_questions_one_pending_per_thread",
      "creates: public.idx_pending_user_questions_tenant",
      "creates: public.idx_pending_user_questions_thread_status",
      "creates: public.idx_pending_user_questions_message",
      "creates-constraint: public.pending_user_questions.pending_user_questions_tenant_id_tenants_id_fk",
      "creates-constraint: public.pending_user_questions.pending_user_questions_thread_id_threads_id_fk",
      "creates-constraint: public.pending_user_questions.pending_user_questions_message_id_messages_id_fk",
      "creates-constraint: public.pending_user_questions.pending_user_questions_thread_turn_id_thread_turns_id_fk",
      "creates-constraint: public.pending_user_questions.pending_user_questions_status_allowed",
      "creates-constraint: public.pending_user_questions.pending_user_questions_answered_via_allowed",
    ]) {
      expect(migration0158).toContain(`-- ${marker}`);
    }
  });

  it("indexes message_id for Message.userQuestion lookups and FK-cascade deletes", () => {
    expect(migration0158).toContain(
      "CREATE INDEX IF NOT EXISTS idx_pending_user_questions_message",
    );
    expect(migration0158).toMatch(
      /idx_pending_user_questions_message\s+ON public\.pending_user_questions \(message_id\)/,
    );
  });

  it("enforces one pending batch per thread via a partial unique index", () => {
    expect(migration0158).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS pending_user_questions_one_pending_per_thread",
    );
    expect(migration0158).toMatch(
      /ON public\.pending_user_questions \(thread_id\)\s+WHERE status = 'pending'/,
    );
  });

  it("constrains status and answered_via vocabularies", () => {
    expect(migration0158).toContain(
      "CHECK (status IN ('pending', 'answered', 'cancelled'))",
    );
    expect(migration0158).toContain(
      "CHECK (answered_via IS NULL OR answered_via IN ('card', 'reply'))",
    );
  });
});
