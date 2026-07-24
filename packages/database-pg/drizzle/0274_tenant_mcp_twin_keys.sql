-- tenant_mcp_twin_keys — per-tenant Bearer keys for the Company Brain MCP
-- server (THINK-333).
--
-- The agent path to /mcp/twin authenticates with a `tkt_`-prefixed key.
-- The mcp-twin handler hashes the incoming Bearer with SHA-256 and looks
-- it up here where revoked_at IS NULL — the matched row IS the tenant
-- selection (no tenant id is embedded in the token, so there is no
-- select-then-verify ambiguity). Raw keys are never stored — only the
-- hash + metadata. Rotation inserts a fresh row and revokes the old one.
--
-- Mirrors tenant_mcp_admin_keys (drizzle/0024) structurally; a separate
-- table so twin revocation never entangles the admin-ops scope.
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0274_tenant_mcp_twin_keys.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants:
--   - tenants exists.
--   - tenant_mcp_twin_keys does not yet exist.
--     SELECT to_regclass('public.tenant_mcp_twin_keys'); -- must be NULL
--
-- creates: public.tenant_mcp_twin_keys
-- creates: public.uq_tenant_mcp_twin_keys_hash
-- creates: public.uq_tenant_mcp_twin_keys_active_name
-- creates: public.idx_tenant_mcp_twin_keys_tenant

CREATE TABLE "tenant_mcp_twin_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	-- SHA-256 hex digest of the raw key. 64 chars; text keeps tooling friendly.
	"key_hash" text NOT NULL,
	-- Human label; "default" for the provisioned connector key.
	"name" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	-- Who created the key. Nullable for service-provisioned keys.
	"created_by_user_id" uuid,
	-- Bumped on every successful auth by the mcp-twin handler. Async,
	-- best-effort (failure to update does not block the request).
	"last_used_at" timestamptz,
	-- Soft-delete. NULL = active. Rotation sets now() on the old row; the
	-- row is retained for audit + to prevent hash reuse.
	"revoked_at" timestamptz
);

-- Global uniqueness on hash — a single-row lookup resolves the tenant.
CREATE UNIQUE INDEX "uq_tenant_mcp_twin_keys_hash"
	ON "tenant_mcp_twin_keys" ("key_hash");

-- Per-tenant uniqueness on name among active rows. Partial index so a
-- rotated/revoked "default" does not block minting a fresh "default".
CREATE UNIQUE INDEX "uq_tenant_mcp_twin_keys_active_name"
	ON "tenant_mcp_twin_keys" ("tenant_id", "name")
	WHERE "revoked_at" IS NULL;

CREATE INDEX "idx_tenant_mcp_twin_keys_tenant"
	ON "tenant_mcp_twin_keys" ("tenant_id", "created_at");
