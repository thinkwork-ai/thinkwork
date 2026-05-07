-- 0069_compliance_schema.sql
--
-- Phase 3 U1 of the System Workflows revert + Compliance reframe.
-- Greenfield `compliance.*` Postgres schema for the SOC2 Type 1
-- evidence-foundation: append-only audit-event log with per-tenant
-- hash chain (computed app-side by the U4 drainer Lambda), an outbox
-- table providing same-transaction durability for control-evidence
-- writes, an opaque actor pseudonym table erasable on GDPR RTBF, and
-- an export-jobs table for the admin async-export flow.
--
-- The 11 Postgres tables that backed System Workflows + Activation
-- were dropped in Phase 2 U6 (drizzle/0068_drop_system_workflows_and_activation.sql,
-- shipped via PR #873 + #878). This migration is greenfield in the
-- new `compliance.*` namespace; nothing is renamed or repointed.
--
-- Plan reference:
--   docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
--
-- Origin brainstorm:
--   docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0069_compliance_schema.sql
-- Then verify:
--   pnpm db:migrate-manual
--   psql "$DATABASE_URL" -c "\dt compliance.*"
--
-- Role separation note: this migration creates the schema and tables
-- with default permissions. Aurora role provisioning (compliance_writer,
-- compliance_reader) lands in U2 via Terraform; until then the dev DB's
-- default app role can read and write `compliance.*` freely. Phase B
-- writers (U3-U6) and the drainer (U4) are inert pre-U2 — no rows
-- accumulate in dev before the role lockdown ships.
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the post-deploy drift gate):
--
-- creates: compliance.audit_outbox
-- creates: compliance.audit_events
-- creates: compliance.actor_pseudonym
-- creates: compliance.export_jobs
-- creates: compliance.idx_audit_outbox_pending
-- creates: compliance.idx_audit_outbox_tenant_enqueued
-- creates: compliance.idx_audit_events_tenant_occurred
-- creates: compliance.idx_audit_events_tenant_event_type
-- creates: compliance.idx_audit_events_actor
-- creates: compliance.idx_audit_events_control_ids
-- creates: compliance.uq_audit_events_event_id
-- creates: compliance.uq_audit_events_outbox_id
-- creates: compliance.uq_audit_outbox_event_id
-- creates: compliance.idx_actor_pseudonym_user
-- creates: compliance.idx_actor_pseudonym_email_hash
-- creates: compliance.idx_export_jobs_tenant_requested
-- creates: compliance.idx_export_jobs_actor_requested
-- creates-constraint: compliance.audit_events.audit_events_actor_type_allowed
-- creates-constraint: compliance.audit_events.audit_events_event_type_prefix
-- creates-constraint: compliance.audit_outbox.audit_outbox_event_type_prefix
-- creates-constraint: compliance.export_jobs.export_jobs_format_allowed
-- creates-constraint: compliance.export_jobs.export_jobs_status_allowed
-- creates-constraint: compliance.actor_pseudonym.actor_pseudonym_actor_type_allowed
-- creates-function: compliance.raise_immutable
-- creates-trigger: compliance.audit_events.audit_events_block_update
-- creates-trigger: compliance.audit_events.audit_events_block_delete
-- creates-trigger: compliance.audit_events.audit_events_block_truncate

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Refuse to apply against an unexpected DB. Hand-rolled migrations are
-- applied by an operator and a stale DATABASE_URL pointing at a non-dev
-- target would create the schema in the wrong place.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS compliance;
COMMENT ON SCHEMA compliance IS
  'SOC2 audit-event log + tamper evidence. App role writes to audit_outbox; drainer writes to audit_events; admin role reads. See docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md.';

-- ---------------------------------------------------------------------------
-- compliance.audit_outbox
--
-- Same-transaction durability tier for control-evidence writes (R6).
-- A resolver or handler inserts here inside its primary `db.transaction`;
-- if the originating action commits, the outbox row is visible. The U4
-- single-writer drainer Lambda (reserved-concurrency=1) polls
-- `FOR UPDATE SKIP LOCKED LIMIT 1`, computes per-tenant prev_hash +
-- event_hash, writes to audit_events keyed on outbox_id (UNIQUE), and
-- marks drained_at. Idempotent on outbox_id replay.
--
-- The full envelope (R5) is stored here so the drainer is a pure
-- chain-and-copy operation; outbox rows are not summary records but
-- the canonical pre-chain representation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance.audit_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  enqueued_at timestamp with time zone NOT NULL DEFAULT now(),
  drained_at timestamp with time zone,
  drainer_error text,
  actor text NOT NULL,
  actor_type text NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  resource_type text,
  resource_id text,
  action text,
  outcome text,
  request_id text,
  thread_id uuid,
  agent_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_schema_version integer NOT NULL DEFAULT 1,
  control_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload_redacted_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload_oversize_s3_key text,
  CONSTRAINT audit_outbox_event_type_prefix CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval)\.'
  )
);

COMMENT ON TABLE compliance.audit_outbox IS
  'Pre-chain durability tier. Writers insert in caller transaction; U4 drainer Lambda single-writer polls FOR UPDATE SKIP LOCKED, computes per-tenant chain, inserts to audit_events.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_outbox_event_id
  ON compliance.audit_outbox (event_id);

-- Partial index over un-drained rows so the drainer's poll query stays
-- O(N pending) regardless of total outbox volume.
CREATE INDEX IF NOT EXISTS idx_audit_outbox_pending
  ON compliance.audit_outbox (enqueued_at)
  WHERE drained_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_outbox_tenant_enqueued
  ON compliance.audit_outbox (tenant_id, enqueued_at);

-- ---------------------------------------------------------------------------
-- compliance.audit_events
--
-- Append-only audit-event log (R5). Per-tenant hash chain via prev_hash
-- + event_hash, both computed app-side by the U4 drainer Lambda. INSERT
-- is the only legal mutation; UPDATE and DELETE are rejected by the
-- compliance.raise_immutable() trigger below as defense-in-depth on top
-- of the role grants U2 ships.
--
-- The 22-field envelope plus payload_oversize_s3_key (oversized payloads
-- spill to S3 with the key reference recorded here) and outbox_id (link
-- back to the originating outbox row, idempotency key for drainer
-- replay).
--
-- prev_hash is nullable: the genesis event in each tenant's chain has
-- no prior hash. event_hash is non-nullable: every row commits to its
-- own hash so the chain is verifiable from any anchor backwards.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance.audit_events (
  event_id uuid PRIMARY KEY NOT NULL,
  outbox_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  actor text NOT NULL,
  actor_type text NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  resource_type text,
  resource_id text,
  action text,
  outcome text,
  request_id text,
  thread_id uuid,
  agent_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_schema_version integer NOT NULL DEFAULT 1,
  control_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload_redacted_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload_oversize_s3_key text,
  prev_hash char(64),
  event_hash char(64) NOT NULL,
  CONSTRAINT audit_events_actor_type_allowed CHECK (
    actor_type IN ('user', 'system', 'agent')
  ),
  CONSTRAINT audit_events_event_type_prefix CHECK (
    event_type ~ '^(auth|user|agent|mcp|workspace|data|policy|approval)\.'
  )
);

COMMENT ON TABLE compliance.audit_events IS
  'Append-only audit-event log. Written ONLY by the U4 drainer Lambda. INSERT-only by role + immutability triggers. Per-tenant hash chain (prev_hash, event_hash). Tamper evidence anchored periodically by U8 to S3 Object Lock.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_events_event_id
  ON compliance.audit_events (event_id);

-- outbox_id UNIQUE provides drainer-replay idempotency: a re-invocation
-- on the same outbox row attempts an INSERT that conflicts and is
-- handled by ON CONFLICT (outbox_id) DO NOTHING in the drainer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_events_outbox_id
  ON compliance.audit_events (outbox_id);

-- Per-tenant time-ordered listing — admin Events list default sort.
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_occurred
  ON compliance.audit_events (tenant_id, occurred_at DESC);

-- Filter by event_type (R8) often combined with tenant + time.
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_event_type
  ON compliance.audit_events (tenant_id, event_type, occurred_at DESC);

-- Filter by actor (R8) — actor stored as opaque text id.
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON compliance.audit_events (actor);

-- Control-evidence exports filter by control_ids[] (e.g. CC6.1, CC8.1).
-- GIN supports `control_ids @> ARRAY['CC6.1']` membership lookups.
CREATE INDEX IF NOT EXISTS idx_audit_events_control_ids
  ON compliance.audit_events USING GIN (control_ids);

-- ---------------------------------------------------------------------------
-- compliance.actor_pseudonym
--
-- GDPR right-to-be-forgotten enabler (Decision #5). The audit chain
-- hashes the opaque `actor` text id, never PII. This table maps
-- actor_id → user_id + email_hash. RTBF erasure deletes the pseudonym
-- row; the chain remains valid (no audit_events row mutates) but
-- actor → person resolution is lost. EDPB recognizes this as effective
-- erasure when re-identification is no longer reasonably possible.
--
-- email_hash is sha256 of the lowercased email — supports typeahead
-- lookup in the admin Events list filter without storing plaintext.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance.actor_pseudonym (
  actor_id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  email_hash char(64),
  actor_type text NOT NULL,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT actor_pseudonym_actor_type_allowed CHECK (
    actor_type IN ('user', 'system', 'agent')
  )
);

COMMENT ON TABLE compliance.actor_pseudonym IS
  'Opaque actor_id ↔ user_id + email_hash mapping. GDPR RTBF: deleting a row breaks actor→person resolution while leaving the audit chain intact. Hash chain hashes actor_id, never PII.';

CREATE INDEX IF NOT EXISTS idx_actor_pseudonym_user
  ON compliance.actor_pseudonym (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_actor_pseudonym_email_hash
  ON compliance.actor_pseudonym (email_hash)
  WHERE email_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- compliance.export_jobs
--
-- Async CSV/JSON export tracking (R9, U11). createAuditExport mutation
-- inserts a queued row, sends an SQS message, and returns job_id. The
-- export-runner Lambda transitions queued → running → complete (or
-- failed), writes the multipart upload to a non-Object-Lock S3 prefix,
-- and publishes a 15-minute presigned URL.
--
-- 90-day max date range and 10/hour/admin rate limit are enforced at
-- the resolver layer (U11), not in the schema. The schema permits any
-- filter shape but the GraphQL mutation rejects out-of-bounds requests
-- before the row lands.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance.export_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  requested_by_actor_id uuid NOT NULL,
  filter jsonb NOT NULL,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  s3_key text,
  presigned_url text,
  presigned_url_expires_at timestamp with time zone,
  job_error text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  CONSTRAINT export_jobs_format_allowed CHECK (
    format IN ('csv', 'json')
  ),
  CONSTRAINT export_jobs_status_allowed CHECK (
    status IN ('queued', 'running', 'complete', 'failed')
  )
);

COMMENT ON TABLE compliance.export_jobs IS
  'Admin async-export job tracking. createAuditExport mutation enforces 90-day max range + 10/hour/admin rate limit before insert. export-runner Lambda streams CSV/NDJSON to S3 + publishes 15min presigned URL.';

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant_requested
  ON compliance.export_jobs (tenant_id, requested_at DESC);

-- Rate-limit check at the resolver layer queries by (tenant, actor, recent window).
CREATE INDEX IF NOT EXISTS idx_export_jobs_actor_requested
  ON compliance.export_jobs (tenant_id, requested_by_actor_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- Immutability trigger function + per-table triggers
--
-- Defense-in-depth on top of the role grants U2 ships. Even if the
-- writer role is mis-granted UPDATE/DELETE/TRUNCATE on audit_events
-- (config drift, mistaken break-glass grant, future privileged role),
-- the triggers RAISE EXCEPTION before the change applies.
--
-- TRUNCATE bypasses BEFORE DELETE triggers in Postgres — it has its own
-- BEFORE TRUNCATE trigger that fires FOR EACH STATEMENT. Without the
-- truncate trigger, an actor with TRUNCATE privilege could wipe the
-- entire audit log without producing the immutability error. The
-- trigger function below switches on TG_OP so a single function serves
-- ROW-level (UPDATE/DELETE) and STATEMENT-level (TRUNCATE) firings.
--
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER is the portable idempotent
-- pattern; CREATE OR REPLACE TRIGGER is Postgres 14+ but DROP IF EXISTS
-- works identically on every supported version.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compliance.raise_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'compliance.audit_events rows are immutable (TRUNCATE blocked)';
  END IF;
  RAISE EXCEPTION 'compliance.audit_events rows are immutable (event_id=%)', COALESCE(OLD.event_id::text, NEW.event_id::text);
END;
$$;

DROP TRIGGER IF EXISTS audit_events_block_update ON compliance.audit_events;
CREATE TRIGGER audit_events_block_update
BEFORE UPDATE ON compliance.audit_events
FOR EACH ROW
EXECUTE FUNCTION compliance.raise_immutable();

DROP TRIGGER IF EXISTS audit_events_block_delete ON compliance.audit_events;
CREATE TRIGGER audit_events_block_delete
BEFORE DELETE ON compliance.audit_events
FOR EACH ROW
EXECUTE FUNCTION compliance.raise_immutable();

DROP TRIGGER IF EXISTS audit_events_block_truncate ON compliance.audit_events;
CREATE TRIGGER audit_events_block_truncate
BEFORE TRUNCATE ON compliance.audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION compliance.raise_immutable();

COMMIT;
