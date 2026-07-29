-- 0227_analyst_reader_role.sql
--
-- THINK-228 U2: the ThinkWork Analyst read-only Aurora role.
--
-- Provisions `analyst_reader`, the least-privilege role the analyst
-- query-broker Lambda uses to execute model-authored SQL against the dev
-- Postgres. Unlike compliance_reader (threat-modeled for a trusted
-- backend), this role's query author is an LLM, so the migration applies
-- the KTD7 adversarial-author hardening:
--
--   - NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
--     NOREPLICATION, and no role memberships (blocks SET ROLE /
--     SET SESSION AUTHORIZATION escalation).
--   - Read-only default transaction mode, statement timeout, search_path,
--     and idle-in-transaction timeout at role level. Defense-in-depth: the
--     hard write barrier is the grant surface (SELECT only, no
--     INSERT/UPDATE/DELETE anywhere).
--   - REVOKE CREATE ON SCHEMA public FROM PUBLIC (blocks CREATE TABLE)
--     and REVOKE TEMP ON DATABASE FROM PUBLIC (blocks CREATE TEMP TABLE).
--     These mutate database-wide ACLs: every non-owner role loses them.
--     Audited dependents: the compliance_* roles never CREATE objects or
--     TEMP tables (their grant surface is compliance.* DML only — see
--     drizzle/0070), so no grant-backs are required. On PostgreSQL >= 15
--     the CREATE revoke is already the default and this is a no-op.
--   - SECURITY DEFINER audit: every SECURITY DEFINER function in schema
--     public loses PUBLIC EXECUTE (a definer function can flip read-only
--     inside its own body); EXECUTE is granted back to the enumerated
--     compliance_* roles so their query surface is unchanged. Ordinary
--     (invoker) functions — including the recreated pg_trgm extension
--     functions — keep their PUBLIC EXECUTE grants untouched.
--   - Explicit per-table SELECT grants generated from the U1 semantic
--     model denylist (packages/database-pg/src/analyst/semantic-model.ts).
--     Secret-bearing tables are never granted; mixed tables get
--     column-level SELECT. Fail-closed: a table added after this apply is
--     unreadable until the generated section is regenerated and re-applied
--     (the staleness test in __tests__/analyst-semantic-model.test.ts
--     fails on any schema change until the regen runs).
--
-- Plan reference:
--   docs/plans/2026-07-08-001-feat-thinkwork-analyst-plan.md (U2, KTD7)
--
-- Apply manually (hand-rolled — NOT in meta/_journal.json):
--   The bootstrap helper wraps this file with psql variable substitution +
--   Secrets Manager population:
--     STAGE=dev bash scripts/bootstrap-analyst-roles.sh
--   Direct apply (advanced — must supply the password):
--     psql "$DATABASE_URL" \
--       -v reader_pass="$ANALYST_READER_PASS" \
--       -f packages/database-pg/drizzle/0227_analyst_reader_role.sql
--
-- Re-running is idempotent: the DO block ALTERs the password when the role
-- exists; GRANT/REVOKE are inherently idempotent.
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the drift gate):
--
-- creates-role: analyst_reader

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- The reader password is OPTIONAL. Supplied (-v reader_pass=...) it is used
-- verbatim (dev bootstrap path, which also stores it in Secrets Manager).
-- Absent — the customer deployment runner's migration sweep passes only
-- `stage` — a random throwaway password is generated instead: since
-- THINK-229 the broker authenticates via RDS IAM tokens (0229 grants
-- rds_iam), the password is a dormant fallback, and operator provisioning
-- (`provisionAnalystConnector`) rotates it with a stored value on demand.
\if :{?reader_pass}
SET LOCAL "thinkwork.analyst_reader_pass" = :'reader_pass';
\else
-- DO block so the generated value never echoes into psql output (runner
-- stdout is shipped to CloudWatch).
DO $$
BEGIN
  PERFORM set_config('thinkwork.analyst_reader_pass',
                     md5(random()::text) || md5(random()::text), true);
END $$;
\endif

-- Refuse to apply against an unexpected DB (stale DATABASE_URL guard).
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Role creation (idempotent) + KTD7 attribute hardening
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyst_reader') THEN
    EXECUTE format(
      'CREATE ROLE analyst_reader WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
      current_setting('thinkwork.analyst_reader_pass'));
  ELSE
    -- Re-run path: rotate the password only. On RDS the master user is
    -- rds_superuser, NOT superuser, and an ALTER ROLE that mentions any
    -- superuser-class attribute (even the no-op NOSUPERUSER / NOBYPASSRLS /
    -- NOREPLICATION) fails with "must be superuser to alter superuser
    -- roles" — attributes are pinned at creation and asserted below.
    EXECUTE format(
      'ALTER ROLE analyst_reader WITH LOGIN PASSWORD %L',
      current_setting('thinkwork.analyst_reader_pass'));
  END IF;
END $$;

-- Assert the creation-time attribute hardening actually holds (covers the
-- re-run path, where ALTER no longer re-asserts attributes, and any
-- out-of-band mutation).
DO $$
DECLARE
  r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'analyst_reader';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit
     OR r.rolbypassrls OR r.rolreplication THEN
    RAISE EXCEPTION 'analyst_reader attribute hardening violated: super=% createdb=% createrole=% inherit=% bypassrls=% replication=%',
      r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit, r.rolbypassrls, r.rolreplication;
  END IF;
END $$;

-- Role-level session defaults. USERSET GUCs are resettable within a
-- session, so the broker issues DISCARD ALL before every query (KTD7);
-- these are defense-in-depth behind the SELECT-only grant surface.
ALTER ROLE analyst_reader SET default_transaction_read_only = on;
ALTER ROLE analyst_reader SET statement_timeout = '15s';
ALTER ROLE analyst_reader SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE analyst_reader SET search_path = public;

-- Assert the role holds no memberships beyond the allowlist (SET ROLE
-- escalation surface). This migration never grants any; the single
-- allowlisted membership is rds_iam (THINK-229 U1, granted by
-- drizzle/0229_analyst_reader_rds_iam_grant.sql — a marker role that
-- flips the login path to IAM tokens and carries no privileges to
-- inherit). Anything else appearing out-of-band fails the apply loudly
-- rather than proceeding with a widened surface.
DO $$
DECLARE
  membership text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO membership
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE member.rolname = 'analyst_reader'
    AND r.rolname <> 'rds_iam';
  IF membership IS NOT NULL THEN
    RAISE EXCEPTION 'analyst_reader unexpectedly holds role memberships: %', membership;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Schema-level lockdown (database-wide ACL changes — see header audit)
-- ---------------------------------------------------------------------------

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMP ON DATABASE thinkwork FROM PUBLIC;

-- SECURITY DEFINER audit: strip PUBLIC EXECUTE from definer functions in
-- public, granting back to the enumerated compliance_* roles. Emits a
-- NOTICE per affected function so the operator sees exactly what changed.
DO $$
DECLARE
  fn record;
  grantees text;
BEGIN
  -- Grant back only to compliance roles that exist on this stage (a fresh
  -- stage may not have run the compliance bootstrap yet).
  SELECT string_agg(quote_ident(rolname), ', ') INTO grantees
  FROM pg_roles
  WHERE rolname IN ('compliance_writer', 'compliance_drainer', 'compliance_reader');
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
    IF grantees IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', fn.signature, grantees);
    END IF;
    RAISE NOTICE 'SECURITY DEFINER hardened: % (PUBLIC EXECUTE revoked; granted back to: %)',
      fn.signature, coalesce(grantees, '<none>');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SELECT grant surface (generated — do not edit by hand)
--
-- Regenerate: npx tsx scripts/generate-analyst-schema.ts
-- Source of truth: packages/database-pg/src/analyst/semantic-model.ts
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO analyst_reader;

-- BEGIN GENERATED ANALYST GRANTS
DO $$
DECLARE
  missing text[] := '{}';
BEGIN
  IF to_regclass('public.activity_log') IS NOT NULL THEN
    GRANT SELECT ON public.activity_log TO analyst_reader;
  ELSE
    missing := missing || 'activity_log'::text;
  END IF;
  IF to_regclass('public.agent_capabilities') IS NOT NULL THEN
    GRANT SELECT ON public.agent_capabilities TO analyst_reader;
  ELSE
    missing := missing || 'agent_capabilities'::text;
  END IF;
  IF to_regclass('public.agent_loop_iterations') IS NOT NULL THEN
    GRANT SELECT ON public.agent_loop_iterations TO analyst_reader;
  ELSE
    missing := missing || 'agent_loop_iterations'::text;
  END IF;
  IF to_regclass('public.agent_loop_runs') IS NOT NULL THEN
    GRANT SELECT ON public.agent_loop_runs TO analyst_reader;
  ELSE
    missing := missing || 'agent_loop_runs'::text;
  END IF;
  IF to_regclass('public.agent_loop_versions') IS NOT NULL THEN
    GRANT SELECT ON public.agent_loop_versions TO analyst_reader;
  ELSE
    missing := missing || 'agent_loop_versions'::text;
  END IF;
  IF to_regclass('public.agent_loops') IS NOT NULL THEN
    GRANT SELECT ON public.agent_loops TO analyst_reader;
  ELSE
    missing := missing || 'agent_loops'::text;
  END IF;
  IF to_regclass('public.agent_mcp_servers') IS NOT NULL THEN
    GRANT SELECT ON public.agent_mcp_servers TO analyst_reader;
  ELSE
    missing := missing || 'agent_mcp_servers'::text;
  END IF;
  IF to_regclass('public.agent_operation_leases') IS NOT NULL THEN
    GRANT SELECT ON public.agent_operation_leases TO analyst_reader;
  ELSE
    missing := missing || 'agent_operation_leases'::text;
  END IF;
  IF to_regclass('public.agent_profile_space_assignments') IS NOT NULL THEN
    GRANT SELECT ON public.agent_profile_space_assignments TO analyst_reader;
  ELSE
    missing := missing || 'agent_profile_space_assignments'::text;
  END IF;
  IF to_regclass('public.agent_profiles') IS NOT NULL THEN
    GRANT SELECT ON public.agent_profiles TO analyst_reader;
  ELSE
    missing := missing || 'agent_profiles'::text;
  END IF;
  IF to_regclass('public.agent_skills') IS NOT NULL THEN
    GRANT SELECT ON public.agent_skills TO analyst_reader;
  ELSE
    missing := missing || 'agent_skills'::text;
  END IF;
  IF to_regclass('public.agent_template_mcp_servers') IS NOT NULL THEN
    GRANT SELECT ON public.agent_template_mcp_servers TO analyst_reader;
  ELSE
    missing := missing || 'agent_template_mcp_servers'::text;
  END IF;
  IF to_regclass('public.agent_templates') IS NOT NULL THEN
    GRANT SELECT ON public.agent_templates TO analyst_reader;
  ELSE
    missing := missing || 'agent_templates'::text;
  END IF;
  IF to_regclass('public.agent_versions') IS NOT NULL THEN
    GRANT SELECT ON public.agent_versions TO analyst_reader;
  ELSE
    missing := missing || 'agent_versions'::text;
  END IF;
  IF to_regclass('public.agent_wakeup_requests') IS NOT NULL THEN
    GRANT SELECT ON public.agent_wakeup_requests TO analyst_reader;
  ELSE
    missing := missing || 'agent_wakeup_requests'::text;
  END IF;
  IF to_regclass('public.agent_workspace_events') IS NOT NULL THEN
    GRANT SELECT ON public.agent_workspace_events TO analyst_reader;
  ELSE
    missing := missing || 'agent_workspace_events'::text;
  END IF;
  IF to_regclass('public.agent_workspace_runs') IS NOT NULL THEN
    GRANT SELECT ON public.agent_workspace_runs TO analyst_reader;
  ELSE
    missing := missing || 'agent_workspace_runs'::text;
  END IF;
  IF to_regclass('public.agents') IS NOT NULL THEN
    GRANT SELECT ON public.agents TO analyst_reader;
  ELSE
    missing := missing || 'agents'::text;
  END IF;
  IF to_regclass('public.artifact_data_bindings') IS NOT NULL THEN
    GRANT SELECT ON public.artifact_data_bindings TO analyst_reader;
  ELSE
    missing := missing || 'artifact_data_bindings'::text;
  END IF;
  IF to_regclass('public.artifact_shares') IS NOT NULL THEN
    GRANT SELECT ON public.artifact_shares TO analyst_reader;
  ELSE
    missing := missing || 'artifact_shares'::text;
  END IF;
  IF to_regclass('public.artifact_versions') IS NOT NULL THEN
    GRANT SELECT ON public.artifact_versions TO analyst_reader;
  ELSE
    missing := missing || 'artifact_versions'::text;
  END IF;
  IF to_regclass('public.artifacts') IS NOT NULL THEN
    GRANT SELECT ON public.artifacts TO analyst_reader;
  ELSE
    missing := missing || 'artifacts'::text;
  END IF;
  IF to_regclass('public.billing_export_line_items') IS NOT NULL THEN
    GRANT SELECT ON public.billing_export_line_items TO analyst_reader;
  ELSE
    missing := missing || 'billing_export_line_items'::text;
  END IF;
  IF to_regclass('public.budget_policies') IS NOT NULL THEN
    GRANT SELECT ON public.budget_policies TO analyst_reader;
  ELSE
    missing := missing || 'budget_policies'::text;
  END IF;
  IF to_regclass('public.capability_broker_calls') IS NOT NULL THEN
    GRANT SELECT ON public.capability_broker_calls TO analyst_reader;
  ELSE
    missing := missing || 'capability_broker_calls'::text;
  END IF;
  IF to_regclass('public.capability_broker_sessions') IS NOT NULL THEN
    GRANT SELECT ON public.capability_broker_sessions TO analyst_reader;
  ELSE
    missing := missing || 'capability_broker_sessions'::text;
  END IF;
  IF to_regclass('public.capability_catalog') IS NOT NULL THEN
    GRANT SELECT ON public.capability_catalog TO analyst_reader;
  ELSE
    missing := missing || 'capability_catalog'::text;
  END IF;
  IF to_regclass('public.capability_connection_proposals') IS NOT NULL THEN
    GRANT SELECT ON public.capability_connection_proposals TO analyst_reader;
  ELSE
    missing := missing || 'capability_connection_proposals'::text;
  END IF;
  IF to_regclass('public.capability_definitions') IS NOT NULL THEN
    GRANT SELECT ON public.capability_definitions TO analyst_reader;
  ELSE
    missing := missing || 'capability_definitions'::text;
  END IF;
  IF to_regclass('public.capability_routine_proposals') IS NOT NULL THEN
    GRANT SELECT ON public.capability_routine_proposals TO analyst_reader;
  ELSE
    missing := missing || 'capability_routine_proposals'::text;
  END IF;
  IF to_regclass('public.connections') IS NOT NULL THEN
    GRANT SELECT ON public.connections TO analyst_reader;
  ELSE
    missing := missing || 'connections'::text;
  END IF;
  IF to_regclass('public.cost_events') IS NOT NULL THEN
    GRANT SELECT ON public.cost_events TO analyst_reader;
  ELSE
    missing := missing || 'cost_events'::text;
  END IF;
  IF to_regclass('public.crm_work_links') IS NOT NULL THEN
    GRANT SELECT ON public.crm_work_links TO analyst_reader;
  ELSE
    missing := missing || 'crm_work_links'::text;
  END IF;
  IF to_regclass('public.document_conformance_reports') IS NOT NULL THEN
    GRANT SELECT ON public.document_conformance_reports TO analyst_reader;
  ELSE
    missing := missing || 'document_conformance_reports'::text;
  END IF;
  IF to_regclass('public.document_plates') IS NOT NULL THEN
    GRANT SELECT ON public.document_plates TO analyst_reader;
  ELSE
    missing := missing || 'document_plates'::text;
  END IF;
  IF to_regclass('public.document_section_waivers') IS NOT NULL THEN
    GRANT SELECT ON public.document_section_waivers TO analyst_reader;
  ELSE
    missing := missing || 'document_section_waivers'::text;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    GRANT SELECT ON public.documents TO analyst_reader;
  ELSE
    missing := missing || 'documents'::text;
  END IF;
  IF to_regclass('public.email_body_objects') IS NOT NULL THEN
    GRANT SELECT ON public.email_body_objects TO analyst_reader;
  ELSE
    missing := missing || 'email_body_objects'::text;
  END IF;
  IF to_regclass('public.email_conversations') IS NOT NULL THEN
    GRANT SELECT ON public.email_conversations TO analyst_reader;
  ELSE
    missing := missing || 'email_conversations'::text;
  END IF;
  IF to_regclass('public.email_domains') IS NOT NULL THEN
    GRANT SELECT ON public.email_domains TO analyst_reader;
  ELSE
    missing := missing || 'email_domains'::text;
  END IF;
  IF to_regclass('public.email_ledger_events') IS NOT NULL THEN
    GRANT SELECT ON public.email_ledger_events TO analyst_reader;
  ELSE
    missing := missing || 'email_ledger_events'::text;
  END IF;
  IF to_regclass('public.email_provider_events') IS NOT NULL THEN
    GRANT SELECT ON public.email_provider_events TO analyst_reader;
  ELSE
    missing := missing || 'email_provider_events'::text;
  END IF;
  IF to_regclass('public.email_readiness_checks') IS NOT NULL THEN
    GRANT SELECT ON public.email_readiness_checks TO analyst_reader;
  ELSE
    missing := missing || 'email_readiness_checks'::text;
  END IF;
  IF to_regclass('public.email_ses_compatibility_mappings') IS NOT NULL THEN
    GRANT SELECT ON public.email_ses_compatibility_mappings TO analyst_reader;
  ELSE
    missing := missing || 'email_ses_compatibility_mappings'::text;
  END IF;
  IF to_regclass('public.email_space_policies') IS NOT NULL THEN
    GRANT SELECT ON public.email_space_policies TO analyst_reader;
  ELSE
    missing := missing || 'email_space_policies'::text;
  END IF;
  IF to_regclass('public.email_space_sender_allowlists') IS NOT NULL THEN
    GRANT SELECT ON public.email_space_sender_allowlists TO analyst_reader;
  ELSE
    missing := missing || 'email_space_sender_allowlists'::text;
  END IF;
  IF to_regclass('public.eval_case_overrides') IS NOT NULL THEN
    GRANT SELECT ON public.eval_case_overrides TO analyst_reader;
  ELSE
    missing := missing || 'eval_case_overrides'::text;
  END IF;
  IF to_regclass('public.eval_datasets') IS NOT NULL THEN
    GRANT SELECT ON public.eval_datasets TO analyst_reader;
  ELSE
    missing := missing || 'eval_datasets'::text;
  END IF;
  IF to_regclass('public.eval_profiles') IS NOT NULL THEN
    GRANT SELECT ON public.eval_profiles TO analyst_reader;
  ELSE
    missing := missing || 'eval_profiles'::text;
  END IF;
  IF to_regclass('public.eval_replay_tool_allowlist') IS NOT NULL THEN
    GRANT SELECT ON public.eval_replay_tool_allowlist TO analyst_reader;
  ELSE
    missing := missing || 'eval_replay_tool_allowlist'::text;
  END IF;
  IF to_regclass('public.eval_results') IS NOT NULL THEN
    GRANT SELECT ON public.eval_results TO analyst_reader;
  ELSE
    missing := missing || 'eval_results'::text;
  END IF;
  IF to_regclass('public.eval_runs') IS NOT NULL THEN
    GRANT SELECT ON public.eval_runs TO analyst_reader;
  ELSE
    missing := missing || 'eval_runs'::text;
  END IF;
  IF to_regclass('public.eval_skill_gate') IS NOT NULL THEN
    GRANT SELECT ON public.eval_skill_gate TO analyst_reader;
  ELSE
    missing := missing || 'eval_skill_gate'::text;
  END IF;
  IF to_regclass('public.eval_test_cases') IS NOT NULL THEN
    GRANT SELECT ON public.eval_test_cases TO analyst_reader;
  ELSE
    missing := missing || 'eval_test_cases'::text;
  END IF;
  IF to_regclass('public.folder_bundle_import_rate_limits') IS NOT NULL THEN
    GRANT SELECT ON public.folder_bundle_import_rate_limits TO analyst_reader;
  ELSE
    missing := missing || 'folder_bundle_import_rate_limits'::text;
  END IF;
  IF to_regclass('public.github_app_installations') IS NOT NULL THEN
    GRANT SELECT ON public.github_app_installations TO analyst_reader;
  ELSE
    missing := missing || 'github_app_installations'::text;
  END IF;
  IF to_regclass('public.github_webhook_deliveries') IS NOT NULL THEN
    GRANT SELECT ON public.github_webhook_deliveries TO analyst_reader;
  ELSE
    missing := missing || 'github_webhook_deliveries'::text;
  END IF;
  IF to_regclass('public.goals') IS NOT NULL THEN
    GRANT SELECT ON public.goals TO analyst_reader;
  ELSE
    missing := missing || 'goals'::text;
  END IF;
  IF to_regclass('public.guardrail_blocks') IS NOT NULL THEN
    GRANT SELECT ON public.guardrail_blocks TO analyst_reader;
  ELSE
    missing := missing || 'guardrail_blocks'::text;
  END IF;
  IF to_regclass('public.guardrails') IS NOT NULL THEN
    GRANT SELECT ON public.guardrails TO analyst_reader;
  ELSE
    missing := missing || 'guardrails'::text;
  END IF;
  IF to_regclass('public.inbox_item_comments') IS NOT NULL THEN
    GRANT SELECT ON public.inbox_item_comments TO analyst_reader;
  ELSE
    missing := missing || 'inbox_item_comments'::text;
  END IF;
  IF to_regclass('public.inbox_item_links') IS NOT NULL THEN
    GRANT SELECT ON public.inbox_item_links TO analyst_reader;
  ELSE
    missing := missing || 'inbox_item_links'::text;
  END IF;
  IF to_regclass('public.inbox_items') IS NOT NULL THEN
    GRANT SELECT ON public.inbox_items TO analyst_reader;
  ELSE
    missing := missing || 'inbox_items'::text;
  END IF;
  IF to_regclass('public.linked_task_events') IS NOT NULL THEN
    GRANT SELECT ON public.linked_task_events TO analyst_reader;
  ELSE
    missing := missing || 'linked_task_events'::text;
  END IF;
  IF to_regclass('public.linked_tasks') IS NOT NULL THEN
    GRANT SELECT ON public.linked_tasks TO analyst_reader;
  ELSE
    missing := missing || 'linked_tasks'::text;
  END IF;
  IF to_regclass('public.managed_application_deployment_events') IS NOT NULL THEN
    GRANT SELECT ON public.managed_application_deployment_events TO analyst_reader;
  ELSE
    missing := missing || 'managed_application_deployment_events'::text;
  END IF;
  IF to_regclass('public.managed_application_deployment_jobs') IS NOT NULL THEN
    GRANT SELECT ON public.managed_application_deployment_jobs TO analyst_reader;
  ELSE
    missing := missing || 'managed_application_deployment_jobs'::text;
  END IF;
  IF to_regclass('public.managed_applications') IS NOT NULL THEN
    GRANT SELECT ON public.managed_applications TO analyst_reader;
  ELSE
    missing := missing || 'managed_applications'::text;
  END IF;
  IF to_regclass('public.memory_claim_evidence') IS NOT NULL THEN
    GRANT SELECT ON public.memory_claim_evidence TO analyst_reader;
  ELSE
    missing := missing || 'memory_claim_evidence'::text;
  END IF;
  IF to_regclass('public.memory_claims') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.memory_claims FROM analyst_reader;
    GRANT SELECT (canonical_subject_id, conflict_state, created_at, effective_from, effective_to, extraction_version, id, ontology_predicate, status, subject_entity_type, subject_key, target_id, target_scope, tenant_id, updated_at, value_hash) ON public.memory_claims TO analyst_reader;
  ELSE
    missing := missing || 'memory_claims'::text;
  END IF;
  IF to_regclass('public.memory_derivations') IS NOT NULL THEN
    GRANT SELECT ON public.memory_derivations TO analyst_reader;
  ELSE
    missing := missing || 'memory_derivations'::text;
  END IF;
  IF to_regclass('public.memory_evidence_items') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.memory_evidence_items FROM analyst_reader;
    GRANT SELECT (acquisition_run_id, content_hash, created_at, extraction_recipe, id, last_error, lifecycle, sensitivity, snapshot_expires_at, snapshot_ref, source_config_id, source_item_id, source_timestamp, source_version, target_id, target_scope, tenant_id, updated_at) ON public.memory_evidence_items TO analyst_reader;
  ELSE
    missing := missing || 'memory_evidence_items'::text;
  END IF;
  IF to_regclass('public.memory_processor_configs') IS NOT NULL THEN
    GRANT SELECT ON public.memory_processor_configs TO analyst_reader;
  ELSE
    missing := missing || 'memory_processor_configs'::text;
  END IF;
  IF to_regclass('public.memory_retraction_attempts') IS NOT NULL THEN
    GRANT SELECT ON public.memory_retraction_attempts TO analyst_reader;
  ELSE
    missing := missing || 'memory_retraction_attempts'::text;
  END IF;
  IF to_regclass('public.memory_run_items') IS NOT NULL THEN
    GRANT SELECT ON public.memory_run_items TO analyst_reader;
  ELSE
    missing := missing || 'memory_run_items'::text;
  END IF;
  IF to_regclass('public.memory_source_authorizations') IS NOT NULL THEN
    GRANT SELECT ON public.memory_source_authorizations TO analyst_reader;
  ELSE
    missing := missing || 'memory_source_authorizations'::text;
  END IF;
  IF to_regclass('public.memory_source_checkpoints') IS NOT NULL THEN
    GRANT SELECT ON public.memory_source_checkpoints TO analyst_reader;
  ELSE
    missing := missing || 'memory_source_checkpoints'::text;
  END IF;
  IF to_regclass('public.memory_source_configs') IS NOT NULL THEN
    GRANT SELECT ON public.memory_source_configs TO analyst_reader;
  ELSE
    missing := missing || 'memory_source_configs'::text;
  END IF;
  IF to_regclass('public.message_artifacts') IS NOT NULL THEN
    GRANT SELECT ON public.message_artifacts TO analyst_reader;
  ELSE
    missing := missing || 'message_artifacts'::text;
  END IF;
  IF to_regclass('public.message_mentions') IS NOT NULL THEN
    GRANT SELECT ON public.message_mentions TO analyst_reader;
  ELSE
    missing := missing || 'message_mentions'::text;
  END IF;
  IF to_regclass('public.messages') IS NOT NULL THEN
    GRANT SELECT ON public.messages TO analyst_reader;
  ELSE
    missing := missing || 'messages'::text;
  END IF;
  IF to_regclass('public.model_catalog') IS NOT NULL THEN
    GRANT SELECT ON public.model_catalog TO analyst_reader;
  ELSE
    missing := missing || 'model_catalog'::text;
  END IF;
  IF to_regclass('public.msteams_tenant_installs') IS NOT NULL THEN
    GRANT SELECT ON public.msteams_tenant_installs TO analyst_reader;
  ELSE
    missing := missing || 'msteams_tenant_installs'::text;
  END IF;
  IF to_regclass('public.msteams_threads') IS NOT NULL THEN
    GRANT SELECT ON public.msteams_threads TO analyst_reader;
  ELSE
    missing := missing || 'msteams_threads'::text;
  END IF;
  IF to_regclass('public.msteams_user_links') IS NOT NULL THEN
    GRANT SELECT ON public.msteams_user_links TO analyst_reader;
  ELSE
    missing := missing || 'msteams_user_links'::text;
  END IF;
  IF to_regclass('public.mutation_idempotency') IS NOT NULL THEN
    GRANT SELECT ON public.mutation_idempotency TO analyst_reader;
  ELSE
    missing := missing || 'mutation_idempotency'::text;
  END IF;
  IF to_regclass('public.pending_user_questions') IS NOT NULL THEN
    GRANT SELECT ON public.pending_user_questions TO analyst_reader;
  ELSE
    missing := missing || 'pending_user_questions'::text;
  END IF;
  IF to_regclass('public.pi_extension_assignments') IS NOT NULL THEN
    GRANT SELECT ON public.pi_extension_assignments TO analyst_reader;
  ELSE
    missing := missing || 'pi_extension_assignments'::text;
  END IF;
  IF to_regclass('public.pi_extension_sources') IS NOT NULL THEN
    GRANT SELECT ON public.pi_extension_sources TO analyst_reader;
  ELSE
    missing := missing || 'pi_extension_sources'::text;
  END IF;
  IF to_regclass('public.pi_extension_versions') IS NOT NULL THEN
    GRANT SELECT ON public.pi_extension_versions TO analyst_reader;
  ELSE
    missing := missing || 'pi_extension_versions'::text;
  END IF;
  IF to_regclass('public.plugin_app_overlays') IS NOT NULL THEN
    GRANT SELECT ON public.plugin_app_overlays TO analyst_reader;
  ELSE
    missing := missing || 'plugin_app_overlays'::text;
  END IF;
  IF to_regclass('public.plugin_components') IS NOT NULL THEN
    GRANT SELECT ON public.plugin_components TO analyst_reader;
  ELSE
    missing := missing || 'plugin_components'::text;
  END IF;
  IF to_regclass('public.plugin_entitlements') IS NOT NULL THEN
    GRANT SELECT ON public.plugin_entitlements TO analyst_reader;
  ELSE
    missing := missing || 'plugin_entitlements'::text;
  END IF;
  IF to_regclass('public.plugin_installs') IS NOT NULL THEN
    GRANT SELECT ON public.plugin_installs TO analyst_reader;
  ELSE
    missing := missing || 'plugin_installs'::text;
  END IF;
  IF to_regclass('public.plugin_uploads') IS NOT NULL THEN
    GRANT SELECT ON public.plugin_uploads TO analyst_reader;
  ELSE
    missing := missing || 'plugin_uploads'::text;
  END IF;
  IF to_regclass('public.principal_permission_grants') IS NOT NULL THEN
    GRANT SELECT ON public.principal_permission_grants TO analyst_reader;
  ELSE
    missing := missing || 'principal_permission_grants'::text;
  END IF;
  IF to_regclass('public.recipes') IS NOT NULL THEN
    GRANT SELECT ON public.recipes TO analyst_reader;
  ELSE
    missing := missing || 'recipes'::text;
  END IF;
  IF to_regclass('public.release_update_events') IS NOT NULL THEN
    GRANT SELECT ON public.release_update_events TO analyst_reader;
  ELSE
    missing := missing || 'release_update_events'::text;
  END IF;
  IF to_regclass('public.release_update_jobs') IS NOT NULL THEN
    GRANT SELECT ON public.release_update_jobs TO analyst_reader;
  ELSE
    missing := missing || 'release_update_jobs'::text;
  END IF;
  IF to_regclass('public.resolved_capability_manifests') IS NOT NULL THEN
    GRANT SELECT ON public.resolved_capability_manifests TO analyst_reader;
  ELSE
    missing := missing || 'resolved_capability_manifests'::text;
  END IF;
  IF to_regclass('public.retry_queue') IS NOT NULL THEN
    GRANT SELECT ON public.retry_queue TO analyst_reader;
  ELSE
    missing := missing || 'retry_queue'::text;
  END IF;
  IF to_regclass('public.routine_asl_versions') IS NOT NULL THEN
    GRANT SELECT ON public.routine_asl_versions TO analyst_reader;
  ELSE
    missing := missing || 'routine_asl_versions'::text;
  END IF;
  IF to_regclass('public.routine_code_cache') IS NOT NULL THEN
    GRANT SELECT ON public.routine_code_cache TO analyst_reader;
  ELSE
    missing := missing || 'routine_code_cache'::text;
  END IF;
  IF to_regclass('public.routine_executions') IS NOT NULL THEN
    GRANT SELECT ON public.routine_executions TO analyst_reader;
  ELSE
    missing := missing || 'routine_executions'::text;
  END IF;
  IF to_regclass('public.routine_repair_events') IS NOT NULL THEN
    GRANT SELECT ON public.routine_repair_events TO analyst_reader;
  ELSE
    missing := missing || 'routine_repair_events'::text;
  END IF;
  IF to_regclass('public.routine_step_events') IS NOT NULL THEN
    GRANT SELECT ON public.routine_step_events TO analyst_reader;
  ELSE
    missing := missing || 'routine_step_events'::text;
  END IF;
  IF to_regclass('public.routines') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.routines FROM analyst_reader;
    GRANT SELECT (agent_id, capability_dependencies, catalog_slug, config, created_at, current_version, description, disabled_reason, documentation_md, engine, execution_principal, fixture_paths, id, last_run_at, module_path, name, next_run_at, owning_agent_id, schedule, state_machine_alias_arn, state_machine_arn, status, tenant_id, type, updated_at, validated_sha, visibility) ON public.routines TO analyst_reader;
  ELSE
    missing := missing || 'routines'::text;
  END IF;
  IF to_regclass('public.sandbox_agent_hourly_counters') IS NOT NULL THEN
    GRANT SELECT ON public.sandbox_agent_hourly_counters TO analyst_reader;
  ELSE
    missing := missing || 'sandbox_agent_hourly_counters'::text;
  END IF;
  IF to_regclass('public.sandbox_invocations') IS NOT NULL THEN
    GRANT SELECT ON public.sandbox_invocations TO analyst_reader;
  ELSE
    missing := missing || 'sandbox_invocations'::text;
  END IF;
  IF to_regclass('public.sandbox_tenant_daily_counters') IS NOT NULL THEN
    GRANT SELECT ON public.sandbox_tenant_daily_counters TO analyst_reader;
  ELSE
    missing := missing || 'sandbox_tenant_daily_counters'::text;
  END IF;
  IF to_regclass('public.scheduled_jobs') IS NOT NULL THEN
    GRANT SELECT ON public.scheduled_jobs TO analyst_reader;
  ELSE
    missing := missing || 'scheduled_jobs'::text;
  END IF;
  IF to_regclass('public.skill_catalog') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.skill_catalog FROM analyst_reader;
    GRANT SELECT (category, content_sha, created_at, description, display_name, icon, id, signature_status, signed_at, signed_by_user_id, signed_content_sha, signed_payload_hash, slug, tags, tenant_id, trust_report, trust_report_content_sha, trust_report_pipeline_version, trust_report_updated_at, updated_at) ON public.skill_catalog TO analyst_reader;
  ELSE
    missing := missing || 'skill_catalog'::text;
  END IF;
  IF to_regclass('public.skill_draft_events') IS NOT NULL THEN
    GRANT SELECT ON public.skill_draft_events TO analyst_reader;
  ELSE
    missing := missing || 'skill_draft_events'::text;
  END IF;
  IF to_regclass('public.skill_drafts') IS NOT NULL THEN
    GRANT SELECT ON public.skill_drafts TO analyst_reader;
  ELSE
    missing := missing || 'skill_drafts'::text;
  END IF;
  IF to_regclass('public.skill_runs') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.skill_runs FROM analyst_reader;
    GRANT SELECT (agent_id, created_at, delete_at, delivered_artifact_ref, delivery_channels, failure_reason, feedback_note, feedback_signal, finished_at, id, inputs, invocation_source, invoker_user_id, resolved_inputs, resolved_inputs_hash, skill_id, skill_version, started_at, status, tenant_id, triggered_by_run_id, updated_at) ON public.skill_runs TO analyst_reader;
  ELSE
    missing := missing || 'skill_runs'::text;
  END IF;
  IF to_regclass('public.slack_threads') IS NOT NULL THEN
    GRANT SELECT ON public.slack_threads TO analyst_reader;
  ELSE
    missing := missing || 'slack_threads'::text;
  END IF;
  IF to_regclass('public.slack_user_links') IS NOT NULL THEN
    GRANT SELECT ON public.slack_user_links TO analyst_reader;
  ELSE
    missing := missing || 'slack_user_links'::text;
  END IF;
  IF to_regclass('public.space_checklist_items') IS NOT NULL THEN
    GRANT SELECT ON public.space_checklist_items TO analyst_reader;
  ELSE
    missing := missing || 'space_checklist_items'::text;
  END IF;
  IF to_regclass('public.space_checklist_templates') IS NOT NULL THEN
    GRANT SELECT ON public.space_checklist_templates TO analyst_reader;
  ELSE
    missing := missing || 'space_checklist_templates'::text;
  END IF;
  IF to_regclass('public.space_integrations') IS NOT NULL THEN
    GRANT SELECT ON public.space_integrations TO analyst_reader;
  ELSE
    missing := missing || 'space_integrations'::text;
  END IF;
  IF to_regclass('public.space_mcp_servers') IS NOT NULL THEN
    GRANT SELECT ON public.space_mcp_servers TO analyst_reader;
  ELSE
    missing := missing || 'space_mcp_servers'::text;
  END IF;
  IF to_regclass('public.space_members') IS NOT NULL THEN
    GRANT SELECT ON public.space_members TO analyst_reader;
  ELSE
    missing := missing || 'space_members'::text;
  END IF;
  IF to_regclass('public.spaces') IS NOT NULL THEN
    GRANT SELECT ON public.spaces TO analyst_reader;
  ELSE
    missing := missing || 'spaces'::text;
  END IF;
  IF to_regclass('public.stripe_customers') IS NOT NULL THEN
    GRANT SELECT ON public.stripe_customers TO analyst_reader;
  ELSE
    missing := missing || 'stripe_customers'::text;
  END IF;
  IF to_regclass('public.stripe_subscriptions') IS NOT NULL THEN
    GRANT SELECT ON public.stripe_subscriptions TO analyst_reader;
  ELSE
    missing := missing || 'stripe_subscriptions'::text;
  END IF;
  IF to_regclass('public.tenant_builtin_tools') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.tenant_builtin_tools FROM analyst_reader;
    GRANT SELECT (config, created_at, enabled, id, last_tested_at, provider, tenant_id, tool_slug, updated_at) ON public.tenant_builtin_tools TO analyst_reader;
  ELSE
    missing := missing || 'tenant_builtin_tools'::text;
  END IF;
  IF to_regclass('public.tenant_context_provider_settings') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_context_provider_settings TO analyst_reader;
  ELSE
    missing := missing || 'tenant_context_provider_settings'::text;
  END IF;
  IF to_regclass('public.tenant_mcp_context_tools') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_mcp_context_tools TO analyst_reader;
  ELSE
    missing := missing || 'tenant_mcp_context_tools'::text;
  END IF;
  IF to_regclass('public.tenant_mcp_servers') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.tenant_mcp_servers FROM analyst_reader;
    GRANT SELECT (approved_at, approved_by, auth_type, created_at, enabled, id, managed_application_key, management_source, name, oauth_provider, plugin_install_id, runtime_metadata, slug, status, tenant_id, tools, transport, updated_at, url, url_hash) ON public.tenant_mcp_servers TO analyst_reader;
  ELSE
    missing := missing || 'tenant_mcp_servers'::text;
  END IF;
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_members TO analyst_reader;
  ELSE
    missing := missing || 'tenant_members'::text;
  END IF;
  IF to_regclass('public.tenant_model_catalog') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_model_catalog TO analyst_reader;
  ELSE
    missing := missing || 'tenant_model_catalog'::text;
  END IF;
  IF to_regclass('public.tenant_policy_events') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_policy_events TO analyst_reader;
  ELSE
    missing := missing || 'tenant_policy_events'::text;
  END IF;
  IF to_regclass('public.tenant_service_principals') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_service_principals TO analyst_reader;
  ELSE
    missing := missing || 'tenant_service_principals'::text;
  END IF;
  IF to_regclass('public.tenant_settings') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_settings TO analyst_reader;
  ELSE
    missing := missing || 'tenant_settings'::text;
  END IF;
  IF to_regclass('public.tenant_system_users') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_system_users TO analyst_reader;
  ELSE
    missing := missing || 'tenant_system_users'::text;
  END IF;
  IF to_regclass('public.tenant_workflow_catalog') IS NOT NULL THEN
    GRANT SELECT ON public.tenant_workflow_catalog TO analyst_reader;
  ELSE
    missing := missing || 'tenant_workflow_catalog'::text;
  END IF;
  IF to_regclass('public.tenants') IS NOT NULL THEN
    GRANT SELECT ON public.tenants TO analyst_reader;
  ELSE
    missing := missing || 'tenants'::text;
  END IF;
  IF to_regclass('public.thread_attachments') IS NOT NULL THEN
    GRANT SELECT ON public.thread_attachments TO analyst_reader;
  ELSE
    missing := missing || 'thread_attachments'::text;
  END IF;
  IF to_regclass('public.thread_dependencies') IS NOT NULL THEN
    GRANT SELECT ON public.thread_dependencies TO analyst_reader;
  ELSE
    missing := missing || 'thread_dependencies'::text;
  END IF;
  IF to_regclass('public.thread_idle_learning_runs') IS NOT NULL THEN
    GRANT SELECT ON public.thread_idle_learning_runs TO analyst_reader;
  ELSE
    missing := missing || 'thread_idle_learning_runs'::text;
  END IF;
  IF to_regclass('public.thread_idle_learning_state') IS NOT NULL THEN
    GRANT SELECT ON public.thread_idle_learning_state TO analyst_reader;
  ELSE
    missing := missing || 'thread_idle_learning_state'::text;
  END IF;
  IF to_regclass('public.thread_label_assignments') IS NOT NULL THEN
    GRANT SELECT ON public.thread_label_assignments TO analyst_reader;
  ELSE
    missing := missing || 'thread_label_assignments'::text;
  END IF;
  IF to_regclass('public.thread_labels') IS NOT NULL THEN
    GRANT SELECT ON public.thread_labels TO analyst_reader;
  ELSE
    missing := missing || 'thread_labels'::text;
  END IF;
  IF to_regclass('public.thread_participants') IS NOT NULL THEN
    GRANT SELECT ON public.thread_participants TO analyst_reader;
  ELSE
    missing := missing || 'thread_participants'::text;
  END IF;
  IF to_regclass('public.thread_turn_events') IS NOT NULL THEN
    GRANT SELECT ON public.thread_turn_events TO analyst_reader;
  ELSE
    missing := missing || 'thread_turn_events'::text;
  END IF;
  IF to_regclass('public.thread_turns') IS NOT NULL THEN
    GRANT SELECT ON public.thread_turns TO analyst_reader;
  ELSE
    missing := missing || 'thread_turns'::text;
  END IF;
  IF to_regclass('public.threads') IS NOT NULL THEN
    GRANT SELECT ON public.threads TO analyst_reader;
  ELSE
    missing := missing || 'threads'::text;
  END IF;
  IF to_regclass('public.tool_execution_events') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.tool_execution_events FROM analyst_reader;
    GRANT SELECT (created_at, duration_ms, error_preview, event_type, id, idempotency_key, input_preview, operation, output_preview, policy_decision_id, policy_revision, principal_id, principal_type, provider_cost_usd, provider_request_id, tenant_id, thread_id, tool_use_id, turn_id) ON public.tool_execution_events TO analyst_reader;
  ELSE
    missing := missing || 'tool_execution_events'::text;
  END IF;
  IF to_regclass('public.trace_cost_reconciliation_facts') IS NOT NULL THEN
    GRANT SELECT ON public.trace_cost_reconciliation_facts TO analyst_reader;
  ELSE
    missing := missing || 'trace_cost_reconciliation_facts'::text;
  END IF;
  IF to_regclass('public.trace_events') IS NOT NULL THEN
    GRANT SELECT ON public.trace_events TO analyst_reader;
  ELSE
    missing := missing || 'trace_events'::text;
  END IF;
  IF to_regclass('public.trace_runs') IS NOT NULL THEN
    GRANT SELECT ON public.trace_runs TO analyst_reader;
  ELSE
    missing := missing || 'trace_runs'::text;
  END IF;
  IF to_regclass('public.trace_source_evidence') IS NOT NULL THEN
    GRANT SELECT ON public.trace_source_evidence TO analyst_reader;
  ELSE
    missing := missing || 'trace_source_evidence'::text;
  END IF;
  IF to_regclass('public.twin_materialization_suggestions') IS NOT NULL THEN
    GRANT SELECT ON public.twin_materialization_suggestions TO analyst_reader;
  ELSE
    missing := missing || 'twin_materialization_suggestions'::text;
  END IF;
  IF to_regclass('public.user_model_approvals') IS NOT NULL THEN
    GRANT SELECT ON public.user_model_approvals TO analyst_reader;
  ELSE
    missing := missing || 'user_model_approvals'::text;
  END IF;
  IF to_regclass('public.user_plugin_activations') IS NOT NULL THEN
    GRANT SELECT ON public.user_plugin_activations TO analyst_reader;
  ELSE
    missing := missing || 'user_plugin_activations'::text;
  END IF;
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    GRANT SELECT ON public.user_profiles TO analyst_reader;
  ELSE
    missing := missing || 'user_profiles'::text;
  END IF;
  IF to_regclass('public.user_quick_actions') IS NOT NULL THEN
    GRANT SELECT ON public.user_quick_actions TO analyst_reader;
  ELSE
    missing := missing || 'user_quick_actions'::text;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON public.users FROM analyst_reader;
    GRANT SELECT (cognito_sub, created_at, email, email_verified_at, id, image, name, phone, phone_verified_at, tenant_id, updated_at, wiki_compile_external_enabled, workspace_folder_name) ON public.users TO analyst_reader;
  ELSE
    missing := missing || 'users'::text;
  END IF;
  IF to_regclass('public.wakeup_requests') IS NOT NULL THEN
    GRANT SELECT ON public.wakeup_requests TO analyst_reader;
  ELSE
    missing := missing || 'wakeup_requests'::text;
  END IF;
  IF to_regclass('public.work_item_comments') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_comments TO analyst_reader;
  ELSE
    missing := missing || 'work_item_comments'::text;
  END IF;
  IF to_regclass('public.work_item_documents') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_documents TO analyst_reader;
  ELSE
    missing := missing || 'work_item_documents'::text;
  END IF;
  IF to_regclass('public.work_item_events') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_events TO analyst_reader;
  ELSE
    missing := missing || 'work_item_events'::text;
  END IF;
  IF to_regclass('public.work_item_external_refs') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_external_refs TO analyst_reader;
  ELSE
    missing := missing || 'work_item_external_refs'::text;
  END IF;
  IF to_regclass('public.work_item_label_assignments') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_label_assignments TO analyst_reader;
  ELSE
    missing := missing || 'work_item_label_assignments'::text;
  END IF;
  IF to_regclass('public.work_item_labels') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_labels TO analyst_reader;
  ELSE
    missing := missing || 'work_item_labels'::text;
  END IF;
  IF to_regclass('public.work_item_saved_views') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_saved_views TO analyst_reader;
  ELSE
    missing := missing || 'work_item_saved_views'::text;
  END IF;
  IF to_regclass('public.work_item_statuses') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_statuses TO analyst_reader;
  ELSE
    missing := missing || 'work_item_statuses'::text;
  END IF;
  IF to_regclass('public.work_item_thread_links') IS NOT NULL THEN
    GRANT SELECT ON public.work_item_thread_links TO analyst_reader;
  ELSE
    missing := missing || 'work_item_thread_links'::text;
  END IF;
  IF to_regclass('public.work_items') IS NOT NULL THEN
    GRANT SELECT ON public.work_items TO analyst_reader;
  ELSE
    missing := missing || 'work_items'::text;
  END IF;
  IF to_regclass('public.workflow_configs') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_configs TO analyst_reader;
  ELSE
    missing := missing || 'workflow_configs'::text;
  END IF;
  IF to_regclass('public.workflow_engine_bindings') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_engine_bindings TO analyst_reader;
  ELSE
    missing := missing || 'workflow_engine_bindings'::text;
  END IF;
  IF to_regclass('public.workflow_evidence') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_evidence TO analyst_reader;
  ELSE
    missing := missing || 'workflow_evidence'::text;
  END IF;
  IF to_regclass('public.workflow_run_events') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_run_events TO analyst_reader;
  ELSE
    missing := missing || 'workflow_run_events'::text;
  END IF;
  IF to_regclass('public.workflow_runs') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_runs TO analyst_reader;
  ELSE
    missing := missing || 'workflow_runs'::text;
  END IF;
  IF to_regclass('public.workflow_triggers') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_triggers TO analyst_reader;
  ELSE
    missing := missing || 'workflow_triggers'::text;
  END IF;
  IF to_regclass('public.workflow_versions') IS NOT NULL THEN
    GRANT SELECT ON public.workflow_versions TO analyst_reader;
  ELSE
    missing := missing || 'workflow_versions'::text;
  END IF;
  IF to_regclass('public.workflows') IS NOT NULL THEN
    GRANT SELECT ON public.workflows TO analyst_reader;
  ELSE
    missing := missing || 'workflows'::text;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE WARNING 'analyst grants skipped for tables missing on this database: %', missing;
  END IF;
END $$;
-- END GENERATED ANALYST GRANTS

COMMIT;
