-- Browser-first customer deployment session state.
--
-- creates: public.customer_deployment_sessions
-- creates: public.customer_deployment_session_events
-- creates: public.customer_deployment_sessions_status_idx
-- creates: public.customer_deployment_sessions_account_region_idx
-- creates: public.customer_deployment_sessions_tenant_idx
-- creates: public.customer_deployment_session_events_session_created_idx
-- creates: public.customer_deployment_session_events_idempotency_uidx

CREATE TABLE IF NOT EXISTS "customer_deployment_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'collecting_inputs',
  "current_step_key" text NOT NULL DEFAULT 'intake',
  "requested_action" text NOT NULL DEFAULT 'deploy',
  "client_token_hash" text NOT NULL,
  "source" text NOT NULL DEFAULT 'browser',
  "customer_name" text NOT NULL,
  "environment_name" text NOT NULL,
  "aws_account_id" text NOT NULL,
  "aws_region" text NOT NULL,
  "availability_zones" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "admin_name" text NOT NULL,
  "admin_email" text NOT NULL,
  "credentials_status" text NOT NULL DEFAULT 'not_connected',
  "runner_mode" text NOT NULL DEFAULT 'hosted',
  "terraform_backend" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "session_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_message" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_deployment_sessions_status_idx"
  ON "customer_deployment_sessions" ("status");

CREATE INDEX IF NOT EXISTS "customer_deployment_sessions_account_region_idx"
  ON "customer_deployment_sessions" ("aws_account_id", "aws_region");

CREATE INDEX IF NOT EXISTS "customer_deployment_sessions_tenant_idx"
  ON "customer_deployment_sessions" ("tenant_id");

CREATE TABLE IF NOT EXISTS "customer_deployment_session_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "customer_deployment_sessions"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "step_key" text,
  "message" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_deployment_session_events_session_created_idx"
  ON "customer_deployment_session_events" ("session_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "customer_deployment_session_events_idempotency_uidx"
  ON "customer_deployment_session_events" ("session_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
