-- Resolved capability manifest context columns (capability-mapping plan U11).
-- Additive: turn/context identity + config fingerprint on the append-only
-- manifest audit table, plus the covering index for "newest manifest matching
-- context" retrieval (U13) and the retention sweep's tenant+created_at range.
-- Plain uuids, deliberately NOT foreign keys — matching template_id/user_id on
-- the same table: audit rows must survive deletion of their source rows.
-- creates-column: public.resolved_capability_manifests.thread_id
-- creates-column: public.resolved_capability_manifests.thread_turn_id
-- creates-column: public.resolved_capability_manifests.space_id
-- creates-column: public.resolved_capability_manifests.agent_profile_id
-- creates-column: public.resolved_capability_manifests.config_fingerprint
-- creates: public.idx_rcm_context

ALTER TABLE public.resolved_capability_manifests
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS thread_turn_id uuid,
  ADD COLUMN IF NOT EXISTS space_id uuid,
  ADD COLUMN IF NOT EXISTS agent_profile_id uuid,
  ADD COLUMN IF NOT EXISTS config_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_rcm_context
  ON public.resolved_capability_manifests (
    tenant_id,
    agent_id,
    space_id,
    agent_profile_id,
    created_at
  );
