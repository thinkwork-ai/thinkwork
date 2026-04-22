-- NOTE: mutation_idempotency table + FK + indexes were intentionally
-- stripped from this generated migration. They were already applied to every
-- stage by the hand-rolled drizzle/0020_mutation_idempotency.sql that shipped
-- in PR #405 (65da2f6); the drizzle journal simply wasn't refreshed, so when
-- db:generate ran for the sandbox schema it re-included the table. Keeping
-- them here would make this migration fail with "relation already exists" on
-- every environment. The 0019 snapshot file does include mutation_idempotency
-- so future db:generate runs stay consistent.
CREATE TABLE "sandbox_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"user_id" uuid NOT NULL,
	"template_id" text,
	"tool_call_id" text,
	"session_id" text,
	"environment_id" text NOT NULL,
	"invocation_source" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"exit_status" text,
	"stdout_bytes" bigint,
	"stderr_bytes" bigint,
	"stdout_truncated" boolean DEFAULT false NOT NULL,
	"stderr_truncated" boolean DEFAULT false NOT NULL,
	"peak_memory_mb" integer,
	"outbound_hosts" jsonb,
	"executed_code_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
	CONSTRAINT "sandbox_invocations_retention_ceiling" CHECK ("sandbox_invocations"."delete_at" <= "sandbox_invocations"."started_at" + interval '180 days'),
	CONSTRAINT "sandbox_invocations_exit_status_allowed" CHECK ("sandbox_invocations"."exit_status" IS NULL OR "sandbox_invocations"."exit_status" IN ('ok','error','timeout','oom','cap_exceeded','provisioning','connection_revoked')),
	CONSTRAINT "sandbox_invocations_source_allowed" CHECK ("sandbox_invocations"."invocation_source" IS NULL OR "sandbox_invocations"."invocation_source" IN ('chat','scheduled','composition'))
);
--> statement-breakpoint
CREATE TABLE "sandbox_agent_hourly_counters" (
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"utc_hour" timestamp with time zone NOT NULL,
	"invocations_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_agent_hourly_counters_tenant_id_agent_id_utc_hour_pk" PRIMARY KEY("tenant_id","agent_id","utc_hour")
);
--> statement-breakpoint
CREATE TABLE "sandbox_tenant_daily_counters" (
	"tenant_id" uuid NOT NULL,
	"utc_date" date NOT NULL,
	"invocations_count" integer DEFAULT 0 NOT NULL,
	"wall_clock_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_tenant_daily_counters_tenant_id_utc_date_pk" PRIMARY KEY("tenant_id","utc_date")
);
--> statement-breakpoint
CREATE TABLE "tenant_policy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before_value" text,
	"after_value" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_policy_events_event_type_allowed" CHECK ("tenant_policy_events"."event_type" IN ('sandbox_enabled','compliance_tier')),
	CONSTRAINT "tenant_policy_events_source_allowed" CHECK ("tenant_policy_events"."source" IN ('graphql','reconciler','sql'))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sandbox_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Rollout-safe: the DEFAULT true is forward-facing semantics (new tenants
-- created post-migration opt in automatically). Existing tenants must NOT
-- auto-opt-in before Phase 3b enforcement (pre-flight + quota + audit) lands;
-- flip them all to false in the same transaction. Operator action re-enables
-- per tenant during the staged rollout described in the plan's Operational
-- Notes.
UPDATE "tenants" SET "sandbox_enabled" = false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "compliance_tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sandbox_interpreter_public_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sandbox_interpreter_internal_id" text;--> statement-breakpoint
ALTER TABLE "sandbox_invocations" ADD CONSTRAINT "sandbox_invocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_invocations" ADD CONSTRAINT "sandbox_invocations_run_id_skill_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_invocations" ADD CONSTRAINT "sandbox_invocations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_agent_hourly_counters" ADD CONSTRAINT "sandbox_agent_hourly_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_agent_hourly_counters" ADD CONSTRAINT "sandbox_agent_hourly_counters_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_tenant_daily_counters" ADD CONSTRAINT "sandbox_tenant_daily_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_policy_events" ADD CONSTRAINT "tenant_policy_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sandbox_invocations_tenant_started" ON "sandbox_invocations" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sandbox_invocations_tenant_agent_started" ON "sandbox_invocations" USING btree ("tenant_id","agent_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_sandbox_invocations_user" ON "sandbox_invocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sandbox_invocations_run" ON "sandbox_invocations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_sandbox_invocations_delete_at" ON "sandbox_invocations" USING btree ("delete_at");--> statement-breakpoint
CREATE INDEX "idx_tenant_policy_events_tenant_created" ON "tenant_policy_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_compliance_tier_allowed" CHECK ("tenants"."compliance_tier" IN ('standard','regulated','hipaa'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_sandbox_requires_standard_tier" CHECK (NOT ("tenants"."sandbox_enabled" = true AND "tenants"."compliance_tier" != 'standard'));