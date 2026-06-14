-- Purpose: add the per-tenant skill-update gate threshold (Skill Tests &
--          Evals U6). A skill UPDATE whose candidate version scores below
--          this threshold is HELD (the workspace swap is deferred) until an
--          operator applies it once the candidate passes, or overrides. A
--          row's PRESENCE = the gate is enabled for the tenant; no row = no
--          gate (nothing blocks). Initial install is never gated; unrated
--          skills (no bundled cases) are never gated.
-- Plan: docs/plans/2026-06-13-003-feat-skill-tests-and-evals-plan.md (U6)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0166_eval_skill_gate.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- Semantics:
--   * Per-tenant single threshold (v1) — tenant_id is the PRIMARY KEY, so
--     a tenant has at most one gate row. Per-skill thresholds are deferred
--     (this locks the migration shape).
--   * threshold is a fraction in [0, 1] (same scale as eval_runs.pass_rate)
--     guarded by a CHECK so a stray write can't smuggle an out-of-range gate.
--   * No row = no gate; setting null in the API DELETEs the row.
--
-- creates: public.eval_skill_gate
-- creates-constraint: public.eval_skill_gate.eval_skill_gate_tenant_id_tenants_id_fk
-- creates-constraint: public.eval_skill_gate.eval_skill_gate_threshold_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.eval_skill_gate (
  tenant_id uuid PRIMARY KEY
    CONSTRAINT eval_skill_gate_tenant_id_tenants_id_fk REFERENCES public.tenants(id),
  threshold numeric(5, 4) NOT NULL
    CONSTRAINT eval_skill_gate_threshold_check CHECK (threshold >= 0 AND threshold <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
