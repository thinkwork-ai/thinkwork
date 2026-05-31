-- creates: public.uq_thread_turns_mobile_client_turn
--
-- Plan: docs/plans/2026-05-31-001-feat-mobile-pi-agentcore-background-handoff-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0139_mobile_turn_client_id.sql
--
-- Mobile Pi starts a durable thread_turn before local execution begins. The
-- clientTurnId is an idempotency token, not authorization, and is stored in
-- thread_turns.external_run_id. Scope the unique key narrowly to mobile Pi
-- turns so existing AgentCore/desktop uses of external_run_id are unchanged.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_turns_mobile_client_turn
  ON public.thread_turns (tenant_id, thread_id, external_run_id)
  WHERE invocation_source = 'mobile_pi'
    AND external_run_id IS NOT NULL;

COMMIT;
