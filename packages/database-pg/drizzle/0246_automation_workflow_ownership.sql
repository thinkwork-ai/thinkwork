-- Automations are private to their owning user on the main product surface.
-- Canonical Workflow projections previously inherited the workflows table
-- defaults (tenant_shared + no owner), which made a linked Automation callable
-- through triggerWorkflowRun even when the AgentLoop path was owner-scoped.
--
-- Reassert the source AgentLoop's ownership on every existing projection and
-- make all Automation-backed Workflows private. An ownerless legacy row then
-- fails closed at invocation instead of becoming tenant-callable.
--
-- Hand-rolled data backfill + partial owner index; not in meta/_journal.json.
-- creates: public.workflows_source_owner_idx

UPDATE public.workflows AS workflow
SET
  visibility = 'agent_private',
  owner_user_id = automation.owner_user_id,
  owner_agent_id = automation.owner_agent_id,
  updated_at = now()
FROM public.agent_loops AS automation
WHERE workflow.tenant_id = automation.tenant_id
  AND workflow.source_agent_loop_id = automation.id
  AND (
    workflow.visibility IS DISTINCT FROM 'agent_private'
    OR workflow.owner_user_id IS DISTINCT FROM automation.owner_user_id
    OR workflow.owner_agent_id IS DISTINCT FROM automation.owner_agent_id
  );

CREATE INDEX IF NOT EXISTS workflows_source_owner_idx
  ON public.workflows (tenant_id, owner_user_id)
  WHERE source_agent_loop_id IS NOT NULL;
