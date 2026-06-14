-- Release update deployment job domain.
--
-- creates: public.release_update_jobs
-- creates: public.release_update_events
-- creates: public.release_update_jobs_tenant_idempotency_uidx
-- creates: public.release_update_jobs_tenant_status_idx
-- creates: public.release_update_jobs_tenant_target_idx
-- creates: public.release_update_events_job_created_idx
-- creates: public.release_update_events_idempotency_uidx

CREATE TABLE IF NOT EXISTS "release_update_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'preflight_pending',
  "idempotency_key" text NOT NULL,
  "requested_by_user_id" uuid,
  "target_release_version" text NOT NULL,
  "current_release_version" text,
  "manifest_url" text NOT NULL,
  "manifest_sha256" text NOT NULL,
  "manifest_signed" boolean NOT NULL DEFAULT false,
  "manifest_trust_policy" text,
  "terraform_module_version" text,
  "preflight_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "preserved_config_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "remediation_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "state_machine_arn" text,
  "execution_arn" text,
  "codebuild_build_arn" text,
  "evidence_bucket" text,
  "evidence_prefix" text,
  "status_pointer_bucket" text,
  "status_pointer_key" text,
  "final_status" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "failure_category" text,
  "failure_message" text,
  "recovery_action" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "release_update_jobs_tenant_idempotency_uidx"
  ON "release_update_jobs" ("tenant_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "release_update_jobs_tenant_status_idx"
  ON "release_update_jobs" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "release_update_jobs_tenant_target_idx"
  ON "release_update_jobs" ("tenant_id", "target_release_version");

CREATE TABLE IF NOT EXISTS "release_update_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL REFERENCES "release_update_jobs"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "message" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "release_update_events_job_created_idx"
  ON "release_update_events" ("job_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "release_update_events_idempotency_uidx"
  ON "release_update_events" ("job_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
