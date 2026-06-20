-- n8n agent-step bridge run ledger.
--
-- Apply manually before deploying bridge endpoint code:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0176_n8n_agent_step_runs.sql
--
-- creates: public.n8n_agent_step_runs
-- creates: public.n8n_agent_step_runs_tenant_idempotency_uidx
-- creates: public.n8n_agent_step_runs_tenant_status_idx
-- creates: public.n8n_agent_step_runs_thread_idx
-- creates: public.n8n_agent_step_runs_n8n_execution_idx
-- creates: public.n8n_agent_step_runs_due_expiry_idx
-- creates: public.n8n_agent_step_runs_resume_pending_idx
-- creates-constraint: public.n8n_agent_step_runs.n8n_agent_step_runs_status_check
-- creates-constraint: public.n8n_agent_step_runs.n8n_agent_step_runs_resume_status_check
-- creates-constraint: public.n8n_agent_step_runs.n8n_agent_step_runs_timeout_bounds_check
-- creates-constraint: public.n8n_agent_step_runs.n8n_agent_step_runs_terminal_state_check

CREATE TABLE IF NOT EXISTS "n8n_agent_step_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "plugin_install_id" uuid REFERENCES "plugin_installs"("id") ON DELETE set null,
  "managed_application_id" uuid REFERENCES "managed_applications"("id") ON DELETE set null,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE restrict,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "thread_id" uuid REFERENCES "threads"("id") ON DELETE set null,
  "thread_turn_id" uuid REFERENCES "thread_turns"("id") ON DELETE set null,
  "opening_message_id" uuid REFERENCES "messages"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'accepted',
  "resume_status" text NOT NULL DEFAULT 'not_ready',
  "workflow_id" text NOT NULL,
  "workflow_name" text,
  "execution_id" text NOT NULL,
  "step_id" text NOT NULL,
  "correlation_id" text NOT NULL,
  "request_id" text,
  "idempotency_key" text NOT NULL,
  "instructions_preview" text,
  "input_preview" text,
  "request_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resume_url_secret_ref" text,
  "resume_url_host" text,
  "resume_url_path" text,
  "timeout_seconds" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "result_payload" jsonb,
  "output_payload" jsonb,
  "error_payload" jsonb,
  "summary" text,
  "links" jsonb,
  "resume_attempt_count" integer NOT NULL DEFAULT 0,
  "next_resume_attempt_at" timestamp with time zone,
  "last_resume_attempt_at" timestamp with time zone,
  "last_resume_http_status" integer,
  "last_resume_error" text,
  "resumed_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "accepted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "n8n_agent_step_runs_status_check"
    CHECK ("status" IN (
      'accepted',
      'waiting',
      'awaiting_human',
      'resume_pending',
      'resuming',
      'resumed',
      'resume_failed',
      'failed',
      'expired'
    )),
  CONSTRAINT "n8n_agent_step_runs_resume_status_check"
    CHECK ("resume_status" IN (
      'not_ready',
      'pending',
      'resuming',
      'resumed',
      'failed'
    )),
  CONSTRAINT "n8n_agent_step_runs_timeout_bounds_check"
    CHECK ("timeout_seconds" BETWEEN 300 AND 604800),
  CONSTRAINT "n8n_agent_step_runs_terminal_state_check"
    CHECK (
      "status" NOT IN ('resumed', 'resume_failed', 'failed', 'expired')
      OR "terminal_at" IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "n8n_agent_step_runs_tenant_idempotency_uidx"
  ON "n8n_agent_step_runs" ("tenant_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "n8n_agent_step_runs_tenant_status_idx"
  ON "n8n_agent_step_runs" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "n8n_agent_step_runs_thread_idx"
  ON "n8n_agent_step_runs" ("tenant_id", "thread_id");

CREATE INDEX IF NOT EXISTS "n8n_agent_step_runs_n8n_execution_idx"
  ON "n8n_agent_step_runs" ("tenant_id", "workflow_id", "execution_id");

CREATE INDEX IF NOT EXISTS "n8n_agent_step_runs_due_expiry_idx"
  ON "n8n_agent_step_runs" ("tenant_id", "expires_at")
  WHERE "status" IN ('accepted', 'waiting', 'awaiting_human');

CREATE INDEX IF NOT EXISTS "n8n_agent_step_runs_resume_pending_idx"
  ON "n8n_agent_step_runs" ("tenant_id", "next_resume_attempt_at")
  WHERE "status" = 'resume_pending';
