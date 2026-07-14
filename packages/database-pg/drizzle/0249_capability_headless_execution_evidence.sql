-- THINK-280 U7: capability-headless execution evidence chain.
--
-- Additive nullable columns that let the execution-detail UI reconstruct the
-- full evidence chain of a governed capability-headless Routine run WITHOUT an
-- AWS call: the exact resolved dependency manifest (twcap + contract hashes),
-- the config/manifest fingerprint checked at preflight, the readiness verdict,
-- operator remediation for a blocked/degraded run, the minted broker-session
-- evidence row, and per-step broker-call / artifact linkage.
--
-- Broker call/session evidence itself already lives in
-- capability_broker_calls / capability_broker_sessions (migration 0247); these
-- columns are the join anchors + the run-level preflight verdict the broker
-- tables do not carry. All columns are NULL on every legacy git_python /
-- user-run-as / Step Functions execution and step — the capability-headless
-- executor is the only writer.
--
-- Hand-rolled additive columns (not in meta/_journal.json). Apply with:
-- psql "$DATABASE_URL" -f <this file>.
-- creates-column: public.routine_executions.capability_dependencies_json
-- creates-column: public.routine_executions.config_fingerprint
-- creates-column: public.routine_executions.readiness_outcome
-- creates-column: public.routine_executions.remediation_json
-- creates-column: public.routine_executions.broker_session_id
-- creates-column: public.routine_step_events.broker_call_id
-- creates-column: public.routine_step_events.artifact_id

BEGIN;

ALTER TABLE public.routine_executions
  ADD COLUMN IF NOT EXISTS capability_dependencies_json jsonb,
  ADD COLUMN IF NOT EXISTS config_fingerprint text,
  ADD COLUMN IF NOT EXISTS readiness_outcome text,
  ADD COLUMN IF NOT EXISTS remediation_json jsonb,
  ADD COLUMN IF NOT EXISTS broker_session_id uuid;

ALTER TABLE public.routine_step_events
  ADD COLUMN IF NOT EXISTS broker_call_id uuid,
  ADD COLUMN IF NOT EXISTS artifact_id uuid;

COMMIT;
