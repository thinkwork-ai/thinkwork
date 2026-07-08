-- THINK-216: Automations (agent_loops) migrate to canonical workflows.
-- Hand-rolled (db:generate is retired).
--   workflows.source_agent_loop_id — idempotency + provenance link for the
--     migration (one workflow per migrated loop; plain uuid, no FK, so the
--     eventual agent_loops DROP needs no dependent-constraint ordering).
--   webhooks.workflow_id — webhook rows repointed from an Automation to its
--     workflow; the webhooks handler's `workflow` target branch starts a
--     shared-interpreter run.
-- creates-column: public.workflows.source_agent_loop_id
-- creates-column: public.webhooks.workflow_id
-- creates: public.workflows_source_agent_loop_uidx

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS source_agent_loop_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS workflows_source_agent_loop_uidx
  ON public.workflows (tenant_id, source_agent_loop_id)
  WHERE source_agent_loop_id IS NOT NULL;

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE;
