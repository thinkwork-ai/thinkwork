-- Rollback only. Apply manually if per-Space email triggers are abandoned.
--
-- drops-column: public.spaces.email_triggers_enabled

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.spaces
  DROP COLUMN IF EXISTS email_triggers_enabled;

COMMIT;
