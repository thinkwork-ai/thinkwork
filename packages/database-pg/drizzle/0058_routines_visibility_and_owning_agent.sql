-- Add visibility + owning_agent_id columns to the routines table
-- (schema follow-up bundle, closing C U11 P2 residual).
--
-- Phase C U11 introduced the create_routine + routine_invoke MCP
-- tools with a visibility check that conflated `agent_id` (the
-- routine's primary execution agent) with "the agent that owns
-- this routine for invocation purposes". This migration splits the
-- two:
--
--   - `owning_agent_id`: the agent that authored / has stewardship.
--   - `visibility`: enum-by-string (kept lower-snake to match the
--     in-code 'agent_private' / 'tenant_shared' literals already
--     baked into admin-ops/checkRoutineVisibility).
--
-- Backfill rule:
--   * agent_id IS NOT NULL → owning_agent_id = agent_id,
--                              visibility = 'agent_private'
--   * agent_id IS NULL    → owning_agent_id = NULL,
--                              visibility = 'tenant_shared'
--
-- This preserves the v0 conflated semantics — every existing routine
-- with an agent stays "private to that agent", every team-scoped
-- routine without an agent stays tenant-wide. The MCP visibility
-- helper switches to read these columns in the same PR so behavior
-- doesn't drift.
--
-- creates-column: public.routines.visibility
-- creates-column: public.routines.owning_agent_id

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'agent_private';

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS owning_agent_id uuid REFERENCES public.agents(id);

-- Backfill existing rows. The default 'agent_private' on the
-- visibility column already covers the agent-owned case; we only
-- need to flip rows without an agent to 'tenant_shared'.
UPDATE public.routines
   SET owning_agent_id = agent_id
 WHERE agent_id IS NOT NULL
   AND owning_agent_id IS NULL;

UPDATE public.routines
   SET visibility = 'tenant_shared'
 WHERE agent_id IS NULL
   AND visibility = 'agent_private';

-- Index for the routine_invoke visibility-check path: lookups go
-- (tenant_id, owning_agent_id) when filtering routines an agent
-- is allowed to invoke.
CREATE INDEX IF NOT EXISTS idx_routines_owning_agent_id
  ON public.routines (tenant_id, owning_agent_id)
  WHERE owning_agent_id IS NOT NULL;

-- CHECK constraint pins the visibility enum at the DB layer so
-- resolvers + the MCP tool can rely on it without joining or
-- re-validating client-side.
ALTER TABLE public.routines
  ADD CONSTRAINT routines_visibility_enum
  CHECK (visibility IN ('agent_private', 'tenant_shared'));
