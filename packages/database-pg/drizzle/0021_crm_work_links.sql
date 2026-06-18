-- CRM work links for Twenty-native launch/resume proof.
-- creates: public.crm_work_links
-- creates: public.uq_crm_work_links_active_outcome
-- creates: public.idx_crm_work_links_thread
-- creates: public.idx_crm_work_links_goal
-- creates: public.idx_crm_work_links_provider_record
-- creates-constraint: public.crm_work_links_provider_allowed
-- creates-constraint: public.crm_work_links_object_type_allowed
-- creates-constraint: public.crm_work_links_workflow_key_allowed
-- creates-constraint: public.crm_work_links_state_allowed
-- creates-constraint: public.crm_work_links_status_handle_state_allowed
-- creates-constraint: public.crm_work_links_last_writeback_state_allowed

CREATE TABLE IF NOT EXISTS public.crm_work_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  object_url text,
  workflow_key text NOT NULL,
  outcome_key text NOT NULL DEFAULT 'default',
  space_id uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  requester_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_writeback_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  plugin_install_id uuid REFERENCES public.plugin_installs(id) ON DELETE SET NULL,
  mcp_server_id uuid REFERENCES public.tenant_mcp_servers(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'active',
  status_handle_state text NOT NULL DEFAULT 'pending',
  status_handle_url text,
  status_handle_action text,
  last_writeback_state text NOT NULL DEFAULT 'pending',
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_resumed_at timestamptz,
  deactivated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_work_links_provider_allowed
    CHECK (provider IN ('twenty')),
  CONSTRAINT crm_work_links_object_type_allowed
    CHECK (object_type IN ('opportunity')),
  CONSTRAINT crm_work_links_workflow_key_allowed
    CHECK (workflow_key IN ('customer_onboarding')),
  CONSTRAINT crm_work_links_state_allowed
    CHECK (state IN ('starting','active','completed','cancelled','failed','archived')),
  CONSTRAINT crm_work_links_status_handle_state_allowed
    CHECK (status_handle_state IN ('pending','posted','requires_reauth','writeback_blocked','failed')),
  CONSTRAINT crm_work_links_last_writeback_state_allowed
    CHECK (last_writeback_state IN ('pending','posted','requires_reauth','blocked','failed','skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_work_links_active_outcome
  ON public.crm_work_links (
    tenant_id,
    provider,
    object_type,
    object_id,
    workflow_key,
    outcome_key
  )
  WHERE state IN ('starting','active');

CREATE INDEX IF NOT EXISTS idx_crm_work_links_thread
  ON public.crm_work_links (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_crm_work_links_goal
  ON public.crm_work_links (tenant_id, goal_id);

CREATE INDEX IF NOT EXISTS idx_crm_work_links_provider_record
  ON public.crm_work_links (tenant_id, provider, object_type, object_id);
