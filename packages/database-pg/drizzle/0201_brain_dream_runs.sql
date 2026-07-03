-- Dream-state audit ledger: per-bank staged plan → atomic apply → applied markers.
-- Plan: docs/plans/2026-07-03-001-feat-thinkwork-brain-memory-architecture-plan.md (U4, KTD-2).
--
-- creates: public.brain_dream_runs
-- creates: public.brain_dream_runs_dedupe_key_uidx
-- creates: public.brain_dream_runs_tenant_bank_idx
-- creates: public.brain_dream_runs_tenant_status_idx
-- creates: public.brain_dream_actions
-- creates: public.brain_dream_actions_run_ordinal_uidx
-- creates: public.brain_dream_actions_run_status_idx
-- creates-constraint: public.brain_dream_runs.brain_dream_runs_tenant_id_tenants_id_fk
-- creates-constraint: public.brain_dream_runs.brain_dream_runs_status_check
-- creates-constraint: public.brain_dream_actions.brain_dream_actions_run_id_brain_dream_runs_id_fk
-- creates-constraint: public.brain_dream_actions.brain_dream_actions_type_check
-- creates-constraint: public.brain_dream_actions.brain_dream_actions_status_check

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'tenants not found; apply core tenant migrations first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "brain_dream_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "bank_id" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'planned',
  "planned_counts" jsonb,
  "applied_counts" jsonb,
  "error_message" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "brain_dream_runs_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
  CONSTRAINT "brain_dream_runs_status_check"
    CHECK (status IN ('planned', 'applying', 'applied', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "brain_dream_runs_dedupe_key_uidx"
  ON "brain_dream_runs" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "brain_dream_runs_tenant_bank_idx"
  ON "brain_dream_runs" ("tenant_id", "bank_id", "created_at");
CREATE INDEX IF NOT EXISTS "brain_dream_runs_tenant_status_idx"
  ON "brain_dream_runs" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "brain_dream_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "action_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'staged',
  "target" jsonb,
  "reason" text,
  "applied_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "brain_dream_actions_run_id_brain_dream_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."brain_dream_runs"("id") ON DELETE cascade,
  CONSTRAINT "brain_dream_actions_type_check"
    CHECK (action_type IN ('quarantine', 'forget', 'consolidate')),
  CONSTRAINT "brain_dream_actions_status_check"
    CHECK (status IN ('staged', 'applied', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "brain_dream_actions_run_ordinal_uidx"
  ON "brain_dream_actions" ("run_id", "ordinal");
CREATE INDEX IF NOT EXISTS "brain_dream_actions_run_status_idx"
  ON "brain_dream_actions" ("run_id", "status");
