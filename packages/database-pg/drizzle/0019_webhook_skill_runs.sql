-- Unit 8 — webhook ingress pattern + tenant system-user actor.
--
-- See docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md
-- (Unit 8). Two changes:
--
--   1. skill_runs.triggered_by_run_id — optional link from one reconciler
--      tick back to the run that spawned the task whose completion fired
--      this tick. Populated by the task-event webhook handler.
--   2. tenant_system_users — one stable uuid per tenant that owns webhook-
--      triggered composition runs. Compiled-in scope: invoke-only. See the
--      schema file for the rationale.
--
-- Apply manually (matches 0018_skill_runs.sql convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0019_webhook_skill_runs.sql
--
-- Drift detection:
--   bash scripts/db-migrate-manual.sh
--
-- Pre-migration invariants:
--   - skill_runs exists (applied via 0018_skill_runs.sql).
--   - tenant_system_users does not exist yet.
--
-- creates: public.tenant_system_users
-- creates: public.uq_tenant_system_users_tenant
-- creates: public.idx_skill_runs_triggered_by
-- creates-column: public.skill_runs.triggered_by_run_id

-- ---------------------------------------------------------------------------
-- 1. skill_runs.triggered_by_run_id
-- ---------------------------------------------------------------------------

ALTER TABLE "skill_runs"
	ADD COLUMN IF NOT EXISTS "triggered_by_run_id" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_skill_runs_triggered_by"
	ON "skill_runs" USING btree ("triggered_by_run_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. tenant_system_users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "tenant_system_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "tenant_system_users"
	ADD CONSTRAINT "tenant_system_users_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_system_users_tenant"
	ON "tenant_system_users" USING btree ("tenant_id");
