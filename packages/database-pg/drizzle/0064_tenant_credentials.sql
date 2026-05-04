-- Tenant-shared credential vault for routines and integrations.
--
-- Secret values live in AWS Secrets Manager. This table stores only
-- non-secret metadata, lifecycle state, and derived runtime references.
--
-- Plan:
--   docs/plans/2026-05-04-002-feat-tenant-credential-vault-routine-migration-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0064_tenant_credentials.sql
--
-- creates: public.tenant_credentials
-- creates: public.uq_tenant_credentials_slug
-- creates: public.idx_tenant_credentials_tenant
-- creates: public.idx_tenant_credentials_status

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.tenant_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  display_name text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  secret_ref text NOT NULL,
  eventbridge_connection_arn text,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_used_at timestamp with time zone,
  last_validated_at timestamp with time zone,
  created_by_user_id uuid REFERENCES public.users(id),
  deleted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_credentials_kind_enum CHECK (
    kind IN (
      'api_key',
      'bearer_token',
      'basic_auth',
      'soap_partner',
      'webhook_signing_secret',
      'json'
    )
  ),
  CONSTRAINT tenant_credentials_status_enum CHECK (
    status IN ('active', 'disabled', 'deleted')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_credentials_slug
  ON public.tenant_credentials (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_tenant_credentials_tenant
  ON public.tenant_credentials (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_credentials_status
  ON public.tenant_credentials (tenant_id, status);

COMMIT;
