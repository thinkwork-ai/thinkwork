-- Rollback for 0058_routines_visibility_and_owning_agent.sql.

ALTER TABLE public.routines DROP CONSTRAINT IF EXISTS routines_visibility_enum;
DROP INDEX IF EXISTS public.idx_routines_owning_agent_id;
ALTER TABLE public.routines DROP COLUMN IF EXISTS owning_agent_id;
ALTER TABLE public.routines DROP COLUMN IF EXISTS visibility;
