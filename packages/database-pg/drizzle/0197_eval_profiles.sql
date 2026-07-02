-- Purpose: Eval Profiles substrate (THINK-107, Eval Profiles U1). Adds the
--          eval_profiles table (agent-under-test as named config: model +
--          judge pin + trial count, one default per tenant), the
--          eval_case_overrides table (case-level verdict overrides for
--          multi-trial cases — the aggregation layer applies them last),
--          run-side pinning columns (profile_id, profile_snapshot,
--          pinned_trial_plan, expected_result_rows), per-trial result
--          identity + agent-turn telemetry columns, and case-quality
--          curation columns. Backfills one default profile per existing
--          tenant; the resolution seam get-or-creates for tenants
--          provisioned later.
-- Plan: docs/plans/2026-07-01-002-feat-eval-profiles-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0197_eval_profiles.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — repo convention is
-- psql-applied files gated by the db:migrate-manual drift reporter).
--
-- Semantics:
--   * eval_profiles: exactly one default per tenant, enforced by a partial
--     unique index. Soft-archive via archived_at; archiving the default is
--     rejected at the API layer.
--   * eval_case_overrides: one row per (run, case); pass|fail only. The
--     per-trial rows on eval_results are never overridden individually.
--   * eval_results.trial_index defaults 0 so every legacy row is trial 0.
--     Row identity (run, case, trial) stays app-enforced (worker dedup +
--     advisory lock), matching the table's existing convention — no unique
--     index, since legacy data predates app-level dedup hardening.
--   * eval_runs.expected_result_rows is nullable; completion checks read
--     COALESCE(expected_result_rows, total_tests) so pre-profile and
--     in-flight runs keep finalizing.
--   * eval_test_cases.quality_state: 'active' | 'retired' | 'needs-revision';
--     seed re-sync propagates transitions one-way (never retired -> active).
--
-- creates: public.eval_profiles
-- creates-constraint: public.eval_profiles.eval_profiles_tenant_id_tenants_id_fk
-- creates-constraint: public.eval_profiles.eval_profiles_trials_check
-- creates: public.eval_case_overrides
-- creates-constraint: public.eval_case_overrides.eval_case_overrides_run_id_eval_runs_id_fk
-- creates-constraint: public.eval_case_overrides.eval_case_overrides_test_case_id_eval_test_cases_id_fk
-- creates-constraint: public.eval_case_overrides.eval_case_overrides_status_check
-- creates-column: public.eval_runs.profile_id
-- creates-column: public.eval_runs.profile_snapshot
-- creates-column: public.eval_runs.pinned_trial_plan
-- creates-column: public.eval_runs.expected_result_rows
-- creates-column: public.eval_results.trial_index
-- creates-column: public.eval_results.agent_input_tokens
-- creates-column: public.eval_results.agent_output_tokens
-- creates-column: public.eval_results.agent_cost_usd
-- creates-column: public.eval_test_cases.quality_state
-- creates-column: public.eval_test_cases.rewritten_from_id
-- creates-constraint: public.eval_test_cases.eval_test_cases_quality_state_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.eval_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL
    CONSTRAINT eval_profiles_tenant_id_tenants_id_fk REFERENCES public.tenants(id),
  name text NOT NULL,
  model text NOT NULL,
  judge_model text,
  trials integer NOT NULL DEFAULT 1
    CONSTRAINT eval_profiles_trials_check CHECK (trials >= 1),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_profiles_tenant_name
  ON public.eval_profiles (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_profiles_tenant_default
  ON public.eval_profiles (tenant_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_eval_profiles_tenant
  ON public.eval_profiles (tenant_id);

CREATE TABLE IF NOT EXISTS public.eval_case_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL
    CONSTRAINT eval_case_overrides_run_id_eval_runs_id_fk
    REFERENCES public.eval_runs(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL
    CONSTRAINT eval_case_overrides_test_case_id_eval_test_cases_id_fk
    REFERENCES public.eval_test_cases(id),
  override_status text NOT NULL
    CONSTRAINT eval_case_overrides_status_check
    CHECK (override_status IN ('pass', 'fail')),
  overridden_by text,
  overridden_at timestamptz NOT NULL DEFAULT now(),
  override_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_case_overrides_run_case
  ON public.eval_case_overrides (run_id, test_case_id);

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS profile_id uuid,
  ADD COLUMN IF NOT EXISTS profile_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pinned_trial_plan jsonb,
  ADD COLUMN IF NOT EXISTS expected_result_rows integer;

DO $$
BEGIN
  ALTER TABLE public.eval_runs
    ADD CONSTRAINT eval_runs_profile_id_eval_profiles_id_fk
    FOREIGN KEY (profile_id) REFERENCES public.eval_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS trial_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_input_tokens integer,
  ADD COLUMN IF NOT EXISTS agent_output_tokens integer,
  ADD COLUMN IF NOT EXISTS agent_cost_usd numeric(12, 6);

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS quality_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS rewritten_from_id text;

DO $$
BEGIN
  ALTER TABLE public.eval_test_cases
    ADD CONSTRAINT eval_test_cases_quality_state_check
    CHECK (quality_state IN ('active', 'retired', 'needs-revision'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: one default profile per existing tenant. Values mirror the
-- code defaults (DEFAULT_EVAL_MODEL_ID in packages/api/src/lib/evals/
-- eval-defaults.ts; judge_model null = deployed default; trials 1). The
-- API's get-or-create resolution seam covers tenants provisioned after
-- this migration and heals any drift between this literal and the code
-- constant.
INSERT INTO public.eval_profiles (tenant_id, name, model, judge_model, trials, is_default)
SELECT t.id, 'Default', 'moonshotai.kimi-k2.5', NULL, 1, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.eval_profiles p
  WHERE p.tenant_id = t.id AND p.is_default = true
);

COMMIT;
