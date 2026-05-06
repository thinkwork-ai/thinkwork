-- Roll back ThinkWork Computer phase-one data foundation.
--
-- Plan:
--   docs/plans/2026-05-06-005-feat-thinkwork-computer-phase-one-foundation-plan.md

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.computer_delegations;
DROP TABLE IF EXISTS public.computer_snapshots;
DROP TABLE IF EXISTS public.computer_events;
DROP TABLE IF EXISTS public.computer_tasks;
DROP TABLE IF EXISTS public.computers;

DROP INDEX IF EXISTS public.idx_agent_templates_kind;

ALTER TABLE public.agent_templates
  DROP CONSTRAINT IF EXISTS agent_templates_kind_allowed;

ALTER TABLE public.agent_templates
  DROP COLUMN IF EXISTS template_kind;

COMMIT;
