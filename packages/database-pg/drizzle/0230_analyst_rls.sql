-- 0230_analyst_rls.sql
--
-- THINK-234: row-level tenant scoping for the ThinkWork Analyst.
--
-- 0227 gave `analyst_reader` a per-table SELECT surface but no row filter —
-- a granted table exposed EVERY tenant's rows. This migration adds the row
-- filter: it enables row-level security and installs one
-- `analyst_tenant_isolation` policy per granted table, scoped
-- `TO analyst_reader` and `FOR SELECT`, that filters rows to the single
-- verified tenant the query broker pins on the connection.
--
-- How the tenant is pinned: after every `DISCARD ALL`, the broker runs
--   SELECT set_config('thinkwork.analyst_tenant', '<verified-tenant-uuid>', false);
-- and each policy reads it back via
--   current_setting('thinkwork.analyst_tenant', true)::uuid
-- (`missing_ok = true`, so an un-primed connection yields NULL → every
-- comparison is false → zero rows, fail-closed). GUC + current_setting::uuid
-- precedent: drizzle/0076_scheduled_jobs_marco_backfill.sql.
--
-- Per-table scope (from packages/database-pg/src/analyst/annotations.ts):
--   - column  (default): USING (tenant_id = <verified tenant>)
--   - self    (tenants): USING (id = <verified tenant>)
--   - join    (no tenant_id of their own — inherit via a parent FK):
--             USING (EXISTS (SELECT 1 FROM <parent> p
--                            WHERE p.<pk> = <table>.<fk>
--                              AND p.tenant_id = <verified tenant>))
--   - global  (capability_catalog, model_catalog): granted, RLS NOT enabled.
--
-- Why ENABLE is safe for every other role: enabling RLS default-denies any
-- non-owner role without a matching policy, but NO other non-owner role holds
-- SELECT on any public.* table — the compliance_* roles are scoped entirely
-- to the compliance.* schema (drizzle/0070, 0073, 0222). The application
-- writer connects as the table OWNER (master/migration user), which bypasses
-- RLS (no FORCE is applied), so ordinary reads/writes are unaffected.
--
-- Generated: the section between the GENERATED ANALYST RLS markers is spliced
-- from packages/database-pg/src/analyst/semantic-model.ts (`analystRlsSql`) by
-- scripts/generate-analyst-schema.ts. A vitest staleness test asserts the
-- committed section matches the current schema, so a table added/removed
-- without a regen fails CI. Do NOT hand-edit inside the markers.
--
-- Plan reference:
--   THINK-234 (analyst row-level tenant scoping) — the RLS-generation leg.
--
-- Apply manually (hand-rolled — NOT in meta/_journal.json). Apply AFTER the
-- broker PR (which pins thinkwork.analyst_tenant) has deployed:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0230_analyst_rls.sql
--
-- Re-running is idempotent: ENABLE ROW LEVEL SECURITY is a no-op once set,
-- each policy is DROP POLICY IF EXISTS'd before CREATE, and the REVOKEs below
-- are inherently idempotent.
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the drift gate). This
-- migration installs one analyst_tenant_isolation policy per granted table
-- (160+); declaring them all would bloat the header, so we declare a
-- representative sentinel set spanning every scope kind (self / column /
-- join). The full policy set is generated and asserted by the vitest
-- staleness test, not by these markers.
--
-- creates-policy: public.tenants.analyst_tenant_isolation
-- creates-policy: public.threads.analyst_tenant_isolation
-- creates-policy: public.agent_operation_leases.analyst_tenant_isolation
-- creates-policy: public.eval_results.analyst_tenant_isolation
-- creates-policy: public.plugin_components.analyst_tenant_isolation
--
-- THINK-84 U6: the msteams tables landed after this file was first applied,
-- so their policies are declared explicitly — the drift gate must force a
-- re-apply on databases that ran 0230 before the msteams tables existed.
-- (0227's grants for the same tables are not marker-checkable; re-apply
-- 0227 alongside 0233 and this file — see the 0233 header.)
-- creates-policy: public.msteams_tenant_installs.analyst_tenant_isolation
-- creates-policy: public.msteams_user_links.analyst_tenant_isolation
-- creates-policy: public.msteams_threads.analyst_tenant_isolation

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Refuse to apply against an unexpected DB (stale DATABASE_URL guard).
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- (a) Revoke the surface THINK-234 removed from the analyst.
--
-- billing_export_imports, stripe_events, webhook_idempotency, and
-- customer_deployment_session_events were granted by 0227 but are now
-- denylisted (platform billing/infra ledgers with no tenant dimension — they
-- carry no tenant_id and so cannot be row-scoped). Re-applying 0227 no longer
-- grants them, but it also does not revoke an existing grant, so revoke here.
-- Existence-guarded so a DB missing any of them still applies cleanly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_export_imports',
    'customer_deployment_session_events',
    'stripe_events',
    'webhook_idempotency'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM analyst_reader', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- (b) Enable RLS + install per-table tenant-isolation policies (generated).
--
-- Regenerate: npx tsx scripts/generate-analyst-schema.ts
-- Source of truth: packages/database-pg/src/analyst/semantic-model.ts
-- ---------------------------------------------------------------------------

-- BEGIN GENERATED ANALYST RLS
-- Global reference tables — granted but RLS intentionally NOT enabled
-- (no tenant dimension): capability_catalog, model_catalog.
DO $$
DECLARE
  missing text[] := '{}';
BEGIN
  IF to_regclass('public.activity_log') IS NOT NULL THEN
    ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.activity_log;
    CREATE POLICY analyst_tenant_isolation ON public.activity_log
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'activity_log'::text;
  END IF;
  IF to_regclass('public.agent_capabilities') IS NOT NULL THEN
    ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_capabilities;
    CREATE POLICY analyst_tenant_isolation ON public.agent_capabilities
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_capabilities'::text;
  END IF;
  IF to_regclass('public.agent_knowledge_bases') IS NOT NULL THEN
    ALTER TABLE public.agent_knowledge_bases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_knowledge_bases;
    CREATE POLICY analyst_tenant_isolation ON public.agent_knowledge_bases
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_knowledge_bases'::text;
  END IF;
  IF to_regclass('public.agent_loop_iterations') IS NOT NULL THEN
    ALTER TABLE public.agent_loop_iterations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_loop_iterations;
    CREATE POLICY analyst_tenant_isolation ON public.agent_loop_iterations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_loop_iterations'::text;
  END IF;
  IF to_regclass('public.agent_loop_runs') IS NOT NULL THEN
    ALTER TABLE public.agent_loop_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_loop_runs;
    CREATE POLICY analyst_tenant_isolation ON public.agent_loop_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_loop_runs'::text;
  END IF;
  IF to_regclass('public.agent_loop_versions') IS NOT NULL THEN
    ALTER TABLE public.agent_loop_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_loop_versions;
    CREATE POLICY analyst_tenant_isolation ON public.agent_loop_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_loop_versions'::text;
  END IF;
  IF to_regclass('public.agent_loops') IS NOT NULL THEN
    ALTER TABLE public.agent_loops ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_loops;
    CREATE POLICY analyst_tenant_isolation ON public.agent_loops
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_loops'::text;
  END IF;
  IF to_regclass('public.agent_mcp_servers') IS NOT NULL THEN
    ALTER TABLE public.agent_mcp_servers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_mcp_servers;
    CREATE POLICY analyst_tenant_isolation ON public.agent_mcp_servers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_mcp_servers'::text;
  END IF;
  IF to_regclass('public.agent_operation_leases') IS NOT NULL THEN
    ALTER TABLE public.agent_operation_leases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_operation_leases;
    CREATE POLICY analyst_tenant_isolation ON public.agent_operation_leases
      FOR SELECT TO analyst_reader
      USING (EXISTS (SELECT 1 FROM public.agents p WHERE p.id = public.agent_operation_leases.agent_id AND p.tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid));
  ELSE
    missing := missing || 'agent_operation_leases'::text;
  END IF;
  IF to_regclass('public.agent_profile_space_assignments') IS NOT NULL THEN
    ALTER TABLE public.agent_profile_space_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_profile_space_assignments;
    CREATE POLICY analyst_tenant_isolation ON public.agent_profile_space_assignments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_profile_space_assignments'::text;
  END IF;
  IF to_regclass('public.agent_profiles') IS NOT NULL THEN
    ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_profiles;
    CREATE POLICY analyst_tenant_isolation ON public.agent_profiles
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_profiles'::text;
  END IF;
  IF to_regclass('public.agent_skills') IS NOT NULL THEN
    ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_skills;
    CREATE POLICY analyst_tenant_isolation ON public.agent_skills
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_skills'::text;
  END IF;
  IF to_regclass('public.agent_template_mcp_servers') IS NOT NULL THEN
    ALTER TABLE public.agent_template_mcp_servers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_template_mcp_servers;
    CREATE POLICY analyst_tenant_isolation ON public.agent_template_mcp_servers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_template_mcp_servers'::text;
  END IF;
  IF to_regclass('public.agent_templates') IS NOT NULL THEN
    ALTER TABLE public.agent_templates ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_templates;
    CREATE POLICY analyst_tenant_isolation ON public.agent_templates
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_templates'::text;
  END IF;
  IF to_regclass('public.agent_versions') IS NOT NULL THEN
    ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_versions;
    CREATE POLICY analyst_tenant_isolation ON public.agent_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_versions'::text;
  END IF;
  IF to_regclass('public.agent_wakeup_requests') IS NOT NULL THEN
    ALTER TABLE public.agent_wakeup_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_wakeup_requests;
    CREATE POLICY analyst_tenant_isolation ON public.agent_wakeup_requests
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_wakeup_requests'::text;
  END IF;
  IF to_regclass('public.agent_workspace_events') IS NOT NULL THEN
    ALTER TABLE public.agent_workspace_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_workspace_events;
    CREATE POLICY analyst_tenant_isolation ON public.agent_workspace_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_workspace_events'::text;
  END IF;
  IF to_regclass('public.agent_workspace_runs') IS NOT NULL THEN
    ALTER TABLE public.agent_workspace_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agent_workspace_runs;
    CREATE POLICY analyst_tenant_isolation ON public.agent_workspace_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agent_workspace_runs'::text;
  END IF;
  IF to_regclass('public.agents') IS NOT NULL THEN
    ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.agents;
    CREATE POLICY analyst_tenant_isolation ON public.agents
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'agents'::text;
  END IF;
  IF to_regclass('public.artifact_data_bindings') IS NOT NULL THEN
    ALTER TABLE public.artifact_data_bindings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.artifact_data_bindings;
    CREATE POLICY analyst_tenant_isolation ON public.artifact_data_bindings
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'artifact_data_bindings'::text;
  END IF;
  IF to_regclass('public.artifact_shares') IS NOT NULL THEN
    ALTER TABLE public.artifact_shares ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.artifact_shares;
    CREATE POLICY analyst_tenant_isolation ON public.artifact_shares
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'artifact_shares'::text;
  END IF;
  IF to_regclass('public.artifact_versions') IS NOT NULL THEN
    ALTER TABLE public.artifact_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.artifact_versions;
    CREATE POLICY analyst_tenant_isolation ON public.artifact_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'artifact_versions'::text;
  END IF;
  IF to_regclass('public.artifacts') IS NOT NULL THEN
    ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.artifacts;
    CREATE POLICY analyst_tenant_isolation ON public.artifacts
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'artifacts'::text;
  END IF;
  IF to_regclass('public.billing_export_line_items') IS NOT NULL THEN
    ALTER TABLE public.billing_export_line_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.billing_export_line_items;
    CREATE POLICY analyst_tenant_isolation ON public.billing_export_line_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'billing_export_line_items'::text;
  END IF;
  IF to_regclass('public.budget_policies') IS NOT NULL THEN
    ALTER TABLE public.budget_policies ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.budget_policies;
    CREATE POLICY analyst_tenant_isolation ON public.budget_policies
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'budget_policies'::text;
  END IF;
  IF to_regclass('public.capability_broker_calls') IS NOT NULL THEN
    ALTER TABLE public.capability_broker_calls ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.capability_broker_calls;
    CREATE POLICY analyst_tenant_isolation ON public.capability_broker_calls
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'capability_broker_calls'::text;
  END IF;
  IF to_regclass('public.capability_broker_sessions') IS NOT NULL THEN
    ALTER TABLE public.capability_broker_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.capability_broker_sessions;
    CREATE POLICY analyst_tenant_isolation ON public.capability_broker_sessions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'capability_broker_sessions'::text;
  END IF;
  IF to_regclass('public.capability_connection_proposals') IS NOT NULL THEN
    ALTER TABLE public.capability_connection_proposals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.capability_connection_proposals;
    CREATE POLICY analyst_tenant_isolation ON public.capability_connection_proposals
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'capability_connection_proposals'::text;
  END IF;
  IF to_regclass('public.capability_definitions') IS NOT NULL THEN
    ALTER TABLE public.capability_definitions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.capability_definitions;
    CREATE POLICY analyst_tenant_isolation ON public.capability_definitions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'capability_definitions'::text;
  END IF;
  IF to_regclass('public.capability_routine_proposals') IS NOT NULL THEN
    ALTER TABLE public.capability_routine_proposals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.capability_routine_proposals;
    CREATE POLICY analyst_tenant_isolation ON public.capability_routine_proposals
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'capability_routine_proposals'::text;
  END IF;
  IF to_regclass('public.connections') IS NOT NULL THEN
    ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.connections;
    CREATE POLICY analyst_tenant_isolation ON public.connections
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'connections'::text;
  END IF;
  IF to_regclass('public.cost_events') IS NOT NULL THEN
    ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.cost_events;
    CREATE POLICY analyst_tenant_isolation ON public.cost_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'cost_events'::text;
  END IF;
  IF to_regclass('public.crm_work_links') IS NOT NULL THEN
    ALTER TABLE public.crm_work_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.crm_work_links;
    CREATE POLICY analyst_tenant_isolation ON public.crm_work_links
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'crm_work_links'::text;
  END IF;
  IF to_regclass('public.document_conformance_reports') IS NOT NULL THEN
    ALTER TABLE public.document_conformance_reports ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.document_conformance_reports;
    CREATE POLICY analyst_tenant_isolation ON public.document_conformance_reports
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'document_conformance_reports'::text;
  END IF;
  IF to_regclass('public.document_plates') IS NOT NULL THEN
    ALTER TABLE public.document_plates ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.document_plates;
    CREATE POLICY analyst_tenant_isolation ON public.document_plates
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'document_plates'::text;
  END IF;
  IF to_regclass('public.document_section_waivers') IS NOT NULL THEN
    ALTER TABLE public.document_section_waivers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.document_section_waivers;
    CREATE POLICY analyst_tenant_isolation ON public.document_section_waivers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'document_section_waivers'::text;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.documents;
    CREATE POLICY analyst_tenant_isolation ON public.documents
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'documents'::text;
  END IF;
  IF to_regclass('public.email_body_objects') IS NOT NULL THEN
    ALTER TABLE public.email_body_objects ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_body_objects;
    CREATE POLICY analyst_tenant_isolation ON public.email_body_objects
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_body_objects'::text;
  END IF;
  IF to_regclass('public.email_conversations') IS NOT NULL THEN
    ALTER TABLE public.email_conversations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_conversations;
    CREATE POLICY analyst_tenant_isolation ON public.email_conversations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_conversations'::text;
  END IF;
  IF to_regclass('public.email_domains') IS NOT NULL THEN
    ALTER TABLE public.email_domains ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_domains;
    CREATE POLICY analyst_tenant_isolation ON public.email_domains
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_domains'::text;
  END IF;
  IF to_regclass('public.email_ledger_events') IS NOT NULL THEN
    ALTER TABLE public.email_ledger_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_ledger_events;
    CREATE POLICY analyst_tenant_isolation ON public.email_ledger_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_ledger_events'::text;
  END IF;
  IF to_regclass('public.email_provider_events') IS NOT NULL THEN
    ALTER TABLE public.email_provider_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_provider_events;
    CREATE POLICY analyst_tenant_isolation ON public.email_provider_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_provider_events'::text;
  END IF;
  IF to_regclass('public.email_readiness_checks') IS NOT NULL THEN
    ALTER TABLE public.email_readiness_checks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_readiness_checks;
    CREATE POLICY analyst_tenant_isolation ON public.email_readiness_checks
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_readiness_checks'::text;
  END IF;
  IF to_regclass('public.email_ses_compatibility_mappings') IS NOT NULL THEN
    ALTER TABLE public.email_ses_compatibility_mappings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_ses_compatibility_mappings;
    CREATE POLICY analyst_tenant_isolation ON public.email_ses_compatibility_mappings
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_ses_compatibility_mappings'::text;
  END IF;
  IF to_regclass('public.email_space_policies') IS NOT NULL THEN
    ALTER TABLE public.email_space_policies ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_space_policies;
    CREATE POLICY analyst_tenant_isolation ON public.email_space_policies
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_space_policies'::text;
  END IF;
  IF to_regclass('public.email_space_sender_allowlists') IS NOT NULL THEN
    ALTER TABLE public.email_space_sender_allowlists ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.email_space_sender_allowlists;
    CREATE POLICY analyst_tenant_isolation ON public.email_space_sender_allowlists
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'email_space_sender_allowlists'::text;
  END IF;
  IF to_regclass('public.eval_case_overrides') IS NOT NULL THEN
    ALTER TABLE public.eval_case_overrides ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_case_overrides;
    CREATE POLICY analyst_tenant_isolation ON public.eval_case_overrides
      FOR SELECT TO analyst_reader
      USING (EXISTS (SELECT 1 FROM public.eval_runs p WHERE p.id = public.eval_case_overrides.run_id AND p.tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid));
  ELSE
    missing := missing || 'eval_case_overrides'::text;
  END IF;
  IF to_regclass('public.eval_datasets') IS NOT NULL THEN
    ALTER TABLE public.eval_datasets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_datasets;
    CREATE POLICY analyst_tenant_isolation ON public.eval_datasets
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_datasets'::text;
  END IF;
  IF to_regclass('public.eval_profiles') IS NOT NULL THEN
    ALTER TABLE public.eval_profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_profiles;
    CREATE POLICY analyst_tenant_isolation ON public.eval_profiles
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_profiles'::text;
  END IF;
  IF to_regclass('public.eval_replay_tool_allowlist') IS NOT NULL THEN
    ALTER TABLE public.eval_replay_tool_allowlist ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_replay_tool_allowlist;
    CREATE POLICY analyst_tenant_isolation ON public.eval_replay_tool_allowlist
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_replay_tool_allowlist'::text;
  END IF;
  IF to_regclass('public.eval_results') IS NOT NULL THEN
    ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_results;
    CREATE POLICY analyst_tenant_isolation ON public.eval_results
      FOR SELECT TO analyst_reader
      USING (EXISTS (SELECT 1 FROM public.eval_runs p WHERE p.id = public.eval_results.run_id AND p.tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid));
  ELSE
    missing := missing || 'eval_results'::text;
  END IF;
  IF to_regclass('public.eval_runs') IS NOT NULL THEN
    ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_runs;
    CREATE POLICY analyst_tenant_isolation ON public.eval_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_runs'::text;
  END IF;
  IF to_regclass('public.eval_skill_gate') IS NOT NULL THEN
    ALTER TABLE public.eval_skill_gate ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_skill_gate;
    CREATE POLICY analyst_tenant_isolation ON public.eval_skill_gate
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_skill_gate'::text;
  END IF;
  IF to_regclass('public.eval_test_cases') IS NOT NULL THEN
    ALTER TABLE public.eval_test_cases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.eval_test_cases;
    CREATE POLICY analyst_tenant_isolation ON public.eval_test_cases
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'eval_test_cases'::text;
  END IF;
  IF to_regclass('public.folder_bundle_import_rate_limits') IS NOT NULL THEN
    ALTER TABLE public.folder_bundle_import_rate_limits ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.folder_bundle_import_rate_limits;
    CREATE POLICY analyst_tenant_isolation ON public.folder_bundle_import_rate_limits
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'folder_bundle_import_rate_limits'::text;
  END IF;
  IF to_regclass('public.github_app_installations') IS NOT NULL THEN
    ALTER TABLE public.github_app_installations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.github_app_installations;
    CREATE POLICY analyst_tenant_isolation ON public.github_app_installations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'github_app_installations'::text;
  END IF;
  IF to_regclass('public.github_webhook_deliveries') IS NOT NULL THEN
    ALTER TABLE public.github_webhook_deliveries ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.github_webhook_deliveries;
    CREATE POLICY analyst_tenant_isolation ON public.github_webhook_deliveries
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'github_webhook_deliveries'::text;
  END IF;
  IF to_regclass('public.goals') IS NOT NULL THEN
    ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.goals;
    CREATE POLICY analyst_tenant_isolation ON public.goals
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'goals'::text;
  END IF;
  IF to_regclass('public.guardrail_blocks') IS NOT NULL THEN
    ALTER TABLE public.guardrail_blocks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.guardrail_blocks;
    CREATE POLICY analyst_tenant_isolation ON public.guardrail_blocks
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'guardrail_blocks'::text;
  END IF;
  IF to_regclass('public.guardrails') IS NOT NULL THEN
    ALTER TABLE public.guardrails ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.guardrails;
    CREATE POLICY analyst_tenant_isolation ON public.guardrails
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'guardrails'::text;
  END IF;
  IF to_regclass('public.inbox_item_comments') IS NOT NULL THEN
    ALTER TABLE public.inbox_item_comments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.inbox_item_comments;
    CREATE POLICY analyst_tenant_isolation ON public.inbox_item_comments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'inbox_item_comments'::text;
  END IF;
  IF to_regclass('public.inbox_item_links') IS NOT NULL THEN
    ALTER TABLE public.inbox_item_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.inbox_item_links;
    CREATE POLICY analyst_tenant_isolation ON public.inbox_item_links
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'inbox_item_links'::text;
  END IF;
  IF to_regclass('public.inbox_items') IS NOT NULL THEN
    ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.inbox_items;
    CREATE POLICY analyst_tenant_isolation ON public.inbox_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'inbox_items'::text;
  END IF;
  IF to_regclass('public.knowledge_base_documents') IS NOT NULL THEN
    ALTER TABLE public.knowledge_base_documents ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.knowledge_base_documents;
    CREATE POLICY analyst_tenant_isolation ON public.knowledge_base_documents
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'knowledge_base_documents'::text;
  END IF;
  IF to_regclass('public.knowledge_bases') IS NOT NULL THEN
    ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.knowledge_bases;
    CREATE POLICY analyst_tenant_isolation ON public.knowledge_bases
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'knowledge_bases'::text;
  END IF;
  IF to_regclass('public.linked_task_events') IS NOT NULL THEN
    ALTER TABLE public.linked_task_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.linked_task_events;
    CREATE POLICY analyst_tenant_isolation ON public.linked_task_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'linked_task_events'::text;
  END IF;
  IF to_regclass('public.linked_tasks') IS NOT NULL THEN
    ALTER TABLE public.linked_tasks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.linked_tasks;
    CREATE POLICY analyst_tenant_isolation ON public.linked_tasks
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'linked_tasks'::text;
  END IF;
  IF to_regclass('public.managed_application_deployment_events') IS NOT NULL THEN
    ALTER TABLE public.managed_application_deployment_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.managed_application_deployment_events;
    CREATE POLICY analyst_tenant_isolation ON public.managed_application_deployment_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'managed_application_deployment_events'::text;
  END IF;
  IF to_regclass('public.managed_application_deployment_jobs') IS NOT NULL THEN
    ALTER TABLE public.managed_application_deployment_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.managed_application_deployment_jobs;
    CREATE POLICY analyst_tenant_isolation ON public.managed_application_deployment_jobs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'managed_application_deployment_jobs'::text;
  END IF;
  IF to_regclass('public.managed_applications') IS NOT NULL THEN
    ALTER TABLE public.managed_applications ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.managed_applications;
    CREATE POLICY analyst_tenant_isolation ON public.managed_applications
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'managed_applications'::text;
  END IF;
  IF to_regclass('public.memory_claim_evidence') IS NOT NULL THEN
    ALTER TABLE public.memory_claim_evidence ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_claim_evidence;
    CREATE POLICY analyst_tenant_isolation ON public.memory_claim_evidence
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_claim_evidence'::text;
  END IF;
  IF to_regclass('public.memory_claims') IS NOT NULL THEN
    ALTER TABLE public.memory_claims ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_claims;
    CREATE POLICY analyst_tenant_isolation ON public.memory_claims
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_claims'::text;
  END IF;
  IF to_regclass('public.memory_derivations') IS NOT NULL THEN
    ALTER TABLE public.memory_derivations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_derivations;
    CREATE POLICY analyst_tenant_isolation ON public.memory_derivations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_derivations'::text;
  END IF;
  IF to_regclass('public.memory_evidence_items') IS NOT NULL THEN
    ALTER TABLE public.memory_evidence_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_evidence_items;
    CREATE POLICY analyst_tenant_isolation ON public.memory_evidence_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_evidence_items'::text;
  END IF;
  IF to_regclass('public.memory_processor_configs') IS NOT NULL THEN
    ALTER TABLE public.memory_processor_configs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_processor_configs;
    CREATE POLICY analyst_tenant_isolation ON public.memory_processor_configs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_processor_configs'::text;
  END IF;
  IF to_regclass('public.memory_retraction_attempts') IS NOT NULL THEN
    ALTER TABLE public.memory_retraction_attempts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_retraction_attempts;
    CREATE POLICY analyst_tenant_isolation ON public.memory_retraction_attempts
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_retraction_attempts'::text;
  END IF;
  IF to_regclass('public.memory_run_items') IS NOT NULL THEN
    ALTER TABLE public.memory_run_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_run_items;
    CREATE POLICY analyst_tenant_isolation ON public.memory_run_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_run_items'::text;
  END IF;
  IF to_regclass('public.memory_source_authorizations') IS NOT NULL THEN
    ALTER TABLE public.memory_source_authorizations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_source_authorizations;
    CREATE POLICY analyst_tenant_isolation ON public.memory_source_authorizations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_source_authorizations'::text;
  END IF;
  IF to_regclass('public.memory_source_checkpoints') IS NOT NULL THEN
    ALTER TABLE public.memory_source_checkpoints ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_source_checkpoints;
    CREATE POLICY analyst_tenant_isolation ON public.memory_source_checkpoints
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_source_checkpoints'::text;
  END IF;
  IF to_regclass('public.memory_source_configs') IS NOT NULL THEN
    ALTER TABLE public.memory_source_configs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.memory_source_configs;
    CREATE POLICY analyst_tenant_isolation ON public.memory_source_configs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'memory_source_configs'::text;
  END IF;
  IF to_regclass('public.message_artifacts') IS NOT NULL THEN
    ALTER TABLE public.message_artifacts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.message_artifacts;
    CREATE POLICY analyst_tenant_isolation ON public.message_artifacts
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'message_artifacts'::text;
  END IF;
  IF to_regclass('public.message_mentions') IS NOT NULL THEN
    ALTER TABLE public.message_mentions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.message_mentions;
    CREATE POLICY analyst_tenant_isolation ON public.message_mentions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'message_mentions'::text;
  END IF;
  IF to_regclass('public.messages') IS NOT NULL THEN
    ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.messages;
    CREATE POLICY analyst_tenant_isolation ON public.messages
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'messages'::text;
  END IF;
  IF to_regclass('public.msteams_tenant_installs') IS NOT NULL THEN
    ALTER TABLE public.msteams_tenant_installs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.msteams_tenant_installs;
    CREATE POLICY analyst_tenant_isolation ON public.msteams_tenant_installs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'msteams_tenant_installs'::text;
  END IF;
  IF to_regclass('public.msteams_threads') IS NOT NULL THEN
    ALTER TABLE public.msteams_threads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.msteams_threads;
    CREATE POLICY analyst_tenant_isolation ON public.msteams_threads
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'msteams_threads'::text;
  END IF;
  IF to_regclass('public.msteams_user_links') IS NOT NULL THEN
    ALTER TABLE public.msteams_user_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.msteams_user_links;
    CREATE POLICY analyst_tenant_isolation ON public.msteams_user_links
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'msteams_user_links'::text;
  END IF;
  IF to_regclass('public.mutation_idempotency') IS NOT NULL THEN
    ALTER TABLE public.mutation_idempotency ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.mutation_idempotency;
    CREATE POLICY analyst_tenant_isolation ON public.mutation_idempotency
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'mutation_idempotency'::text;
  END IF;
  IF to_regclass('public.pending_user_questions') IS NOT NULL THEN
    ALTER TABLE public.pending_user_questions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.pending_user_questions;
    CREATE POLICY analyst_tenant_isolation ON public.pending_user_questions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'pending_user_questions'::text;
  END IF;
  IF to_regclass('public.pi_extension_assignments') IS NOT NULL THEN
    ALTER TABLE public.pi_extension_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.pi_extension_assignments;
    CREATE POLICY analyst_tenant_isolation ON public.pi_extension_assignments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'pi_extension_assignments'::text;
  END IF;
  IF to_regclass('public.pi_extension_sources') IS NOT NULL THEN
    ALTER TABLE public.pi_extension_sources ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.pi_extension_sources;
    CREATE POLICY analyst_tenant_isolation ON public.pi_extension_sources
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'pi_extension_sources'::text;
  END IF;
  IF to_regclass('public.pi_extension_versions') IS NOT NULL THEN
    ALTER TABLE public.pi_extension_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.pi_extension_versions;
    CREATE POLICY analyst_tenant_isolation ON public.pi_extension_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'pi_extension_versions'::text;
  END IF;
  IF to_regclass('public.plugin_app_overlays') IS NOT NULL THEN
    ALTER TABLE public.plugin_app_overlays ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.plugin_app_overlays;
    CREATE POLICY analyst_tenant_isolation ON public.plugin_app_overlays
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'plugin_app_overlays'::text;
  END IF;
  IF to_regclass('public.plugin_components') IS NOT NULL THEN
    ALTER TABLE public.plugin_components ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.plugin_components;
    CREATE POLICY analyst_tenant_isolation ON public.plugin_components
      FOR SELECT TO analyst_reader
      USING (EXISTS (SELECT 1 FROM public.plugin_installs p WHERE p.id = public.plugin_components.plugin_install_id AND p.tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid));
  ELSE
    missing := missing || 'plugin_components'::text;
  END IF;
  IF to_regclass('public.plugin_entitlements') IS NOT NULL THEN
    ALTER TABLE public.plugin_entitlements ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.plugin_entitlements;
    CREATE POLICY analyst_tenant_isolation ON public.plugin_entitlements
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'plugin_entitlements'::text;
  END IF;
  IF to_regclass('public.plugin_installs') IS NOT NULL THEN
    ALTER TABLE public.plugin_installs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.plugin_installs;
    CREATE POLICY analyst_tenant_isolation ON public.plugin_installs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'plugin_installs'::text;
  END IF;
  IF to_regclass('public.plugin_uploads') IS NOT NULL THEN
    ALTER TABLE public.plugin_uploads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.plugin_uploads;
    CREATE POLICY analyst_tenant_isolation ON public.plugin_uploads
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'plugin_uploads'::text;
  END IF;
  IF to_regclass('public.principal_permission_grants') IS NOT NULL THEN
    ALTER TABLE public.principal_permission_grants ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.principal_permission_grants;
    CREATE POLICY analyst_tenant_isolation ON public.principal_permission_grants
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'principal_permission_grants'::text;
  END IF;
  IF to_regclass('public.recipes') IS NOT NULL THEN
    ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.recipes;
    CREATE POLICY analyst_tenant_isolation ON public.recipes
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'recipes'::text;
  END IF;
  IF to_regclass('public.release_update_events') IS NOT NULL THEN
    ALTER TABLE public.release_update_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.release_update_events;
    CREATE POLICY analyst_tenant_isolation ON public.release_update_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'release_update_events'::text;
  END IF;
  IF to_regclass('public.release_update_jobs') IS NOT NULL THEN
    ALTER TABLE public.release_update_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.release_update_jobs;
    CREATE POLICY analyst_tenant_isolation ON public.release_update_jobs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'release_update_jobs'::text;
  END IF;
  IF to_regclass('public.resolved_capability_manifests') IS NOT NULL THEN
    ALTER TABLE public.resolved_capability_manifests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.resolved_capability_manifests;
    CREATE POLICY analyst_tenant_isolation ON public.resolved_capability_manifests
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'resolved_capability_manifests'::text;
  END IF;
  IF to_regclass('public.retry_queue') IS NOT NULL THEN
    ALTER TABLE public.retry_queue ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.retry_queue;
    CREATE POLICY analyst_tenant_isolation ON public.retry_queue
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'retry_queue'::text;
  END IF;
  IF to_regclass('public.routine_asl_versions') IS NOT NULL THEN
    ALTER TABLE public.routine_asl_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routine_asl_versions;
    CREATE POLICY analyst_tenant_isolation ON public.routine_asl_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routine_asl_versions'::text;
  END IF;
  IF to_regclass('public.routine_code_cache') IS NOT NULL THEN
    ALTER TABLE public.routine_code_cache ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routine_code_cache;
    CREATE POLICY analyst_tenant_isolation ON public.routine_code_cache
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routine_code_cache'::text;
  END IF;
  IF to_regclass('public.routine_executions') IS NOT NULL THEN
    ALTER TABLE public.routine_executions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routine_executions;
    CREATE POLICY analyst_tenant_isolation ON public.routine_executions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routine_executions'::text;
  END IF;
  IF to_regclass('public.routine_repair_events') IS NOT NULL THEN
    ALTER TABLE public.routine_repair_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routine_repair_events;
    CREATE POLICY analyst_tenant_isolation ON public.routine_repair_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routine_repair_events'::text;
  END IF;
  IF to_regclass('public.routine_step_events') IS NOT NULL THEN
    ALTER TABLE public.routine_step_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routine_step_events;
    CREATE POLICY analyst_tenant_isolation ON public.routine_step_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routine_step_events'::text;
  END IF;
  IF to_regclass('public.routines') IS NOT NULL THEN
    ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.routines;
    CREATE POLICY analyst_tenant_isolation ON public.routines
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'routines'::text;
  END IF;
  IF to_regclass('public.sandbox_agent_hourly_counters') IS NOT NULL THEN
    ALTER TABLE public.sandbox_agent_hourly_counters ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.sandbox_agent_hourly_counters;
    CREATE POLICY analyst_tenant_isolation ON public.sandbox_agent_hourly_counters
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'sandbox_agent_hourly_counters'::text;
  END IF;
  IF to_regclass('public.sandbox_invocations') IS NOT NULL THEN
    ALTER TABLE public.sandbox_invocations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.sandbox_invocations;
    CREATE POLICY analyst_tenant_isolation ON public.sandbox_invocations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'sandbox_invocations'::text;
  END IF;
  IF to_regclass('public.sandbox_tenant_daily_counters') IS NOT NULL THEN
    ALTER TABLE public.sandbox_tenant_daily_counters ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.sandbox_tenant_daily_counters;
    CREATE POLICY analyst_tenant_isolation ON public.sandbox_tenant_daily_counters
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'sandbox_tenant_daily_counters'::text;
  END IF;
  IF to_regclass('public.scheduled_jobs') IS NOT NULL THEN
    ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.scheduled_jobs;
    CREATE POLICY analyst_tenant_isolation ON public.scheduled_jobs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'scheduled_jobs'::text;
  END IF;
  IF to_regclass('public.skill_catalog') IS NOT NULL THEN
    ALTER TABLE public.skill_catalog ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.skill_catalog;
    CREATE POLICY analyst_tenant_isolation ON public.skill_catalog
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'skill_catalog'::text;
  END IF;
  IF to_regclass('public.skill_draft_events') IS NOT NULL THEN
    ALTER TABLE public.skill_draft_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.skill_draft_events;
    CREATE POLICY analyst_tenant_isolation ON public.skill_draft_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'skill_draft_events'::text;
  END IF;
  IF to_regclass('public.skill_drafts') IS NOT NULL THEN
    ALTER TABLE public.skill_drafts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.skill_drafts;
    CREATE POLICY analyst_tenant_isolation ON public.skill_drafts
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'skill_drafts'::text;
  END IF;
  IF to_regclass('public.skill_runs') IS NOT NULL THEN
    ALTER TABLE public.skill_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.skill_runs;
    CREATE POLICY analyst_tenant_isolation ON public.skill_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'skill_runs'::text;
  END IF;
  IF to_regclass('public.slack_threads') IS NOT NULL THEN
    ALTER TABLE public.slack_threads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.slack_threads;
    CREATE POLICY analyst_tenant_isolation ON public.slack_threads
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'slack_threads'::text;
  END IF;
  IF to_regclass('public.slack_user_links') IS NOT NULL THEN
    ALTER TABLE public.slack_user_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.slack_user_links;
    CREATE POLICY analyst_tenant_isolation ON public.slack_user_links
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'slack_user_links'::text;
  END IF;
  IF to_regclass('public.space_checklist_items') IS NOT NULL THEN
    ALTER TABLE public.space_checklist_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_checklist_items;
    CREATE POLICY analyst_tenant_isolation ON public.space_checklist_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_checklist_items'::text;
  END IF;
  IF to_regclass('public.space_checklist_templates') IS NOT NULL THEN
    ALTER TABLE public.space_checklist_templates ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_checklist_templates;
    CREATE POLICY analyst_tenant_isolation ON public.space_checklist_templates
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_checklist_templates'::text;
  END IF;
  IF to_regclass('public.space_integrations') IS NOT NULL THEN
    ALTER TABLE public.space_integrations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_integrations;
    CREATE POLICY analyst_tenant_isolation ON public.space_integrations
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_integrations'::text;
  END IF;
  IF to_regclass('public.space_knowledge_bases') IS NOT NULL THEN
    ALTER TABLE public.space_knowledge_bases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_knowledge_bases;
    CREATE POLICY analyst_tenant_isolation ON public.space_knowledge_bases
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_knowledge_bases'::text;
  END IF;
  IF to_regclass('public.space_mcp_servers') IS NOT NULL THEN
    ALTER TABLE public.space_mcp_servers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_mcp_servers;
    CREATE POLICY analyst_tenant_isolation ON public.space_mcp_servers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_mcp_servers'::text;
  END IF;
  IF to_regclass('public.space_members') IS NOT NULL THEN
    ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.space_members;
    CREATE POLICY analyst_tenant_isolation ON public.space_members
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'space_members'::text;
  END IF;
  IF to_regclass('public.spaces') IS NOT NULL THEN
    ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.spaces;
    CREATE POLICY analyst_tenant_isolation ON public.spaces
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'spaces'::text;
  END IF;
  IF to_regclass('public.stripe_customers') IS NOT NULL THEN
    ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.stripe_customers;
    CREATE POLICY analyst_tenant_isolation ON public.stripe_customers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'stripe_customers'::text;
  END IF;
  IF to_regclass('public.stripe_subscriptions') IS NOT NULL THEN
    ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.stripe_subscriptions;
    CREATE POLICY analyst_tenant_isolation ON public.stripe_subscriptions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'stripe_subscriptions'::text;
  END IF;
  IF to_regclass('public.tenant_builtin_tools') IS NOT NULL THEN
    ALTER TABLE public.tenant_builtin_tools ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_builtin_tools;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_builtin_tools
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_builtin_tools'::text;
  END IF;
  IF to_regclass('public.tenant_context_provider_settings') IS NOT NULL THEN
    ALTER TABLE public.tenant_context_provider_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_context_provider_settings;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_context_provider_settings
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_context_provider_settings'::text;
  END IF;
  IF to_regclass('public.tenant_mcp_context_tools') IS NOT NULL THEN
    ALTER TABLE public.tenant_mcp_context_tools ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_mcp_context_tools;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_mcp_context_tools
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_mcp_context_tools'::text;
  END IF;
  IF to_regclass('public.tenant_mcp_servers') IS NOT NULL THEN
    ALTER TABLE public.tenant_mcp_servers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_mcp_servers;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_mcp_servers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_mcp_servers'::text;
  END IF;
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_members;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_members
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_members'::text;
  END IF;
  IF to_regclass('public.tenant_model_catalog') IS NOT NULL THEN
    ALTER TABLE public.tenant_model_catalog ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_model_catalog;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_model_catalog
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_model_catalog'::text;
  END IF;
  IF to_regclass('public.tenant_policy_events') IS NOT NULL THEN
    ALTER TABLE public.tenant_policy_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_policy_events;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_policy_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_policy_events'::text;
  END IF;
  IF to_regclass('public.tenant_service_principals') IS NOT NULL THEN
    ALTER TABLE public.tenant_service_principals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_service_principals;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_service_principals
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_service_principals'::text;
  END IF;
  IF to_regclass('public.tenant_settings') IS NOT NULL THEN
    ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_settings;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_settings
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_settings'::text;
  END IF;
  IF to_regclass('public.tenant_system_users') IS NOT NULL THEN
    ALTER TABLE public.tenant_system_users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_system_users;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_system_users
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_system_users'::text;
  END IF;
  IF to_regclass('public.tenant_workflow_catalog') IS NOT NULL THEN
    ALTER TABLE public.tenant_workflow_catalog ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenant_workflow_catalog;
    CREATE POLICY analyst_tenant_isolation ON public.tenant_workflow_catalog
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenant_workflow_catalog'::text;
  END IF;
  IF to_regclass('public.tenants') IS NOT NULL THEN
    ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tenants;
    CREATE POLICY analyst_tenant_isolation ON public.tenants
      FOR SELECT TO analyst_reader
      USING (id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tenants'::text;
  END IF;
  IF to_regclass('public.thread_attachments') IS NOT NULL THEN
    ALTER TABLE public.thread_attachments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_attachments;
    CREATE POLICY analyst_tenant_isolation ON public.thread_attachments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_attachments'::text;
  END IF;
  IF to_regclass('public.thread_dependencies') IS NOT NULL THEN
    ALTER TABLE public.thread_dependencies ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_dependencies;
    CREATE POLICY analyst_tenant_isolation ON public.thread_dependencies
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_dependencies'::text;
  END IF;
  IF to_regclass('public.thread_idle_learning_runs') IS NOT NULL THEN
    ALTER TABLE public.thread_idle_learning_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_idle_learning_runs;
    CREATE POLICY analyst_tenant_isolation ON public.thread_idle_learning_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_idle_learning_runs'::text;
  END IF;
  IF to_regclass('public.thread_idle_learning_state') IS NOT NULL THEN
    ALTER TABLE public.thread_idle_learning_state ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_idle_learning_state;
    CREATE POLICY analyst_tenant_isolation ON public.thread_idle_learning_state
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_idle_learning_state'::text;
  END IF;
  IF to_regclass('public.thread_label_assignments') IS NOT NULL THEN
    ALTER TABLE public.thread_label_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_label_assignments;
    CREATE POLICY analyst_tenant_isolation ON public.thread_label_assignments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_label_assignments'::text;
  END IF;
  IF to_regclass('public.thread_labels') IS NOT NULL THEN
    ALTER TABLE public.thread_labels ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_labels;
    CREATE POLICY analyst_tenant_isolation ON public.thread_labels
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_labels'::text;
  END IF;
  IF to_regclass('public.thread_participants') IS NOT NULL THEN
    ALTER TABLE public.thread_participants ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_participants;
    CREATE POLICY analyst_tenant_isolation ON public.thread_participants
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_participants'::text;
  END IF;
  IF to_regclass('public.thread_turn_events') IS NOT NULL THEN
    ALTER TABLE public.thread_turn_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_turn_events;
    CREATE POLICY analyst_tenant_isolation ON public.thread_turn_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_turn_events'::text;
  END IF;
  IF to_regclass('public.thread_turns') IS NOT NULL THEN
    ALTER TABLE public.thread_turns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.thread_turns;
    CREATE POLICY analyst_tenant_isolation ON public.thread_turns
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'thread_turns'::text;
  END IF;
  IF to_regclass('public.threads') IS NOT NULL THEN
    ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.threads;
    CREATE POLICY analyst_tenant_isolation ON public.threads
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'threads'::text;
  END IF;
  IF to_regclass('public.tool_execution_events') IS NOT NULL THEN
    ALTER TABLE public.tool_execution_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.tool_execution_events;
    CREATE POLICY analyst_tenant_isolation ON public.tool_execution_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'tool_execution_events'::text;
  END IF;
  IF to_regclass('public.trace_cost_reconciliation_facts') IS NOT NULL THEN
    ALTER TABLE public.trace_cost_reconciliation_facts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.trace_cost_reconciliation_facts;
    CREATE POLICY analyst_tenant_isolation ON public.trace_cost_reconciliation_facts
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'trace_cost_reconciliation_facts'::text;
  END IF;
  IF to_regclass('public.trace_events') IS NOT NULL THEN
    ALTER TABLE public.trace_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.trace_events;
    CREATE POLICY analyst_tenant_isolation ON public.trace_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'trace_events'::text;
  END IF;
  IF to_regclass('public.trace_runs') IS NOT NULL THEN
    ALTER TABLE public.trace_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.trace_runs;
    CREATE POLICY analyst_tenant_isolation ON public.trace_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'trace_runs'::text;
  END IF;
  IF to_regclass('public.trace_source_evidence') IS NOT NULL THEN
    ALTER TABLE public.trace_source_evidence ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.trace_source_evidence;
    CREATE POLICY analyst_tenant_isolation ON public.trace_source_evidence
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'trace_source_evidence'::text;
  END IF;
  IF to_regclass('public.user_model_approvals') IS NOT NULL THEN
    ALTER TABLE public.user_model_approvals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.user_model_approvals;
    CREATE POLICY analyst_tenant_isolation ON public.user_model_approvals
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'user_model_approvals'::text;
  END IF;
  IF to_regclass('public.user_plugin_activations') IS NOT NULL THEN
    ALTER TABLE public.user_plugin_activations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.user_plugin_activations;
    CREATE POLICY analyst_tenant_isolation ON public.user_plugin_activations
      FOR SELECT TO analyst_reader
      USING (EXISTS (SELECT 1 FROM public.plugin_installs p WHERE p.id = public.user_plugin_activations.plugin_install_id AND p.tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid));
  ELSE
    missing := missing || 'user_plugin_activations'::text;
  END IF;
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.user_profiles;
    CREATE POLICY analyst_tenant_isolation ON public.user_profiles
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'user_profiles'::text;
  END IF;
  IF to_regclass('public.user_quick_actions') IS NOT NULL THEN
    ALTER TABLE public.user_quick_actions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.user_quick_actions;
    CREATE POLICY analyst_tenant_isolation ON public.user_quick_actions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'user_quick_actions'::text;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.users;
    CREATE POLICY analyst_tenant_isolation ON public.users
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'users'::text;
  END IF;
  IF to_regclass('public.wakeup_requests') IS NOT NULL THEN
    ALTER TABLE public.wakeup_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.wakeup_requests;
    CREATE POLICY analyst_tenant_isolation ON public.wakeup_requests
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'wakeup_requests'::text;
  END IF;
  IF to_regclass('public.work_item_comments') IS NOT NULL THEN
    ALTER TABLE public.work_item_comments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_comments;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_comments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_comments'::text;
  END IF;
  IF to_regclass('public.work_item_documents') IS NOT NULL THEN
    ALTER TABLE public.work_item_documents ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_documents;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_documents
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_documents'::text;
  END IF;
  IF to_regclass('public.work_item_events') IS NOT NULL THEN
    ALTER TABLE public.work_item_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_events;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_events'::text;
  END IF;
  IF to_regclass('public.work_item_external_refs') IS NOT NULL THEN
    ALTER TABLE public.work_item_external_refs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_external_refs;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_external_refs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_external_refs'::text;
  END IF;
  IF to_regclass('public.work_item_label_assignments') IS NOT NULL THEN
    ALTER TABLE public.work_item_label_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_label_assignments;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_label_assignments
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_label_assignments'::text;
  END IF;
  IF to_regclass('public.work_item_labels') IS NOT NULL THEN
    ALTER TABLE public.work_item_labels ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_labels;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_labels
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_labels'::text;
  END IF;
  IF to_regclass('public.work_item_saved_views') IS NOT NULL THEN
    ALTER TABLE public.work_item_saved_views ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_saved_views;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_saved_views
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_saved_views'::text;
  END IF;
  IF to_regclass('public.work_item_statuses') IS NOT NULL THEN
    ALTER TABLE public.work_item_statuses ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_statuses;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_statuses
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_statuses'::text;
  END IF;
  IF to_regclass('public.work_item_thread_links') IS NOT NULL THEN
    ALTER TABLE public.work_item_thread_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_item_thread_links;
    CREATE POLICY analyst_tenant_isolation ON public.work_item_thread_links
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_item_thread_links'::text;
  END IF;
  IF to_regclass('public.work_items') IS NOT NULL THEN
    ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.work_items;
    CREATE POLICY analyst_tenant_isolation ON public.work_items
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'work_items'::text;
  END IF;
  IF to_regclass('public.workflow_configs') IS NOT NULL THEN
    ALTER TABLE public.workflow_configs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_configs;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_configs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_configs'::text;
  END IF;
  IF to_regclass('public.workflow_engine_bindings') IS NOT NULL THEN
    ALTER TABLE public.workflow_engine_bindings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_engine_bindings;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_engine_bindings
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_engine_bindings'::text;
  END IF;
  IF to_regclass('public.workflow_evidence') IS NOT NULL THEN
    ALTER TABLE public.workflow_evidence ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_evidence;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_evidence
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_evidence'::text;
  END IF;
  IF to_regclass('public.workflow_run_events') IS NOT NULL THEN
    ALTER TABLE public.workflow_run_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_run_events;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_run_events
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_run_events'::text;
  END IF;
  IF to_regclass('public.workflow_runs') IS NOT NULL THEN
    ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_runs;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_runs
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_runs'::text;
  END IF;
  IF to_regclass('public.workflow_triggers') IS NOT NULL THEN
    ALTER TABLE public.workflow_triggers ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_triggers;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_triggers
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_triggers'::text;
  END IF;
  IF to_regclass('public.workflow_versions') IS NOT NULL THEN
    ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflow_versions;
    CREATE POLICY analyst_tenant_isolation ON public.workflow_versions
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflow_versions'::text;
  END IF;
  IF to_regclass('public.workflows') IS NOT NULL THEN
    ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS analyst_tenant_isolation ON public.workflows;
    CREATE POLICY analyst_tenant_isolation ON public.workflows
      FOR SELECT TO analyst_reader
      USING (tenant_id = current_setting('thinkwork.analyst_tenant', true)::uuid);
  ELSE
    missing := missing || 'workflows'::text;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE WARNING 'analyst RLS skipped for tables missing on this database: %', missing;
  END IF;
END $$;
-- END GENERATED ANALYST RLS

COMMIT;
