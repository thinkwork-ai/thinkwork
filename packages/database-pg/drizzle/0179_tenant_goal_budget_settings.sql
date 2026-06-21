-- Tenant-level default token budget for composer-launched Pi goal mode.
-- Plan: docs/plans/2026-06-18-001-feat-pi-goal-composer-mode-plan.md (U7).
--
-- creates-column: public.tenant_settings.goal_default_token_budget
-- creates-constraint: public.tenant_settings.tenant_settings_goal_default_token_budget_check

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS goal_default_token_budget integer;

ALTER TABLE public.tenant_settings
  DROP CONSTRAINT IF EXISTS tenant_settings_goal_default_token_budget_check;

ALTER TABLE public.tenant_settings
  ADD CONSTRAINT tenant_settings_goal_default_token_budget_check
  CHECK (
    goal_default_token_budget IS NULL
    OR (
      goal_default_token_budget > 0
      AND goal_default_token_budget <= 2000000
    )
  );
