-- creates: public.agent_template_runbook_assignments
-- creates: public.uq_agent_templates_tenant_id_id
-- creates: public.tenant_runbook_catalog_tenant_id_id_uq
-- creates: public.uq_agent_template_runbook_assignments
-- creates: public.idx_agent_template_runbook_assignments_template
-- creates: public.idx_agent_template_runbook_assignments_catalog

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_templates_tenant_id_id
  ON public.agent_templates (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_runbook_catalog_tenant_id_id_uq
  ON public.tenant_runbook_catalog (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.agent_template_runbook_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_agent_template_runbook_assignments_template_tenant
    FOREIGN KEY (tenant_id, template_id)
    REFERENCES public.agent_templates (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_agent_template_runbook_assignments_catalog_tenant
    FOREIGN KEY (tenant_id, catalog_id)
    REFERENCES public.tenant_runbook_catalog (tenant_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_template_runbook_assignments
  ON public.agent_template_runbook_assignments (template_id, catalog_id);

CREATE INDEX IF NOT EXISTS idx_agent_template_runbook_assignments_template
  ON public.agent_template_runbook_assignments (template_id);

CREATE INDEX IF NOT EXISTS idx_agent_template_runbook_assignments_catalog
  ON public.agent_template_runbook_assignments (catalog_id);
