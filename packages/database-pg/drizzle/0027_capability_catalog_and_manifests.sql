-- Resolved Capability Manifest schema — U15 part 1/3 of plan #007.
--
-- Lands two tables inert (no runtime capture yet):
--   capability_catalog           — unified skill / tool / mcp-server registry
--   resolved_capability_manifests — append-only per-session audit
--
-- Plus a conservative backfill:
--   - Every existing skill_catalog row becomes a capability_catalog row
--     with type='skill', source='builtin'.
--   - Six built-in tools are seeded with type='tool', source='builtin'
--     (execute_code, web_search, recall, reflect, artifacts, Skill).
--
-- U15 part 2 wires container-sources/capability_manifest.py + POST to
-- /api/runtime/manifests. Part 3 flips SI-7 enforcement on at
-- Agent(tools=...) construction.
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0027_capability_catalog_and_manifests.sql
--
-- Drift detection: pnpm db:migrate-manual
--
-- creates: public.capability_catalog
-- creates: public.resolved_capability_manifests
-- creates: public.uq_capability_catalog_type_source_slug
-- creates: public.idx_capability_catalog_type
-- creates: public.idx_capability_catalog_source
-- creates: public.idx_rcm_tenant
-- creates: public.idx_rcm_agent
-- creates: public.idx_rcm_template
-- creates: public.idx_rcm_created_at

-- ---------------------------------------------------------------------------
-- Pre-flight guards — fail loudly on a partially-migrated DB.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION '0027: public.tenants is missing — refusing to apply';
  END IF;
  IF to_regclass('public.agents') IS NULL THEN
    RAISE EXCEPTION '0027: public.agents is missing — refusing to apply';
  END IF;
  IF to_regclass('public.skill_catalog') IS NULL THEN
    RAISE EXCEPTION '0027: public.skill_catalog is missing — refusing to apply (U3 / migration 0025 must land first)';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- capability_catalog — unified capability registry (plan §U15).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "capability_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "type" text NOT NULL,
  "source" text NOT NULL,
  "implementation_ref" jsonb,
  "spec" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Domain constraint on type. CHECK rather than pgEnum for the same
-- reasons cited in 0025 (portable, no enum-rename grief, small set).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_catalog_type_allowed'
      AND conrelid = 'public.capability_catalog'::regclass
  ) THEN
    ALTER TABLE "capability_catalog"
      ADD CONSTRAINT "capability_catalog_type_allowed"
      CHECK ("type" IN ('skill', 'tool', 'mcp-server'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'capability_catalog_source_allowed'
      AND conrelid = 'public.capability_catalog'::regclass
  ) THEN
    ALTER TABLE "capability_catalog"
      ADD CONSTRAINT "capability_catalog_source_allowed"
      CHECK ("source" IN ('builtin', 'tenant-library', 'community'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_capability_catalog_type_source_slug"
  ON "capability_catalog" ("type", "source", "slug");

CREATE INDEX IF NOT EXISTS "idx_capability_catalog_type"
  ON "capability_catalog" ("type");

CREATE INDEX IF NOT EXISTS "idx_capability_catalog_source"
  ON "capability_catalog" ("source");

-- ---------------------------------------------------------------------------
-- resolved_capability_manifests — per-session audit (plan §U15).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "resolved_capability_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" text NOT NULL,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "template_id" uuid,
  "user_id" uuid,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "manifest_json" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_rcm_tenant"
  ON "resolved_capability_manifests" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_rcm_agent"
  ON "resolved_capability_manifests" ("agent_id");

CREATE INDEX IF NOT EXISTS "idx_rcm_template"
  ON "resolved_capability_manifests" ("template_id");

-- created_at index powers the 30-day TTL sweep + admin "last N manifests"
-- queries — both are ORDER BY created_at DESC LIMIT N.
CREATE INDEX IF NOT EXISTS "idx_rcm_created_at"
  ON "resolved_capability_manifests" ("created_at" DESC);

-- ---------------------------------------------------------------------------
-- Backfill: every skill_catalog row becomes a capability_catalog row.
-- Idempotent via ON CONFLICT on the (type, source, slug) unique index —
-- re-running the migration is a no-op on already-seeded installations.
-- ---------------------------------------------------------------------------

INSERT INTO "capability_catalog" ("slug", "type", "source", "implementation_ref", "spec", "created_at", "updated_at")
SELECT
  sc."slug",
  'skill' AS "type",
  CASE sc."source"
    WHEN 'builtin'   THEN 'builtin'
    WHEN 'community' THEN 'community'
    ELSE 'tenant-library'
  END AS "source",
  NULL::jsonb AS "implementation_ref",
  jsonb_build_object(
    'display_name', sc."display_name",
    'description', sc."description",
    'category', sc."category",
    'version', sc."version",
    'execution', sc."execution",
    'mode', sc."mode"
  ) AS "spec",
  sc."created_at",
  sc."updated_at"
FROM "skill_catalog" sc
ON CONFLICT ("type", "source", "slug") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: six built-in tools the Strands container currently hard-codes.
-- implementation_ref points at the Python module that owns the tool. U15
-- part 3 enforces SI-7 — the runtime will refuse to register a built-in
-- that is not present in this table.
-- ---------------------------------------------------------------------------

INSERT INTO "capability_catalog" ("slug", "type", "source", "implementation_ref", "spec")
VALUES
  (
    'execute_code', 'tool', 'builtin',
    jsonb_build_object('module_path', 'sandbox_tool', 'class_name', 'ExecuteCodeTool'),
    jsonb_build_object(
      'display_name', 'Execute Code',
      'description', 'Run Python / bash / node in the per-session AgentCore Code Sandbox.'
    )
  ),
  (
    'web_search', 'tool', 'builtin',
    jsonb_build_object('module_path', 'strands_tools', 'class_name', 'web_search'),
    jsonb_build_object(
      'display_name', 'Web Search',
      'description', 'Query the web via the managed Strands search tool.'
    )
  ),
  (
    'recall', 'tool', 'builtin',
    jsonb_build_object('module_path', 'memory_tools', 'class_name', 'recall'),
    jsonb_build_object(
      'display_name', 'Recall',
      'description', 'Read from the agent''s memory engine (managed / Hindsight).'
    )
  ),
  (
    'reflect', 'tool', 'builtin',
    jsonb_build_object('module_path', 'memory_tools', 'class_name', 'reflect'),
    jsonb_build_object(
      'display_name', 'Reflect',
      'description', 'Write a reflective note into the agent''s memory engine.'
    )
  ),
  (
    'artifacts', 'tool', 'builtin',
    jsonb_build_object('module_path', 'artifact_tools', 'class_name', 'ArtifactsTool'),
    jsonb_build_object(
      'display_name', 'Artifacts',
      'description', 'Emit a structured artifact for the admin UI to render.'
    )
  ),
  (
    'Skill', 'tool', 'builtin',
    jsonb_build_object('module_path', 'skill_meta_tool', 'class_name', 'Skill'),
    jsonb_build_object(
      'display_name', 'Skill (meta-tool)',
      'description', 'Invoke any skill available in the session allowlist.'
    )
  )
ON CONFLICT ("type", "source", "slug") DO NOTHING;
