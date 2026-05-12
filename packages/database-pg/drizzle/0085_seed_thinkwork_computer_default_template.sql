-- creates: public.view_thinkwork_computer_default_template_seeded
--
-- U1 (R3/R10) — Seed the platform-default Computer template that
-- `provisionComputerForMember` resolves by slug when auto-provisioning a
-- newly-added tenant member. Tenant-id NULL = platform-wide; every tenant
-- can resolve it because `requireComputerTemplate` accepts NULL-tenant rows.
--
-- See docs/plans/2026-05-11-003-feat-computer-admin-crud-plan.md (U1).
-- The brainstorm's R3 says auto-provision must work day-one with zero admin
-- configuration; this seed makes that true on a fresh tenant.
--
-- The marker view exists solely to give scripts/db-migrate-manual.sh
-- something to verify — the drift reporter cannot probe for data rows. The
-- view returns 1 row when the seed has been applied. Same pattern as
-- 0022_seed_thinkwork_admin_permissions.sql.
--
-- Apply manually (matches the 0019/0020/0022 convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0085_seed_thinkwork_computer_default_template.sql
--
-- This file is frozen. If the default template's attributes need to change
-- (e.g., model upgrade), ship a new migration that UPDATEs the row — do not
-- edit this one.

-- Guarded insert. The unique index uq_agent_templates_tenant_slug is on
-- (tenant_id, slug), but Postgres treats NULL values as distinct in unique
-- indexes by default — so ON CONFLICT against a NULL tenant_id row will
-- never match. Use WHERE NOT EXISTS for idempotency instead.
INSERT INTO agent_templates (tenant_id, name, slug, template_kind, source, model, config)
SELECT
  NULL,
  'Thinkwork Computer',
  'thinkwork-computer-default',
  'computer',
  'system',
  'us.anthropic.claude-sonnet-4-20250514-v1:0',
  '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agent_templates
   WHERE slug = 'thinkwork-computer-default'
     AND tenant_id IS NULL
     AND template_kind = 'computer'
);

CREATE OR REPLACE VIEW public.view_thinkwork_computer_default_template_seeded AS
SELECT id, slug, template_kind, source
  FROM agent_templates
 WHERE slug = 'thinkwork-computer-default'
   AND tenant_id IS NULL
   AND template_kind = 'computer';
