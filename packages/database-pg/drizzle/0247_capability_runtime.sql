-- THINK-280 U1: governed capability runtime persistence.
--
-- Immutable definition/version records, tenant service principals,
-- per-version credential bindings, external confidential clients,
-- research/admission and Routine proposals, and append-only broker
-- session/call evidence. Shared semantics (descriptor shape, taxonomies,
-- fingerprints, twcap references) live in @thinkwork/capability-contracts.
--
-- Admitted definition versions are immutable: a trigger rejects UPDATEs that
-- touch anything but lifecycle/admission metadata once lifecycle = 'admitted',
-- and rejects DELETE outright. Refreshes create a new candidate version row.
--
-- Hand-rolled (CHECK constraints, trigger, precise FK ordering); not in
-- meta/_journal.json. Apply with: psql "$DATABASE_URL" -f <this file>.
-- creates: public.tenant_service_principals
-- creates: public.capability_definitions
-- creates: public.capability_definition_versions
-- creates: public.capability_credential_bindings
-- creates: public.capability_external_clients
-- creates: public.capability_connection_proposals
-- creates: public.capability_routine_proposals
-- creates: public.capability_broker_sessions
-- creates: public.capability_broker_calls
-- creates-column: public.capability_catalog.definition_version_id
-- creates-column: public.routines.capability_dependencies
-- creates-column: public.routines.execution_principal
-- creates-column: public.agent_loops.execution_principal
-- creates-column: public.routine_executions.execution_principal
-- creates-column: public.routine_code_cache.capability_dependencies

BEGIN;

-- ---------------------------------------------------------------------------
-- tenant_service_principals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_service_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  purpose text,
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_service_principals_status_check
    CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_service_principals_tenant_slug
  ON public.tenant_service_principals (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_tenant_service_principals_tenant
  ON public.tenant_service_principals (tenant_id);

-- ---------------------------------------------------------------------------
-- capability_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  class text NOT NULL,
  slug text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_definitions_status_check
    CHECK (status IN ('active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_definitions_identity
  ON public.capability_definitions (namespace, class, slug);
CREATE INDEX IF NOT EXISTS idx_capability_definitions_tenant
  ON public.capability_definitions (tenant_id);

-- ---------------------------------------------------------------------------
-- capability_definition_versions (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL
    REFERENCES public.capability_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  descriptor_json jsonb NOT NULL,
  descriptor_fingerprint text NOT NULL,
  contract_hashes_json jsonb NOT NULL,
  signature_json jsonb,
  lifecycle text NOT NULL DEFAULT 'candidate',
  provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_proposal_id uuid,
  admitted_at timestamptz,
  admitted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_definition_versions_lifecycle_check
    CHECK (lifecycle IN ('candidate', 'admitted', 'rejected', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_definition_versions_def_version
  ON public.capability_definition_versions (definition_id, version);
CREATE INDEX IF NOT EXISTS idx_capability_definition_versions_def
  ON public.capability_definition_versions (definition_id);
CREATE INDEX IF NOT EXISTS idx_capability_definition_versions_fingerprint
  ON public.capability_definition_versions (descriptor_fingerprint);

-- Admitted versions are immutable. Once lifecycle = 'admitted', the signed
-- payload columns can never change; only lifecycle may move forward
-- (admitted -> retired). Direct DELETEs are rejected (append-only history);
-- FK CASCADE deletes (definition/tenant removal) run inside the RI trigger
-- (pg_trigger_depth() > 1) and are allowed through.
CREATE OR REPLACE FUNCTION public.capability_definition_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'capability_definition_versions rows are append-only';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.lifecycle = 'admitted' THEN
    IF NEW.descriptor_json IS DISTINCT FROM OLD.descriptor_json
      OR NEW.descriptor_fingerprint IS DISTINCT FROM OLD.descriptor_fingerprint
      OR NEW.contract_hashes_json IS DISTINCT FROM OLD.contract_hashes_json
      OR NEW.signature_json IS DISTINCT FROM OLD.signature_json
      OR NEW.provenance_json IS DISTINCT FROM OLD.provenance_json
      OR NEW.source_proposal_id IS DISTINCT FROM OLD.source_proposal_id
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
      OR NEW.admitted_at IS DISTINCT FROM OLD.admitted_at
      OR NEW.admitted_by_user_id IS DISTINCT FROM OLD.admitted_by_user_id
    THEN
      RAISE EXCEPTION 'admitted capability definition versions are immutable';
    END IF;
    IF NEW.lifecycle NOT IN ('admitted', 'retired') THEN
      RAISE EXCEPTION 'admitted versions may only move to retired';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capability_definition_versions_immutable
  ON public.capability_definition_versions;
CREATE TRIGGER trg_capability_definition_versions_immutable
  BEFORE UPDATE OR DELETE ON public.capability_definition_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.capability_definition_versions_immutable();

-- ---------------------------------------------------------------------------
-- capability_credential_bindings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_credential_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_version_id uuid NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE CASCADE,
  principal_mode text NOT NULL,
  service_principal_id uuid
    REFERENCES public.tenant_service_principals(id) ON DELETE RESTRICT,
  subject_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  credential_refs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness text NOT NULL DEFAULT 'pending_setup',
  readiness_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_credential_bindings_mode_check
    CHECK (principal_mode IN ('requester', 'agent_owner', 'service')),
  CONSTRAINT capability_credential_bindings_readiness_check
    CHECK (readiness IN ('pending_setup', 'verifying', 'ready', 'degraded', 'revoked')),
  -- exactly one explicit subject per mode: service mode names a service
  -- principal and never a user; user modes never name a service principal
  CONSTRAINT capability_credential_bindings_subject_check
    CHECK (
      (principal_mode = 'service'
        AND service_principal_id IS NOT NULL
        AND subject_user_id IS NULL)
      OR
      (principal_mode IN ('requester', 'agent_owner')
        AND service_principal_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_capability_credential_bindings_tenant
  ON public.capability_credential_bindings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_credential_bindings_version
  ON public.capability_credential_bindings (definition_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_credential_bindings_subject
  ON public.capability_credential_bindings (
    definition_version_id,
    principal_mode,
    coalesce(service_principal_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(subject_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- capability_external_clients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_external_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_secret_hash text NOT NULL,
  service_principal_id uuid NOT NULL
    REFERENCES public.tenant_service_principals(id) ON DELETE RESTRICT,
  allowed_resource text NOT NULL,
  allowed_scopes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_external_clients_status_check
    CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_external_clients_client_id
  ON public.capability_external_clients (client_id);
CREATE INDEX IF NOT EXISTS idx_capability_external_clients_tenant
  ON public.capability_external_clients (tenant_id);

-- ---------------------------------------------------------------------------
-- capability_connection_proposals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_connection_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid
    REFERENCES public.capability_definitions(id) ON DELETE SET NULL,
  payload_json jsonb NOT NULL,
  payload_fingerprint text NOT NULL,
  provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  inbox_item_id uuid,
  created_by_actor_type text,
  created_by_actor_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_connection_proposals_status_check
    CHECK (status IN ('draft', 'submitted', 'admitted', 'rejected', 'superseded'))
);

CREATE INDEX IF NOT EXISTS idx_capability_connection_proposals_tenant
  ON public.capability_connection_proposals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_connection_proposals_definition
  ON public.capability_connection_proposals (definition_id);
CREATE INDEX IF NOT EXISTS idx_capability_connection_proposals_status
  ON public.capability_connection_proposals (tenant_id, status);

-- ---------------------------------------------------------------------------
-- capability_routine_proposals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_routine_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  routine_id uuid,
  payload_json jsonb NOT NULL,
  payload_fingerprint text NOT NULL,
  evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  inbox_item_id uuid,
  approval_mode text,
  approval_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor_type text,
  created_by_actor_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  promoted_commit_sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_routine_proposals_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'superseded', 'promoted')),
  CONSTRAINT capability_routine_proposals_approval_mode_check
    CHECK (approval_mode IS NULL OR approval_mode IN ('operator', 'repair'))
);

CREATE INDEX IF NOT EXISTS idx_capability_routine_proposals_tenant
  ON public.capability_routine_proposals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_routine_proposals_routine
  ON public.capability_routine_proposals (routine_id);
CREATE INDEX IF NOT EXISTS idx_capability_routine_proposals_status
  ON public.capability_routine_proposals (tenant_id, status);

-- ---------------------------------------------------------------------------
-- capability_broker_sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_broker_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  audience text NOT NULL,
  context_fingerprint text NOT NULL,
  principal_mode text NOT NULL,
  service_principal_id uuid
    REFERENCES public.tenant_service_principals(id) ON DELETE SET NULL,
  subject_user_id uuid,
  grant_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  budgets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  routine_execution_id uuid,
  thread_turn_id uuid,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_broker_sessions_mode_check
    CHECK (principal_mode IN ('requester', 'agent_owner', 'service')),
  CONSTRAINT capability_broker_sessions_status_check
    CHECK (status IN ('active', 'expired', 'cancelled', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_broker_sessions_session_id
  ON public.capability_broker_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_capability_broker_sessions_tenant
  ON public.capability_broker_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_broker_sessions_created
  ON public.capability_broker_sessions (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- capability_broker_calls (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.capability_broker_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  broker_session_id uuid NOT NULL
    REFERENCES public.capability_broker_sessions(id) ON DELETE CASCADE,
  client_request_id text NOT NULL,
  sequence bigint,
  operation_ref text,
  contract_hash text,
  definition_version_id uuid
    REFERENCES public.capability_definition_versions(id) ON DELETE SET NULL,
  binding_id uuid
    REFERENCES public.capability_credential_bindings(id) ON DELETE SET NULL,
  status text NOT NULL,
  policy_decisions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_digest text,
  result_digest text,
  error_category text,
  effect text,
  budget_delta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  adapter_kind text,
  duration_ms integer,
  durable_ref_json jsonb,
  routine_execution_id uuid,
  thread_turn_id uuid,
  compliance_event_id uuid,
  authorized_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_broker_calls_status_check
    CHECK (status IN ('rejected', 'authorized', 'completed', 'accepted', 'failed', 'indeterminate'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_broker_calls_session_request
  ON public.capability_broker_calls (broker_session_id, client_request_id);
CREATE INDEX IF NOT EXISTS idx_capability_broker_calls_tenant
  ON public.capability_broker_calls (tenant_id);
CREATE INDEX IF NOT EXISTS idx_capability_broker_calls_session
  ON public.capability_broker_calls (broker_session_id);
CREATE INDEX IF NOT EXISTS idx_capability_broker_calls_routine_exec
  ON public.capability_broker_calls (routine_execution_id);

-- ---------------------------------------------------------------------------
-- Additive columns on existing tables (legacy semantics unchanged)
-- ---------------------------------------------------------------------------

ALTER TABLE public.capability_catalog
  ADD COLUMN IF NOT EXISTS definition_version_id uuid
    REFERENCES public.capability_definition_versions(id) ON DELETE SET NULL;

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS capability_dependencies jsonb,
  ADD COLUMN IF NOT EXISTS execution_principal jsonb;

ALTER TABLE public.agent_loops
  ADD COLUMN IF NOT EXISTS execution_principal jsonb;

ALTER TABLE public.routine_executions
  ADD COLUMN IF NOT EXISTS execution_principal jsonb;

ALTER TABLE public.routine_code_cache
  ADD COLUMN IF NOT EXISTS capability_dependencies jsonb;

COMMIT;
