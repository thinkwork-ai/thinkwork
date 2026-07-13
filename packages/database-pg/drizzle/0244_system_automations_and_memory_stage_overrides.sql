-- THINK-264: Personal Memory Processing becomes a first-class system Automation.
--
-- Two independent additions:
--
-- 1. agent_loops.kind / .system_key — platform-provisioned Automations. A
--    `system` row renders in the Automations inventory like any other, can be
--    enabled/disabled, but is never hand-created and never deletable. The
--    partial unique index makes ensure-on-read provisioning idempotent under
--    concurrency (two parallel reads cannot mint two personal-memory loops).
--
-- 2. memory_processor_configs.stage_overrides — per-stage toggles for the
--    optional tail of the memory pipeline (compound/graph/wiki). The
--    acquire → project → resolve → retain spine is deliberately NOT
--    disableable; see the app-side TOGGLEABLE_MEMORY_STAGES allowlist, which
--    is the enforcement point. This column only stores intent.
--
-- Hand-rolled (partial unique index + CHECKs); not in meta/_journal.json.
--
-- creates-column: public.agent_loops.kind
-- creates-column: public.agent_loops.system_key
-- creates-column: public.memory_processor_configs.stage_overrides
-- creates: public.agent_loops_system_owner_uidx

ALTER TABLE public.agent_loops
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS system_key text;

ALTER TABLE public.agent_loops
  DROP CONSTRAINT IF EXISTS agent_loops_kind_check;
ALTER TABLE public.agent_loops
  ADD CONSTRAINT agent_loops_kind_check CHECK (kind IN ('user', 'system'));

-- A system row is exactly identified by its key; a user row must not carry one.
ALTER TABLE public.agent_loops
  DROP CONSTRAINT IF EXISTS agent_loops_system_key_check;
ALTER TABLE public.agent_loops
  ADD CONSTRAINT agent_loops_system_key_check
  CHECK ((kind = 'system') = (system_key IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS agent_loops_system_owner_uidx
  ON public.agent_loops (tenant_id, system_key, owner_user_id)
  WHERE system_key IS NOT NULL;

ALTER TABLE public.memory_processor_configs
  ADD COLUMN IF NOT EXISTS stage_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
