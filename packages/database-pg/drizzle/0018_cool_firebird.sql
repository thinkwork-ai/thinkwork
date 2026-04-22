-- Agent self-serve tools — user_profiles columns for Unit 1 of
-- docs/plans/2026-04-22-003-feat-agent-self-serve-tools-plan.md.
--
-- Adds 4 nullable text columns that agents can update through the new
-- `update_user_profile` tool:
--
--   • call_by   → rendered into USER.md as {{HUMAN_CALL_BY}}
--   • notes     → rendered into USER.md as {{HUMAN_NOTES}}
--   • family    → rendered into USER.md as {{HUMAN_FAMILY}}
--   • context   → rendered into USER.md as {{HUMAN_CONTEXT}}
--
-- USER.md's {{HUMAN_PHONE}} is read from the existing `users.phone`
-- column (account-level contact info) — no separate profile column.
--
-- All nullable with no default — existing rows render "—" for each field
-- until the agent (or a human via the admin UI) populates them.
--
-- Purely additive; ADD COLUMN nullable on Postgres is O(1) regardless of
-- row count.

ALTER TABLE "user_profiles" ADD COLUMN "call_by" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "family" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "context" text;
