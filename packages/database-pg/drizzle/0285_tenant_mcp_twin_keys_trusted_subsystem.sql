-- Trusted-subsystem marker on tenant_mcp_twin_keys (THINK-626) — the write
-- side of the `trustedSubsystem` field in key manifest v2
-- (twin-mcp-keys/v2; reader is company-brain brain-mcp/src/auth.ts).
--
-- true lets the key assert `on_behalf_of` per tools/call — running the call
-- under the named signed-in human's user-claims entry instead of under the
-- key's own grants. It is NOT a grant and it can never widen anyone: the
-- asserted user's grants come from the user-claims manifest, and a tenant
-- that publishes none refuses the assertion. It belongs only on keys the
-- platform itself holds (the Pi runtime's provisioned "default" connector
-- key), never on one handed to a customer's client — hence default false
-- and no backfill for user-minted rows.
--
-- Hand-rolled (mirrors the 0274/0281/0282 convention; not registered in
-- meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0285_tenant_mcp_twin_keys_trusted_subsystem.sql
-- creates-column: public.tenant_mcp_twin_keys.trusted_subsystem

ALTER TABLE public.tenant_mcp_twin_keys
  ADD COLUMN IF NOT EXISTS trusted_subsystem boolean NOT NULL DEFAULT false;

-- The platform-provisioned connector key ("default") is the ThinkWork Pi
-- runtime's own key — the one and only principal that may speak for a
-- signed-in human. Grandfather every active one; re-provisioning would set
-- the same flag anyway. User-minted keys stay false.
UPDATE public.tenant_mcp_twin_keys
   SET trusted_subsystem = true
 WHERE name = 'default'
   AND revoked_at IS NULL
   AND trusted_subsystem = false;
