-- Bootstrap first-admin claim markers.
--
-- creates-column: public.tenants.first_admin_claim_required
-- creates-column: public.tenants.first_admin_claimed_at
-- creates-column: public.tenants.first_admin_claimed_user_id

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "first_admin_claim_required" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "first_admin_claimed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "first_admin_claimed_user_id" uuid;

