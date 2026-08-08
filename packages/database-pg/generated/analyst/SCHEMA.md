# ThinkWork dev Postgres — semantic model

<!-- GENERATED FILE — do not edit by hand. -->
<!-- Regenerate: pnpm --filter @thinkwork/database-pg exec tsx ../../scripts/generate-analyst-schema.ts -->

This document describes every table you are permitted to query on this
data source. It is generated from the application's canonical schema
definitions; tables and columns not listed here are not granted to your
database role, so do not query them (and avoid `SELECT *` — name the
columns you need).

Conventions:

- Multi-tenant: most tables carry `tenant_id` → `tenants.id`. Always
  scope aggregates by `tenant_id` unless the question is explicitly
  cross-tenant.
- Timestamps are `timestamp with time zone` and named `*_at`.
- Join hints list the declared foreign keys; prefer them over inferred
  joins.

## Tables

- [activity_log](#activity-log)
- [agent_capabilities](#agent-capabilities)
- [agent_loop_iterations](#agent-loop-iterations)
- [agent_loop_runs](#agent-loop-runs)
- [agent_loop_versions](#agent-loop-versions)
- [agent_loops](#agent-loops)
- [agent_mcp_servers](#agent-mcp-servers)
- [agent_operation_leases](#agent-operation-leases)
- [agent_profile_space_assignments](#agent-profile-space-assignments)
- [agent_profiles](#agent-profiles)
- [agent_skills](#agent-skills)
- [agent_template_mcp_servers](#agent-template-mcp-servers)
- [agent_templates](#agent-templates)
- [agent_versions](#agent-versions)
- [agent_wakeup_requests](#agent-wakeup-requests)
- [agent_workspace_events](#agent-workspace-events)
- [agent_workspace_runs](#agent-workspace-runs)
- [agents](#agents)
- [artifact_data_bindings](#artifact-data-bindings)
- [artifact_shares](#artifact-shares)
- [artifact_versions](#artifact-versions)
- [artifacts](#artifacts)
- [billing_export_line_items](#billing-export-line-items)
- [budget_policies](#budget-policies)
- [capability_broker_calls](#capability-broker-calls)
- [capability_broker_sessions](#capability-broker-sessions)
- [capability_catalog](#capability-catalog)
- [capability_connection_proposals](#capability-connection-proposals)
- [capability_definitions](#capability-definitions)
- [capability_routine_proposals](#capability-routine-proposals)
- [connections](#connections)
- [cost_events](#cost-events)
- [crm_work_links](#crm-work-links)
- [document_conformance_reports](#document-conformance-reports)
- [document_plates](#document-plates)
- [document_section_waivers](#document-section-waivers)
- [documents](#documents)
- [email_body_objects](#email-body-objects)
- [email_conversations](#email-conversations)
- [email_domains](#email-domains)
- [email_ledger_events](#email-ledger-events)
- [email_provider_events](#email-provider-events)
- [email_readiness_checks](#email-readiness-checks)
- [email_ses_compatibility_mappings](#email-ses-compatibility-mappings)
- [email_space_policies](#email-space-policies)
- [email_space_sender_allowlists](#email-space-sender-allowlists)
- [eval_case_overrides](#eval-case-overrides)
- [eval_datasets](#eval-datasets)
- [eval_profiles](#eval-profiles)
- [eval_replay_tool_allowlist](#eval-replay-tool-allowlist)
- [eval_results](#eval-results)
- [eval_runs](#eval-runs)
- [eval_skill_gate](#eval-skill-gate)
- [eval_test_cases](#eval-test-cases)
- [folder_bundle_import_rate_limits](#folder-bundle-import-rate-limits)
- [github_app_installations](#github-app-installations)
- [github_webhook_deliveries](#github-webhook-deliveries)
- [goals](#goals)
- [guardrail_blocks](#guardrail-blocks)
- [guardrails](#guardrails)
- [inbox_item_comments](#inbox-item-comments)
- [inbox_item_links](#inbox-item-links)
- [inbox_items](#inbox-items)
- [linked_task_events](#linked-task-events)
- [linked_tasks](#linked-tasks)
- [managed_application_deployment_events](#managed-application-deployment-events)
- [managed_application_deployment_jobs](#managed-application-deployment-jobs)
- [managed_applications](#managed-applications)
- [memory_claim_evidence](#memory-claim-evidence)
- [memory_claims](#memory-claims)
- [memory_derivations](#memory-derivations)
- [memory_evidence_items](#memory-evidence-items)
- [memory_processor_configs](#memory-processor-configs)
- [memory_retraction_attempts](#memory-retraction-attempts)
- [memory_run_items](#memory-run-items)
- [memory_source_authorizations](#memory-source-authorizations)
- [memory_source_checkpoints](#memory-source-checkpoints)
- [memory_source_configs](#memory-source-configs)
- [message_artifacts](#message-artifacts)
- [message_mentions](#message-mentions)
- [messages](#messages)
- [model_catalog](#model-catalog)
- [msteams_tenant_installs](#msteams-tenant-installs)
- [msteams_threads](#msteams-threads)
- [msteams_user_links](#msteams-user-links)
- [mutation_idempotency](#mutation-idempotency)
- [pending_user_questions](#pending-user-questions)
- [pi_extension_assignments](#pi-extension-assignments)
- [pi_extension_sources](#pi-extension-sources)
- [pi_extension_versions](#pi-extension-versions)
- [plugin_app_overlays](#plugin-app-overlays)
- [plugin_components](#plugin-components)
- [plugin_entitlements](#plugin-entitlements)
- [plugin_installs](#plugin-installs)
- [plugin_uploads](#plugin-uploads)
- [principal_permission_grants](#principal-permission-grants)
- [recipes](#recipes)
- [release_update_events](#release-update-events)
- [release_update_jobs](#release-update-jobs)
- [resolved_capability_manifests](#resolved-capability-manifests)
- [retry_queue](#retry-queue)
- [routine_asl_versions](#routine-asl-versions)
- [routine_code_cache](#routine-code-cache)
- [routine_executions](#routine-executions)
- [routine_repair_events](#routine-repair-events)
- [routine_step_events](#routine-step-events)
- [routines](#routines)
- [sandbox_agent_hourly_counters](#sandbox-agent-hourly-counters)
- [sandbox_invocations](#sandbox-invocations)
- [sandbox_tenant_daily_counters](#sandbox-tenant-daily-counters)
- [scheduled_jobs](#scheduled-jobs)
- [skill_catalog](#skill-catalog)
- [skill_draft_events](#skill-draft-events)
- [skill_drafts](#skill-drafts)
- [skill_runs](#skill-runs)
- [slack_threads](#slack-threads)
- [slack_user_links](#slack-user-links)
- [space_checklist_items](#space-checklist-items)
- [space_checklist_templates](#space-checklist-templates)
- [space_integrations](#space-integrations)
- [space_mcp_servers](#space-mcp-servers)
- [space_members](#space-members)
- [spaces](#spaces)
- [stripe_customers](#stripe-customers)
- [stripe_subscriptions](#stripe-subscriptions)
- [tenant_builtin_tools](#tenant-builtin-tools)
- [tenant_context_provider_settings](#tenant-context-provider-settings)
- [tenant_mcp_context_tools](#tenant-mcp-context-tools)
- [tenant_mcp_servers](#tenant-mcp-servers)
- [tenant_members](#tenant-members)
- [tenant_model_catalog](#tenant-model-catalog)
- [tenant_policy_events](#tenant-policy-events)
- [tenant_service_principals](#tenant-service-principals)
- [tenant_settings](#tenant-settings)
- [tenant_system_users](#tenant-system-users)
- [tenant_workflow_catalog](#tenant-workflow-catalog)
- [tenants](#tenants)
- [thread_attachments](#thread-attachments)
- [thread_dependencies](#thread-dependencies)
- [thread_idle_learning_runs](#thread-idle-learning-runs)
- [thread_idle_learning_state](#thread-idle-learning-state)
- [thread_label_assignments](#thread-label-assignments)
- [thread_labels](#thread-labels)
- [thread_participants](#thread-participants)
- [thread_turn_events](#thread-turn-events)
- [thread_turns](#thread-turns)
- [threads](#threads)
- [tool_execution_events](#tool-execution-events)
- [trace_cost_reconciliation_facts](#trace-cost-reconciliation-facts)
- [trace_events](#trace-events)
- [trace_runs](#trace-runs)
- [trace_source_evidence](#trace-source-evidence)
- [twin_materialization_suggestions](#twin-materialization-suggestions)
- [user_brain_claims](#user-brain-claims)
- [user_model_approvals](#user-model-approvals)
- [user_plugin_activations](#user-plugin-activations)
- [user_profiles](#user-profiles)
- [user_quick_actions](#user-quick-actions)
- [users](#users)
- [wakeup_requests](#wakeup-requests)
- [work_item_comments](#work-item-comments)
- [work_item_documents](#work-item-documents)
- [work_item_events](#work-item-events)
- [work_item_external_refs](#work-item-external-refs)
- [work_item_label_assignments](#work-item-label-assignments)
- [work_item_labels](#work-item-labels)
- [work_item_saved_views](#work-item-saved-views)
- [work_item_statuses](#work-item-statuses)
- [work_item_thread_links](#work-item-thread-links)
- [work_items](#work-items)
- [workflow_configs](#workflow-configs)
- [workflow_engine_bindings](#workflow-engine-bindings)
- [workflow_evidence](#workflow-evidence)
- [workflow_run_events](#workflow-run-events)
- [workflow_runs](#workflow-runs)
- [workflow_triggers](#workflow-triggers)
- [workflow_versions](#workflow-versions)
- [workflows](#workflows)

## activity_log

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| actor_type | text | not null |
| actor_id | uuid | not null |
| action | text | not null |
| entity_type | text |  |
| entity_id | uuid |  |
| changes | jsonb |  |
| metadata | jsonb |  |
| ip_address | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `activity_log.tenant_id` → `tenants.id`

## agent_capabilities

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| agent_id | uuid | not null |
| tenant_id | uuid | not null |
| capability | text | not null |
| config | jsonb |  |
| enabled | boolean | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `agent_capabilities.agent_id` → `agents.id`
- `agent_capabilities.tenant_id` → `tenants.id`

## agent_loop_iterations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_loop_run_id | uuid | not null |
| iteration_number | integer | not null |
| status | text | not null |
| goal_mode_action | text |  |
| agent_wakeup_request_id | uuid |  |
| thread_turn_id | uuid |  |
| input_summary | jsonb |  |
| output_summary | jsonb |  |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| error_code | text |  |
| error_message | text |  |
| total_cost_usd_cents | bigint |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `queued`, `running`, `waiting_for_human`, `completed`, `failed`, `budget_stopped`, `escalated`, `canceled`, `skipped`

Join hints:

- `agent_loop_iterations.agent_loop_run_id` → `agent_loop_runs.id`
- `agent_loop_iterations.agent_wakeup_request_id` → `agent_wakeup_requests.id`
- `agent_loop_iterations.tenant_id` → `tenants.id`
- `agent_loop_iterations.thread_turn_id` → `thread_turns.id`

## agent_loop_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_loop_id | uuid | not null |
| agent_loop_version_id | uuid |  |
| status | text | not null |
| trigger_family | text | not null |
| trigger_source | text |  |
| scheduled_job_id | uuid |  |
| actor_type | text |  |
| actor_id | uuid |  |
| idempotency_key | text |  |
| correlation_id | text |  |
| current_iteration | integer | not null |
| terminal_reason | text |  |
| policy_snapshot | jsonb | not null |
| input_summary | jsonb |  |
| output_summary | jsonb |  |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| last_event_at | timestamp with time zone |  |
| error_code | text |  |
| error_message | text |  |
| total_cost_usd_cents | bigint |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `queued`, `running`, `waiting_for_human`, `completed`, `failed`, `budget_stopped`, `escalated`, `canceled`, `skipped`
- `trigger_family`: `manual`, `schedule`, `api`, `webhook`, `app_event`, `n8n`

Join hints:

- `agent_loop_runs.agent_loop_id` → `agent_loops.id`
- `agent_loop_runs.agent_loop_version_id` → `agent_loop_versions.id`
- `agent_loop_runs.tenant_id` → `tenants.id`

## agent_loop_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_loop_id | uuid | not null |
| version_number | integer | not null |
| version_status | text | not null |
| trigger_spec | jsonb | not null |
| routine_actions_spec | jsonb |  |
| target_spec | jsonb | not null |
| source_metadata | jsonb | not null |
| created_by_actor_type | text |  |
| created_by_actor_id | uuid |  |
| published_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `version_status`: `draft`, `active`, `superseded`, `archived`

Join hints:

- `agent_loop_versions.agent_loop_id` → `agent_loops.id`
- `agent_loop_versions.tenant_id` → `tenants.id`

## agent_loops

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| slug | text | not null |
| description | text |  |
| lifecycle_status | text | not null |
| enabled | boolean | not null |
| kind | text | not null |
| system_key | text |  |
| owner_user_id | uuid |  |
| owner_agent_id | uuid |  |
| run_as_user_id | uuid |  |
| execution_principal | jsonb |  |
| space_id | uuid |  |
| primary_trigger_family | text | not null |
| current_version_id | uuid |  |
| current_version_number | integer |  |
| last_run_id | uuid |  |
| last_run_status | text |  |
| last_run_at | timestamp with time zone |  |
| last_run_summary | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `lifecycle_status`: `draft`, `active`, `paused`, `archived`
- `kind`: `user`, `system`
- `primary_trigger_family`: `manual`, `schedule`, `api`, `webhook`, `app_event`, `n8n`

Join hints:

- `agent_loops.owner_agent_id` → `agents.id`
- `agent_loops.owner_user_id` → `users.id`
- `agent_loops.run_as_user_id` → `users.id`
- `agent_loops.space_id` → `spaces.id`
- `agent_loops.tenant_id` → `tenants.id`

## agent_mcp_servers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| agent_id | uuid | not null |
| tenant_id | uuid | not null |
| mcp_server_id | uuid | not null |
| enabled | boolean | not null |
| config | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `agent_mcp_servers.agent_id` → `agents.id`
- `agent_mcp_servers.mcp_server_id` → `tenant_mcp_servers.id`
- `agent_mcp_servers.tenant_id` → `tenants.id`

## agent_operation_leases

| column | type | flags |
| --- | --- | --- |
| agent_id | uuid | PK, not null |
| lease_id | uuid | PK, not null |
| lease_kind | text | not null |
| owner_kind | text | not null |
| owner_id | text |  |
| acquired_at | timestamp with time zone | not null |
| last_heartbeat_at | timestamp with time zone | not null |
| expires_at | timestamp with time zone | not null |

Join hints:

- `agent_operation_leases.agent_id` → `agents.id`

## agent_profile_space_assignments

| column | type | flags |
| --- | --- | --- |
| profile_id | uuid | not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `agent_profile_space_assignments.profile_id` → `agent_profiles.id`
- `agent_profile_space_assignments.space_id` → `spaces.id`
- `agent_profile_space_assignments.tenant_id` → `tenants.id`

## agent_profiles

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| name | text | not null |
| description | text |  |
| routing_guidance | text |  |
| instructions | text | not null |
| model_id | text | not null |
| enabled | boolean | not null |
| built_in_key | text |  |
| source_space_id | uuid |  |
| tool_policy | jsonb | not null |
| skill_policy | jsonb | not null |
| execution_controls | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `agent_profiles.source_space_id` → `spaces.id`
- `agent_profiles.tenant_id` → `tenants.id`

## agent_skills

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| agent_id | uuid | not null |
| tenant_id | uuid | not null |
| skill_id | text | not null |
| config | jsonb |  |
| permissions | jsonb |  |
| rate_limit_rpm | integer |  |
| model_override | text |  |
| enabled | boolean | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `agent_skills.agent_id` → `agents.id`
- `agent_skills.tenant_id` → `tenants.id`

## agent_template_mcp_servers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| template_id | uuid | not null |
| tenant_id | uuid | not null |
| mcp_server_id | uuid | not null |
| enabled | boolean | not null |
| config | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `agent_template_mcp_servers.mcp_server_id` → `tenant_mcp_servers.id`
- `agent_template_mcp_servers.tenant_id` → `tenants.id`

## agent_templates

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid |  |
| name | text | not null |
| slug | text | not null |
| description | text |  |
| category | text |  |
| icon | text |  |
| source | text | not null |
| runtime | text | not null |
| template_kind | text | not null |
| model | text |  |
| guardrail_id | uuid |  |
| blocked_tools | jsonb |  |
| config | jsonb |  |
| skills | jsonb |  |
| knowledge_base_ids | jsonb |  |
| sandbox | jsonb |  |
| browser | jsonb |  |
| web_search | jsonb |  |
| web_extract | jsonb |  |
| send_email | jsonb |  |
| context_engine | jsonb |  |
| is_published | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `template_kind`: `agent`, `computer`

Join hints:

- `agent_templates.guardrail_id` → `guardrails.id`
- `agent_templates.tenant_id` → `tenants.id`

## agent_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| version_number | integer | not null |
| label | text |  |
| config_snapshot | jsonb |  |
| workspace_snapshot | jsonb |  |
| skills_snapshot | jsonb |  |
| knowledge_bases_snapshot | jsonb |  |
| guardrail_snapshot | jsonb |  |
| created_by | uuid |  |
| created_at | timestamp with time zone | not null |
| is_active | boolean | not null |

Join hints:

- `agent_versions.agent_id` → `agents.id`
- `agent_versions.created_by` → `users.id`
- `agent_versions.tenant_id` → `tenants.id`

## agent_wakeup_requests

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| source | text | not null |
| trigger_detail | text |  |
| reason | text |  |
| payload | jsonb |  |
| status | text | not null |
| coalesced_count | integer | not null |
| idempotency_key | text |  |
| requested_by_actor_type | text |  |
| requested_by_actor_id | text |  |
| run_id | uuid |  |
| requested_at | timestamp with time zone | not null |
| claimed_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `agent_wakeup_requests.agent_id` → `agents.id`
- `agent_wakeup_requests.tenant_id` → `tenants.id`

## agent_workspace_events

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| run_id | uuid |  |
| event_type | text | not null |
| idempotency_key | text | not null |
| bucket | text | not null |
| source_object_key | text | not null |
| audit_object_key | text |  |
| object_etag | text |  |
| object_version_id | text |  |
| sequencer | text | not null |
| mirror_status | text | not null |
| reason | text |  |
| payload | jsonb |  |
| actor_type | text |  |
| actor_id | text |  |
| parent_event_id | bigint |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `agent_workspace_events.agent_id` → `agents.id`
- `agent_workspace_events.parent_event_id` → `agent_workspace_events.id`
- `agent_workspace_events.run_id` → `agent_workspace_runs.id`
- `agent_workspace_events.tenant_id` → `tenants.id`

## agent_workspace_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| target_path | text | not null |
| status | text | not null |
| source_object_key | text |  |
| request_object_key | text |  |
| current_wakeup_request_id | uuid |  |
| current_thread_turn_id | uuid |  |
| parent_run_id | uuid |  |
| depth | integer | not null |
| inbox_write_count | integer | not null |
| wakeup_retry_count | integer | not null |
| last_event_at | timestamp with time zone | not null |
| completed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `agent_workspace_runs.agent_id` → `agents.id`
- `agent_workspace_runs.current_thread_turn_id` → `thread_turns.id`
- `agent_workspace_runs.current_wakeup_request_id` → `agent_wakeup_requests.id`
- `agent_workspace_runs.parent_run_id` → `agent_workspace_runs.id`
- `agent_workspace_runs.tenant_id` → `tenants.id`

## agents

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| slug | text |  |
| workspace_folder_name | text |  |
| role | text |  |
| type | text | not null |
| source | text | not null |
| runtime | text | not null |
| status | text | not null |
| system_prompt | text |  |
| reports_to | uuid |  |
| parent_agent_id | uuid |  |
| human_pair_id | uuid |  |
| adapter_type | text |  |
| adapter_config | jsonb |  |
| runtime_config | jsonb |  |
| model | text |  |
| guardrail_id | uuid |  |
| blocked_tools | jsonb |  |
| sandbox | jsonb |  |
| browser | jsonb |  |
| web_search | jsonb |  |
| web_extract | jsonb |  |
| send_email | jsonb |  |
| context_engine | jsonb |  |
| json_render_ui | jsonb |  |
| is_platform_default | boolean | not null |
| capability_folder_dispatch | boolean | not null |
| agentcore_runtime_dispatch | boolean | not null |
| agent_profile_manifest_authority | boolean | not null |
| budget_monthly_cents | integer |  |
| spent_monthly_cents | integer |  |
| budget_paused | boolean | not null |
| budget_paused_at | timestamp with time zone |  |
| budget_paused_reason | text |  |
| last_heartbeat_at | timestamp with time zone |  |
| avatar_url | text |  |
| template_id | uuid |  |
| version | integer | not null |
| agent_pinned_versions | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `agents.guardrail_id` → `guardrails.id`
- `agents.human_pair_id` → `users.id`
- `agents.parent_agent_id` → `agents.id`
- `agents.reports_to` → `agents.id`
- `agents.template_id` → `agent_templates.id`
- `agents.tenant_id` → `tenants.id`

## artifact_data_bindings

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| artifact_id | uuid | not null |
| part_id | text | not null |
| element_id | text | not null |
| mcp_server_ref | text | not null |
| server_name | text | not null |
| tool_name | text | not null |
| frozen_args | jsonb | not null |
| result_shape_hash | text | not null |
| auth_context | text | not null |
| owner_user_id | uuid |  |
| quality | text | not null |
| last_fetched_at | timestamp with time zone |  |
| last_good_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `auth_context`: `tenant_mcp`, `per_user_oauth`
- `quality`: `good`, `stale`, `bad`, `schema_stale`

Join hints:

- `artifact_data_bindings.artifact_id` → `artifacts.id`
- `artifact_data_bindings.owner_user_id` → `users.id`
- `artifact_data_bindings.tenant_id` → `tenants.id`

## artifact_shares

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| artifact_id | uuid | not null |
| created_by | uuid | not null |
| created_at | timestamp with time zone | not null |
| revoked_at | timestamp with time zone |  |
| revoked_by | uuid |  |

Join hints:

- `artifact_shares.artifact_id` → `artifacts.id`
- `artifact_shares.created_by` → `users.id`
- `artifact_shares.revoked_by` → `users.id`
- `artifact_shares.tenant_id` → `tenants.id`

## artifact_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| artifact_id | uuid | not null |
| version | integer | not null |
| s3_key | text | not null |
| content_hash | text | not null |
| created_by | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `artifact_versions.artifact_id` → `artifacts.id`
- `artifact_versions.created_by` → `users.id`
- `artifact_versions.tenant_id` → `tenants.id`

## artifacts

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| thread_id | uuid |  |
| created_by_user_id | uuid |  |
| space_id | uuid |  |
| head_version | integer | not null |
| head_write_seq | integer | not null |
| title | text | not null |
| type | text | not null |
| status | text | not null |
| content | text |  |
| s3_key | text |  |
| summary | text |  |
| source_message_id | uuid |  |
| metadata | jsonb |  |
| favorited_at | timestamp with time zone |  |
| last_refresh_at | timestamp with time zone |  |
| refresh_failed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `artifacts.agent_id` → `agents.id`
- `artifacts.created_by_user_id` → `users.id`
- `artifacts.source_message_id` → `messages.id`
- `artifacts.space_id` → `spaces.id`
- `artifacts.tenant_id` → `tenants.id`
- `artifacts.thread_id` → `threads.id`

## billing_export_line_items

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| import_id | uuid | not null |
| tenant_id | uuid |  |
| provider | text | not null |
| line_item_id | text | not null |
| usage_account_id | text |  |
| service_code | text | not null |
| operation | text | not null |
| line_item_type | text |  |
| usage_start | timestamp with time zone | not null |
| usage_end | timestamp with time zone | not null |
| billing_period_start | timestamp with time zone | not null |
| billing_period_end | timestamp with time zone | not null |
| amount_usd | numeric(12, 6) | not null |
| usage_amount | numeric(20, 6) |  |
| currency | text | not null |
| model | text | not null |
| region | text |  |
| resource_id | text |  |
| attribution_level | text | not null |
| attribution_key | text | not null |
| source_uri | text | not null |
| raw_row | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `attribution_level`: `tenant`, `account`, `service_window`

Join hints:

- `billing_export_line_items.import_id` → `billing_export_imports.id`
- `billing_export_line_items.tenant_id` → `tenants.id`

## budget_policies

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| user_id | uuid |  |
| scope | text | not null |
| period | text | not null |
| limit_usd | numeric(12, 6) | not null |
| action_on_exceed | text | not null |
| enabled | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `budget_policies.agent_id` → `agents.id`
- `budget_policies.tenant_id` → `tenants.id`
- `budget_policies.user_id` → `users.id`

## capability_broker_calls

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| broker_session_id | uuid | not null |
| client_request_id | text | not null |
| sequence | bigint |  |
| operation_ref | text |  |
| contract_hash | text |  |
| definition_version_id | uuid |  |
| binding_id | uuid |  |
| status | text | not null |
| policy_decisions_json | jsonb | not null |
| request_digest | text |  |
| result_digest | text |  |
| error_category | text |  |
| effect | text |  |
| budget_delta_json | jsonb | not null |
| adapter_kind | text |  |
| duration_ms | integer |  |
| durable_ref_json | jsonb |  |
| routine_execution_id | uuid |  |
| thread_turn_id | uuid |  |
| compliance_event_id | uuid |  |
| authorized_at | timestamp with time zone |  |
| finalized_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `capability_broker_calls.binding_id` → `capability_credential_bindings.id`
- `capability_broker_calls.broker_session_id` → `capability_broker_sessions.id`
- `capability_broker_calls.definition_version_id` → `capability_definition_versions.id`
- `capability_broker_calls.tenant_id` → `tenants.id`

## capability_broker_sessions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| session_id | text | not null |
| audience | text | not null |
| context_fingerprint | text | not null |
| principal_mode | text | not null |
| service_principal_id | uuid |  |
| subject_user_id | uuid |  |
| grant_snapshot_json | jsonb | not null |
| budgets_json | jsonb | not null |
| routine_execution_id | uuid |  |
| thread_turn_id | uuid |  |
| status | text | not null |
| expires_at | timestamp with time zone | not null |
| closed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `capability_broker_sessions.service_principal_id` → `tenant_service_principals.id`
- `capability_broker_sessions.tenant_id` → `tenants.id`

## capability_catalog

Note: Platform-global capability reference data — not tenant-scoped. RLS is intentionally not enabled (THINK-234).

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| slug | text | not null |
| type | text | not null |
| source | text | not null |
| implementation_ref | jsonb |  |
| spec | jsonb |  |
| definition_version_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `capability_catalog.definition_version_id` → `capability_definition_versions.id`

## capability_connection_proposals

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| definition_id | uuid |  |
| payload_json | jsonb | not null |
| payload_fingerprint | text | not null |
| provenance_json | jsonb | not null |
| status | text | not null |
| inbox_item_id | uuid |  |
| created_by_actor_type | text |  |
| created_by_actor_id | uuid |  |
| decided_at | timestamp with time zone |  |
| decided_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `capability_connection_proposals.decided_by_user_id` → `users.id`
- `capability_connection_proposals.definition_id` → `capability_definitions.id`
- `capability_connection_proposals.tenant_id` → `tenants.id`

## capability_definitions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid |  |
| namespace | text | not null |
| class | text | not null |
| slug | text | not null |
| display_name | text | not null |
| status | text | not null |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `capability_definitions.created_by_user_id` → `users.id`
- `capability_definitions.tenant_id` → `tenants.id`

## capability_routine_proposals

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| routine_id | uuid |  |
| payload_json | jsonb | not null |
| payload_fingerprint | text | not null |
| evidence_refs_json | jsonb | not null |
| status | text | not null |
| inbox_item_id | uuid |  |
| approval_mode | text |  |
| approval_evidence_json | jsonb | not null |
| created_by_actor_type | text |  |
| created_by_actor_id | uuid |  |
| decided_at | timestamp with time zone |  |
| decided_by_user_id | uuid |  |
| promoted_commit_sha | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `capability_routine_proposals.decided_by_user_id` → `users.id`
- `capability_routine_proposals.tenant_id` → `tenants.id`

## connections

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| user_id | uuid | not null |
| provider_id | uuid | not null |
| status | text | not null |
| external_id | text |  |
| metadata | jsonb |  |
| connected_at | timestamp with time zone |  |
| disconnected_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `connections.provider_id` → `connect_providers.id`
- `connections.tenant_id` → `tenants.id`
- `connections.user_id` → `users.id`

## cost_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| user_id | uuid |  |
| thread_id | uuid |  |
| request_id | text | not null |
| event_type | text | not null |
| runtime_type | text |  |
| amount_usd | numeric(12, 6) | not null |
| model | text |  |
| provider | text |  |
| input_tokens | integer |  |
| output_tokens | integer |  |
| cached_read_tokens | integer |  |
| cached_write_tokens | integer |  |
| enforcement_exempt | boolean | not null |
| duration_ms | integer |  |
| trace_id | text |  |
| trace_event_id | uuid |  |
| reconciliation_state | text | not null |
| reconciliation_source | text |  |
| reconciliation_at | timestamp with time zone |  |
| source_evidence_ref | jsonb |  |
| billing_account_id | text |  |
| billing_service_code | text |  |
| billing_operation | text |  |
| billing_period_start | timestamp with time zone |  |
| billing_period_end | timestamp with time zone |  |
| billing_attribution_level | text |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `reconciliation_state`: `runtime-reported`, `invocation-reconciled`, `bill-reconciled`, `mismatch`, `unreconciled/error`

Join hints:

- `cost_events.agent_id` → `agents.id`
- `cost_events.tenant_id` → `tenants.id`
- `cost_events.user_id` → `users.id`

## crm_work_links

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider | text | not null |
| object_type | text | not null |
| object_id | text | not null |
| object_url | text |  |
| workflow_key | text | not null |
| outcome_key | text | not null |
| space_id | uuid |  |
| thread_id | uuid |  |
| goal_id | uuid |  |
| requester_user_id | uuid |  |
| last_writeback_user_id | uuid |  |
| plugin_install_id | uuid |  |
| mcp_server_id | uuid |  |
| state | text | not null |
| status_handle_state | text | not null |
| status_handle_url | text |  |
| status_handle_action | text |  |
| last_writeback_state | text | not null |
| failure_code | text |  |
| failure_message | text |  |
| metadata | jsonb | not null |
| started_at | timestamp with time zone | not null |
| last_resumed_at | timestamp with time zone |  |
| deactivated_at | timestamp with time zone |  |
| archived_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `provider`: `twenty`
- `object_type`: `opportunity`
- `workflow_key`: `customer_onboarding`
- `state`: `starting`, `active`, `completed`, `cancelled`, `failed`, `archived`
- `status_handle_state`: `pending`, `posted`, `requires_reauth`, `writeback_blocked`, `failed`
- `last_writeback_state`: `pending`, `posted`, `requires_reauth`, `blocked`, `failed`, `skipped`

Join hints:

- `crm_work_links.goal_id` → `goals.id`
- `crm_work_links.last_writeback_user_id` → `users.id`
- `crm_work_links.mcp_server_id` → `tenant_mcp_servers.id`
- `crm_work_links.plugin_install_id` → `plugin_installs.id`
- `crm_work_links.requester_user_id` → `users.id`
- `crm_work_links.space_id` → `spaces.id`
- `crm_work_links.tenant_id` → `tenants.id`
- `crm_work_links.thread_id` → `threads.id`

## document_conformance_reports

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| artifact_id | uuid | not null |
| plate_slug | text | not null |
| document_status | text | not null |
| digest_revision | text | not null |
| manifest_snapshot | jsonb | not null |
| sections | jsonb | not null |
| analyses | jsonb | not null |
| judge_status | text | not null |
| judge_attempts | integer | not null |
| judge_model | text |  |
| judge_findings | jsonb |  |
| judge_completed_at | timestamp with time zone |  |
| judge_error | text |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `judge_status`: `pending`, `complete`, `error`, `skipped`

Join hints:

- `document_conformance_reports.artifact_id` → `artifacts.id`
- `document_conformance_reports.tenant_id` → `tenants.id`

## document_plates

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| origin | text | not null |
| config | jsonb | not null |
| hidden | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `origin`: `platform_override`, `tenant`

Join hints:

- `document_plates.tenant_id` → `tenants.id`

## document_section_waivers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| artifact_id | uuid | not null |
| plate_slug | text | not null |
| section_id | text | not null |
| tier | text | not null |
| reason | text | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `tier`: `required`, `required-if-material`

Join hints:

- `document_section_waivers.artifact_id` → `artifacts.id`
- `document_section_waivers.tenant_id` → `tenants.id`

## documents

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid |  |
| name | text | not null |
| content | text |  |
| s3_key | text |  |
| mime_type | text |  |
| size_bytes | integer |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `documents.tenant_id` → `tenants.id`
- `documents.thread_id` → `threads.id`

## email_body_objects

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| conversation_id | uuid |  |
| direction | text | not null |
| content_hash | text | not null |
| object_ref | text | not null |
| retention_until | timestamp with time zone | not null |
| redacted_at | timestamp with time zone |  |
| redacted_by_user_id | uuid |  |
| redaction_reason | text |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `direction`: `inbound`, `outbound`

Join hints:

- `email_body_objects.conversation_id` → `email_conversations.id`
- `email_body_objects.redacted_by_user_id` → `users.id`
- `email_body_objects.tenant_id` → `tenants.id`

## email_conversations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid |  |
| thread_id | uuid |  |
| provider_install_id | uuid |  |
| subject | text |  |
| status | text | not null |
| approved_at | timestamp with time zone |  |
| approved_by_user_id | uuid |  |
| last_message_at | timestamp with time zone |  |
| participant_hash | text | not null |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `pending_approval`, `approved`, `closed`, `blocked`

Join hints:

- `email_conversations.approved_by_user_id` → `users.id`
- `email_conversations.provider_install_id` → `email_provider_installs.id`
- `email_conversations.space_id` → `spaces.id`
- `email_conversations.tenant_id` → `tenants.id`
- `email_conversations.thread_id` → `threads.id`

## email_domains

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider_install_id | uuid | not null |
| domain | text | not null |
| ownership_type | text | not null |
| status | text | not null |
| sending_verified_at | timestamp with time zone |  |
| inbound_verified_at | timestamp with time zone |  |
| dns_records | jsonb | not null |
| provider_metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `ownership_type`: `thinkwork_owned`, `customer_owned`
- `status`: `pending`, `verified`, `failed`, `disabled`

Join hints:

- `email_domains.provider_install_id` → `email_provider_installs.id`
- `email_domains.tenant_id` → `tenants.id`

## email_ledger_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| conversation_id | uuid |  |
| space_id | uuid |  |
| thread_id | uuid |  |
| message_id | uuid |  |
| inbox_item_id | uuid |  |
| provider_install_id | uuid |  |
| event_type | text | not null |
| provider_message_id | text |  |
| provider_event_id | text |  |
| actor_user_id | uuid |  |
| body_object_id | uuid |  |
| subject | text |  |
| from_email | text |  |
| to_emails | jsonb | not null |
| reason_code | text |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `draft_created`, `approval_requested`, `approval_approved`, `approval_denied`, `send_blocked`, `send_attempted`, `send_succeeded`, `send_failed`, `inbound_received`, `inbound_authorized`, `inbound_rejected`, `provider_event`, `readiness_check`, `body_retained`, `body_redacted`

Join hints:

- `email_ledger_events.actor_user_id` → `users.id`
- `email_ledger_events.body_object_id` → `email_body_objects.id`
- `email_ledger_events.conversation_id` → `email_conversations.id`
- `email_ledger_events.inbox_item_id` → `inbox_items.id`
- `email_ledger_events.message_id` → `messages.id`
- `email_ledger_events.provider_install_id` → `email_provider_installs.id`
- `email_ledger_events.space_id` → `spaces.id`
- `email_ledger_events.tenant_id` → `tenants.id`
- `email_ledger_events.thread_id` → `threads.id`

## email_provider_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider_install_id | uuid | not null |
| ledger_event_id | uuid |  |
| provider_event_id | text | not null |
| provider_message_id | text |  |
| event_type | text | not null |
| occurred_at | timestamp with time zone |  |
| payload_metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `sent`, `delivered`, `delayed`, `failed`, `bounced`, `complained`, `opened`, `clicked`, `received`

Join hints:

- `email_provider_events.ledger_event_id` → `email_ledger_events.id`
- `email_provider_events.provider_install_id` → `email_provider_installs.id`
- `email_provider_events.tenant_id` → `tenants.id`

## email_readiness_checks

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider_install_id | uuid | not null |
| domain_id | uuid |  |
| check_key | text | not null |
| status | text | not null |
| last_checked_at | timestamp with time zone |  |
| failure_code | text |  |
| failure_message | text |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `check_key`: `credentials`, `sending_domain`, `inbound_receiving`, `webhook_signature`, `provider_events`, `loop_test`
- `status`: `pending`, `pass`, `fail`, `blocked`

Join hints:

- `email_readiness_checks.domain_id` → `email_domains.id`
- `email_readiness_checks.provider_install_id` → `email_provider_installs.id`
- `email_readiness_checks.tenant_id` → `tenants.id`

## email_ses_compatibility_mappings

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider_install_id | uuid | not null |
| reply_token_id | uuid |  |
| conversation_id | uuid |  |
| ses_message_id | text |  |
| legacy_thread_id | uuid |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `email_ses_compatibility_mappings.conversation_id` → `email_conversations.id`
- `email_ses_compatibility_mappings.legacy_thread_id` → `threads.id`
- `email_ses_compatibility_mappings.provider_install_id` → `email_provider_installs.id`
- `email_ses_compatibility_mappings.reply_token_id` → `email_reply_tokens.id`
- `email_ses_compatibility_mappings.tenant_id` → `tenants.id`

## email_space_policies

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| provider_install_id | uuid |  |
| enabled | boolean | not null |
| registered_users_allowed | boolean | not null |
| private_space_membership_required | boolean | not null |
| outside_sender_default | text | not null |
| first_send_review_required | boolean | not null |
| policy | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `outside_sender_default`: `deny`, `allowlist`

Join hints:

- `email_space_policies.provider_install_id` → `email_provider_installs.id`
- `email_space_policies.space_id` → `spaces.id`
- `email_space_policies.tenant_id` → `tenants.id`

## email_space_sender_allowlists

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| value_type | text | not null |
| value | text | not null |
| reason | text |  |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `value_type`: `email`, `domain`

Join hints:

- `email_space_sender_allowlists.created_by_user_id` → `users.id`
- `email_space_sender_allowlists.space_id` → `spaces.id`
- `email_space_sender_allowlists.tenant_id` → `tenants.id`

## eval_case_overrides

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| run_id | uuid | not null |
| test_case_id | uuid | not null |
| override_status | text | not null |
| overridden_by | text |  |
| overridden_at | timestamp with time zone | not null |
| override_reason | text | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `eval_case_overrides.run_id` → `eval_runs.id`
- `eval_case_overrides.test_case_id` → `eval_test_cases.id`

## eval_datasets

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| name | text |  |
| kind | text | not null |
| version | integer | not null |
| manifest_sha | text |  |
| archived_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `eval_datasets.tenant_id` → `tenants.id`

## eval_profiles

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| model | text | not null |
| runtime_type | text | not null |
| judge_model | text |  |
| trials | integer | not null |
| is_default | boolean | not null |
| archived_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `eval_profiles.tenant_id` → `tenants.id`

## eval_replay_tool_allowlist

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| server_name | text | not null |
| tool_name | text | not null |
| mode | text | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `eval_replay_tool_allowlist.tenant_id` → `tenants.id`

## eval_results

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| run_id | uuid | not null |
| test_case_id | uuid |  |
| status | text | not null |
| trial_index | integer | not null |
| execution_tier | text | not null |
| score | numeric(5, 4) |  |
| duration_ms | integer |  |
| agent_input_tokens | integer |  |
| agent_output_tokens | integer |  |
| agent_cost_usd | numeric(12, 6) |  |
| agent_session_id | text |  |
| thread_turn_id | uuid |  |
| input | text |  |
| system_prompt | text |  |
| expected | text |  |
| actual_output | text |  |
| evaluator_results | jsonb | not null |
| assertions | jsonb | not null |
| error_message | text |  |
| error_cause | text |  |
| override_status | text |  |
| overridden_by | text |  |
| overridden_at | timestamp with time zone |  |
| override_reason | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `eval_results.run_id` → `eval_runs.id`
- `eval_results.test_case_id` → `eval_test_cases.id`
- `eval_results.thread_turn_id` → `thread_turns.id`

## eval_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| computer_id | uuid |  |
| scheduled_job_id | uuid |  |
| requester_user_id | uuid |  |
| status | text | not null |
| execution_target | text | not null |
| runtime_host | text | not null |
| model | text |  |
| categories | text[] | not null |
| selected_test_case_ids | uuid[] | not null |
| dataset_id | uuid |  |
| dataset_version | integer |  |
| pinned_case_ids | text[] |  |
| profile_id | uuid |  |
| profile_snapshot | jsonb |  |
| pinned_trial_plan | jsonb |  |
| expected_result_rows | integer |  |
| total_tests | integer | not null |
| passed | integer | not null |
| failed | integer | not null |
| errored | integer |  |
| unstable | integer |  |
| scoring_version | integer |  |
| summary_scoring_version | integer |  |
| pass_rate | numeric(5, 4) |  |
| regression | boolean | not null |
| cost_usd | numeric(12, 6) |  |
| cost_partial | boolean |  |
| error_message | text |  |
| started_at | timestamp with time zone |  |
| completed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `eval_runs.agent_id` → `agents.id`
- `eval_runs.dataset_id` → `eval_datasets.id`
- `eval_runs.profile_id` → `eval_profiles.id`
- `eval_runs.requester_user_id` → `users.id`
- `eval_runs.scheduled_job_id` → `scheduled_jobs.id`
- `eval_runs.tenant_id` → `tenants.id`

## eval_skill_gate

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| threshold | numeric(5, 4) | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `eval_skill_gate.tenant_id` → `tenants.id`

## eval_test_cases

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| category | text | not null |
| query | text | not null |
| system_prompt | text |  |
| assertions | jsonb | not null |
| agentcore_evaluator_ids | text[] | not null |
| tags | text[] | not null |
| enabled | boolean | not null |
| quality_state | text | not null |
| rewritten_from_id | text |  |
| source | text | not null |
| dataset_id | uuid |  |
| dataset_case_id | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `eval_test_cases.dataset_id` → `eval_datasets.id`
- `eval_test_cases.tenant_id` → `tenants.id`

## folder_bundle_import_rate_limits

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| utc_hour | timestamp with time zone | PK, not null |
| import_count | integer | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `folder_bundle_import_rate_limits.tenant_id` → `tenants.id`

## github_app_installations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| installation_id | integer | not null |
| account_login | text | not null |
| account_type | text | not null |
| status | text | not null |
| permissions | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `github_app_installations.tenant_id` → `tenants.id`

## github_webhook_deliveries

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| event_type | text | not null |
| delivery_id | text |  |
| payload | jsonb |  |
| status | text | not null |
| processed_at | timestamp with time zone |  |
| error | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `github_webhook_deliveries.tenant_id` → `tenants.id`

## goals

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| thread_id | uuid | not null |
| template_key | text |  |
| outcome | text | not null |
| workspace_folder_name | text |  |
| owner_type | text |  |
| owner_id | text |  |
| mode | text | not null |
| status | text | not null |
| progress_model | text | not null |
| completion_rule | jsonb |  |
| review_policy | jsonb |  |
| folder_s3_prefix | text | not null |
| reviewer_type | text |  |
| reviewer_id | text |  |
| started_at | timestamp with time zone | not null |
| reviewed_at | timestamp with time zone |  |
| completed_at | timestamp with time zone |  |
| cancelled_at | timestamp with time zone |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `mode`: `delegate`, `collaborate`
- `status`: `active`, `in_review`, `completed`, `cancelled`

Join hints:

- `goals.space_id` → `spaces.id`
- `goals.tenant_id` → `tenants.id`
- `goals.thread_id` → `threads.id`

## guardrail_blocks

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| guardrail_id | uuid | not null |
| thread_id | uuid |  |
| message_id | uuid |  |
| block_type | text | not null |
| action | text | not null |
| blocked_topics | text[] |  |
| content_filters | jsonb |  |
| raw_response | jsonb |  |
| user_message | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `guardrail_blocks.agent_id` → `agents.id`
- `guardrail_blocks.guardrail_id` → `guardrails.id`
- `guardrail_blocks.tenant_id` → `tenants.id`

## guardrails

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| description | text |  |
| bedrock_guardrail_id | text |  |
| bedrock_version | text |  |
| is_default | boolean | not null |
| status | text | not null |
| config | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `guardrails.tenant_id` → `tenants.id`

## inbox_item_comments

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| inbox_item_id | uuid | not null |
| tenant_id | uuid | not null |
| author_type | text |  |
| author_id | uuid |  |
| content | text | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `inbox_item_comments.inbox_item_id` → `inbox_items.id`
- `inbox_item_comments.tenant_id` → `tenants.id`

## inbox_item_links

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| inbox_item_id | uuid | not null |
| tenant_id | uuid | not null |
| linked_type | text |  |
| linked_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `inbox_item_links.inbox_item_id` → `inbox_items.id`
- `inbox_item_links.tenant_id` → `tenants.id`

## inbox_items

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| requester_type | text |  |
| requester_id | uuid |  |
| recipient_id | uuid |  |
| type | text | not null |
| status | text | not null |
| title | text |  |
| description | text |  |
| entity_type | text |  |
| entity_id | uuid |  |
| config | jsonb |  |
| revision | integer | not null |
| review_notes | text |  |
| decided_by | uuid |  |
| decided_at | timestamp with time zone |  |
| expires_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `inbox_items.tenant_id` → `tenants.id`

## linked_task_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| linked_task_id | uuid | not null |
| space_id | uuid | not null |
| thread_id | uuid | not null |
| provider | text | not null |
| event_type | text | not null |
| external_event_id | text |  |
| previous_status | text |  |
| new_status | text |  |
| message | text |  |
| metadata | jsonb |  |
| occurred_at | timestamp with time zone | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `provider`: `lastmile`, `thinkwork`, `twenty`
- `event_type`: `created`, `status_changed`, `completed`, `blocked`, `reassigned`, `due_date_changed`, `comment_added`, `sync_failed`, `writeback_posted`
- `previous_status`: `unknown`, `todo`, `in_progress`, `completed`, `blocked`, `cancelled`, `not_applicable`
- `new_status`: `unknown`, `todo`, `in_progress`, `completed`, `blocked`, `cancelled`, `not_applicable`

Join hints:

- `linked_task_events.linked_task_id` → `linked_tasks.id`
- `linked_task_events.space_id` → `spaces.id`
- `linked_task_events.tenant_id` → `tenants.id`
- `linked_task_events.thread_id` → `threads.id`

## linked_tasks

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| thread_id | uuid | not null |
| checklist_item_id | uuid |  |
| provider | text | not null |
| external_task_id | text | not null |
| external_task_url | text |  |
| title | text | not null |
| required | boolean | not null |
| role_key | text |  |
| assignee_display | text |  |
| assignee_external_id | text |  |
| status | text | not null |
| blocked | boolean | not null |
| sync_status | text | not null |
| last_synced_at | timestamp with time zone |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `provider`: `lastmile`, `thinkwork`, `twenty`
- `status`: `unknown`, `todo`, `in_progress`, `completed`, `blocked`, `cancelled`, `not_applicable`
- `sync_status`: `pending`, `synced`, `warning`, `error`

Join hints:

- `linked_tasks.checklist_item_id` → `space_checklist_items.id`
- `linked_tasks.space_id` → `spaces.id`
- `linked_tasks.tenant_id` → `tenants.id`
- `linked_tasks.thread_id` → `threads.id`

## managed_application_deployment_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| job_id | uuid | not null |
| event_type | text | not null |
| message | text | not null |
| payload | jsonb | not null |
| idempotency_key | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `managed_application_deployment_events.job_id` → `managed_application_deployment_jobs.id`
- `managed_application_deployment_events.tenant_id` → `tenants.id`

## managed_application_deployment_jobs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| application_id | uuid |  |
| app_key | text | not null |
| operation | text | not null |
| status | text | not null |
| idempotency_key | text | not null |
| requested_by_user_id | uuid |  |
| release_version | text | not null |
| manifest_digest | text | not null |
| desired_config_version | text | not null |
| state_machine_arn | text |  |
| plan_execution_arn | text |  |
| apply_execution_arn | text |  |
| codebuild_build_arn | text |  |
| plan_digest | text |  |
| plan_summary | jsonb | not null |
| data_impact | jsonb | not null |
| evidence_bucket | text |  |
| evidence_prefix | text |  |
| approval_required | boolean | not null |
| approved_by_user_id | uuid |  |
| approved_at | timestamp with time zone |  |
| rejected_by_user_id | uuid |  |
| rejected_at | timestamp with time zone |  |
| error_message | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `managed_application_deployment_jobs.application_id` → `managed_applications.id`
- `managed_application_deployment_jobs.tenant_id` → `tenants.id`

## managed_applications

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| key | text | not null |
| display_name | text | not null |
| desired_status | text | not null |
| current_status | text | not null |
| desired_config | jsonb | not null |
| selected_release_version | text |  |
| selected_manifest_digest | text |  |
| last_job_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `managed_applications.tenant_id` → `tenants.id`

## memory_claim_evidence

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| claim_id | uuid | not null |
| evidence_item_id | uuid | not null |
| source_config_id | uuid | not null |
| status | text | not null |
| created_at | timestamp with time zone | not null |
| retracted_at | timestamp with time zone |  |

Enum values:

- `status`: `active`, `retracted`

Join hints:

- `memory_claim_evidence.claim_id` → `memory_claims.id`
- `memory_claim_evidence.evidence_item_id` → `memory_evidence_items.id`
- `memory_claim_evidence.source_config_id` → `memory_source_configs.id`
- `memory_claim_evidence.tenant_id` → `tenants.id`

## memory_claims

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| target_scope | text | not null |
| target_id | uuid | not null |
| canonical_subject_id | uuid |  |
| subject_key | text | not null |
| subject_entity_type | text | not null |
| ontology_predicate | text | not null |
| value_hash | text | not null |
| effective_from | timestamp with time zone |  |
| effective_to | timestamp with time zone |  |
| status | text | not null |
| conflict_state | text | not null |
| extraction_version | text | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `target_scope`: `user`, `space`, `tenant`
- `status`: `active`, `superseded`, `retracted`
- `conflict_state`: `none`, `conflicted`

Join hints:

- `memory_claims.canonical_subject_id` → `canonical_entities.id`
- `memory_claims.tenant_id` → `tenants.id`

Not granted (do not query): `value`.

## memory_derivations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| source_config_id | uuid | not null |
| evidence_item_id | uuid | not null |
| projection_key | text | not null |
| target_bank_id | text | not null |
| hindsight_document_id | text | not null |
| current_version | text | not null |
| lifecycle | text | not null |
| retracted_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `lifecycle`: `active`, `superseded`, `retracted`

Join hints:

- `memory_derivations.evidence_item_id` → `memory_evidence_items.id`
- `memory_derivations.source_config_id` → `memory_source_configs.id`
- `memory_derivations.tenant_id` → `tenants.id`

## memory_evidence_items

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| source_config_id | uuid | not null |
| source_item_id | text | not null |
| source_version | text | not null |
| source_timestamp | timestamp with time zone |  |
| content_hash | text | not null |
| acquisition_run_id | uuid |  |
| target_scope | text | not null |
| target_id | uuid | not null |
| lifecycle | text | not null |
| sensitivity | text |  |
| snapshot_ref | text |  |
| snapshot_expires_at | timestamp with time zone |  |
| extraction_recipe | jsonb | not null |
| last_error | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `target_scope`: `user`, `space`, `tenant`
- `lifecycle`: `active`, `superseded`, `deleted`, `deferred`, `failed`

Join hints:

- `memory_evidence_items.acquisition_run_id` → `workflow_runs.id`
- `memory_evidence_items.source_config_id` → `memory_source_configs.id`
- `memory_evidence_items.tenant_id` → `tenants.id`

Not granted (do not query): `normalized_snapshot`.

## memory_processor_configs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| mode | text | not null |
| target_scope | text | not null |
| target_id | uuid | not null |
| workflow_id | uuid |  |
| enabled | boolean | not null |
| status | text | not null |
| budget | jsonb | not null |
| stage_overrides | jsonb | not null |
| config_version | integer | not null |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `mode`: `personal`, `shared`
- `target_scope`: `user`, `space`, `tenant`
- `status`: `active`, `disabled`

Join hints:

- `memory_processor_configs.created_by_user_id` → `users.id`
- `memory_processor_configs.tenant_id` → `tenants.id`
- `memory_processor_configs.workflow_id` → `workflows.id`

## memory_retraction_attempts

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| scope | text | not null |
| derivation_id | uuid |  |
| source_config_id | uuid | not null |
| provider | text | not null |
| provider_document_id | text | not null |
| target_bank_id | text | not null |
| status | text | not null |
| attempt_count | integer | not null |
| max_attempts | integer | not null |
| next_retry_at | timestamp with time zone |  |
| locked_at | timestamp with time zone |  |
| locked_by | text |  |
| lock_generation | integer | not null |
| erase_generation | integer | not null |
| cleanup_phase | text |  |
| cleanup_cursor | text |  |
| reconsolidation_note | text |  |
| error_class | text |  |
| error_message | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| completed_at | timestamp with time zone |  |

Enum values:

- `scope`: `derivation`, `source`, `erase`
- `status`: `queued`, `running`, `supports_updated`, `provider_deleted`, `reconsolidated`, `retracted`, `failed`, `dead_lettered`
- `cleanup_phase`: `snapshots_deleted`, `evidence_purged`

Join hints:

- `memory_retraction_attempts.derivation_id` → `memory_derivations.id`
- `memory_retraction_attempts.source_config_id` → `memory_source_configs.id`
- `memory_retraction_attempts.tenant_id` → `tenants.id`

## memory_run_items

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| workflow_run_id | uuid | not null |
| source_config_id | uuid | not null |
| source_item_id | text | not null |
| stage | text | not null |
| result | text | not null |
| detail | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `stage`: `acquire`, `extract`, `project`, `resolve`, `retain`, `compound`, `graph`, `wiki`, `preflight`
- `result`: `seen`, `changed`, `retracted`, `deferred`, `failed`, `noop`

Join hints:

- `memory_run_items.source_config_id` → `memory_source_configs.id`
- `memory_run_items.tenant_id` → `tenants.id`
- `memory_run_items.workflow_run_id` → `workflow_runs.id`

## memory_source_authorizations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| processor_config_id | uuid | not null |
| source_family | text | not null |
| source_binding_key | text | not null |
| boundary | jsonb | not null |
| granted_by_user_id | uuid |  |
| grant_version | integer | not null |
| status | text | not null |
| expires_at | timestamp with time zone |  |
| revoked_at | timestamp with time zone |  |
| sensitivity | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `source_family`: `twenty`, `firecrawl`, `email`, `bedrock_kb`
- `status`: `active`, `revoked`, `expired`

Join hints:

- `memory_source_authorizations.granted_by_user_id` → `users.id`
- `memory_source_authorizations.processor_config_id` → `memory_processor_configs.id`
- `memory_source_authorizations.tenant_id` → `tenants.id`

## memory_source_checkpoints

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| source_config_id | uuid | not null |
| partition_key | text | not null |
| cursor | jsonb | not null |
| version | integer | not null |
| last_advanced_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `memory_source_checkpoints.source_config_id` → `memory_source_configs.id`
- `memory_source_checkpoints.tenant_id` → `tenants.id`

## memory_source_configs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| processor_config_id | uuid | not null |
| source_family | text | not null |
| source_binding_key | text | not null |
| enabled | boolean | not null |
| boundary | jsonb | not null |
| policy_version | integer | not null |
| erase_generation | integer | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `source_family`: `twenty`, `firecrawl`, `email`, `bedrock_kb`

Join hints:

- `memory_source_configs.processor_config_id` → `memory_processor_configs.id`
- `memory_source_configs.tenant_id` → `tenants.id`

## message_artifacts

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| message_id | uuid | not null |
| thread_id | uuid | not null |
| tenant_id | uuid | not null |
| artifact_type | text | not null |
| name | text |  |
| content | text |  |
| s3_key | text |  |
| mime_type | text |  |
| size_bytes | integer |  |
| metadata | jsonb |  |
| artifact_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `message_artifacts.message_id` → `messages.id`
- `message_artifacts.tenant_id` → `tenants.id`
- `message_artifacts.thread_id` → `threads.id`

## message_mentions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| message_id | uuid | not null |
| target_type | text | not null |
| target_id | uuid | not null |
| display_name | text | not null |
| raw_text | text |  |
| start_offset | integer |  |
| end_offset | integer |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `target_type`: `user`, `agent`, `agent_profile`

Join hints:

- `message_mentions.message_id` → `messages.id`
- `message_mentions.tenant_id` → `tenants.id`
- `message_mentions.thread_id` → `threads.id`

## messages

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| thread_id | uuid | not null |
| tenant_id | uuid | not null |
| role | text | not null |
| content | text |  |
| parts | jsonb |  |
| sender_type | text |  |
| sender_id | uuid |  |
| source_event_id | text |  |
| tool_calls | jsonb |  |
| tool_results | jsonb |  |
| metadata | jsonb |  |
| token_count | integer |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `messages.tenant_id` → `tenants.id`
- `messages.thread_id` → `threads.id`

## model_catalog

Note: Platform-global model reference data — not tenant-scoped. RLS is intentionally not enabled (THINK-234).

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| model_id | text | not null |
| provider | text | not null |
| display_name | text | not null |
| input_cost_per_million | numeric(10, 4) |  |
| output_cost_per_million | numeric(10, 4) |  |
| context_window | integer |  |
| max_output_tokens | integer |  |
| supports_vision | boolean |  |
| supports_tools | boolean |  |
| is_available | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

## msteams_tenant_installs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| entra_tenant_id | text | not null |
| bot_app_id | text | not null |
| status | text | not null |
| consent_status | text | not null |
| installed_by_user_id | uuid |  |
| installed_at | timestamp with time zone |  |
| uninstalled_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `pending`, `active`, `uninstalled`, `revoked`
- `consent_status`: `pending`, `granted`, `admin_required`, `revoked`

Join hints:

- `msteams_tenant_installs.installed_by_user_id` → `users.id`
- `msteams_tenant_installs.tenant_id` → `tenants.id`

## msteams_threads

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| entra_tenant_id | text | not null |
| conversation_id | text | not null |
| service_url | text | not null |
| thread_id | uuid | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `msteams_threads.entra_tenant_id` → `msteams_tenant_installs.entra_tenant_id`
- `msteams_threads.tenant_id` → `tenants.id`
- `msteams_threads.thread_id` → `threads.id`

## msteams_user_links

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| entra_tenant_id | text | not null |
| aad_object_id | text | not null |
| user_id | uuid | not null |
| display_name | text |  |
| status | text | not null |
| linked_at | timestamp with time zone | not null |
| unlinked_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `unlinked`, `orphaned`, `suspended`

Join hints:

- `msteams_user_links.entra_tenant_id` → `msteams_tenant_installs.entra_tenant_id`
- `msteams_user_links.tenant_id` → `tenants.id`
- `msteams_user_links.user_id` → `users.id`

## mutation_idempotency

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| invoker_user_id | uuid | not null |
| mutation_name | text | not null |
| idempotency_key | text | not null |
| resolved_inputs_hash | text | not null |
| status | text | not null |
| result_json | jsonb |  |
| failure_reason | text |  |
| created_at | timestamp with time zone | not null |
| completed_at | timestamp with time zone |  |

Join hints:

- `mutation_idempotency.tenant_id` → `tenants.id`

## pending_user_questions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| message_id | uuid | not null |
| thread_turn_id | uuid | not null |
| status | text | not null |
| questions | jsonb | not null |
| answers | jsonb |  |
| answered_via | text |  |
| answered_by | text |  |
| answered_at | timestamp with time zone |  |
| delegation_context | jsonb |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `status`: `pending`, `answered`, `cancelled`
- `answered_via`: `card`, `reply`

Join hints:

- `pending_user_questions.message_id` → `messages.id`
- `pending_user_questions.tenant_id` → `tenants.id`
- `pending_user_questions.thread_id` → `threads.id`
- `pending_user_questions.thread_turn_id` → `thread_turns.id`

## pi_extension_assignments

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| version_id | uuid | not null |
| target_type | text | not null |
| agent_profile_id | uuid |  |
| enabled | boolean | not null |
| granted_permissions | jsonb | not null |
| assigned_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `target_type`: `default_agent`, `agent_profile`

Join hints:

- `pi_extension_assignments.agent_profile_id` → `agent_profiles.id`
- `pi_extension_assignments.assigned_by_user_id` → `users.id`
- `pi_extension_assignments.tenant_id` → `tenants.id`
- `pi_extension_assignments.version_id` → `pi_extension_versions.id`

## pi_extension_sources

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| source_type | text | not null |
| repository_url | text | not null |
| repository_owner | text |  |
| repository_name | text |  |
| display_name | text |  |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `source_type`: `github`

Join hints:

- `pi_extension_sources.created_by_user_id` → `users.id`
- `pi_extension_sources.tenant_id` → `tenants.id`

## pi_extension_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| source_id | uuid | not null |
| display_name | text |  |
| description | text |  |
| source_ref | text | not null |
| commit_sha | text |  |
| manifest_hash | text |  |
| artifact_hash | text |  |
| artifact_uri | text |  |
| runtime_target | text |  |
| status | text | not null |
| status_reason | text |  |
| manifest | jsonb | not null |
| tool_names | text[] | not null |
| lifecycle_hooks | text[] | not null |
| permission_classes | text[] | not null |
| verification_report | jsonb | not null |
| reviewed_by_user_id | uuid |  |
| reviewed_at | timestamp with time zone |  |
| approved_by_user_id | uuid |  |
| approved_at | timestamp with time zone |  |
| rejected_by_user_id | uuid |  |
| rejected_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `imported`, `needs_review`, `approved`, `rejected`, `failed_verification`

Join hints:

- `pi_extension_versions.approved_by_user_id` → `users.id`
- `pi_extension_versions.rejected_by_user_id` → `users.id`
- `pi_extension_versions.reviewed_by_user_id` → `users.id`
- `pi_extension_versions.source_id` → `pi_extension_sources.id`
- `pi_extension_versions.tenant_id` → `tenants.id`

## plugin_app_overlays

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| plugin_install_id | uuid | not null |
| app_surface_key | text | not null |
| app_key | text | not null |
| provider | text | not null |
| provider_record_type | text | not null |
| provider_record_id | text | not null |
| section_key | text | not null |
| payload | jsonb | not null |
| created_by_user_id | uuid |  |
| updated_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `plugin_app_overlays.created_by_user_id` → `users.id`
- `plugin_app_overlays.plugin_install_id` → `plugin_installs.id`
- `plugin_app_overlays.tenant_id` → `tenants.id`
- `plugin_app_overlays.updated_by_user_id` → `users.id`

## plugin_components

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| plugin_install_id | uuid | not null |
| component_key | text | not null |
| component_type | text | not null |
| state | text | not null |
| handler_ref | jsonb | not null |
| last_error | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `component_type`: `mcp-server`, `skills`, `infrastructure`, `ui-surface`
- `state`: `pending`, `provisioned`, `failed`

Join hints:

- `plugin_components.plugin_install_id` → `plugin_installs.id`

## plugin_entitlements

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| plugin_key | text | not null |
| entitlement_product_key | text | not null |
| status | text | not null |
| source | text | not null |
| granted_by_user_id | uuid |  |
| granted_at | timestamp with time zone | not null |
| revoked_at | timestamp with time zone |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `revoked`
- `source`: `install_key`, `backdoor_key`, `operator_grant`, `migration`

Join hints:

- `plugin_entitlements.granted_by_user_id` → `users.id`
- `plugin_entitlements.tenant_id` → `tenants.id`

## plugin_installs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| plugin_key | text | not null |
| pinned_version | text | not null |
| pinned_payload_sha256 | text | not null |
| state | text | not null |
| idempotency_key | text | not null |
| last_transition_at | timestamp with time zone | not null |
| last_error | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `state`: `installing`, `awaiting_approval`, `installed`, `partially_installed`, `failed`, `uninstalling`

Join hints:

- `plugin_installs.tenant_id` → `tenants.id`

## plugin_uploads

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| uploaded_by | uuid |  |
| uploaded_at | timestamp with time zone | not null |
| bundle_sha256 | text | not null |
| plugin_name | text | not null |
| plugin_version | text |  |
| status | text | not null |
| s3_staging_prefix | text |  |
| error_message | text |  |

Join hints:

- `plugin_uploads.tenant_id` → `tenants.id`

## principal_permission_grants

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| principal_type | text | not null |
| principal_id | uuid | not null |
| permission_key | text | not null |
| scope | jsonb |  |
| granted_by | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `principal_permission_grants.granted_by` → `users.id`
- `principal_permission_grants.tenant_id` → `tenants.id`

## recipes

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| thread_id | uuid |  |
| title | text | not null |
| summary | text |  |
| server | text | not null |
| tool | text | not null |
| params | jsonb | not null |
| genui_type | text | not null |
| templates | jsonb |  |
| cached_result | jsonb |  |
| last_refreshed | timestamp with time zone |  |
| last_error | text |  |
| source_message_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `recipes.agent_id` → `agents.id`
- `recipes.source_message_id` → `messages.id`
- `recipes.tenant_id` → `tenants.id`
- `recipes.thread_id` → `threads.id`

## release_update_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| job_id | uuid | not null |
| event_type | text | not null |
| message | text | not null |
| payload | jsonb | not null |
| idempotency_key | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `release_update_events.job_id` → `release_update_jobs.id`
- `release_update_events.tenant_id` → `tenants.id`

## release_update_jobs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| status | text | not null |
| idempotency_key | text | not null |
| requested_by_user_id | uuid |  |
| target_release_version | text | not null |
| current_release_version | text |  |
| manifest_url | text | not null |
| manifest_sha256 | text | not null |
| manifest_signed | boolean | not null |
| manifest_trust_policy | text |  |
| terraform_module_version | text |  |
| preflight_summary | jsonb | not null |
| preserved_config_summary | jsonb | not null |
| remediation_summary | jsonb | not null |
| state_machine_arn | text |  |
| execution_arn | text |  |
| codebuild_build_arn | text |  |
| evidence_bucket | text |  |
| evidence_prefix | text |  |
| status_pointer_bucket | text |  |
| status_pointer_key | text |  |
| final_status | jsonb | not null |
| failure_category | text |  |
| failure_message | text |  |
| recovery_action | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `release_update_jobs.tenant_id` → `tenants.id`

## resolved_capability_manifests

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| session_id | text | not null |
| agent_id | uuid |  |
| template_id | uuid |  |
| user_id | uuid |  |
| thread_id | uuid |  |
| thread_turn_id | uuid |  |
| space_id | uuid |  |
| agent_profile_id | uuid |  |
| config_fingerprint | text |  |
| tenant_id | uuid | not null |
| manifest_json | jsonb | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `resolved_capability_manifests.agent_id` → `agents.id`
- `resolved_capability_manifests.tenant_id` → `tenants.id`

## retry_queue

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| thread_id | uuid |  |
| attempt | integer | not null |
| max_attempts | integer | not null |
| status | text | not null |
| scheduled_at | timestamp with time zone | not null |
| last_error | text |  |
| origin_turn_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `retry_queue.agent_id` → `agents.id`
- `retry_queue.tenant_id` → `tenants.id`
- `retry_queue.thread_id` → `threads.id`

## routine_asl_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| routine_id | uuid | not null |
| version_number | integer | not null |
| state_machine_arn | text | not null |
| version_arn | text | not null |
| alias_was_pointing | text |  |
| asl_json | jsonb | not null |
| markdown_summary | text | not null |
| step_manifest_json | jsonb | not null |
| validation_warnings_json | jsonb |  |
| published_by_actor_id | uuid |  |
| published_by_actor_type | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `routine_asl_versions.routine_id` → `routines.id`
- `routine_asl_versions.tenant_id` → `tenants.id`

## routine_code_cache

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| routine_id | uuid | not null |
| sha | text | not null |
| s3_key | text | not null |
| fixture_status | text | not null |
| fixture_result_json | text |  |
| capability_dependencies | jsonb |  |
| fetched_at | timestamp with time zone | not null |
| validated_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `fixture_status`: `pending`, `green`, `red`

Join hints:

- `routine_code_cache.routine_id` → `routines.id`
- `routine_code_cache.tenant_id` → `tenants.id`

## routine_executions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| routine_id | uuid | not null |
| state_machine_arn | text |  |
| alias_arn | text |  |
| version_arn | text |  |
| routine_asl_version_id | uuid |  |
| sfn_execution_arn | text |  |
| trigger_id | uuid |  |
| trigger_source | text | not null |
| input_json | jsonb |  |
| output_json | jsonb |  |
| execution_principal | jsonb |  |
| status | text | not null |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| error_code | text |  |
| error_message | text |  |
| total_llm_cost_usd_cents | bigint |  |
| commit_sha | text |  |
| validated_sha | text |  |
| cache_served | boolean |  |
| capability_dependencies_json | jsonb |  |
| config_fingerprint | text |  |
| readiness_outcome | text |  |
| remediation_json | jsonb |  |
| broker_session_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `routine_executions.routine_asl_version_id` → `routine_asl_versions.id`
- `routine_executions.routine_id` → `routines.id`
- `routine_executions.tenant_id` → `tenants.id`
- `routine_executions.trigger_id` → `scheduled_jobs.id`

## routine_repair_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| routine_id | uuid | not null |
| execution_id | uuid |  |
| event_type | text | not null |
| thread_ref | text |  |
| from_sha | text |  |
| to_sha | text |  |
| gate_result | text |  |
| envelope_verdict | text |  |
| budget_snapshot | integer |  |
| detail_json | jsonb |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `retry`, `revert`, `repair_attempt`, `pending_commit`, `disabled`, `infra_failure`

Join hints:

- `routine_repair_events.execution_id` → `routine_executions.id`
- `routine_repair_events.routine_id` → `routines.id`
- `routine_repair_events.tenant_id` → `tenants.id`

## routine_step_events

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| execution_id | uuid | not null |
| node_id | text | not null |
| recipe_type | text | not null |
| status | text | not null |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| input_json | jsonb |  |
| output_json | jsonb |  |
| error_json | jsonb |  |
| llm_cost_usd_cents | bigint |  |
| retry_count | integer | not null |
| stdout_s3_uri | text |  |
| stderr_s3_uri | text |  |
| stdout_preview | text |  |
| truncated | boolean | not null |
| broker_call_id | uuid |  |
| artifact_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `routine_step_events.execution_id` → `routine_executions.id`
- `routine_step_events.tenant_id` → `tenants.id`

## routines

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| name | text | not null |
| description | text |  |
| type | text | not null |
| status | text | not null |
| schedule | text |  |
| config | jsonb |  |
| engine | text | not null |
| state_machine_arn | text |  |
| state_machine_alias_arn | text |  |
| documentation_md | text |  |
| current_version | integer |  |
| visibility | text | not null |
| owning_agent_id | uuid |  |
| catalog_slug | text |  |
| module_path | text |  |
| fixture_paths | jsonb |  |
| capability_dependencies | jsonb |  |
| execution_principal | jsonb |  |
| validated_sha | text |  |
| disabled_reason | text |  |
| last_run_at | timestamp with time zone |  |
| next_run_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `engine`: `legacy_python`, `step_functions`, `git_python`
- `visibility`: `agent_private`, `tenant_shared`

Join hints:

- `routines.agent_id` → `agents.id`
- `routines.owning_agent_id` → `agents.id`
- `routines.tenant_id` → `tenants.id`

Not granted (do not query): `credential_refs`.

## sandbox_agent_hourly_counters

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| agent_id | uuid | PK, not null |
| utc_hour | timestamp with time zone | PK, not null |
| invocations_count | integer | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `sandbox_agent_hourly_counters.agent_id` → `agents.id`
- `sandbox_agent_hourly_counters.tenant_id` → `tenants.id`

## sandbox_invocations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| run_id | uuid |  |
| agent_id | uuid |  |
| user_id | uuid | not null |
| template_id | text |  |
| tool_call_id | text |  |
| session_id | text |  |
| environment_id | text | not null |
| invocation_source | text |  |
| started_at | timestamp with time zone | not null |
| finished_at | timestamp with time zone |  |
| duration_ms | integer |  |
| exit_status | text |  |
| stdout_bytes | bigint |  |
| stderr_bytes | bigint |  |
| stdout_truncated | boolean | not null |
| stderr_truncated | boolean | not null |
| peak_memory_mb | integer |  |
| outbound_hosts | jsonb |  |
| executed_code_hash | text |  |
| failure_reason | text |  |
| created_at | timestamp with time zone | not null |
| delete_at | timestamp with time zone | not null |

Enum values:

- `invocation_source`: `chat`, `scheduled`, `composition`
- `exit_status`: `ok`, `error`, `timeout`, `oom`, `cap_exceeded`, `provisioning`, `connection_revoked`

Join hints:

- `sandbox_invocations.agent_id` → `agents.id`
- `sandbox_invocations.run_id` → `skill_runs.id`
- `sandbox_invocations.tenant_id` → `tenants.id`

## sandbox_tenant_daily_counters

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| utc_date | date | PK, not null |
| invocations_count | integer | not null |
| wall_clock_seconds | integer | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `sandbox_tenant_daily_counters.tenant_id` → `tenants.id`

## scheduled_jobs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| trigger_type | text | not null |
| agent_id | uuid |  |
| space_id | uuid |  |
| computer_id | uuid |  |
| routine_id | uuid |  |
| agent_loop_id | uuid |  |
| workflow_id | uuid |  |
| name | text | not null |
| description | text |  |
| prompt | text |  |
| config | jsonb |  |
| schedule_type | text |  |
| schedule_expression | text |  |
| timezone | text | not null |
| enabled | boolean | not null |
| budget_paused | boolean | not null |
| budget_paused_at | timestamp with time zone |  |
| budget_paused_reason | text |  |
| eb_schedule_name | text |  |
| last_run_at | timestamp with time zone |  |
| next_run_at | timestamp with time zone |  |
| created_by_type | text |  |
| created_by_id | text |  |
| run_as_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `scheduled_jobs.agent_id` → `agents.id`
- `scheduled_jobs.routine_id` → `routines.id`
- `scheduled_jobs.run_as_user_id` → `users.id`
- `scheduled_jobs.space_id` → `spaces.id`
- `scheduled_jobs.tenant_id` → `tenants.id`

## skill_catalog

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| display_name | text |  |
| description | text |  |
| category | text |  |
| icon | text |  |
| tags | text[] |  |
| content_sha | text | not null |
| trust_report | jsonb |  |
| trust_report_content_sha | text |  |
| trust_report_pipeline_version | text |  |
| trust_report_updated_at | timestamp with time zone |  |
| signature_status | text |  |
| signed_content_sha | text |  |
| signed_payload_hash | text |  |
| signed_at | timestamp with time zone |  |
| signed_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `skill_catalog.signed_by_user_id` → `users.id`
- `skill_catalog.tenant_id` → `tenants.id`

Not granted (do not query): `signature_payload`.

## skill_draft_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| draft_id | uuid | not null |
| actor_user_id | uuid |  |
| event_type | text | not null |
| message | text |  |
| payload | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `created`, `updated`, `submitted`, `rejected`, `failed`, `published`

Join hints:

- `skill_draft_events.actor_user_id` → `users.id`
- `skill_draft_events.draft_id` → `skill_drafts.id`
- `skill_draft_events.tenant_id` → `tenants.id`

## skill_drafts

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| requested_by_user_id | uuid | not null |
| source_thread_id | uuid |  |
| source_message_id | uuid |  |
| inbox_item_id | uuid |  |
| slug | text | not null |
| title | text | not null |
| display_name | text |  |
| summary | text |  |
| source_kind | text | not null |
| status | text | not null |
| current_content_hash | text |  |
| draft_s3_prefix | text | not null |
| failure_message | text |  |
| rejected_by_user_id | uuid |  |
| rejected_at | timestamp with time zone |  |
| published_catalog_slug | text |  |
| published_content_hash | text |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| submitted_at | timestamp with time zone |  |

Enum values:

- `source_kind`: `thread`, `archive`, `manual`, `existing_skill`
- `status`: `draft`, `submitted`, `rejected`, `failed`, `published`

Join hints:

- `skill_drafts.rejected_by_user_id` → `users.id`
- `skill_drafts.requested_by_user_id` → `users.id`
- `skill_drafts.source_message_id` → `messages.id`
- `skill_drafts.source_thread_id` → `threads.id`
- `skill_drafts.tenant_id` → `tenants.id`

## skill_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| invoker_user_id | uuid | not null |
| skill_id | text | not null |
| skill_version | integer | not null |
| invocation_source | text | not null |
| inputs | jsonb | not null |
| resolved_inputs | jsonb | not null |
| resolved_inputs_hash | text | not null |
| triggered_by_run_id | uuid |  |
| status | text | not null |
| delivery_channels | jsonb | not null |
| started_at | timestamp with time zone | not null |
| finished_at | timestamp with time zone |  |
| delivered_artifact_ref | jsonb |  |
| delete_at | timestamp with time zone | not null |
| feedback_signal | text |  |
| feedback_note | text |  |
| failure_reason | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `skill_runs.agent_id` → `agents.id`
- `skill_runs.tenant_id` → `tenants.id`

Not granted (do not query): `completion_hmac_secret`.

## slack_threads

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slack_team_id | text | not null |
| channel_id | text | not null |
| root_thread_ts | text |  |
| thread_id | uuid | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `slack_threads.slack_team_id` → `slack_workspaces.slack_team_id`
- `slack_threads.tenant_id` → `tenants.id`
- `slack_threads.thread_id` → `threads.id`

## slack_user_links

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slack_team_id | text | not null |
| slack_user_id | text | not null |
| user_id | uuid | not null |
| slack_user_name | text |  |
| slack_user_email | text |  |
| status | text | not null |
| linked_at | timestamp with time zone | not null |
| unlinked_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `unlinked`, `orphaned`, `suspended`

Join hints:

- `slack_user_links.slack_team_id` → `slack_workspaces.slack_team_id`
- `slack_user_links.tenant_id` → `tenants.id`
- `slack_user_links.user_id` → `users.id`

## space_checklist_items

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| template_id | uuid | not null |
| key | text | not null |
| title | text | not null |
| description | text |  |
| role_key | text |  |
| required | boolean | not null |
| sort_order | integer | not null |
| external_task_template | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `space_checklist_items.space_id` → `spaces.id`
- `space_checklist_items.template_id` → `space_checklist_templates.id`
- `space_checklist_items.tenant_id` → `tenants.id`

## space_checklist_templates

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| key | text | not null |
| name | text | not null |
| description | text |  |
| config | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `space_checklist_templates.space_id` → `spaces.id`
- `space_checklist_templates.tenant_id` → `tenants.id`

## space_integrations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| provider | text | not null |
| status | text | not null |
| writeback_policy | text | not null |
| config | jsonb |  |
| webhook_config_ref | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `provider`: `lastmile_tasks`, `webhook`
- `status`: `active`, `paused`, `archived`
- `writeback_policy`: `disabled`, `status_only`, `status_and_comments`

Join hints:

- `space_integrations.space_id` → `spaces.id`
- `space_integrations.tenant_id` → `tenants.id`

## space_mcp_servers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| mcp_server_id | uuid | not null |
| enabled | boolean | not null |
| config | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `space_mcp_servers.mcp_server_id` → `tenant_mcp_servers.id`
- `space_mcp_servers.space_id` → `spaces.id`
- `space_mcp_servers.tenant_id` → `tenants.id`

## space_members

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| user_id | uuid | not null |
| role | text | not null |
| notification_preference | text | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `role`: `owner`, `admin`, `member`, `viewer`
- `notification_preference`: `subscribed`, `mentions`, `muted`

Join hints:

- `space_members.space_id` → `spaces.id`
- `space_members.tenant_id` → `tenants.id`
- `space_members.user_id` → `users.id`

## spaces

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| workspace_folder_name | text |  |
| name | text | not null |
| description | text |  |
| prompt | text |  |
| status | text | not null |
| kind | text | not null |
| access_mode | text | not null |
| icon | text |  |
| category | text |  |
| template_key | text |  |
| config | jsonb |  |
| context_config | jsonb |  |
| connected_data_config | jsonb |  |
| tool_policy | jsonb |  |
| mcp_policy | jsonb |  |
| agent_availability_policy | jsonb |  |
| trigger_config | jsonb |  |
| email_triggers_enabled | boolean | not null |
| email_trigger_status | text | not null |
| model_override | text |  |
| guardrail_id_override | uuid |  |
| budget_monthly_cents_override | integer |  |
| budget_paused_override | boolean |  |
| sandbox_override | boolean |  |
| render_diagnostics | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `archived`
- `kind`: `custom`, `customer_onboarding`
- `access_mode`: `public`, `private`
- `email_trigger_status`: `none`, `disabled`, `enabled`

Join hints:

- `spaces.guardrail_id_override` → `guardrails.id`
- `spaces.tenant_id` → `tenants.id`

## stripe_customers

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| stripe_customer_id | text | not null |
| email | text | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `stripe_customers.tenant_id` → `tenants.id`

## stripe_subscriptions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| stripe_subscription_id | text | not null |
| stripe_price_id | text | not null |
| status | text | not null |
| current_period_end | timestamp with time zone |  |
| cancel_at_period_end | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `stripe_subscriptions.tenant_id` → `tenants.id`

## tenant_builtin_tools

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| tool_slug | text | not null |
| provider | text |  |
| enabled | boolean | not null |
| config | jsonb |  |
| last_tested_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_builtin_tools.tenant_id` → `tenants.id`

Not granted (do not query): `secret_ref`.

## tenant_context_provider_settings

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| provider_id | text | not null |
| family | text | not null |
| enabled | boolean | not null |
| default_enabled | boolean | not null |
| config | jsonb | not null |
| last_tested_at | timestamp with time zone |  |
| last_test_state | text |  |
| last_test_latency_ms | integer |  |
| last_test_error | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_context_provider_settings.tenant_id` → `tenants.id`

## tenant_mcp_context_tools

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| mcp_server_id | uuid | not null |
| tool_name | text | not null |
| display_name | text |  |
| declared_read_only | boolean | not null |
| declared_search_safe | boolean | not null |
| approved | boolean | not null |
| default_enabled | boolean | not null |
| approved_by | uuid |  |
| approved_at | timestamp with time zone |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_mcp_context_tools.mcp_server_id` → `tenant_mcp_servers.id`
- `tenant_mcp_context_tools.tenant_id` → `tenants.id`

## tenant_mcp_servers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| slug | text | not null |
| url | text | not null |
| transport | text | not null |
| auth_type | text | not null |
| runtime_metadata | jsonb |  |
| oauth_provider | text |  |
| tools | jsonb |  |
| enabled | boolean | not null |
| management_source | text | not null |
| managed_application_key | text |  |
| plugin_install_id | uuid |  |
| status | text | not null |
| url_hash | text |  |
| approved_by | uuid |  |
| approved_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_mcp_servers.plugin_install_id` → `plugin_installs.id`
- `tenant_mcp_servers.tenant_id` → `tenants.id`

Not granted (do not query): `auth_config`.

## tenant_members

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| principal_type | text | not null |
| principal_id | uuid | not null |
| role | text | not null |
| status | text | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_members.tenant_id` → `tenants.id`

## tenant_model_catalog

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | PK, not null |
| model_id | text | PK, not null |
| display_name | text | not null |
| enabled | boolean | not null |
| pricing_status | text | not null |
| pricing_source | text |  |
| pricing_diagnostics | jsonb | not null |
| last_priced_at | timestamp with time zone |  |
| import_source | text | not null |
| import_payload | jsonb | not null |
| imported_by_user_id | uuid |  |
| imported_at | timestamp with time zone | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `pricing_status`: `resolved`, `missing`, `ambiguous`, `error`

Join hints:

- `tenant_model_catalog.imported_by_user_id` → `users.id`
- `tenant_model_catalog.model_id` → `model_catalog.model_id`
- `tenant_model_catalog.tenant_id` → `tenants.id`

## tenant_policy_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| actor_user_id | uuid | not null |
| event_type | text | not null |
| before_value | text |  |
| after_value | text |  |
| source | text | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `sandbox_enabled`, `compliance_tier`, `user_brain_claims`
- `source`: `graphql`, `reconciler`, `sql`

Join hints:

- `tenant_policy_events.tenant_id` → `tenants.id`

## tenant_service_principals

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| display_name | text | not null |
| purpose | text |  |
| status | text | not null |
| revoked_at | timestamp with time zone |  |
| revoked_by_user_id | uuid |  |
| created_by_user_id | uuid |  |
| metadata_json | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_service_principals.created_by_user_id` → `users.id`
- `tenant_service_principals.revoked_by_user_id` → `users.id`
- `tenant_service_principals.tenant_id` → `tenants.id`

## tenant_settings

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid |  |
| default_model | text |  |
| budget_monthly_cents | integer |  |
| goal_default_token_budget | integer |  |
| auto_close_thread_minutes | integer |  |
| max_agents | integer |  |
| brain_user_claims_enabled | boolean | not null |
| features | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `tenant_settings.tenant_id` → `tenants.id`

## tenant_system_users

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `tenant_system_users.tenant_id` → `tenants.id`

## tenant_workflow_catalog

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| slug | text | not null |
| display_name | text | not null |
| description | text |  |
| category | text |  |
| icon | text |  |
| default_config | jsonb | not null |
| default_schedule | text |  |
| status | text | not null |
| enabled | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `draft`, `archived`

Join hints:

- `tenant_workflow_catalog.tenant_id` → `tenants.id`

## tenants

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| name | text | not null |
| slug | text | not null |
| plan | text | not null |
| issue_prefix | text |  |
| issue_counter | integer | not null |
| channel_counters | jsonb | not null |
| wiki_compile_enabled | boolean | not null |
| capability_registry_trust | boolean | not null |
| sandbox_enabled | boolean | not null |
| compliance_tier | text | not null |
| sandbox_interpreter_public_id | text |  |
| sandbox_interpreter_internal_id | text |  |
| sandbox_interpreter_capability_private_id | text |  |
| pending_owner_email | text |  |
| first_admin_claim_required | boolean | not null |
| first_admin_claimed_at | timestamp with time zone |  |
| first_admin_claimed_user_id | uuid |  |
| deactivated_at | timestamp with time zone |  |
| deactivation_reason | text |  |
| disabled_builtin_tools | jsonb | not null |
| workspace_orchestration_enabled | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `compliance_tier`: `standard`, `regulated`, `hipaa`

## thread_attachments

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| thread_id | uuid | not null |
| tenant_id | uuid | not null |
| name | text |  |
| s3_key | text |  |
| mime_type | text |  |
| size_bytes | integer |  |
| uploaded_by | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_attachments.tenant_id` → `tenants.id`
- `thread_attachments.thread_id` → `threads.id`

## thread_dependencies

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| blocked_by_thread_id | uuid | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_dependencies.blocked_by_thread_id` → `threads.id`
- `thread_dependencies.tenant_id` → `tenants.id`
- `thread_dependencies.thread_id` → `threads.id`

## thread_idle_learning_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| computer_id | uuid |  |
| requester_user_id | uuid |  |
| scheduled_job_id | uuid |  |
| activity_sequence | integer | not null |
| scheduled_for | timestamp with time zone |  |
| started_at | timestamp with time zone | not null |
| finished_at | timestamp with time zone |  |
| status | text | not null |
| changed_files | jsonb |  |
| candidate_summary | jsonb |  |
| report_s3_key | text |  |
| error | text |  |
| budget | jsonb |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `running`, `stale_noop`, `changed`, `no_change`, `failed`, `rolled_back`

Join hints:

- `thread_idle_learning_runs.requester_user_id` → `users.id`
- `thread_idle_learning_runs.scheduled_job_id` → `scheduled_jobs.id`
- `thread_idle_learning_runs.tenant_id` → `tenants.id`
- `thread_idle_learning_runs.thread_id` → `threads.id`

## thread_idle_learning_state

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| computer_id | uuid |  |
| requester_user_id | uuid |  |
| activity_sequence | integer | not null |
| last_activity_at | timestamp with time zone | not null |
| scheduled_for | timestamp with time zone |  |
| scheduled_job_id | uuid |  |
| status | text | not null |
| last_run_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `idle_scheduled`, `running`, `stale`, `changed`, `no_change`, `failed`, `disabled`

Join hints:

- `thread_idle_learning_state.requester_user_id` → `users.id`
- `thread_idle_learning_state.scheduled_job_id` → `scheduled_jobs.id`
- `thread_idle_learning_state.tenant_id` → `tenants.id`
- `thread_idle_learning_state.thread_id` → `threads.id`

## thread_label_assignments

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| thread_id | uuid | not null |
| label_id | uuid | not null |
| tenant_id | uuid | not null |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_label_assignments.label_id` → `thread_labels.id`
- `thread_label_assignments.tenant_id` → `tenants.id`
- `thread_label_assignments.thread_id` → `threads.id`

## thread_labels

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| color | text |  |
| description | text |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_labels.tenant_id` → `tenants.id`

## thread_participants

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| space_id | uuid |  |
| participant_type | text | not null |
| user_id | uuid |  |
| agent_id | uuid |  |
| role | text | not null |
| source | text | not null |
| notification_preference | text | not null |
| last_read_at | timestamp with time zone |  |
| pinned_at | timestamp with time zone |  |
| pin_order | integer |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `participant_type`: `user`, `agent`
- `notification_preference`: `subscribed`, `mentions`, `muted`

Join hints:

- `thread_participants.agent_id` → `agents.id`
- `thread_participants.space_id` → `spaces.id`
- `thread_participants.tenant_id` → `tenants.id`
- `thread_participants.thread_id` → `threads.id`
- `thread_participants.user_id` → `users.id`

## thread_turn_events

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| run_id | uuid | not null |
| agent_id | uuid |  |
| seq | integer | not null |
| event_type | text | not null |
| stream | text |  |
| level | text |  |
| color | text |  |
| message | text |  |
| payload | jsonb |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_turn_events.agent_id` → `agents.id`
- `thread_turn_events.run_id` → `thread_turns.id`
- `thread_turn_events.tenant_id` → `tenants.id`

## thread_turns

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| trigger_id | uuid |  |
| agent_id | uuid |  |
| routine_id | uuid |  |
| invocation_source | text | not null |
| trigger_detail | text |  |
| wakeup_request_id | uuid |  |
| thread_id | uuid |  |
| triggering_message_id | uuid |  |
| turn_number | integer |  |
| runtime_type | text |  |
| status | text | not null |
| kind | text | not null |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| finalized_at | timestamp with time zone |  |
| error | text |  |
| error_code | text |  |
| system_prompt | text |  |
| usage_json | jsonb |  |
| result_json | jsonb |  |
| context_snapshot | jsonb |  |
| session_id_before | text |  |
| session_id_after | text |  |
| external_run_id | text |  |
| log_store | text |  |
| log_ref | text |  |
| log_bytes | integer |  |
| log_sha256 | text |  |
| log_compressed | boolean |  |
| stdout_excerpt | text |  |
| stderr_excerpt | text |  |
| webhook_id | uuid |  |
| last_activity_at | timestamp with time zone |  |
| retry_attempt | integer |  |
| origin_turn_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `thread_turns.agent_id` → `agents.id`
- `thread_turns.routine_id` → `routines.id`
- `thread_turns.tenant_id` → `tenants.id`
- `thread_turns.trigger_id` → `scheduled_jobs.id`
- `thread_turns.webhook_id` → `webhooks.id`

## threads

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid |  |
| computer_id | uuid |  |
| space_id | uuid | not null |
| user_id | uuid |  |
| number | integer | not null |
| identifier | text |  |
| title | text | not null |
| workspace_folder_name | text |  |
| description | text |  |
| status | text | not null |
| priority | text | not null |
| type | text | not null |
| channel | text | not null |
| parent_id | uuid |  |
| assignee_type | text |  |
| assignee_id | uuid |  |
| reporter_id | uuid |  |
| checkout_run_id | text |  |
| checkout_version | integer | not null |
| billing_code | text |  |
| labels | jsonb |  |
| metadata | jsonb |  |
| session_data | jsonb |  |
| mode_override | text |  |
| due_at | timestamp with time zone |  |
| started_at | timestamp with time zone |  |
| completed_at | timestamp with time zone |  |
| cancelled_at | timestamp with time zone |  |
| closed_at | timestamp with time zone |  |
| archived_at | timestamp with time zone |  |
| last_turn_completed_at | timestamp with time zone |  |
| last_response_preview | text |  |
| last_read_at | timestamp with time zone |  |
| created_by_type | text |  |
| created_by_id | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `mode_override`: `agent`, `multiplayer`

Join hints:

- `threads.agent_id` → `agents.id`
- `threads.reporter_id` → `users.id`
- `threads.space_id` → `spaces.id`
- `threads.tenant_id` → `tenants.id`
- `threads.user_id` → `users.id`

## tool_execution_events

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| thread_id | uuid | not null |
| turn_id | uuid | not null |
| principal_type | text | not null |
| principal_id | text | not null |
| tool_use_id | text | not null |
| operation | text | not null |
| policy_revision | text |  |
| policy_decision_id | text |  |
| idempotency_key | text | not null |
| event_type | text | not null |
| input_preview | jsonb |  |
| output_preview | jsonb |  |
| error_preview | jsonb |  |
| provider_request_id | text |  |
| duration_ms | integer |  |
| provider_cost_usd | numeric(18, 8) |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `principal_type`: `user`, `service`
- `event_type`: `started`, `completed`, `failed`, `uncertain`

Join hints:

- `tool_execution_events.tenant_id` → `tenants.id`
- `tool_execution_events.thread_id` → `threads.id`
- `tool_execution_events.turn_id` → `thread_turns.id`

Not granted (do not query): `credential_owner_alias`.

## trace_cost_reconciliation_facts

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| trace_run_id | uuid |  |
| trace_event_id | uuid |  |
| cost_event_id | uuid |  |
| source_evidence_id | uuid |  |
| reconciliation_state | text | not null |
| reconciliation_scope | text | not null |
| provider | text |  |
| model | text |  |
| request_id | text |  |
| attribution_level | text |  |
| runtime_input_tokens | integer |  |
| runtime_output_tokens | integer |  |
| runtime_cached_read_tokens | integer |  |
| provider_input_tokens | integer |  |
| provider_output_tokens | integer |  |
| provider_cached_read_tokens | integer |  |
| runtime_amount_usd | numeric(12, 6) |  |
| provider_amount_usd | numeric(12, 6) |  |
| billed_amount_usd | numeric(12, 6) |  |
| variance_usd | numeric(12, 6) |  |
| metadata | jsonb | not null |
| reconciled_at | timestamp with time zone | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `reconciliation_state`: `runtime-reported`, `invocation-reconciled`, `bill-reconciled`, `mismatch`, `unreconciled/error`
- `reconciliation_scope`: `runtime`, `invocation`, `bill`, `aggregate`, `operator_resolution`

Join hints:

- `trace_cost_reconciliation_facts.cost_event_id` → `cost_events.id`
- `trace_cost_reconciliation_facts.source_evidence_id` → `trace_source_evidence.id`
- `trace_cost_reconciliation_facts.tenant_id` → `tenants.id`
- `trace_cost_reconciliation_facts.trace_event_id` → `trace_events.id`
- `trace_cost_reconciliation_facts.trace_run_id` → `trace_runs.id`

## trace_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| trace_run_id | uuid | not null |
| parent_event_id | uuid |  |
| thread_turn_id | uuid |  |
| request_id | text |  |
| parent_request_id | text |  |
| event_type | text | not null |
| event_status | text |  |
| observed_at | timestamp with time zone | not null |
| duration_ms | integer |  |
| payload_summary | jsonb | not null |
| source_evidence_ref | jsonb | not null |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `turn`, `runtime_phase`, `model_invocation`, `tool_invocation`, `memory_context_lookup`, `workspace_hydration`, `response_finalization`, `agent_profile_run`, `sub_agent_lane`, `cost_observation`

Join hints:

- `trace_events.parent_event_id` → `trace_events.id`
- `trace_events.tenant_id` → `tenants.id`
- `trace_events.thread_turn_id` → `thread_turns.id`
- `trace_events.trace_run_id` → `trace_runs.id`

## trace_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| trace_id | text | not null |
| thread_id | uuid |  |
| thread_turn_id | uuid |  |
| agent_id | uuid |  |
| user_id | uuid |  |
| runtime_type | text |  |
| runtime_session_id | text |  |
| status | text | not null |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `trace_runs.agent_id` → `agents.id`
- `trace_runs.tenant_id` → `tenants.id`
- `trace_runs.thread_turn_id` → `thread_turns.id`
- `trace_runs.user_id` → `users.id`

## trace_source_evidence

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| trace_run_id | uuid |  |
| trace_event_id | uuid |  |
| source_type | text | not null |
| source_system | text | not null |
| source_id | text |  |
| uri | text |  |
| observed_at | timestamp with time zone |  |
| summary | jsonb | not null |
| redaction_state | text | not null |
| retention_expires_at | timestamp with time zone |  |
| metadata | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `source_type`: `runtime`, `agentcore_span`, `bedrock_invocation_log`, `aws_cur`, `operator`, `backfill`

Join hints:

- `trace_source_evidence.tenant_id` → `tenants.id`
- `trace_source_evidence.trace_event_id` → `trace_events.id`
- `trace_source_evidence.trace_run_id` → `trace_runs.id`

## twin_materialization_suggestions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| entity_type_slug | text | not null |
| facet_slug | text | not null |
| hit_count | integer | not null |
| last_question | text |  |
| dismissed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `twin_materialization_suggestions.tenant_id` → `tenants.id`

## user_brain_claims

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| user_id | uuid | not null |
| security_groups | text[] | not null |
| kb_collections | text[] | not null |
| kb_bundles | jsonb | not null |
| default_kb_bundle | text |  |
| tool_allowlist | text[] |  |
| is_operator | boolean | not null |
| kb_trace | boolean | not null |
| analytics_key | boolean | not null |
| enabled | boolean | not null |
| notes | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| updated_by_user_id | uuid |  |

Join hints:

- `user_brain_claims.tenant_id` → `tenants.id`
- `user_brain_claims.user_id` → `users.id`

## user_model_approvals

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| user_id | uuid | not null |
| model_id | text | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `user_model_approvals.model_id` → `model_catalog.model_id`
- `user_model_approvals.tenant_id` → `tenants.id`
- `user_model_approvals.user_id` → `users.id`

## user_plugin_activations

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| user_id | uuid | not null |
| plugin_install_id | uuid | not null |
| status | text | not null |
| granted_scopes | jsonb | not null |
| granted_at | timestamp with time zone | not null |
| revoked_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `active`, `needs_reauth`, `revoked`

Join hints:

- `user_plugin_activations.plugin_install_id` → `plugin_installs.id`
- `user_plugin_activations.user_id` → `users.id`

## user_profiles

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| user_id | uuid |  |
| tenant_id | uuid |  |
| display_name | text |  |
| theme | text |  |
| notification_preferences | jsonb |  |
| operating_model | jsonb |  |
| operating_model_history | jsonb[] | not null |
| title | text |  |
| timezone | text |  |
| pronouns | text |  |
| call_by | text |  |
| notes | text |  |
| family | text |  |
| context | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `user_profiles.tenant_id` → `tenants.id`
- `user_profiles.user_id` → `users.id`

## user_quick_actions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| user_id | uuid | not null |
| tenant_id | uuid | not null |
| title | text | not null |
| prompt | text | not null |
| workspace_agent_id | uuid |  |
| scope | text | not null |
| sort_order | integer | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `user_quick_actions.tenant_id` → `tenants.id`
- `user_quick_actions.user_id` → `users.id`
- `user_quick_actions.workspace_agent_id` → `agents.id`

## users

Note: End-user account records. Always scope by tenant_id; avoid joining across tenants in ad hoc reports.

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid |  |
| email | text | Primary contact email for the account., ⚠ PII |
| cognito_sub | text |  |
| name | text |  |
| workspace_folder_name | text |  |
| image | text |  |
| email_verified_at | timestamp with time zone |  |
| phone | text |  |
| phone_verified_at | timestamp with time zone |  |
| wiki_compile_external_enabled | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `users.tenant_id` → `tenants.id`

Not granted (do not query): `expo_push_token`.

## wakeup_requests

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| agent_id | uuid | not null |
| reason | text |  |
| priority | text | not null |
| status | text | not null |
| payload | jsonb |  |
| scheduled_for | timestamp with time zone |  |
| processed_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `wakeup_requests.agent_id` → `agents.id`
- `wakeup_requests.tenant_id` → `tenants.id`

## work_item_comments

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| work_item_id | uuid | not null |
| thread_id | uuid |  |
| author_user_id | uuid |  |
| author_agent_id | uuid |  |
| body | text | not null |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| archived_at | timestamp with time zone |  |

Join hints:

- `work_item_comments.author_agent_id` → `agents.id`
- `work_item_comments.author_user_id` → `users.id`
- `work_item_comments.space_id` → `spaces.id`
- `work_item_comments.tenant_id` → `tenants.id`
- `work_item_comments.thread_id` → `threads.id`
- `work_item_comments.work_item_id` → `work_items.id`

## work_item_documents

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| work_item_id | uuid | not null |
| kind | text | not null |
| title | text | not null |
| content_type | text | not null |
| s3_key | text | not null |
| size_bytes | integer | not null |
| checksum_sha256 | text |  |
| metadata | jsonb |  |
| created_by_user_id | uuid |  |
| created_by_agent_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| archived_at | timestamp with time zone |  |

Enum values:

- `kind`: `plan`, `progress`, `spec`, `evidence`, `handoff`, `note`, `other`

Join hints:

- `work_item_documents.created_by_agent_id` → `agents.id`
- `work_item_documents.created_by_user_id` → `users.id`
- `work_item_documents.tenant_id` → `tenants.id`
- `work_item_documents.work_item_id` → `work_items.id`

## work_item_events

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| work_item_id | uuid | not null |
| thread_id | uuid |  |
| actor_user_id | uuid |  |
| actor_agent_id | uuid |  |
| event_type | text | not null |
| previous_status_id | uuid |  |
| new_status_id | uuid |  |
| message | text |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `event_type`: `created`, `updated`, `status_changed`, `completed`, `blocked`, `unblocked`, `assigned`, `due_date_changed`, `applicability_changed`, `linked_thread`, `agent_action`, `comment_added`

Join hints:

- `work_item_events.actor_agent_id` → `agents.id`
- `work_item_events.actor_user_id` → `users.id`
- `work_item_events.new_status_id` → `work_item_statuses.id`
- `work_item_events.previous_status_id` → `work_item_statuses.id`
- `work_item_events.space_id` → `spaces.id`
- `work_item_events.tenant_id` → `tenants.id`
- `work_item_events.thread_id` → `threads.id`
- `work_item_events.work_item_id` → `work_items.id`

## work_item_external_refs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| work_item_id | uuid | not null |
| provider | text | not null |
| external_id | text | not null |
| external_url | text |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `provider`: `thinkwork`, `lastmile`, `linear`, `twenty`

Join hints:

- `work_item_external_refs.tenant_id` → `tenants.id`
- `work_item_external_refs.work_item_id` → `work_items.id`

## work_item_label_assignments

| column | type | flags |
| --- | --- | --- |
| tenant_id | uuid | not null |
| work_item_id | uuid | not null |
| label_id | uuid | not null |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |

Join hints:

- `work_item_label_assignments.created_by_user_id` → `users.id`
- `work_item_label_assignments.label_id` → `work_item_labels.id`
- `work_item_label_assignments.tenant_id` → `tenants.id`
- `work_item_label_assignments.work_item_id` → `work_items.id`

## work_item_labels

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| slug | text | not null |
| color | text |  |
| description | text |  |
| created_by_user_id | uuid |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| archived_at | timestamp with time zone |  |

Join hints:

- `work_item_labels.created_by_user_id` → `users.id`
- `work_item_labels.tenant_id` → `tenants.id`

## work_item_saved_views

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| user_id | uuid |  |
| space_id | uuid |  |
| name | text | not null |
| view_type | text | not null |
| filters | jsonb |  |
| grouping | jsonb |  |
| sorting | jsonb |  |
| view_config | jsonb |  |
| is_private | boolean | not null |
| is_default | boolean | not null |
| is_favorite | boolean | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `view_type`: `list`, `board`

Join hints:

- `work_item_saved_views.space_id` → `spaces.id`
- `work_item_saved_views.tenant_id` → `tenants.id`
- `work_item_saved_views.user_id` → `users.id`

## work_item_statuses

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| name | text | not null |
| description | text |  |
| color | text |  |
| icon | text |  |
| category | text | not null |
| is_active | boolean | not null |
| is_final | boolean | not null |
| is_default | boolean | not null |
| display_order | integer | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `category`: `todo`, `active`, `blocked`, `done`, `skipped`

Join hints:

- `work_item_statuses.space_id` → `spaces.id`
- `work_item_statuses.tenant_id` → `tenants.id`

## work_item_thread_links

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| work_item_id | uuid | not null |
| thread_id | uuid | not null |
| space_id | uuid | not null |
| relationship | text | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `relationship`: `primary`, `mentioned`, `evidence`, `follow_up`

Join hints:

- `work_item_thread_links.space_id` → `spaces.id`
- `work_item_thread_links.tenant_id` → `tenants.id`
- `work_item_thread_links.thread_id` → `threads.id`
- `work_item_thread_links.work_item_id` → `work_items.id`

## work_items

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| space_id | uuid | not null |
| status_id | uuid |  |
| title | text | not null |
| notes | text |  |
| priority | text | not null |
| owner_user_id | uuid |  |
| owner_agent_id | uuid |  |
| due_at | timestamp with time zone |  |
| required | boolean | not null |
| applicable | boolean | not null |
| blocked | boolean | not null |
| open_engine_enabled | boolean | not null |
| open_engine_queue_key | text |  |
| open_engine_claimed_by_agent_id | uuid |  |
| open_engine_claimed_at | timestamp with time zone |  |
| open_engine_claim_expires_at | timestamp with time zone |  |
| open_engine_human_hold | boolean | not null |
| open_engine_human_hold_reason | text |  |
| open_engine_scheduled_at | timestamp with time zone |  |
| open_engine_dependency_state | text | not null |
| open_engine_routing | jsonb |  |
| completed_at | timestamp with time zone |  |
| completed_by_user_id | uuid |  |
| completed_by_agent_id | uuid |  |
| created_by_user_id | uuid |  |
| created_by_agent_id | uuid |  |
| template_source_id | uuid |  |
| metadata | jsonb |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |
| archived_at | timestamp with time zone |  |

Enum values:

- `priority`: `low`, `normal`, `high`, `urgent`
- `open_engine_dependency_state`: `ready`, `waiting`

Join hints:

- `work_items.completed_by_agent_id` → `agents.id`
- `work_items.completed_by_user_id` → `users.id`
- `work_items.created_by_agent_id` → `agents.id`
- `work_items.created_by_user_id` → `users.id`
- `work_items.open_engine_claimed_by_agent_id` → `agents.id`
- `work_items.owner_agent_id` → `agents.id`
- `work_items.owner_user_id` → `users.id`
- `work_items.space_id` → `spaces.id`
- `work_items.status_id` → `work_item_statuses.id`
- `work_items.template_source_id` → `space_checklist_items.id`
- `work_items.tenant_id` → `tenants.id`

## workflow_configs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| dispatch | jsonb |  |
| concurrency | jsonb |  |
| retry | jsonb |  |
| turn_loop | jsonb |  |
| workspace | jsonb |  |
| stall_detection | jsonb |  |
| orchestration | jsonb |  |
| session_compaction | jsonb |  |
| prompt_template | text |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Join hints:

- `workflow_configs.tenant_id` → `tenants.id`

## workflow_engine_bindings

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| workflow_id | uuid | not null |
| workflow_version_id | uuid |  |
| binding_type | text | not null |
| binding_status | text | not null |
| routine_id | uuid |  |
| routine_asl_version_id | uuid |  |
| plugin_install_id | uuid |  |
| managed_application_id | uuid |  |
| external_workflow_id | text |  |
| external_workflow_name | text |  |
| external_version_id | text |  |
| connection_ref | jsonb | not null |
| capability_flags | jsonb | not null |
| readiness_state | text | not null |
| readiness_reasons | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `binding_type`: `step_functions_routine`, `step_functions_interpreter`, `n8n_bridge`, `n8n_import`, `twenty_crm`, `connected_app`, `native`
- `binding_status`: `configured`, `ready`, `blocked_not_ready`, `disabled`, `archived`
- `readiness_state`: `unknown`, `ready`, `blocked_not_ready`, `disabled`

Join hints:

- `workflow_engine_bindings.managed_application_id` → `managed_applications.id`
- `workflow_engine_bindings.plugin_install_id` → `plugin_installs.id`
- `workflow_engine_bindings.routine_asl_version_id` → `routine_asl_versions.id`
- `workflow_engine_bindings.routine_id` → `routines.id`
- `workflow_engine_bindings.tenant_id` → `tenants.id`
- `workflow_engine_bindings.workflow_id` → `workflows.id`
- `workflow_engine_bindings.workflow_version_id` → `workflow_versions.id`

## workflow_evidence

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| workflow_id | uuid | not null |
| workflow_run_id | uuid |  |
| evidence_type | text | not null |
| source_system | text | not null |
| source_id | text |  |
| uri | text |  |
| summary | jsonb | not null |
| redaction_state | text | not null |
| sensitivity | text |  |
| retention_expires_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `redaction_state`: `summary_only`, `redacted`, `offloaded`, `raw_allowed`

Join hints:

- `workflow_evidence.tenant_id` → `tenants.id`
- `workflow_evidence.workflow_id` → `workflows.id`
- `workflow_evidence.workflow_run_id` → `workflow_runs.id`

## workflow_run_events

| column | type | flags |
| --- | --- | --- |
| id | bigserial | PK, not null |
| tenant_id | uuid | not null |
| workflow_run_id | uuid | not null |
| event_type | text | not null |
| event_status | text |  |
| provenance | text | not null |
| occurred_at | timestamp with time zone | not null |
| message | text |  |
| payload_summary | jsonb | not null |
| evidence_ref | jsonb | not null |
| created_at | timestamp with time zone | not null |

Enum values:

- `provenance`: `native_event`, `app_callback`, `engine_history`, `output_inferred`, `operator_decision`

Join hints:

- `workflow_run_events.tenant_id` → `tenants.id`
- `workflow_run_events.workflow_run_id` → `workflow_runs.id`

## workflow_runs

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| workflow_id | uuid | not null |
| workflow_version_id | uuid |  |
| engine_binding_id | uuid |  |
| status | text | not null |
| trigger_family | text | not null |
| trigger_source | text |  |
| actor_type | text |  |
| actor_id | uuid |  |
| idempotency_key | text |  |
| correlation_id | text |  |
| backend_execution_id | text |  |
| backend_execution_ref | jsonb | not null |
| capability_snapshot | jsonb | not null |
| readiness_snapshot | jsonb | not null |
| input_summary | jsonb |  |
| output_summary | jsonb |  |
| started_at | timestamp with time zone |  |
| finished_at | timestamp with time zone |  |
| last_event_at | timestamp with time zone |  |
| error_code | text |  |
| error_message | text |  |
| total_cost_usd_cents | bigint |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `status`: `queued`, `running`, `waiting_for_human`, `succeeded`, `failed`, `canceled`, `timed_out`, `blocked_not_ready`

Join hints:

- `workflow_runs.engine_binding_id` → `workflow_engine_bindings.id`
- `workflow_runs.tenant_id` → `tenants.id`
- `workflow_runs.workflow_id` → `workflows.id`
- `workflow_runs.workflow_version_id` → `workflow_versions.id`

## workflow_triggers

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| workflow_id | uuid | not null |
| workflow_version_id | uuid |  |
| trigger_family | text | not null |
| source_system | text |  |
| enabled | boolean | not null |
| idempotency_required | boolean | not null |
| trigger_config | jsonb | not null |
| actor_contract | jsonb | not null |
| readiness_state | text | not null |
| readiness_reasons | jsonb | not null |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `trigger_family`: `manual`, `schedule`, `webhook`, `crm`, `n8n`, `api`, `agent`, `child_workflow`
- `readiness_state`: `unknown`, `ready`, `blocked_not_ready`, `disabled`

Join hints:

- `workflow_triggers.tenant_id` → `tenants.id`
- `workflow_triggers.workflow_id` → `workflows.id`
- `workflow_triggers.workflow_version_id` → `workflow_versions.id`

## workflow_versions

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| workflow_id | uuid | not null |
| version_number | integer | not null |
| version_status | text | not null |
| source_kind | text | not null |
| source_metadata | jsonb | not null |
| definition_snapshot | jsonb | not null |
| capability_snapshot | jsonb | not null |
| routine_asl_version_id | uuid |  |
| created_by_actor_type | text |  |
| created_by_actor_id | uuid |  |
| published_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |

Enum values:

- `version_status`: `draft`, `active`, `superseded`, `archived`

Join hints:

- `workflow_versions.routine_asl_version_id` → `routine_asl_versions.id`
- `workflow_versions.tenant_id` → `tenants.id`
- `workflow_versions.workflow_id` → `workflows.id`

## workflows

| column | type | flags |
| --- | --- | --- |
| id | uuid | PK, not null |
| tenant_id | uuid | not null |
| name | text | not null |
| slug | text | not null |
| description | text |  |
| lifecycle_status | text | not null |
| visibility | text | not null |
| owner_user_id | uuid |  |
| owner_agent_id | uuid |  |
| primary_trigger_family | text | not null |
| current_version_id | uuid |  |
| current_version_number | integer |  |
| capability_flags | jsonb | not null |
| readiness_state | text | not null |
| readiness_reasons | jsonb | not null |
| last_run_id | uuid |  |
| source_agent_loop_id | uuid |  |
| last_run_at | timestamp with time zone |  |
| created_at | timestamp with time zone | not null |
| updated_at | timestamp with time zone | not null |

Enum values:

- `lifecycle_status`: `draft`, `active`, `deprecated`, `archived`
- `visibility`: `agent_private`, `tenant_shared`
- `primary_trigger_family`: `manual`, `schedule`, `webhook`, `crm`, `n8n`, `api`, `agent`, `child_workflow`
- `readiness_state`: `unknown`, `ready`, `blocked_not_ready`, `disabled`

Join hints:

- `workflows.owner_agent_id` → `agents.id`
- `workflows.owner_user_id` → `users.id`
- `workflows.tenant_id` → `tenants.id`
