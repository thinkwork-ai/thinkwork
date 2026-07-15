-- Governed autonomy U3 follow-up: the autonomous self-promotion path stamps
-- approval_mode='autonomous', but 0247's CHECK only allowed
-- ('operator','repair') — every live self_promote_routine failed with a
-- check-constraint violation (first observed dev 2026-07-15, proposal
-- 88225e66). Recreate the CHECK with the autonomous mode included.
--
-- Hand-rolled (constraint recreation): apply via
--   psql "$DATABASE_URL" -f drizzle/0255_capability_autonomous_approval_mode.sql
-- creates: public.capability_routine_proposals_approval_mode_check

ALTER TABLE public.capability_routine_proposals
  DROP CONSTRAINT IF EXISTS capability_routine_proposals_approval_mode_check;

ALTER TABLE public.capability_routine_proposals
  ADD CONSTRAINT capability_routine_proposals_approval_mode_check
  CHECK (approval_mode IS NULL OR approval_mode IN ('operator', 'repair', 'autonomous'));
