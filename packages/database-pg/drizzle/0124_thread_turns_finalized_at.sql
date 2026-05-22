-- creates-column: public.thread_turns.finalized_at
--
-- chat-agent-invoke direct-callback finalize architecture (plan
-- 2026-05-22-006). The new chat-agent-finalize Lambda handler keys on
-- thread_turns.finalized_at to enforce idempotency: when the Strands runtime
-- POSTs the same turn_id twice (transient network failure → retry), the
-- second call detects finalized_at IS NOT NULL and returns
-- {idempotent: true} without re-running the cost / message-insert /
-- notify side-effects.

\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE public.thread_turns
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

COMMIT;
