-- User brain claims (THINK-625): per-(tenant, user) Company Brain
-- authorization, the write side of the user-claims/v1 manifest published to
-- `user-claims/<tenantId>/latest.json` in the brain-artifacts bucket.
--
-- Ships three things that must land together, because the publisher is
-- useless without the safety interlock and the audit row cannot be written
-- without the widened event-type constraint:
--   1. the user_brain_claims table,
--   2. tenant_settings.brain_user_claims_enabled (default false),
--   3. the tenant_policy_events event_type CHECK widened to accept
--      'user_brain_claims' (renamed to _v2 so drift is detectable).
--
-- Hand-rolled (partial-index-free but with a NULL-vs-empty array column the
-- generator flattens; mirrors the 0274/0281/0282 convention). Not registered
-- in meta/_journal.json.
-- Apply via: psql "$DATABASE_URL" -f drizzle/0284_user_brain_claims.sql
-- creates: public.user_brain_claims
-- creates: public.uq_user_brain_claims_tenant_user
-- creates: public.idx_user_brain_claims_tenant
-- creates-column: public.tenant_settings.brain_user_claims_enabled
-- creates-constraint: public.tenant_policy_events.tenant_policy_events_event_type_allowed_v2

CREATE TABLE IF NOT EXISTS public.user_brain_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- '[]' = PUBLIC graph only; ARRAY['*'] = every group.
  security_groups text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- KB is grant-only: '[]' = no KB at all; ARRAY['*'] = every collection.
  kb_collections text[] NOT NULL DEFAULT ARRAY[]::text[],
  kb_bundles jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_kb_bundle text,
  -- NULL is DISTINCT from '{}': NULL = the Brain surface default applies,
  -- '{}' = no tools at all. Never coalesce one into the other.
  tool_allowlist text[],
  is_operator boolean NOT NULL DEFAULT false,
  kb_trace boolean NOT NULL DEFAULT false,
  -- false still publishes an entry (disabled: true) so the Brain fails
  -- closed rather than falling back to legacy group grants.
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_brain_claims_tenant_user
  ON public.user_brain_claims (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_brain_claims_tenant
  ON public.user_brain_claims (tenant_id);

-- Per-tenant enable flag. Default false everywhere: claims rows are
-- editable with no publish until an operator flips this on.
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS brain_user_claims_enabled boolean NOT NULL DEFAULT false;

-- Widen the audited event types. The old constraint is dropped and a
-- freshly-named one created so `pnpm db:migrate-manual` can prove the
-- widened version is actually present in the target database.
ALTER TABLE public.tenant_policy_events
  DROP CONSTRAINT IF EXISTS tenant_policy_events_event_type_allowed;

ALTER TABLE public.tenant_policy_events
  DROP CONSTRAINT IF EXISTS tenant_policy_events_event_type_allowed_v2;

ALTER TABLE public.tenant_policy_events
  ADD CONSTRAINT tenant_policy_events_event_type_allowed_v2
  CHECK (event_type IN ('sandbox_enabled','compliance_tier','user_brain_claims'));
