-- V1 agent-architecture — column drop (U6 of plan #007).
--
-- Drops the legacy `skill_catalog.execution` and `skill_catalog.mode` columns
-- plus the `idx_skill_catalog_execution` index. The runtime no longer branches
-- on these fields: the `composition` + `declarative` execution types were
-- deleted in U6, and the remaining `script` / `context` distinction is read
-- from each skill's on-disk `skill.yaml` by the agentcore-strands runtime —
-- never from the catalog table.
--
-- See docs/plans/2026-04-23-007-feat-v1-agent-architecture-final-call-plan.md
-- §Implementation Units → U6.
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0029_collapse_execution_types.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - skill_catalog exists
--   - no TypeScript / Python code reads the execution or mode columns
--     on the skill_catalog table (enforced by U6 PR's grep-for-zero
--     check, see the plan's §U6 verification block).
--
-- drops-column: public.skill_catalog.execution
-- drops-column: public.skill_catalog.mode

DO $$
BEGIN
  IF to_regclass('public.skill_catalog') IS NULL THEN
    RAISE EXCEPTION 'skill_catalog table missing — cannot drop execution/mode columns on a fresh stage';
  END IF;
END $$;

-- The runtime cutover (PR #U6) ships before this migration. Once deployed
-- the columns are unread; the drop is a pure cleanup.
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS execution;
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS mode;

-- The execution-keyed index tracked skill_catalog.execution and is dead once
-- that column is gone. DROP IF EXISTS keeps the migration idempotent.
DROP INDEX IF EXISTS idx_skill_catalog_execution;
