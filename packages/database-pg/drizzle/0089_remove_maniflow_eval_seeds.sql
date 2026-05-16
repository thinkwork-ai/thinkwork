-- creates: public.view_eval_seed_maniflow_cleanup_0089
--
-- Removes maniflow-era yaml-seed evaluation test cases from deployed tenants.
--
-- Historical eval_results rows keep their run payloads but detach from the
-- deleted test case rows first because eval_results.test_case_id is nullable
-- and the FK is non-cascading.
--
-- Apply manually before deploy:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0089_remove_maniflow_eval_seeds.sql

\set ON_ERROR_STOP on

BEGIN;

WITH old_seed_cases AS (
  SELECT id
  FROM eval_test_cases
  WHERE source = 'yaml-seed'
    AND category IN (
      'email-calendar',
      'knowledge-base',
      'mcp-gateway',
      'red-team',
      'sub-agents',
      'brain-onepager-citations',
      'brain-triage-routing',
      'brain-trust-gradient-promotion',
      'brain-write-back-capture',
      'thread-management',
      'tool-safety',
      'workspace-memory',
      'workspace-routing'
    )
)
UPDATE eval_results
SET test_case_id = NULL
WHERE test_case_id IN (SELECT id FROM old_seed_cases);

DELETE FROM eval_test_cases
WHERE source = 'yaml-seed'
  AND category IN (
    'email-calendar',
    'knowledge-base',
    'mcp-gateway',
    'red-team',
    'sub-agents',
    'brain-onepager-citations',
    'brain-triage-routing',
    'brain-trust-gradient-promotion',
    'brain-write-back-capture',
    'thread-management',
    'tool-safety',
    'workspace-memory',
    'workspace-routing'
  );

CREATE OR REPLACE VIEW public.view_eval_seed_maniflow_cleanup_0089 AS
SELECT 1 AS applied
WHERE NOT EXISTS (
  SELECT 1
  FROM eval_test_cases
  WHERE source = 'yaml-seed'
    AND category IN (
      'email-calendar',
      'knowledge-base',
      'mcp-gateway',
      'red-team',
      'sub-agents',
      'brain-onepager-citations',
      'brain-triage-routing',
      'brain-trust-gradient-promotion',
      'brain-write-back-capture',
      'thread-management',
      'tool-safety',
      'workspace-memory',
      'workspace-routing'
    )
);

COMMIT;
