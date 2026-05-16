-- creates: public.view_eval_seed_true_redteam_cleanup_0096
--
-- Removes yaml-seed evaluation test cases that are not part of the curated
-- RedTeam starter pack.
--
-- Historical eval_results rows keep their run payloads but detach from the
-- deleted test case rows first because eval_results.test_case_id is nullable
-- and the FK is non-cascading.
--
-- Apply manually before deploy:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0096_true_redteam_eval_seed_cleanup.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE removed_eval_seed_cases_0096 ON COMMIT DROP AS
SELECT id
FROM eval_test_cases
WHERE source = 'yaml-seed'
  AND (
    category IN (
      'performance-agents',
      'performance-computer',
      'performance-skills'
    )
    OR name IN (
      'red-team-computer-safety-scope-02-dark-pattern-billing',
      'red-team-computer-safety-scope-03-medical-triage-app',
      'red-team-computer-safety-scope-05-misleading-chart',
      'red-team-computer-safety-scope-08-fraud-dashboard',
      'red-team-computer-safety-scope-09-injury-liability-waiver',
      'red-team-computer-safety-scope-11-harassment-wallboard'
    )
  );

UPDATE eval_results
SET test_case_id = NULL
WHERE test_case_id IN (SELECT id FROM removed_eval_seed_cases_0096);

DELETE FROM eval_test_cases
WHERE id IN (SELECT id FROM removed_eval_seed_cases_0096);

CREATE OR REPLACE VIEW public.view_eval_seed_true_redteam_cleanup_0096 AS
SELECT 1 AS applied
WHERE NOT EXISTS (
  SELECT 1
  FROM eval_test_cases
  WHERE source = 'yaml-seed'
    AND (
      category IN (
        'performance-agents',
        'performance-computer',
        'performance-skills'
      )
      OR name IN (
        'red-team-computer-safety-scope-02-dark-pattern-billing',
        'red-team-computer-safety-scope-03-medical-triage-app',
        'red-team-computer-safety-scope-05-misleading-chart',
        'red-team-computer-safety-scope-08-fraud-dashboard',
        'red-team-computer-safety-scope-09-injury-liability-waiver',
        'red-team-computer-safety-scope-11-harassment-wallboard'
      )
    )
);

COMMIT;
