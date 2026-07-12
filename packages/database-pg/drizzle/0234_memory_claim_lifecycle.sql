-- THINK-193 U2: external-memory claim lifecycle.
-- Contents:
--   * memory_source_authorizations — explicit grant, the MAXIMUM readable
--     envelope per (processor, family, binding) (partial unique on active).
--   * memory_claims — durable ontology-shaped claims with a null-safe
--     fingerprint unique index (COALESCE folds NULL effective_from).
--   * memory_claim_evidence — many-to-many claim <- evidence support edges.
--   * memory_retraction_attempts — idempotent multi-system retraction ledger
--     (retain-attempts-shaped: status/attempt/lock columns, partial unique so
--     a completed retraction can be re-queued later).
--   * memory_evidence_items.snapshot_expires_at — app-enforced S3 snapshot TTL.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0234_memory_claim_lifecycle.sql
-- creates: public.memory_source_authorizations
-- creates: public.memory_claims
-- creates: public.memory_claim_evidence
-- creates: public.memory_retraction_attempts
-- creates-column: public.memory_evidence_items.snapshot_expires_at

CREATE TABLE IF NOT EXISTS public.memory_source_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  processor_config_id uuid NOT NULL
    REFERENCES public.memory_processor_configs(id) ON DELETE CASCADE,
  source_family text NOT NULL,
  source_binding_key text NOT NULL,
  boundary jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  grant_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  revoked_at timestamptz,
  sensitivity jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_source_authorizations_source_family_check
    CHECK (source_family IN ('twenty', 'firecrawl', 'email', 'bedrock_kb')),
  CONSTRAINT memory_source_authorizations_status_check
    CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_source_authorizations_active_uidx
  ON public.memory_source_authorizations (processor_config_id, source_family, source_binding_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS memory_source_authorizations_tenant_idx
  ON public.memory_source_authorizations (tenant_id);

CREATE TABLE IF NOT EXISTS public.memory_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_scope text NOT NULL,
  target_id uuid NOT NULL,
  canonical_subject_id uuid,
  subject_key text NOT NULL,
  subject_entity_type text NOT NULL DEFAULT 'customer',
  ontology_predicate text NOT NULL,
  value jsonb NOT NULL,
  value_hash text NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz,
  status text NOT NULL DEFAULT 'active',
  conflict_state text NOT NULL DEFAULT 'none',
  extraction_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_claims_target_scope_check
    CHECK (target_scope IN ('space', 'tenant')),
  CONSTRAINT memory_claims_status_check
    CHECK (status IN ('active', 'superseded', 'retracted')),
  CONSTRAINT memory_claims_conflict_state_check
    CHECK (conflict_state IN ('none', 'conflicted'))
);

-- Null-safe fingerprint: COALESCE folds NULL effective_from into '-infinity'
-- so duplicate open-ended claims collide instead of coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS memory_claims_fingerprint_uidx
  ON public.memory_claims (
    tenant_id,
    target_scope,
    target_id,
    subject_key,
    ontology_predicate,
    value_hash,
    COALESCE(effective_from, '-infinity'::timestamptz)
  );

CREATE INDEX IF NOT EXISTS memory_claims_target_subject_idx
  ON public.memory_claims (tenant_id, target_scope, target_id, subject_key);

CREATE INDEX IF NOT EXISTS memory_claims_tenant_status_idx
  ON public.memory_claims (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.memory_claim_evidence (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL
    REFERENCES public.memory_claims(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL
    REFERENCES public.memory_evidence_items(id) ON DELETE CASCADE,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  retracted_at timestamptz,
  CONSTRAINT memory_claim_evidence_status_check
    CHECK (status IN ('active', 'retracted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_claim_evidence_pair_uidx
  ON public.memory_claim_evidence (claim_id, evidence_item_id);

CREATE INDEX IF NOT EXISTS memory_claim_evidence_evidence_idx
  ON public.memory_claim_evidence (evidence_item_id);

CREATE INDEX IF NOT EXISTS memory_claim_evidence_claim_status_idx
  ON public.memory_claim_evidence (claim_id, status);

CREATE TABLE IF NOT EXISTS public.memory_retraction_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  derivation_id uuid REFERENCES public.memory_derivations(id) ON DELETE SET NULL,
  source_config_id uuid NOT NULL
    REFERENCES public.memory_source_configs(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'hindsight',
  provider_document_id text NOT NULL,
  target_bank_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  error_class text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT memory_retraction_attempts_scope_check
    CHECK (scope IN ('derivation', 'source')),
  CONSTRAINT memory_retraction_attempts_status_check
    CHECK (status IN ('queued', 'running', 'supports_updated', 'provider_deleted', 'reconsolidated', 'retracted', 'failed', 'dead_lettered')),
  CONSTRAINT memory_retraction_attempts_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT memory_retraction_attempts_max_attempts_positive
    CHECK (max_attempts > 0)
);

-- Partial unique — a completed retraction can be re-queued later.
CREATE UNIQUE INDEX IF NOT EXISTS memory_retraction_attempts_document_uidx
  ON public.memory_retraction_attempts (tenant_id, provider, provider_document_id)
  WHERE status NOT IN ('retracted', 'dead_lettered');

CREATE INDEX IF NOT EXISTS memory_retraction_attempts_due_idx
  ON public.memory_retraction_attempts (status, next_retry_at, created_at);

ALTER TABLE public.memory_evidence_items
  ADD COLUMN IF NOT EXISTS snapshot_expires_at timestamptz;
