-- mutation_idempotency — server-authoritative idempotency for admin-skill mutations
--
-- See docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md (Unit 4).
-- Lets the thinkwork-admin Python skill retry a mutation with the same
-- idempotency_key and receive the original result without re-executing.
-- Protects the stamp-out-an-enterprise recipe from spawning duplicate
-- rows on transient failures + replays.
--
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0020_mutation_idempotency.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- Pre-migration invariant: no existing table named mutation_idempotency.
--   SELECT to_regclass('public.mutation_idempotency'); must return NULL.
--
-- Divergence from skill_runs: mutation_idempotency uses a FULL unique index
-- (not partial-on-status='running') because a succeeded mutation's key
-- MUST block a duplicate retry and return the stored result. skill_runs
-- can use a partial index because a failed composition is safe to re-run.
-- Full index also sidesteps the ON-CONFLICT-on-partial-index gotcha noted
-- at startSkillRun.mutation.ts:127-129.
--
-- creates: public.mutation_idempotency
-- creates: public.uq_mutation_idempotency_key

CREATE TABLE "mutation_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	-- Plain uuid without FK to users — skill_runs.invoker_user_id follows
	-- the same precedent. Service-auth callers may assert principalIds
	-- whose users row is managed elsewhere; an FK here would foot-gun
	-- that path without adding safety the row itself needs.
	"invoker_user_id" uuid NOT NULL,
	"mutation_name" text NOT NULL,
	-- Client-supplied recipe-step key OR server-derived resolved_inputs_hash.
	-- Unique per (tenant, invoker, mutation).
	"idempotency_key" text NOT NULL,
	-- SHA256 over canonicalized inputs, always server-computed. Kept for
	-- audit/debug even when the client provided a distinct key.
	"resolved_inputs_hash" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"result_json" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"completed_at" timestamp with time zone,
	CONSTRAINT "status_allowed"
		CHECK (status IN ('pending','succeeded','failed'))
);
--> statement-breakpoint

ALTER TABLE "mutation_idempotency" ADD CONSTRAINT "mutation_idempotency_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- FULL unique index (deliberate divergence from skill_runs' partial index).
CREATE UNIQUE INDEX "uq_mutation_idempotency_key" ON "mutation_idempotency"
	USING btree ("tenant_id","invoker_user_id","mutation_name","idempotency_key");
--> statement-breakpoint

CREATE INDEX "idx_mutation_idempotency_tenant_created" ON "mutation_idempotency"
	USING btree ("tenant_id","created_at");
