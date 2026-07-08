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
SET LOCAL "thinkwork.analyst_reader_pass" = :'reader_pass';

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
    EXECUTE format(
      'ALTER ROLE analyst_reader WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION',
      current_setting('thinkwork.analyst_reader_pass'));
  END IF;
END $$;

-- Role-level session defaults. USERSET GUCs are resettable within a
-- session, so the broker issues DISCARD ALL before every query (KTD7);
-- these are defense-in-depth behind the SELECT-only grant surface.
ALTER ROLE analyst_reader SET default_transaction_read_only = on;
ALTER ROLE analyst_reader SET statement_timeout = '15s';
ALTER ROLE analyst_reader SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE analyst_reader SET search_path = public;

-- Assert the role holds no memberships (SET ROLE escalation surface). This
-- migration never grants any; if one appears out-of-band, fail the apply
-- loudly rather than proceeding with a widened surface.
DO $$
DECLARE
  membership text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO membership
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE member.rolname = 'analyst_reader';
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
GRANT SELECT ON public.activity_log TO analyst_reader;
GRANT SELECT ON public.agent_capabilities TO analyst_reader;
GRANT SELECT ON public.agent_knowledge_bases TO analyst_reader;
GRANT SELECT ON public.agent_loop_iterations TO analyst_reader;
GRANT SELECT ON public.agent_loop_runs TO analyst_reader;
GRANT SELECT ON public.agent_loop_versions TO analyst_reader;
GRANT SELECT ON public.agent_loops TO analyst_reader;
GRANT SELECT ON public.agent_mcp_servers TO analyst_reader;
GRANT SELECT ON public.agent_operation_leases TO analyst_reader;
GRANT SELECT ON public.agent_profile_space_assignments TO analyst_reader;
GRANT SELECT ON public.agent_profiles TO analyst_reader;
GRANT SELECT ON public.agent_skills TO analyst_reader;
GRANT SELECT ON public.agent_template_mcp_servers TO analyst_reader;
GRANT SELECT ON public.agent_templates TO analyst_reader;
GRANT SELECT ON public.agent_versions TO analyst_reader;
GRANT SELECT ON public.agent_wakeup_requests TO analyst_reader;
GRANT SELECT ON public.agent_workspace_events TO analyst_reader;
GRANT SELECT ON public.agent_workspace_runs TO analyst_reader;
GRANT SELECT ON public.agents TO analyst_reader;
GRANT SELECT ON public.artifact_data_bindings TO analyst_reader;
GRANT SELECT ON public.artifact_shares TO analyst_reader;
GRANT SELECT ON public.artifact_versions TO analyst_reader;
GRANT SELECT ON public.artifacts TO analyst_reader;
GRANT SELECT ON public.billing_export_imports TO analyst_reader;
GRANT SELECT ON public.billing_export_line_items TO analyst_reader;
GRANT SELECT ON public.brain_dream_actions TO analyst_reader;
GRANT SELECT ON public.brain_dream_runs TO analyst_reader;
GRANT SELECT ON public.budget_policies TO analyst_reader;
GRANT SELECT ON public.capability_catalog TO analyst_reader;
GRANT SELECT ON public.connections TO analyst_reader;
GRANT SELECT ON public.cost_events TO analyst_reader;
GRANT SELECT ON public.crm_work_links TO analyst_reader;
GRANT SELECT ON public.customer_deployment_session_events TO analyst_reader;
GRANT SELECT ON public.document_conformance_reports TO analyst_reader;
GRANT SELECT ON public.document_plates TO analyst_reader;
GRANT SELECT ON public.document_section_waivers TO analyst_reader;
GRANT SELECT ON public.documents TO analyst_reader;
GRANT SELECT ON public.email_body_objects TO analyst_reader;
GRANT SELECT ON public.email_conversations TO analyst_reader;
GRANT SELECT ON public.email_domains TO analyst_reader;
GRANT SELECT ON public.email_ledger_events TO analyst_reader;
GRANT SELECT ON public.email_provider_events TO analyst_reader;
GRANT SELECT ON public.email_readiness_checks TO analyst_reader;
GRANT SELECT ON public.email_ses_compatibility_mappings TO analyst_reader;
GRANT SELECT ON public.email_space_policies TO analyst_reader;
GRANT SELECT ON public.email_space_sender_allowlists TO analyst_reader;
GRANT SELECT ON public.eval_case_overrides TO analyst_reader;
GRANT SELECT ON public.eval_datasets TO analyst_reader;
GRANT SELECT ON public.eval_profiles TO analyst_reader;
GRANT SELECT ON public.eval_replay_tool_allowlist TO analyst_reader;
GRANT SELECT ON public.eval_results TO analyst_reader;
GRANT SELECT ON public.eval_runs TO analyst_reader;
GRANT SELECT ON public.eval_skill_gate TO analyst_reader;
GRANT SELECT ON public.eval_test_cases TO analyst_reader;
GRANT SELECT ON public.folder_bundle_import_rate_limits TO analyst_reader;
GRANT SELECT ON public.github_app_installations TO analyst_reader;
GRANT SELECT ON public.github_webhook_deliveries TO analyst_reader;
GRANT SELECT ON public.goals TO analyst_reader;
GRANT SELECT ON public.guardrail_blocks TO analyst_reader;
GRANT SELECT ON public.guardrails TO analyst_reader;
GRANT SELECT ON public.inbox_item_comments TO analyst_reader;
GRANT SELECT ON public.inbox_item_links TO analyst_reader;
GRANT SELECT ON public.inbox_items TO analyst_reader;
GRANT SELECT ON public.knowledge_bases TO analyst_reader;
GRANT SELECT ON public.knowledge_graph_entities TO analyst_reader;
GRANT SELECT ON public.knowledge_graph_evidence TO analyst_reader;
GRANT SELECT ON public.knowledge_graph_ingest_runs TO analyst_reader;
GRANT SELECT ON public.knowledge_graph_observation_cursors TO analyst_reader;
GRANT SELECT ON public.knowledge_graph_relationships TO analyst_reader;
GRANT SELECT ON public.linked_task_events TO analyst_reader;
GRANT SELECT ON public.linked_tasks TO analyst_reader;
GRANT SELECT ON public.managed_application_deployment_events TO analyst_reader;
GRANT SELECT ON public.managed_application_deployment_jobs TO analyst_reader;
GRANT SELECT ON public.managed_applications TO analyst_reader;
GRANT SELECT ON public.memory_retain_attempts TO analyst_reader;
GRANT SELECT ON public.message_artifacts TO analyst_reader;
GRANT SELECT ON public.message_mentions TO analyst_reader;
GRANT SELECT ON public.messages TO analyst_reader;
GRANT SELECT ON public.model_catalog TO analyst_reader;
GRANT SELECT ON public.mutation_idempotency TO analyst_reader;
GRANT SELECT ON public.pending_user_questions TO analyst_reader;
GRANT SELECT ON public.pi_extension_assignments TO analyst_reader;
GRANT SELECT ON public.pi_extension_sources TO analyst_reader;
GRANT SELECT ON public.pi_extension_versions TO analyst_reader;
GRANT SELECT ON public.plugin_app_overlays TO analyst_reader;
GRANT SELECT ON public.plugin_components TO analyst_reader;
GRANT SELECT ON public.plugin_entitlements TO analyst_reader;
GRANT SELECT ON public.plugin_installs TO analyst_reader;
GRANT SELECT ON public.plugin_uploads TO analyst_reader;
GRANT SELECT ON public.principal_permission_grants TO analyst_reader;
GRANT SELECT ON public.recipes TO analyst_reader;
GRANT SELECT ON public.release_update_events TO analyst_reader;
GRANT SELECT ON public.release_update_jobs TO analyst_reader;
GRANT SELECT ON public.resolved_capability_manifests TO analyst_reader;
GRANT SELECT ON public.retry_queue TO analyst_reader;
GRANT SELECT ON public.routine_asl_versions TO analyst_reader;
GRANT SELECT ON public.routine_code_cache TO analyst_reader;
GRANT SELECT ON public.routine_executions TO analyst_reader;
GRANT SELECT ON public.routine_repair_events TO analyst_reader;
GRANT SELECT ON public.routine_step_events TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.routines FROM analyst_reader;
GRANT SELECT (agent_id, catalog_slug, config, created_at, current_version, description, disabled_reason, documentation_md, engine, fixture_paths, id, last_run_at, module_path, name, next_run_at, owning_agent_id, schedule, state_machine_alias_arn, state_machine_arn, status, tenant_id, type, updated_at, validated_sha, visibility) ON public.routines TO analyst_reader;
GRANT SELECT ON public.sandbox_agent_hourly_counters TO analyst_reader;
GRANT SELECT ON public.sandbox_invocations TO analyst_reader;
GRANT SELECT ON public.sandbox_tenant_daily_counters TO analyst_reader;
GRANT SELECT ON public.scheduled_jobs TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.skill_catalog FROM analyst_reader;
GRANT SELECT (category, content_sha, created_at, description, display_name, icon, id, signature_status, signed_at, signed_by_user_id, signed_content_sha, signed_payload_hash, slug, tags, tenant_id, trust_report, trust_report_content_sha, trust_report_pipeline_version, trust_report_updated_at, updated_at) ON public.skill_catalog TO analyst_reader;
GRANT SELECT ON public.skill_draft_events TO analyst_reader;
GRANT SELECT ON public.skill_drafts TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.skill_runs FROM analyst_reader;
GRANT SELECT (agent_id, created_at, delete_at, delivered_artifact_ref, delivery_channels, failure_reason, feedback_note, feedback_signal, finished_at, id, inputs, invocation_source, invoker_user_id, resolved_inputs, resolved_inputs_hash, skill_id, skill_version, started_at, status, tenant_id, triggered_by_run_id, updated_at) ON public.skill_runs TO analyst_reader;
GRANT SELECT ON public.slack_threads TO analyst_reader;
GRANT SELECT ON public.slack_user_links TO analyst_reader;
GRANT SELECT ON public.space_checklist_items TO analyst_reader;
GRANT SELECT ON public.space_checklist_templates TO analyst_reader;
GRANT SELECT ON public.space_integrations TO analyst_reader;
GRANT SELECT ON public.space_knowledge_bases TO analyst_reader;
GRANT SELECT ON public.space_mcp_servers TO analyst_reader;
GRANT SELECT ON public.space_members TO analyst_reader;
GRANT SELECT ON public.spaces TO analyst_reader;
GRANT SELECT ON public.stripe_customers TO analyst_reader;
GRANT SELECT ON public.stripe_events TO analyst_reader;
GRANT SELECT ON public.stripe_subscriptions TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.tenant_builtin_tools FROM analyst_reader;
GRANT SELECT (config, created_at, enabled, id, last_tested_at, provider, tenant_id, tool_slug, updated_at) ON public.tenant_builtin_tools TO analyst_reader;
GRANT SELECT ON public.tenant_context_provider_settings TO analyst_reader;
GRANT SELECT ON public.tenant_mcp_context_tools TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.tenant_mcp_servers FROM analyst_reader;
GRANT SELECT (approved_at, approved_by, auth_type, created_at, enabled, id, managed_application_key, management_source, name, oauth_provider, plugin_install_id, runtime_metadata, slug, status, tenant_id, tools, transport, updated_at, url, url_hash) ON public.tenant_mcp_servers TO analyst_reader;
GRANT SELECT ON public.tenant_members TO analyst_reader;
GRANT SELECT ON public.tenant_model_catalog TO analyst_reader;
GRANT SELECT ON public.tenant_policy_events TO analyst_reader;
GRANT SELECT ON public.tenant_settings TO analyst_reader;
GRANT SELECT ON public.tenant_system_users TO analyst_reader;
GRANT SELECT ON public.tenant_workflow_catalog TO analyst_reader;
GRANT SELECT ON public.tenants TO analyst_reader;
GRANT SELECT ON public.thread_attachments TO analyst_reader;
GRANT SELECT ON public.thread_dependencies TO analyst_reader;
GRANT SELECT ON public.thread_idle_learning_runs TO analyst_reader;
GRANT SELECT ON public.thread_idle_learning_state TO analyst_reader;
GRANT SELECT ON public.thread_label_assignments TO analyst_reader;
GRANT SELECT ON public.thread_labels TO analyst_reader;
GRANT SELECT ON public.thread_participants TO analyst_reader;
GRANT SELECT ON public.thread_turn_events TO analyst_reader;
GRANT SELECT ON public.thread_turns TO analyst_reader;
GRANT SELECT ON public.threads TO analyst_reader;
GRANT SELECT ON public.trace_cost_reconciliation_facts TO analyst_reader;
GRANT SELECT ON public.trace_events TO analyst_reader;
GRANT SELECT ON public.trace_runs TO analyst_reader;
GRANT SELECT ON public.trace_source_evidence TO analyst_reader;
GRANT SELECT ON public.user_model_approvals TO analyst_reader;
GRANT SELECT ON public.user_plugin_activations TO analyst_reader;
GRANT SELECT ON public.user_profiles TO analyst_reader;
GRANT SELECT ON public.user_quick_actions TO analyst_reader;
REVOKE ALL PRIVILEGES ON public.users FROM analyst_reader;
GRANT SELECT (cognito_sub, created_at, email, email_verified_at, id, image, name, phone, phone_verified_at, tenant_id, updated_at, wiki_compile_external_enabled, workspace_folder_name) ON public.users TO analyst_reader;
GRANT SELECT ON public.wakeup_requests TO analyst_reader;
GRANT SELECT ON public.webhook_idempotency TO analyst_reader;
GRANT SELECT ON public.work_item_comments TO analyst_reader;
GRANT SELECT ON public.work_item_documents TO analyst_reader;
GRANT SELECT ON public.work_item_events TO analyst_reader;
GRANT SELECT ON public.work_item_external_refs TO analyst_reader;
GRANT SELECT ON public.work_item_label_assignments TO analyst_reader;
GRANT SELECT ON public.work_item_labels TO analyst_reader;
GRANT SELECT ON public.work_item_saved_views TO analyst_reader;
GRANT SELECT ON public.work_item_statuses TO analyst_reader;
GRANT SELECT ON public.work_item_thread_links TO analyst_reader;
GRANT SELECT ON public.work_items TO analyst_reader;
GRANT SELECT ON public.workflow_configs TO analyst_reader;
GRANT SELECT ON public.workflow_engine_bindings TO analyst_reader;
GRANT SELECT ON public.workflow_evidence TO analyst_reader;
GRANT SELECT ON public.workflow_run_events TO analyst_reader;
GRANT SELECT ON public.workflow_runs TO analyst_reader;
GRANT SELECT ON public.workflow_triggers TO analyst_reader;
GRANT SELECT ON public.workflow_versions TO analyst_reader;
GRANT SELECT ON public.workflows TO analyst_reader;
-- END GENERATED ANALYST GRANTS

COMMIT;
