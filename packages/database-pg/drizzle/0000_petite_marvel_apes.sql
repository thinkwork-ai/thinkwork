CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"default_model" text,
	"budget_monthly_cents" integer,
	"auto_close_thread_minutes" integer DEFAULT 30,
	"max_agents" integer,
	"features" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'pro' NOT NULL,
	"issue_prefix" text,
	"issue_counter" integer DEFAULT 0 NOT NULL,
	"channel_counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"display_name" text,
	"theme" text DEFAULT 'system',
	"notification_preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text,
	"name" text,
	"image" text,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"expo_push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agent_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"name" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "agent_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"config" jsonb,
	"permissions" jsonb,
	"rate_limit_rpm" integer,
	"model_override" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"role" text,
	"type" text DEFAULT 'agent' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"system_prompt" text,
	"reports_to" uuid,
	"parent_agent_id" uuid,
	"human_pair_id" uuid,
	"adapter_type" text,
	"adapter_config" jsonb,
	"runtime_config" jsonb,
	"budget_monthly_cents" integer,
	"spent_monthly_cents" integer DEFAULT 0,
	"budget_paused" boolean DEFAULT false NOT NULL,
	"budget_paused_at" timestamp with time zone,
	"budget_paused_reason" text,
	"last_heartbeat_at" timestamp with time zone,
	"avatar_url" text,
	"template_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"invite_type" text DEFAULT 'agent' NOT NULL,
	"allowed_join_types" text[],
	"defaults_payload" jsonb,
	"max_uses" integer DEFAULT 5 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invite_id" uuid,
	"request_type" text DEFAULT 'agent' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"agent_name" text NOT NULL,
	"adapter_type" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"adapter_config" jsonb,
	"claim_secret_hash" text,
	"claim_expires_at" timestamp with time zone,
	"claim_consumed_at" timestamp with time zone,
	"created_agent_id" uuid,
	"approved_by_user_id" uuid,
	"rejected_by_user_id" uuid,
	"rejection_reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"input_cost_per_million" numeric(10, 4),
	"output_cost_per_million" numeric(10, 4),
	"context_window" integer,
	"max_output_tokens" integer,
	"supports_vision" boolean DEFAULT false,
	"supports_tools" boolean DEFAULT true,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_catalog_model_id_unique" UNIQUE("model_id")
);
--> statement-breakpoint
CREATE TABLE "principal_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"scope" jsonb,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid,
	"name" text NOT NULL,
	"content" text,
	"s3_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"name" text,
	"content" text,
	"s3_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"metadata" jsonb,
	"artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"sender_type" text,
	"sender_id" uuid,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"metadata" jsonb,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"description" text,
	"type" text DEFAULT 'team' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"budget_monthly_cents" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_id" uuid,
	"agent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"schedule" text,
	"config" jsonb,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"provider_type" text NOT NULL,
	"auth_type" text NOT NULL,
	"config" jsonb,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connect_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_id" text,
	"metadata" jsonb,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_factory_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_factory_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"github_owner" text NOT NULL,
	"github_repo" text NOT NULL,
	"github_installation_id" integer,
	"default_branch" text,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_factory_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"commit_sha" text,
	"branch" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_app_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"delivery_id" text,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text,
	"s3_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_type" text,
	"author_id" uuid,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_label_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"number" integer NOT NULL,
	"identifier" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"type" text DEFAULT 'task' NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"parent_id" uuid,
	"assignee_type" text,
	"assignee_id" uuid,
	"reporter_id" uuid,
	"checkout_run_id" text,
	"checkout_version" integer DEFAULT 0 NOT NULL,
	"billing_code" text,
	"labels" jsonb,
	"metadata" jsonb,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"last_turn_completed_at" timestamp with time zone,
	"last_response_preview" text,
	"last_read_at" timestamp with time zone,
	"created_by_type" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_item_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_type" text,
	"author_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"linked_type" text,
	"linked_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requester_type" text,
	"requester_id" uuid,
	"recipient_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"entity_type" text,
	"entity_id" uuid,
	"config" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"review_notes" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wakeup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"trigger_detail" text,
	"reason" text,
	"payload" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"coalesced_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"requested_by_actor_type" text,
	"requested_by_actor_id" text,
	"run_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"session_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"state" jsonb,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runtime_state_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "agent_task_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_state_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid,
	"task_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wakeup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"reason" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"scheduled_for" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"scope" text NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"limit_usd" numeric(12, 6) NOT NULL,
	"action_on_exceed" text DEFAULT 'pause' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"team_id" uuid,
	"thread_id" uuid,
	"request_id" text NOT NULL,
	"event_type" text NOT NULL,
	"amount_usd" numeric(12, 6) NOT NULL,
	"model" text,
	"provider" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_read_tokens" integer,
	"duration_ms" integer,
	"trace_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"agent_id" uuid,
	"routine_id" uuid,
	"team_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"prompt" text,
	"config" jsonb,
	"schedule_type" text,
	"schedule_expression" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"eb_schedule_name" text,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by_type" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_turn_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid,
	"seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"stream" text,
	"level" text,
	"color" text,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_id" uuid,
	"agent_id" uuid,
	"routine_id" uuid,
	"invocation_source" text DEFAULT 'schedule' NOT NULL,
	"trigger_detail" text,
	"wakeup_request_id" uuid,
	"thread_id" uuid,
	"turn_number" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"error_code" text,
	"usage_json" jsonb,
	"result_json" jsonb,
	"context_snapshot" jsonb,
	"session_id_before" text,
	"session_id_after" text,
	"external_run_id" text,
	"log_store" text,
	"log_ref" text,
	"log_bytes" integer,
	"log_sha256" text,
	"log_compressed" boolean,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"webhook_id" uuid,
	"last_activity_at" timestamp with time zone,
	"retry_attempt" integer DEFAULT 0,
	"origin_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"search_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"embedding_model" text DEFAULT 'amazon.titan-embed-text-v2:0' NOT NULL,
	"chunking_strategy" text DEFAULT 'FIXED_SIZE' NOT NULL,
	"chunk_size_tokens" integer DEFAULT 300,
	"chunk_overlap_percent" integer DEFAULT 20,
	"status" text DEFAULT 'creating' NOT NULL,
	"aws_kb_id" text,
	"aws_data_source_id" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"document_count" integer DEFAULT 0,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_reply_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"context_type" text NOT NULL,
	"context_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"ses_message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"max_uses" integer DEFAULT 3 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_reply_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "thread_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"blocked_by_thread_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retry_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"thread_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"origin_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"thread_id" uuid,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"content" text,
	"s3_key" text,
	"summary" text,
	"source_message_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token" text NOT NULL,
	"target_type" text NOT NULL,
	"agent_id" uuid,
	"routine_id" uuid,
	"prompt" text,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit" integer DEFAULT 60,
	"last_invoked_at" timestamp with time zone,
	"invocation_count" integer DEFAULT 0 NOT NULL,
	"created_by_type" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"thread_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"server" text NOT NULL,
	"tool" text NOT NULL,
	"params" jsonb NOT NULL,
	"genui_type" text NOT NULL,
	"templates" jsonb,
	"cached_result" jsonb,
	"last_refreshed" timestamp with time zone,
	"last_error" text,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"category" text,
	"version" text NOT NULL,
	"author" text DEFAULT 'thinkwork' NOT NULL,
	"icon" text,
	"tags" text[],
	"source" text DEFAULT 'builtin' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"execution" text DEFAULT 'context' NOT NULL,
	"mode" text DEFAULT 'tool' NOT NULL,
	"requires_env" text[],
	"oauth_provider" text,
	"oauth_scopes" text[],
	"mcp_server" text,
	"mcp_tools" text[],
	"dependencies" text[],
	"triggers" text[],
	"tier1_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_catalog_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tenant_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"source" text DEFAULT 'catalog' NOT NULL,
	"version" text,
	"catalog_version" text,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrail_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"guardrail_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"block_type" text NOT NULL,
	"action" text NOT NULL,
	"blocked_topics" text[],
	"content_filters" jsonb,
	"raw_response" jsonb,
	"user_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"bedrock_guardrail_id" text,
	"bedrock_version" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"source" text DEFAULT 'user' NOT NULL,
	"model" text,
	"guardrail_id" uuid,
	"blocked_tools" jsonb,
	"config" jsonb,
	"skills" jsonb,
	"knowledge_base_ids" jsonb,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"label" text,
	"config_snapshot" jsonb,
	"workspace_snapshot" jsonb,
	"skills_snapshot" jsonb,
	"knowledge_bases_snapshot" jsonb,
	"guardrail_snapshot" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"changes" jsonb,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_quick_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"workspace_agent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_human_pair_id_users_id_fk" FOREIGN KEY ("human_pair_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_created_agent_id_agents_id_fk" FOREIGN KEY ("created_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_permission_grants" ADD CONSTRAINT "principal_permission_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_permission_grants" ADD CONSTRAINT "principal_permission_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_artifacts" ADD CONSTRAINT "message_artifacts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_artifacts" ADD CONSTRAINT "message_artifacts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_artifacts" ADD CONSTRAINT "message_artifacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_users" ADD CONSTRAINT "team_users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_users" ADD CONSTRAINT "team_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_users" ADD CONSTRAINT "team_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_id_connect_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."connect_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_jobs" ADD CONSTRAINT "code_factory_jobs_repo_id_code_factory_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."code_factory_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_jobs" ADD CONSTRAINT "code_factory_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_jobs" ADD CONSTRAINT "code_factory_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_repos" ADD CONSTRAINT "code_factory_repos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_runs" ADD CONSTRAINT "code_factory_runs_job_id_code_factory_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."code_factory_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_factory_runs" ADD CONSTRAINT "code_factory_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_deliveries" ADD CONSTRAINT "github_webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_attachments" ADD CONSTRAINT "thread_attachments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_attachments" ADD CONSTRAINT "thread_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_comments" ADD CONSTRAINT "thread_comments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_comments" ADD CONSTRAINT "thread_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_label_assignments" ADD CONSTRAINT "thread_label_assignments_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_label_assignments" ADD CONSTRAINT "thread_label_assignments_label_id_thread_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."thread_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_label_assignments" ADD CONSTRAINT "thread_label_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_labels" ADD CONSTRAINT "thread_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item_comments" ADD CONSTRAINT "inbox_item_comments_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item_comments" ADD CONSTRAINT "inbox_item_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item_links" ADD CONSTRAINT "inbox_item_links_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item_links" ADD CONSTRAINT "inbox_item_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wakeup_requests" ADD CONSTRAINT "agent_wakeup_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_runtime_state_id_agent_runtime_state_id_fk" FOREIGN KEY ("runtime_state_id") REFERENCES "public"."agent_runtime_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_sessions" ADD CONSTRAINT "agent_task_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wakeup_requests" ADD CONSTRAINT "wakeup_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wakeup_requests" ADD CONSTRAINT "wakeup_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turn_events" ADD CONSTRAINT "thread_turn_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turn_events" ADD CONSTRAINT "thread_turn_events_run_id_thread_turns_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."thread_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turn_events" ADD CONSTRAINT "thread_turn_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turns" ADD CONSTRAINT "thread_turns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turns" ADD CONSTRAINT "thread_turns_trigger_id_scheduled_jobs_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turns" ADD CONSTRAINT "thread_turns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turns" ADD CONSTRAINT "thread_turns_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_turns" ADD CONSTRAINT "thread_turns_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_reply_tokens" ADD CONSTRAINT "email_reply_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_reply_tokens" ADD CONSTRAINT "email_reply_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_dependencies" ADD CONSTRAINT "thread_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_dependencies" ADD CONSTRAINT "thread_dependencies_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_dependencies" ADD CONSTRAINT "thread_dependencies_blocked_by_thread_id_threads_id_fk" FOREIGN KEY ("blocked_by_thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_queue" ADD CONSTRAINT "retry_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_queue" ADD CONSTRAINT "retry_queue_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retry_queue" ADD CONSTRAINT "retry_queue_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_idempotency" ADD CONSTRAINT "webhook_idempotency_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_skills" ADD CONSTRAINT "tenant_skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_blocks" ADD CONSTRAINT "guardrail_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_blocks" ADD CONSTRAINT "guardrail_blocks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_blocks" ADD CONSTRAINT "guardrail_blocks_guardrail_id_guardrails_id_fk" FOREIGN KEY ("guardrail_id") REFERENCES "public"."guardrails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrails" ADD CONSTRAINT "guardrails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_templates" ADD CONSTRAINT "agent_templates_guardrail_id_guardrails_id_fk" FOREIGN KEY ("guardrail_id") REFERENCES "public"."guardrails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quick_actions" ADD CONSTRAINT "user_quick_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quick_actions" ADD CONSTRAINT "user_quick_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quick_actions" ADD CONSTRAINT "user_quick_actions_workspace_agent_id_agents_id_fk" FOREIGN KEY ("workspace_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenant_members_tenant" ON "tenant_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_members_principal" ON "tenant_members" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_members_principal" ON "tenant_members" USING btree ("tenant_id","principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_tenant_id" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_capabilities_agent_capability" ON "agent_capabilities" USING btree ("agent_id","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_skills_agent_skill" ON "agent_skills" USING btree ("agent_id","skill_id");--> statement-breakpoint
CREATE INDEX "idx_agents_tenant_id" ON "agents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_agents_type" ON "agents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_agents_status" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agents_reports_to" ON "agents" USING btree ("reports_to");--> statement-breakpoint
CREATE INDEX "idx_agents_source" ON "agents" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_join_requests_tenant_status" ON "join_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "join_requests_invite_idx" ON "join_requests" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "join_requests_claim_secret_idx" ON "join_requests" USING btree ("claim_secret_hash");--> statement-breakpoint
CREATE INDEX "idx_ppg_principal" ON "principal_permission_grants" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ppg_tenant_principal_permission" ON "principal_permission_grants" USING btree ("tenant_id","principal_type","principal_id","permission_key");--> statement-breakpoint
CREATE INDEX "idx_messages_thread_id" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_messages_tenant_id_created_at" ON "messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_team_agents_team_agent" ON "team_agents" USING btree ("team_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_team_users_team_user" ON "team_users" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_teams_tenant_id" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_routines_tenant_id" ON "routines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_routines_status" ON "routines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_connections_tenant_provider" ON "connections" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_code_factory_repos_owner_repo" ON "code_factory_repos" USING btree ("github_owner","github_repo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_thread_label_assignment" ON "thread_label_assignments" USING btree ("thread_id","label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_thread_labels_tenant_name" ON "thread_labels" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_threads_tenant_number" ON "threads" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "idx_threads_tenant_status" ON "threads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_threads_assignee" ON "threads" USING btree ("assignee_type","assignee_id");--> statement-breakpoint
CREATE INDEX "idx_threads_parent_id" ON "threads" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_threads_checkout_run_id" ON "threads" USING btree ("checkout_run_id");--> statement-breakpoint
CREATE INDEX "idx_threads_tenant_channel" ON "threads" USING btree ("tenant_id","channel");--> statement-breakpoint
CREATE INDEX "idx_inbox_items_tenant_status" ON "inbox_items" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_inbox_items_entity" ON "inbox_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_agent_wakeup_requests_status" ON "agent_wakeup_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_agent_runtime_state_agent_status" ON "agent_runtime_state" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "idx_wakeup_requests_status_scheduled" ON "wakeup_requests" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_budget_policies_tenant" ON "budget_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_budget_policies_agent" ON "budget_policies" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_cost_events_tenant_created" ON "cost_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_cost_events_agent_created" ON "cost_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cost_events_request_type" ON "cost_events" USING btree ("request_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_cost_events_thread" ON "cost_events" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_cost_events_trace" ON "cost_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_tenant_type" ON "scheduled_jobs" USING btree ("tenant_id","trigger_type");--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_agent" ON "scheduled_jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_routine" ON "scheduled_jobs" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_enabled" ON "scheduled_jobs" USING btree ("tenant_id","enabled");--> statement-breakpoint
CREATE INDEX "idx_thread_turn_events_run_seq" ON "thread_turn_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "idx_thread_turn_events_tenant_created" ON "thread_turn_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_tenant_agent" ON "thread_turns" USING btree ("tenant_id","agent_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_tenant_routine" ON "thread_turns" USING btree ("tenant_id","routine_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_trigger" ON "thread_turns" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_status" ON "thread_turns" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_thread" ON "thread_turns" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_thread_turns_webhook" ON "thread_turns" USING btree ("webhook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_kb" ON "agent_knowledge_bases" USING btree ("agent_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_bases_tenant" ON "knowledge_bases" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_knowledge_bases_tenant_slug" ON "knowledge_bases" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_email_reply_tokens_hash" ON "email_reply_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_email_reply_tokens_agent" ON "email_reply_tokens" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_email_reply_tokens_expires" ON "email_reply_tokens" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_email_reply_tokens_ses_msg" ON "email_reply_tokens" USING btree ("ses_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_thread_dependency" ON "thread_dependencies" USING btree ("thread_id","blocked_by_thread_id");--> statement-breakpoint
CREATE INDEX "idx_thread_deps_thread" ON "thread_dependencies" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_thread_deps_blocked_by" ON "thread_dependencies" USING btree ("blocked_by_thread_id");--> statement-breakpoint
CREATE INDEX "idx_thread_deps_tenant" ON "thread_dependencies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_retry_queue_status_scheduled" ON "retry_queue" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_retry_queue_tenant" ON "retry_queue" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_retry_queue_origin_turn" ON "retry_queue" USING btree ("origin_turn_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_tenant_id" ON "artifacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_thread_id" ON "artifacts" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_agent_id" ON "artifacts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_type" ON "artifacts" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_webhook_idempotency_key" ON "webhook_idempotency" USING btree ("webhook_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_webhooks_token" ON "webhooks" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_webhooks_tenant" ON "webhooks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_tenant_enabled" ON "webhooks" USING btree ("tenant_id","enabled");--> statement-breakpoint
CREATE INDEX "idx_recipes_tenant_id" ON "recipes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_recipes_thread_id" ON "recipes" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_recipes_agent_id" ON "recipes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_skill_catalog_category" ON "skill_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_skill_catalog_execution" ON "skill_catalog" USING btree ("execution");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_skills" ON "tenant_skills" USING btree ("tenant_id","skill_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_skills_tenant_source" ON "tenant_skills" USING btree ("tenant_id","source");--> statement-breakpoint
CREATE INDEX "idx_guardrail_blocks_tenant" ON "guardrail_blocks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_guardrail_blocks_agent" ON "guardrail_blocks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_guardrail_blocks_guardrail" ON "guardrail_blocks" USING btree ("guardrail_id");--> statement-breakpoint
CREATE INDEX "idx_guardrail_blocks_created" ON "guardrail_blocks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_guardrails_tenant" ON "guardrails" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_templates_tenant_slug" ON "agent_templates" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_agent_templates_tenant" ON "agent_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_agent_templates_category" ON "agent_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_agent_templates_source" ON "agent_templates" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_agent_versions_agent" ON "agent_versions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_versions_agent_version" ON "agent_versions" USING btree ("agent_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_activity_log_tenant_created" ON "activity_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_entity" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_actor" ON "activity_log" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "idx_user_quick_actions_user" ON "user_quick_actions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_quick_actions_tenant" ON "user_quick_actions" USING btree ("tenant_id");