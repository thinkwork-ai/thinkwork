-- thread_turns.kind column.
--
-- Adds a `kind` field to distinguish agent-turn rows (default) from
-- system events (escalate/delegate) that U2 of the thread-detail cleanup
-- plan writes in place of the dropped thread_comments table. Prerequisite
-- for U2 — without this column the escalate/delegate refactor can't land.
--
-- See docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
-- (Unit U12 — prerequisite migration).
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0026_thread_turns_add_kind.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - thread_turns exists.
--   - thread_turns.kind does not yet exist.
--
-- creates-column: public.thread_turns.kind
-- creates: public.idx_thread_turns_kind

ALTER TABLE "thread_turns"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'agent_turn';

CREATE INDEX IF NOT EXISTS "idx_thread_turns_kind"
  ON "thread_turns" ("kind");
