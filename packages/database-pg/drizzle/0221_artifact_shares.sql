-- THINK-208 U1: public artifact share links.
-- One row per public "anyone with the link" grant on a document artifact.
-- The URL token is an HMAC signature over id — no token material at rest.
-- Revoke-only lifecycle (revoked_at flips the row dead); artifact delete
-- cascades rows away so the link 404s. Additive — safe to apply ahead of
-- code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0221_artifact_shares.sql
-- creates: public.artifact_shares

CREATE TABLE IF NOT EXISTS public.artifact_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id)
);

-- One active public link per artifact (get-or-create dedupe, R4).
CREATE UNIQUE INDEX IF NOT EXISTS artifact_shares_active_artifact_uidx
  ON public.artifact_shares (artifact_id)
  WHERE revoked_at IS NULL;

-- Operator tenant-wide share list.
CREATE INDEX IF NOT EXISTS artifact_shares_tenant_created_idx
  ON public.artifact_shares (tenant_id, created_at);
