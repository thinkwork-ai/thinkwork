-- creates: public.email_provider_installs_provider_allowed

ALTER TABLE public.email_provider_installs
  DROP CONSTRAINT IF EXISTS email_provider_installs_provider_allowed;

ALTER TABLE public.email_provider_installs
  ADD CONSTRAINT email_provider_installs_provider_allowed
  CHECK (provider IN ('resend', 'sendgrid', 'ses'));

