-- THINK-153 U1: tenant-scoped document plate registry.
-- Platform plates are code-defined (packages/api plate-definitions.ts);
-- this table stores only tenant deltas (origin = 'platform_override') and
-- tenant-created plates (origin = 'tenant'). Additive — safe to apply ahead
-- of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0218_document_plates.sql
-- creates: public.document_plates

CREATE TABLE IF NOT EXISTS public.document_plates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  origin text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_plates_origin_check
    CHECK (origin IN ('platform_override', 'tenant')),
  CONSTRAINT document_plates_slug_check
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS document_plates_tenant_slug_uidx
  ON public.document_plates (tenant_id, slug);

CREATE INDEX IF NOT EXISTS document_plates_tenant_idx
  ON public.document_plates (tenant_id);
