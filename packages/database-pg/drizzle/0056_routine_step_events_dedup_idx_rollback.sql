-- Rollback for 0056_routine_step_events_dedup_idx.sql
DROP INDEX IF EXISTS public.idx_routine_step_events_dedup;
