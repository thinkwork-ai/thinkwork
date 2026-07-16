-- THINK-302 U11: pending_tool_approvals — parked-turn HITL ledger.
--
-- A distinct pending kind from pending_user_questions (KTD-5): a gated tool
-- call parks the turn and this row is the recoverable ledger. Two partial
-- unique indexes drizzle-kit cannot express live here:
--   * one `pending` approval per thread (the one-slot invariant, R32) — so
--     an approval can COEXIST with a pending question (separate tables/slots),
--     and the intake endpoint returns 409 on a second concurrent park.
--   * resume-replay uniqueness (thread_turn_id, tool_call_id, manifest
--     fingerprint) — a stale approval cannot authorize a drifted definition
--     and a retried intake is idempotent.
--
-- Ships INERT: no writer touches this table until U11b; U12 consumes it.
--
-- Hand-rolled (partial indices, CHECK constraints); not in meta/_journal.json.
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0258_pending_tool_approvals.sql
-- creates: public.pending_tool_approvals
-- creates: public.pending_tool_approvals_one_pending_per_thread
-- creates: public.pending_tool_approvals_resume_identity
-- creates: public.idx_pending_tool_approvals_tenant
-- creates: public.idx_pending_tool_approvals_thread_status
-- creates: public.idx_pending_tool_approvals_message
-- creates: public.idx_pending_tool_approvals_purge

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0258_pending_tool_approvals'));

CREATE TABLE IF NOT EXISTS public.pending_tool_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  thread_turn_id uuid NOT NULL REFERENCES public.thread_turns(id),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  manifest_fingerprint text NOT NULL,
  tool_call_id text NOT NULL,
  class text NOT NULL,
  slug text NOT NULL,
  marker_sha text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requesting_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  encrypted_payload text,
  display_summary jsonb NOT NULL,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  answered_via text,
  answered_at timestamptz,
  payload_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_tool_approvals_status_allowed
    CHECK (status IN ('pending','approved','denied','cancelled')),
  CONSTRAINT pending_tool_approvals_answered_via_allowed
    CHECK (answered_via IS NULL OR answered_via IN ('card','slack','governance','archive','reaper')),
  CONSTRAINT pending_tool_approvals_terminal_consistency
    CHECK ((status = 'pending') = (answered_at IS NULL))
);

-- One pending approval per thread (the one-slot invariant). Partial so
-- terminal rows never block a new park, and so it is INDEPENDENT of the
-- pending_user_questions slot (an approval + a question can both be pending).
CREATE UNIQUE INDEX IF NOT EXISTS pending_tool_approvals_one_pending_per_thread
  ON public.pending_tool_approvals (thread_id)
  WHERE status = 'pending';

-- Resume-replay identity: a park is unique per (turn, tool call, pinned
-- manifest) so a retried intake is idempotent and a stale approval cannot
-- authorize a drifted definition.
CREATE UNIQUE INDEX IF NOT EXISTS pending_tool_approvals_resume_identity
  ON public.pending_tool_approvals (thread_turn_id, tool_call_id, manifest_fingerprint);

CREATE INDEX IF NOT EXISTS idx_pending_tool_approvals_tenant
  ON public.pending_tool_approvals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pending_tool_approvals_thread_status
  ON public.pending_tool_approvals (thread_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_tool_approvals_message
  ON public.pending_tool_approvals (message_id);
-- Reaper scan: terminal rows whose payload is not yet purged, by age.
CREATE INDEX IF NOT EXISTS idx_pending_tool_approvals_purge
  ON public.pending_tool_approvals (status, payload_purged_at);

SELECT pg_advisory_unlock(hashtext('migration:0258_pending_tool_approvals'));
