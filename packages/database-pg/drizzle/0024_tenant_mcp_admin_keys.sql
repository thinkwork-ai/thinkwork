-- tenant_mcp_admin_keys — per-tenant Bearer tokens for the admin-ops MCP server.
--
-- Replaces the shared API_AUTH_SECRET for MCP admin-ops calls. Each tenant
-- has one or more tokens; the admin-ops Lambda hashes the incoming Bearer
-- with SHA-256 and looks it up here to resolve the caller's tenant. Raw
-- tokens are never stored — only the hash + metadata.
--
-- See docs/plans/2026-04-22-shared-admin-ops-library-requirements.md and
-- PR following up on #480 (admin-ops shared package + MCP Lambda).
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0024_tenant_mcp_admin_keys.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - tenants exists.
--   - tenant_mcp_admin_keys does not yet exist.
--     SELECT to_regclass('public.tenant_mcp_admin_keys'); -- must be NULL
--
-- creates: public.tenant_mcp_admin_keys
-- creates: public.uq_tenant_mcp_admin_keys_hash
-- creates: public.uq_tenant_mcp_admin_keys_active_name
-- creates: public.idx_tenant_mcp_admin_keys_tenant

CREATE TABLE "tenant_mcp_admin_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	-- SHA-256 hex digest of the raw token. 64 chars; bytea would be smaller
	-- but text keeps psql/Postgres tooling friendly and there are few rows.
	"key_hash" text NOT NULL,
	-- Human label ("default", "ci", "ops-laptop-eric"). Unique per tenant
	-- among non-revoked rows so operators can re-create a revoked "default".
	"name" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	-- Who created the key. Nullable for break-glass bootstrap via apikey
	-- where no human-user row is attributable.
	"created_by_user_id" uuid,
	-- Bumped on every successful auth by the admin-ops Lambda. Async,
	-- best-effort (failure to update does not block the request).
	"last_used_at" timestamptz,
	-- Soft-delete. NULL = active. Set to now() on revoke; row retained for
	-- audit + to prevent hash reuse. A scheduled GC (future PR) hard-deletes
	-- rows with revoked_at < now() - 90 days.
	"revoked_at" timestamptz
);

-- Global uniqueness on hash — different tenants cannot share a token value
-- (collision probability with SHA-256 is negligible, but makes the lookup
-- path a single-row read regardless of how tenants are partitioned).
CREATE UNIQUE INDEX "uq_tenant_mcp_admin_keys_hash"
	ON "tenant_mcp_admin_keys" ("key_hash");

-- Per-tenant uniqueness on name among active rows. Partial index so a
-- revoked "default" does not block creating a fresh "default".
CREATE UNIQUE INDEX "uq_tenant_mcp_admin_keys_active_name"
	ON "tenant_mcp_admin_keys" ("tenant_id", "name")
	WHERE "revoked_at" IS NULL;

-- Supports listing a tenant's keys ordered by created_at.
CREATE INDEX "idx_tenant_mcp_admin_keys_tenant"
	ON "tenant_mcp_admin_keys" ("tenant_id", "created_at" DESC);
