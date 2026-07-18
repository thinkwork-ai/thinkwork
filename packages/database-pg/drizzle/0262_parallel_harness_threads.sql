-- creates: public.idx_harness_enrollment_active_profile
-- Allow multiple normal Composer threads to remain pinned to the same
-- tenant/trust-profile Harness while Pi threads continue independently.

DROP INDEX IF EXISTS public.uq_harness_enrollment_active_profile;

CREATE INDEX IF NOT EXISTS idx_harness_enrollment_active_profile
  ON public.harness_managed_thread_enrollments (tenant_id, trust_profile)
  WHERE status = 'active';
