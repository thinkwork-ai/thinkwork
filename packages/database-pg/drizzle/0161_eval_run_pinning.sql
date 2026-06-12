-- Purpose: run scope pinning (Evaluations Trust Core U6) — runs execute
--          exactly the dataset version they were launched with. eval_runs
--          gains the dataset linkage (dataset_id), the manifest version
--          pinned at launch (dataset_version), and the resolved
--          dataset_case_id scope (pinned_case_ids). Case CONTENT is not
--          stored in the DB: launch copies each enabled case file to the
--          run snapshot prefix tenants/<slug>/eval-datasets/.runs/<run-id>/
--          in S3 (inside the guarded eval-datasets prefix, so the Pi-role
--          IAM Deny and tenant teardown cover it by construction).
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U6)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0161_eval_run_pinning.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter). Requires 0160_eval_datasets.sql
-- (the eval_datasets table this FK points at).
--
-- All columns are additive and nullable with NO defaults — null is
-- semantically load-bearing:
--   * eval_runs.dataset_id NULL       => legacy category/test-case launch
--     (the pre-U6 path keeps working unchanged).
--   * eval_runs.dataset_version NULL  => scope not yet pinned (the
--     eval-runner stamps it when it captures the run snapshot, before
--     fan-out) or a legacy launch.
--   * eval_runs.pinned_case_ids NULL  => same. Non-null = the launch-time
--     resolved dataset_case_ids; the reconciler reconstructs expected
--     scope from THIS list, never the live enabled=true table filter
--     (a case tombstoned mid-run must not wedge the run).
--   * eval_runs.dataset_id is ON DELETE NO ACTION by design: datasets
--     soft-archive (archived_at), never hard-delete while runs pin them.
--
-- creates-column: public.eval_runs.dataset_id
-- creates-column: public.eval_runs.dataset_version
-- creates-column: public.eval_runs.pinned_case_ids
-- creates-constraint: public.eval_runs.eval_runs_dataset_id_eval_datasets_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS dataset_id uuid
    CONSTRAINT eval_runs_dataset_id_eval_datasets_id_fk
    REFERENCES public.eval_datasets(id);

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS dataset_version integer;

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS pinned_case_ids text[];

COMMIT;
