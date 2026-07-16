-- THINK-302 U3b: per-tenant capability registry-trust gate (KTD-8).
--
-- Off for every tenant at migration time; flipped on per tenant
-- (dev → TEI → McPherson) as the capability approval registry replaces
-- per-folder sidecar signatures. Read by the workspace renderer
-- (compose-tuple) to decide registry-trust vs legacy sidecar admission.
--
-- Additive, idempotent column add. Hand-rolled only so it carries a
-- drift-gate marker alongside the sibling hand-rolled capability migrations;
-- db:push would also add it from the ORM definition.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0259_tenant_capability_registry_trust.sql
-- creates-column: public.tenants.capability_registry_trust

\set ON_ERROR_STOP on

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS capability_registry_trust boolean NOT NULL DEFAULT false;
