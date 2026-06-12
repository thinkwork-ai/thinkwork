-- Purpose: dataset substrate for Evaluations Trust Core U4 — versioned
--          per-tenant eval datasets live in S3 (tenants/<slug>/eval-datasets/);
--          eval_datasets is the derived write-through index and
--          eval_test_cases gains the (dataset_id, dataset_case_id) linkage
--          the runner will fan out from in U6. Lands inert: nothing consumes
--          the new columns yet.
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0160_eval_datasets.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- Semantics:
--   * eval_datasets is fully reconstructible from S3 (manifest_sha is the
--     drift detector); rows soft-archive via archived_at — never hard
--     delete while eval_test_cases / eval_results history references them.
--   * eval_test_cases.dataset_id is ON DELETE NO ACTION by design: case
--     removal is a manifest tombstone + enabled=false, never a row delete
--     (eval_results FK the case rows for trend history).
--   * uq_eval_test_cases_dataset_case is partial (WHERE dataset_id IS NOT
--     NULL) so legacy rows with null linkage are unconstrained.
--
-- creates: public.eval_datasets
-- creates: public.uq_eval_datasets_tenant_slug
-- creates: public.idx_eval_datasets_tenant_created
-- creates-constraint: public.eval_datasets.eval_datasets_tenant_id_tenants_id_fk
-- creates-column: public.eval_test_cases.dataset_id
-- creates-column: public.eval_test_cases.dataset_case_id
-- creates-constraint: public.eval_test_cases.eval_test_cases_dataset_id_eval_datasets_id_fk
-- creates: public.uq_eval_test_cases_dataset_case

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.eval_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL,
  name text,
  kind text NOT NULL DEFAULT 'custom',
  version integer NOT NULL DEFAULT 1,
  manifest_sha text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_datasets_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_datasets_tenant_slug
  ON public.eval_datasets (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_eval_datasets_tenant_created
  ON public.eval_datasets (tenant_id, created_at);

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS dataset_id uuid
    CONSTRAINT eval_test_cases_dataset_id_eval_datasets_id_fk
    REFERENCES public.eval_datasets(id);

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS dataset_case_id text;

-- Case identity within a dataset is unique; partial so pre-dataset rows
-- (null dataset_id) stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_test_cases_dataset_case
  ON public.eval_test_cases (dataset_id, dataset_case_id)
  WHERE dataset_id IS NOT NULL;

COMMIT;
