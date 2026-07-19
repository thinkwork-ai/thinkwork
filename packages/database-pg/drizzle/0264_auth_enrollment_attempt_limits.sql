-- Cap recipient-challenge guesses across every route for an enrollment grant.
-- creates-column: public.auth_identity_enrollments.failed_attempts
-- creates-column: public.auth_identity_enrollments.locked_at
-- creates-constraint: public.auth_identity_enrollments.auth_identity_enrollments_failed_attempts_nonnegative

ALTER TABLE public.auth_identity_enrollments
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

ALTER TABLE public.auth_identity_enrollments
  DROP CONSTRAINT IF EXISTS auth_identity_enrollments_failed_attempts_nonnegative;

ALTER TABLE public.auth_identity_enrollments
  ADD CONSTRAINT auth_identity_enrollments_failed_attempts_nonnegative
  CHECK (failed_attempts >= 0);
