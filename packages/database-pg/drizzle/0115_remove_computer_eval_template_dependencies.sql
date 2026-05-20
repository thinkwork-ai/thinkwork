-- Purpose: remove remaining Computer/Evaluation dependencies on Agent Templates.
-- Plan: docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md (U10)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0115_remove_computer_eval_template_dependencies.sql
-- creates-column: public.eval_test_cases.agent_id
-- creates-constraint: public.eval_test_cases.eval_test_cases_agent_id_agents_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS agent_id uuid;

WITH ranked_agents AS (
  SELECT
    tc.id AS test_case_id,
    a.id AS agent_id,
    row_number() OVER (
      PARTITION BY tc.id
      ORDER BY
        CASE WHEN a.type = 'eval' THEN 0 ELSE 1 END,
        CASE WHEN a.source = 'system' THEN 0 ELSE 1 END,
        a.created_at DESC
    ) AS rn
  FROM public.eval_test_cases tc
  JOIN public.agents a
    ON a.template_id = tc.agent_template_id
   AND a.tenant_id = tc.tenant_id
  WHERE tc.agent_id IS NULL
    AND tc.agent_template_id IS NOT NULL
    AND a.status <> 'archived'
)
UPDATE public.eval_test_cases tc
SET agent_id = ranked_agents.agent_id
FROM ranked_agents
WHERE ranked_agents.test_case_id = tc.id
  AND ranked_agents.rn = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'eval_test_cases_agent_id_agents_id_fk'
      AND conrelid = 'public.eval_test_cases'::regclass
  ) THEN
    ALTER TABLE public.eval_test_cases
      ADD CONSTRAINT eval_test_cases_agent_id_agents_id_fk
      FOREIGN KEY (agent_id)
      REFERENCES public.agents(id);
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_computers_template;

ALTER TABLE public.computers
  DROP COLUMN IF EXISTS template_id;

ALTER TABLE public.eval_runs
  DROP COLUMN IF EXISTS agent_template_id;

ALTER TABLE public.eval_test_cases
  DROP COLUMN IF EXISTS agent_template_id;

COMMIT;
