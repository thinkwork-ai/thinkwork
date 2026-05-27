DROP TRIGGER IF EXISTS spaces_email_trigger_status_sync ON public.spaces;

DROP FUNCTION IF EXISTS public.sync_space_email_trigger_status();

ALTER TABLE public.spaces
  DROP CONSTRAINT IF EXISTS spaces_email_trigger_status_allowed;

ALTER TABLE public.spaces
  DROP COLUMN IF EXISTS email_trigger_status;
