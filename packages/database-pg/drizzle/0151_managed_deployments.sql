-- Managed application deployment job domain.
--
-- creates: public.managed_applications
-- creates: public.managed_application_deployment_jobs
-- creates: public.managed_application_deployment_events
-- creates: public.managed_applications_tenant_key_uidx
-- creates: public.managed_applications_tenant_status_idx
-- creates: public.managed_deployment_jobs_tenant_idempotency_uidx
-- creates: public.managed_deployment_jobs_tenant_app_idx
-- creates: public.managed_deployment_jobs_status_idx
-- creates: public.managed_deployment_events_job_created_idx
-- creates: public.managed_deployment_events_idempotency_uidx

CREATE TABLE IF NOT EXISTS "managed_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "display_name" text NOT NULL,
  "desired_status" text NOT NULL DEFAULT 'disabled',
  "current_status" text NOT NULL DEFAULT 'unknown',
  "desired_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "selected_release_version" text,
  "selected_manifest_digest" text,
  "last_job_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "managed_applications_tenant_key_uidx"
  ON "managed_applications" ("tenant_id", "key");

CREATE INDEX IF NOT EXISTS "managed_applications_tenant_status_idx"
  ON "managed_applications" ("tenant_id", "current_status");

CREATE TABLE IF NOT EXISTS "managed_application_deployment_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "application_id" uuid REFERENCES "managed_applications"("id") ON DELETE set null,
  "app_key" text NOT NULL,
  "operation" text NOT NULL,
  "status" text NOT NULL DEFAULT 'planning',
  "idempotency_key" text NOT NULL,
  "requested_by_user_id" uuid,
  "release_version" text NOT NULL,
  "manifest_digest" text NOT NULL,
  "desired_config_version" text NOT NULL,
  "state_machine_arn" text,
  "plan_execution_arn" text,
  "apply_execution_arn" text,
  "codebuild_build_arn" text,
  "plan_digest" text,
  "plan_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "data_impact" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "evidence_bucket" text,
  "evidence_prefix" text,
  "approval_required" boolean NOT NULL DEFAULT true,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by_user_id" uuid,
  "rejected_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "managed_deployment_jobs_tenant_idempotency_uidx"
  ON "managed_application_deployment_jobs" ("tenant_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "managed_deployment_jobs_tenant_app_idx"
  ON "managed_application_deployment_jobs" ("tenant_id", "app_key");

CREATE INDEX IF NOT EXISTS "managed_deployment_jobs_status_idx"
  ON "managed_application_deployment_jobs" ("status");

CREATE TABLE IF NOT EXISTS "managed_application_deployment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL REFERENCES "managed_application_deployment_jobs"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "message" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "managed_deployment_events_job_created_idx"
  ON "managed_application_deployment_events" ("job_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "managed_deployment_events_idempotency_uidx"
  ON "managed_application_deployment_events" ("job_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
