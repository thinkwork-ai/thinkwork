-- 0266_auth_identity_recovery_grants.sql
-- creates-constraint: public.auth_identity_enrollments.auth_identity_enrollments_grant_kind_allowed

ALTER TABLE public.auth_identity_enrollments
  DROP CONSTRAINT IF EXISTS auth_identity_enrollments_grant_kind_allowed;

ALTER TABLE public.auth_identity_enrollments
  ADD CONSTRAINT auth_identity_enrollments_grant_kind_allowed
  CHECK (recipient_grant_kind IN ('membership', 'pending_owner', 'identity_recovery', 'session_migration'));
