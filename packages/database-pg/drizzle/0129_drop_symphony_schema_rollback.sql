-- Rollback for 0129_drop_symphony_schema.sql.
--
-- Recreates the schema and all 17 table shapes that existed before U5.
-- This rollback restores schema compatibility only; it does not reconstruct
-- the 89 rows of test-fixture data that lived in the non-empty tables.
--
-- Shapes captured by `pg_dump --schema-only --schema=symphony` against
-- thinkwork-dev as of 2026-05-24, before the drop. Indexes, primary keys,
-- triggers, and internal FKs are restored.
--
-- creates: symphony.claims
-- creates: symphony.claims_v2
-- creates: symphony.cost_totals
-- creates: symphony.github_installations
-- creates: symphony.hitl_questions
-- creates: symphony.nonce_log
-- creates: symphony.orchestrator_flags
-- creates: symphony.repositories
-- creates: symphony.run_events
-- creates: symphony.runs
-- creates: symphony.runs_v2
-- creates: symphony.service_health
-- creates: symphony.service_leases
-- creates: symphony.spend_actuals
-- creates: symphony.spend_reservations
-- creates: symphony.work_items
-- creates: symphony.workflow_versions
-- creates-function: symphony.set_updated_at

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS symphony;

CREATE OR REPLACE FUNCTION symphony.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS symphony.claims (
    issue_id text NOT NULL,
    linear_updated_at text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    label text,
    project_slug text,
    eligibility_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT claims_pkey PRIMARY KEY (issue_id),
    CONSTRAINT claims_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'running'::text, 'retry_queued'::text, 'released'::text, 'terminal'::text])))
);

CREATE TABLE IF NOT EXISTS symphony.github_installations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    installation_id text NOT NULL,
    account_login text NOT NULL,
    account_type text,
    target_type text,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    suspended_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT github_installations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS symphony.repositories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    github_installation_id uuid,
    tracker_type text DEFAULT 'github'::text NOT NULL,
    owner text NOT NULL,
    name text NOT NULL,
    full_name text NOT NULL,
    external_id text,
    default_branch text DEFAULT 'main'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    active_workflow_version_id uuid,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT repositories_pkey PRIMARY KEY (id),
    CONSTRAINT repositories_enabled_workflow_check CHECK (((enabled = false) OR (active_workflow_version_id IS NOT NULL))),
    CONSTRAINT repositories_tracker_type_check CHECK ((tracker_type = ANY (ARRAY['github'::text, 'linear'::text]))),
    CONSTRAINT repositories_github_installation_id_fkey FOREIGN KEY (github_installation_id) REFERENCES symphony.github_installations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.work_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repository_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tracker_type text DEFAULT 'github'::text NOT NULL,
    external_id text NOT NULL,
    number integer,
    title text NOT NULL,
    body text,
    state text NOT NULL,
    url text,
    author_login text,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    tracker_updated_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT work_items_pkey PRIMARY KEY (id),
    CONSTRAINT work_items_state_check CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text, 'deleted'::text, 'unknown'::text]))),
    CONSTRAINT work_items_tracker_type_check CHECK ((tracker_type = ANY (ARRAY['github'::text, 'linear'::text]))),
    CONSTRAINT work_items_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES symphony.repositories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS symphony.workflow_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_sha text NOT NULL,
    parsed_workflow jsonb NOT NULL,
    validation_status text NOT NULL,
    last_validation_error text,
    repository_id uuid,
    workflow_body text,
    content_sha256 text,
    CONSTRAINT workflow_versions_pkey PRIMARY KEY (id),
    CONSTRAINT workflow_versions_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'invalid'::text]))),
    CONSTRAINT workflow_versions_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES symphony.repositories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.claims_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_item_id uuid NOT NULL,
    workflow_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    claimed_by text,
    lease_expires_at timestamp with time zone,
    retry_after timestamp with time zone,
    eligibility_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT claims_v2_pkey PRIMARY KEY (id),
    CONSTRAINT claims_v2_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'running'::text, 'retry_queued'::text, 'released'::text, 'terminal'::text, 'abandoned'::text]))),
    CONSTRAINT claims_v2_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES symphony.work_items(id) ON DELETE RESTRICT,
    CONSTRAINT claims_v2_workflow_version_id_fkey FOREIGN KEY (workflow_version_id) REFERENCES symphony.workflow_versions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issue_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    current_state text DEFAULT 'pending'::text NOT NULL,
    outcome text,
    error_class text,
    last_agent_message text,
    next_retry_at timestamp with time zone,
    task_token text,
    step_function_execution_arn text,
    kill_target text,
    cost_finalized_at timestamp with time zone,
    pr_url text,
    workspace_key text,
    outcome_payload jsonb,
    rotation_counter integer DEFAULT 0 NOT NULL,
    next_rotation_arn text,
    runtime_session_id text,
    session_started_at timestamp with time zone,
    last_usage_event_at timestamp with time zone,
    CONSTRAINT runs_pkey PRIMARY KEY (id),
    CONSTRAINT runs_current_state_check CHECK ((current_state = ANY (ARRAY['pending'::text, 'preparing_workspace'::text, 'invoking_agent'::text, 'recording_result'::text, 'continuation'::text, 'rotating'::text, 'cancelling'::text, 'terminal'::text, 'failed'::text, 'stalled'::text]))),
    CONSTRAINT runs_kill_target_check CHECK (((kill_target IS NULL) OR (kill_target = ANY (ARRAY['cooperative'::text, 'hard'::text])))),
    CONSTRAINT runs_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES symphony.claims(issue_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS symphony.runs_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid,
    work_item_id uuid NOT NULL,
    workflow_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    phase text DEFAULT 'pending'::text NOT NULL,
    outcome text,
    error_class text,
    agentcore_session_id text,
    workspace_key text,
    pr_url text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    outcome_payload jsonb,
    CONSTRAINT runs_v2_pkey PRIMARY KEY (id),
    CONSTRAINT runs_v2_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['pr_opened'::text, 'no_pr_required'::text, 'needs_input'::text, 'blocked'::text, 'failed'::text, 'cancelled'::text, 'continued'::text])))),
    CONSTRAINT runs_v2_phase_check CHECK ((phase = ANY (ARRAY['pending'::text, 'dispatching'::text, 'running'::text, 'needs_input'::text, 'blocked'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT runs_v2_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES symphony.claims_v2(id) ON DELETE SET NULL,
    CONSTRAINT runs_v2_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES symphony.work_items(id) ON DELETE RESTRICT,
    CONSTRAINT runs_v2_workflow_version_id_fkey FOREIGN KEY (workflow_version_id) REFERENCES symphony.workflow_versions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.cost_totals (
    run_id uuid NOT NULL,
    finalized_at timestamp with time zone DEFAULT now() NOT NULL,
    reservation_usd numeric(10,4) NOT NULL,
    actuals_usd numeric(10,4) NOT NULL,
    delta_usd numeric(10,4) NOT NULL,
    CONSTRAINT cost_totals_pkey PRIMARY KEY (run_id),
    CONSTRAINT cost_totals_actuals_nonneg CHECK ((actuals_usd >= (0)::numeric)),
    CONSTRAINT cost_totals_reservation_nonneg CHECK ((reservation_usd >= (0)::numeric)),
    CONSTRAINT cost_totals_run_id_fkey FOREIGN KEY (run_id) REFERENCES symphony.runs(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS symphony.hitl_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    work_item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    question_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    prompt text NOT NULL,
    answer text,
    asked_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    answered_by text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT hitl_questions_pkey PRIMARY KEY (id),
    CONSTRAINT hitl_questions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'answered'::text, 'cancelled'::text]))),
    CONSTRAINT hitl_questions_run_id_fkey FOREIGN KEY (run_id) REFERENCES symphony.runs_v2(id) ON DELETE SET NULL,
    CONSTRAINT hitl_questions_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES symphony.work_items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS symphony.nonce_log (
    nonce text NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    CONSTRAINT nonce_log_pkey PRIMARY KEY (nonce),
    CONSTRAINT nonce_log_source_check CHECK ((source = ANY (ARRAY['hmac-callback'::text, 'webhook-delivery'::text])))
);

CREATE TABLE IF NOT EXISTS symphony.orchestrator_flags (
    scope text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dispatch_paused boolean DEFAULT false NOT NULL,
    global_cap_exceeded boolean DEFAULT false NOT NULL,
    active_workflow_version_id uuid,
    flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT orchestrator_flags_pkey PRIMARY KEY (scope),
    CONSTRAINT orchestrator_flags_scope_global CHECK ((scope = 'global'::text)),
    CONSTRAINT orchestrator_flags_active_workflow_version_id_fkey FOREIGN KEY (active_workflow_version_id) REFERENCES symphony.workflow_versions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.run_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    work_item_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT run_events_pkey PRIMARY KEY (id),
    CONSTRAINT run_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES symphony.runs_v2(id) ON DELETE SET NULL,
    CONSTRAINT run_events_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES symphony.work_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS symphony.service_health (
    service_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT service_health_pkey PRIMARY KEY (service_id),
    CONSTRAINT service_health_status_check CHECK ((status = ANY (ARRAY['starting'::text, 'ready'::text, 'degraded'::text, 'stopped'::text])))
);

CREATE TABLE IF NOT EXISTS symphony.service_leases (
    lease_key text NOT NULL,
    holder_id text NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    heartbeat_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT service_leases_pkey PRIMARY KEY (lease_key)
);

CREATE TABLE IF NOT EXISTS symphony.spend_actuals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    cumulative_input_tokens bigint NOT NULL,
    cumulative_output_tokens bigint NOT NULL,
    cumulative_agentcore_seconds numeric(10,3) NOT NULL,
    cumulative_usd numeric(10,4) NOT NULL,
    nonce text NOT NULL,
    CONSTRAINT spend_actuals_pkey PRIMARY KEY (id),
    CONSTRAINT spend_actuals_input_nonneg CHECK ((cumulative_input_tokens >= 0)),
    CONSTRAINT spend_actuals_output_nonneg CHECK ((cumulative_output_tokens >= 0)),
    CONSTRAINT spend_actuals_seconds_nonneg CHECK ((cumulative_agentcore_seconds >= (0)::numeric)),
    CONSTRAINT spend_actuals_usd_nonneg CHECK ((cumulative_usd >= (0)::numeric)),
    CONSTRAINT spend_actuals_run_id_fkey FOREIGN KEY (run_id) REFERENCES symphony.runs(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS symphony.spend_reservations (
    run_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    amount_usd numeric(10,4) NOT NULL,
    released_at timestamp with time zone,
    released_amount_usd numeric(10,4),
    CONSTRAINT spend_reservations_pkey PRIMARY KEY (run_id),
    CONSTRAINT spend_reservations_amount_nonneg CHECK ((amount_usd >= (0)::numeric)),
    CONSTRAINT spend_reservations_released_amount_nonneg CHECK (((released_amount_usd IS NULL) OR (released_amount_usd >= (0)::numeric))),
    CONSTRAINT spend_reservations_run_id_fkey FOREIGN KEY (run_id) REFERENCES symphony.runs(id) ON DELETE RESTRICT
);

-- Indexes (recreated to match pre-drop performance shape)

CREATE UNIQUE INDEX IF NOT EXISTS claims_active_unique ON symphony.claims USING btree (issue_id) WHERE (status = ANY (ARRAY['claimed'::text, 'running'::text, 'retry_queued'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS claims_v2_active_unique ON symphony.claims_v2 USING btree (work_item_id) WHERE (status = ANY (ARRAY['claimed'::text, 'running'::text, 'retry_queued'::text]));
CREATE INDEX IF NOT EXISTS claims_v2_lease_idx ON symphony.claims_v2 USING btree (lease_expires_at) WHERE (status = ANY (ARRAY['claimed'::text, 'running'::text, 'retry_queued'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS github_installations_installation_id_unique ON symphony.github_installations USING btree (installation_id);
CREATE INDEX IF NOT EXISTS hitl_questions_pending_idx ON symphony.hitl_questions USING btree (work_item_id, asked_at DESC) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX IF NOT EXISTS hitl_questions_run_key_unique ON symphony.hitl_questions USING btree (run_id, question_key) WHERE (run_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS nonce_log_used_at_idx ON symphony.nonce_log USING btree (used_at);
CREATE INDEX IF NOT EXISTS repositories_active_idx ON symphony.repositories USING btree (tracker_type, enabled, archived_at) WHERE ((enabled = true) AND (archived_at IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS repositories_installation_owner_name_unique ON symphony.repositories USING btree (github_installation_id, lower(owner), lower(name));
CREATE INDEX IF NOT EXISTS run_events_run_idx ON symphony.run_events USING btree (run_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS run_events_work_item_idx ON symphony.run_events USING btree (work_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS runs_issue_id_idx ON symphony.runs USING btree (issue_id);
CREATE INDEX IF NOT EXISTS runs_v2_phase_idx ON symphony.runs_v2 USING btree (phase, updated_at DESC);
CREATE INDEX IF NOT EXISTS runs_v2_work_item_idx ON symphony.runs_v2 USING btree (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_leases_expires_idx ON symphony.service_leases USING btree (expires_at);
CREATE INDEX IF NOT EXISTS spend_actuals_run_recorded_idx ON symphony.spend_actuals USING btree (run_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS spend_reservations_open_idx ON symphony.spend_reservations USING btree (released_at) WHERE (released_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS work_items_external_unique ON symphony.work_items USING btree (repository_id, tracker_type, external_id);
CREATE INDEX IF NOT EXISTS work_items_repository_state_idx ON symphony.work_items USING btree (repository_id, state, tracker_updated_at DESC);
CREATE INDEX IF NOT EXISTS workflow_versions_repository_id_idx ON symphony.workflow_versions USING btree (repository_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_versions_source_sha_unique ON symphony.workflow_versions USING btree (source_sha);

-- Triggers (set_updated_at on 11 tables)

DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.claims;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.claims FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.claims_v2;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.claims_v2 FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.github_installations;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.github_installations FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.hitl_questions;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.hitl_questions FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.orchestrator_flags;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.orchestrator_flags FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.repositories;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.repositories FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.runs;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.runs FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.runs_v2;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.runs_v2 FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.service_health;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.service_health FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.service_leases;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.service_leases FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_trg ON symphony.work_items;
CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON symphony.work_items FOR EACH ROW EXECUTE FUNCTION symphony.set_updated_at();

COMMIT;
