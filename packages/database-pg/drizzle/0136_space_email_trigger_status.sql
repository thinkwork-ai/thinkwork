-- creates-column: public.spaces.email_trigger_status
-- creates-constraint: public.spaces.spaces_email_trigger_status_allowed
-- creates-function: public.sync_space_email_trigger_status
-- creates-trigger: public.spaces.spaces_email_trigger_status_sync

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS email_trigger_status text;

UPDATE public.spaces
   SET email_trigger_status = CASE
     WHEN email_triggers_enabled IS TRUE THEN 'enabled'
     ELSE 'none'
   END
 WHERE email_trigger_status IS NULL;

ALTER TABLE public.spaces
  ALTER COLUMN email_trigger_status SET DEFAULT 'none';

ALTER TABLE public.spaces
  ALTER COLUMN email_trigger_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'spaces_email_trigger_status_allowed'
       AND conrelid = 'public.spaces'::regclass
  ) THEN
    ALTER TABLE public.spaces
      ADD CONSTRAINT spaces_email_trigger_status_allowed
      CHECK (email_trigger_status IN ('none','disabled','enabled'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_space_email_trigger_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email_trigger_status IS NOT DISTINCT FROM OLD.email_trigger_status
     AND NEW.email_triggers_enabled IS DISTINCT FROM OLD.email_triggers_enabled THEN
    NEW.email_trigger_status := CASE
      WHEN NEW.email_triggers_enabled IS TRUE THEN 'enabled'
      ELSE 'disabled'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spaces_email_trigger_status_sync ON public.spaces;

CREATE TRIGGER spaces_email_trigger_status_sync
BEFORE UPDATE OF email_triggers_enabled ON public.spaces
FOR EACH ROW
EXECUTE FUNCTION public.sync_space_email_trigger_status();

COMMIT;
