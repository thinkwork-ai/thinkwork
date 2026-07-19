-- 0265_require_fully_valid_auth_publication.sql
-- Partially validated providers must never be published or admitted. Existing
-- rows are unpublished before the stricter canonical constraint is installed.
-- creates-constraint: public.auth_provider_resources.auth_provider_resources_no_public_without_valid

BEGIN;

UPDATE public.auth_provider_resources
SET public_options_published = false,
    updated_at = now()
WHERE public_options_published = true
  AND validation_status <> 'valid';

ALTER TABLE public.auth_provider_resources
  DROP CONSTRAINT IF EXISTS auth_provider_resources_no_public_without_valid;

ALTER TABLE public.auth_provider_resources
  ADD CONSTRAINT auth_provider_resources_no_public_without_valid
  CHECK (
    public_options_published = false
    OR (
      validation_status = 'valid'
      AND lifecycle_state <> 'denied'
    )
  );

COMMIT;
