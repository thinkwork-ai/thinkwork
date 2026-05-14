-- Seed every tenant's `tenant_workflow_catalog` with the v1 baseline catalog
-- so the apps/computer Customize page has real Available rows to render.
-- Idempotent via ON CONFLICT(tenant_id, slug) DO NOTHING — re-running this
-- script never duplicates.
--
-- Plan:
--   docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md (U10)
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0079_seed_tenant_customize_catalog.sql
--
-- The data mirrors the workflow fixture catalog that previously lived in
-- apps/computer/src/components/customize/customize-fixtures.ts so the live
-- queries (U4 / U6) render the same shape the user already saw on the
-- inert page. Per-tenant variation can be added by INSERTing rows with a
-- specific tenant_id; the SELECT-from-tenants below is the convenient
-- "every tenant gets the v1 baseline" path.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── Workflows ─────────────────────────────────────────────────────────────

WITH baseline_workflows(slug, display_name, description, category) AS (
  VALUES
    ('daily-standup-digest',         'Daily standup digest',         'Summarize yesterday''s work and today''s plan from assigned work sources.', 'Engineering'),
    ('customer-health-refresh',      'Customer health refresh',      'Recompute health scores nightly across the active book of business.', 'Customer Success'),
    ('renewal-pipeline-sweep',       'Renewal pipeline sweep',       'Surface upcoming renewals every Monday with risk callouts.',         'Sales'),
    ('new-lead-triage',              'New lead triage',              'Score and route inbound leads to the right account exec.',           'Sales'),
    ('weekly-sales-brief',           'Weekly sales brief',           'Friday wrap-up: pipeline movement, wins, blocked deals.',            'Sales'),
    ('support-incident-postmortem',  'Support incident postmortem',  'Draft a postmortem after every P0/P1 support escalation.',           'Customer Success'),
    ('weekly-product-changelog',     'Weekly product changelog',     'Generate a customer-facing changelog from merged PRs.',              'Product')
)
INSERT INTO public.tenant_workflow_catalog
  (tenant_id, slug, display_name, description, category, default_config, status, enabled)
SELECT
  t.id,
  bw.slug,
  bw.display_name,
  bw.description,
  bw.category,
  '{}'::jsonb,
  'active',
  true
FROM public.tenants t
CROSS JOIN baseline_workflows bw
ON CONFLICT (tenant_id, slug) DO NOTHING;

COMMIT;
