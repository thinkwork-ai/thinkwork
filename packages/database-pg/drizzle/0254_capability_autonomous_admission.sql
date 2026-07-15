-- Autonomous capability self-extension — admission provenance.
--
-- Adds two columns to capability_definition_versions so an agent-admitted
-- (autonomous) version is distinguishable from an operator-admitted one and
-- stays fully attributable:
--
--   * admission_mode      — 'operator' (human admitted, the default for every
--     existing row) | 'autonomous' (an agent self-admitted an auto-tier
--     public/read-only/no-credential capability with no human).
--   * admitted_by_agent_id — the composing agent for autonomous admissions;
--     null for operator admissions.
--
-- Hand-rolled (additive, nullable/defaulted — safe on live rows). Applied to
-- dev via psql; the deploy migration-drift gate checks the markers below.
--
-- creates-column: public.capability_definition_versions.admission_mode
-- creates-column: public.capability_definition_versions.admitted_by_agent_id

ALTER TABLE public.capability_definition_versions
  ADD COLUMN IF NOT EXISTS admission_mode text NOT NULL DEFAULT 'operator';

ALTER TABLE public.capability_definition_versions
  ADD COLUMN IF NOT EXISTS admitted_by_agent_id uuid;

ALTER TABLE public.capability_definition_versions
  DROP CONSTRAINT IF EXISTS capability_definition_versions_admission_mode_check;
ALTER TABLE public.capability_definition_versions
  ADD CONSTRAINT capability_definition_versions_admission_mode_check
  CHECK (admission_mode IN ('operator', 'autonomous'));
