-- skill_runs — audit log + idempotency surface for composition invocations.
--
-- See docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md
-- (Unit 4). This table is an audit log, NOT an execution substrate — runs
-- complete inside a single AgentCore Runtime session and only the final
-- outcome is recorded here.
--
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0018_skill_runs.sql
--
-- Drift detection:
--   bash scripts/db-migrate-manual.sh
--
-- Pre-migration invariant: no existing table named skill_runs.
--   SELECT to_regclass('public.skill_runs'); must return NULL.
--
-- creates: public.skill_runs
-- creates: public.uq_skill_runs_dedup_active

CREATE TABLE "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"invoker_user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"skill_version" integer NOT NULL DEFAULT 1,
	"invocation_source" text NOT NULL,
	"inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"resolved_inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"resolved_inputs_hash" text NOT NULL,
	"status" text NOT NULL DEFAULT 'running',
	"delivery_channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone NOT NULL DEFAULT now(),
	"finished_at" timestamp with time zone,
	"delivered_artifact_ref" jsonb,
	"delete_at" timestamp with time zone NOT NULL DEFAULT (now() + interval '30 days'),
	"feedback_signal" text,
	"feedback_note" text,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "retention_ceiling"
		CHECK (delete_at <= started_at + interval '180 days'),
	CONSTRAINT "status_allowed"
		CHECK (status IN ('running','complete','failed','cancelled','invoker_deprovisioned','skipped_disabled','cost_bounded_error')),
	CONSTRAINT "invocation_source_allowed"
		CHECK (invocation_source IN ('chat','scheduled','catalog','webhook')),
	CONSTRAINT "feedback_signal_allowed"
		CHECK (feedback_signal IS NULL OR feedback_signal IN ('positive','negative'))
);
--> statement-breakpoint

ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_agent_id_agents_id_fk"
	FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_skill_runs_tenant_started" ON "skill_runs"
	USING btree ("tenant_id","started_at");
--> statement-breakpoint

CREATE INDEX "idx_skill_runs_invoker" ON "skill_runs"
	USING btree ("invoker_user_id");
--> statement-breakpoint

CREATE INDEX "idx_skill_runs_tenant_skill" ON "skill_runs"
	USING btree ("tenant_id","skill_id");
--> statement-breakpoint

CREATE INDEX "idx_skill_runs_delete_at" ON "skill_runs"
	USING btree ("delete_at");
--> statement-breakpoint

-- Dedup: only rows still in 'running' status can collide. Once a run
-- flips to a terminal status its slot is freed and a re-invocation with
-- the same inputs inserts cleanly as a fresh reconciler tick.
CREATE UNIQUE INDEX "uq_skill_runs_dedup_active" ON "skill_runs"
	USING btree ("tenant_id","invoker_user_id","skill_id","resolved_inputs_hash")
	WHERE status = 'running';
