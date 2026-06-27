-- Add Open Engine queue state to native Work Items.
--
-- Work Items are the persisted queue substrate for ThinkWork Open Engine:
-- agents can discover eligible items by queue key, claim them with expiring
-- leases, and respect human holds independently of generic blocked state.
--
-- creates-column: public.work_items.open_engine_enabled
-- creates-column: public.work_items.open_engine_queue_key
-- creates-column: public.work_items.open_engine_claimed_by_agent_id
-- creates-column: public.work_items.open_engine_claimed_at
-- creates-column: public.work_items.open_engine_claim_expires_at
-- creates-column: public.work_items.open_engine_human_hold
-- creates-column: public.work_items.open_engine_human_hold_reason
-- creates-column: public.work_items.open_engine_scheduled_at
-- creates-column: public.work_items.open_engine_dependency_state
-- creates-column: public.work_items.open_engine_routing
-- creates: public.idx_work_items_open_engine_ready
-- creates: public.idx_work_items_open_engine_claim
-- creates-constraint: public.work_items.work_items_open_engine_dependency_state_allowed

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS open_engine_enabled boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS open_engine_queue_key text,
  ADD COLUMN IF NOT EXISTS open_engine_claimed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE set null,
  ADD COLUMN IF NOT EXISTS open_engine_claimed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS open_engine_claim_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS open_engine_human_hold boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS open_engine_human_hold_reason text,
  ADD COLUMN IF NOT EXISTS open_engine_scheduled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS open_engine_dependency_state text DEFAULT 'ready' NOT NULL,
  ADD COLUMN IF NOT EXISTS open_engine_routing jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_items_open_engine_dependency_state_allowed'
      AND conrelid = 'public.work_items'::regclass
  ) THEN
    ALTER TABLE public.work_items
      ADD CONSTRAINT work_items_open_engine_dependency_state_allowed
      CHECK (open_engine_dependency_state IN ('ready', 'waiting'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_items_open_engine_ready
  ON public.work_items (
    tenant_id,
    open_engine_queue_key,
    open_engine_scheduled_at,
    open_engine_claim_expires_at,
    updated_at
  )
  WHERE open_engine_enabled = true
    AND archived_at IS NULL
    AND open_engine_human_hold = false
    AND blocked = false
    AND open_engine_dependency_state = 'ready';

CREATE INDEX IF NOT EXISTS idx_work_items_open_engine_claim
  ON public.work_items (
    tenant_id,
    open_engine_claimed_by_agent_id,
    open_engine_claim_expires_at
  );
