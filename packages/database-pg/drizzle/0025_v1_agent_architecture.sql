-- V1 agent-architecture — additive schema (U3 of plan #007).
--
-- Ships the persistence layer the V1 plan needs in Phase 1. Strictly additive:
-- no column drops, no existing-data rewrites (except column defaults on new
-- columns). U6 drops `skill_catalog.execution` + `mode` via a separate later
-- migration once the runtime cutover is complete.
--
-- See docs/plans/2026-04-23-007-feat-v1-agent-architecture-final-call-plan.md
-- §Implementation Units → U3.
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0025_v1_agent_architecture.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariants (enforced by the to_regclass guards below):
--   - tenants exists
--   - tenant_mcp_servers exists
--   - plugin_uploads does NOT yet exist
--     SELECT to_regclass('public.plugin_uploads'); -- must be NULL
--
-- creates: public.plugin_uploads
-- creates: public.idx_plugin_uploads_tenant
-- creates: public.idx_plugin_uploads_status
-- creates-column: public.plugin_uploads.id
-- creates-column: public.tenant_mcp_servers.status
-- creates-column: public.tenant_mcp_servers.url_hash
-- creates-column: public.tenant_mcp_servers.approved_by
-- creates-column: public.tenant_mcp_servers.approved_at
-- creates-column: public.tenants.disabled_builtin_tools

-- ---------------------------------------------------------------------------
-- Pre-flight: fail loudly on missing pre-state. Without these guards a
-- partially-migrated DB can silently absorb a migration meant for a later
-- snapshot. Pattern mirrors 0023 / 0024.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION '0025: public.tenants is missing — refusing to apply';
  END IF;
  IF to_regclass('public.tenant_mcp_servers') IS NULL THEN
    RAISE EXCEPTION '0025: public.tenant_mcp_servers is missing — refusing to apply';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- tenants.disabled_builtin_tools — per-tenant kill switches (plan R6, R7).
--
-- JSONB array of built-in tool slugs the tenant has disabled globally. Empty
-- array = all built-ins available (subject to template blocks). Runtime
-- honors at session construction; template blocks intersect (narrow-only) —
-- a template cannot unblock what the tenant disabled.
--
-- Admin UI to edit this column defers per §Scope Boundaries → Deferred to
-- Follow-Up Work; until then operators flip the column via DB mutation.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "disabled_builtin_tools" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- tenant_mcp_servers — admin-approval gate for bundled MCP endpoints (plan R8).
--
-- Mirrors the existing user_mcp_tokens.status pattern: an MCP server shipped
-- inside an uploaded plugin registers as 'pending' and requires admin action
-- before any agent can invoke it. Existing rows default to 'approved' so this
-- migration cannot accidentally revoke working integrations (plan: "No
-- existing agent loses MCP").
--
-- url_hash pins (url, auth_config) at approval time; any mutation to either
-- field MUST revert status to 'pending' (enforced in the API resolver in
-- U11, not at the DB layer — keeps the invariant debuggable from the
-- application).
-- ---------------------------------------------------------------------------

ALTER TABLE "tenant_mcp_servers"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'approved';

ALTER TABLE "tenant_mcp_servers"
  ADD COLUMN IF NOT EXISTS "url_hash" text;

ALTER TABLE "tenant_mcp_servers"
  ADD COLUMN IF NOT EXISTS "approved_by" uuid;

ALTER TABLE "tenant_mcp_servers"
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;

-- Narrow the status column domain. CHECK rather than a pgEnum because:
--   (a) enums ship with their own migration headaches (renames are fiddly),
--   (b) the set is small and unlikely to grow,
--   (c) pattern-matches existing text-column invariants in this schema
--       (compliance_tier, billing statuses, etc).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_mcp_servers_status_allowed'
      AND conrelid = 'public.tenant_mcp_servers'::regclass
  ) THEN
    ALTER TABLE "tenant_mcp_servers"
      ADD CONSTRAINT "tenant_mcp_servers_status_allowed"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- plugin_uploads — audit of tenant self-serve plugin uploads (plan R1, R2).
--
-- Every POST /api/plugins/upload writes a row in phase 1 of the three-phase
-- saga (plan §U10 Approach). Survives saga failures as the durable audit of
-- what was attempted; a background sweeper reaps orphaned staging > 1h.
--
-- Columns:
--   - id:                 server-generated PK
--   - tenant_id:          owning tenant (FK to tenants)
--   - uploaded_by:        the admin user who initiated the upload
--   - uploaded_at:        wall-clock timestamp of phase-1 insert
--   - bundle_sha256:      content hash of the zip; lets the saga detect
--                         idempotent re-uploads without re-running phases 2/3
--   - plugin_name:        parsed from plugin.json (`name`)
--   - plugin_version:     parsed from plugin.json (`version`) when present
--   - status:             'staging' | 'installed' | 'failed'
--   - s3_staging_prefix:  intermediate upload key before phase-2 rename
--   - error_message:      populated on failure, null on success
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "plugin_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "bundle_sha256" text NOT NULL,
  "plugin_name" text NOT NULL,
  "plugin_version" text,
  "status" text NOT NULL DEFAULT 'staging',
  "s3_staging_prefix" text,
  "error_message" text
);

-- Status domain. Same rationale as tenant_mcp_servers above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plugin_uploads_status_allowed'
      AND conrelid = 'public.plugin_uploads'::regclass
  ) THEN
    ALTER TABLE "plugin_uploads"
      ADD CONSTRAINT "plugin_uploads_status_allowed"
      CHECK ("status" IN ('staging', 'installed', 'failed'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "idx_plugin_uploads_tenant"
  ON "plugin_uploads" ("tenant_id");

-- Partial index on status — the sweeper that reaps orphan staging rows > 1h
-- old scans `WHERE status = 'staging'`, a tiny fraction of total rows.
CREATE INDEX IF NOT EXISTS "idx_plugin_uploads_status"
  ON "plugin_uploads" ("status", "uploaded_at")
  WHERE "status" = 'staging';

-- ---------------------------------------------------------------------------
-- Slug renames — per U1 census bucket `needs-explicit-migration`.
--
-- The U1 census (docs/plans/2026-04-23-007-feat-v1-agent-architecture-final-
-- call-plan.census.md) reports zero slugs in this bucket as of 2026-04-24,
-- so this block is intentionally empty. The comment stays so a future run
-- that does require slug renames has the pattern documented inline rather
-- than rediscovered from the plan:
--
--   UPDATE "skill_catalog" SET "slug" = "slug" || '-legacy'
--   WHERE "slug" IN ('<old1>', '<old2>');
--   UPDATE "agent_skills"  SET "skill_id" = "skill_id" || '-legacy'
--   WHERE "skill_id" IN ('<old1>', '<old2>');
-- ---------------------------------------------------------------------------
