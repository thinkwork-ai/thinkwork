-- creates-trigger: public.tool_execution_events.trg_reject_tool_execution_event_mutation
-- Thread deletion was impossible for any thread whose agent ran tools: the
-- ledger declares thread_id/turn_id/tenant_id FKs ON DELETE CASCADE, but the
-- append-only guard trigger fired on the cascaded DELETE too and aborted the
-- whole deleteThread transaction with `tool_execution_events_are_append_only`.
--
-- Recreate the guard with WHEN (pg_trigger_depth() = 0): direct UPDATE/DELETE
-- statements are still rejected (the WHEN clause sees depth 0 and the guard
-- raises), while deletes arriving through FK referential-action triggers run
-- at depth >= 1 and are allowed — which is exactly the lifecycle the CASCADE
-- clauses on this table already promised.
DROP TRIGGER IF EXISTS trg_reject_tool_execution_event_mutation
  ON public.tool_execution_events;
CREATE TRIGGER trg_reject_tool_execution_event_mutation
BEFORE UPDATE OR DELETE ON public.tool_execution_events
FOR EACH ROW
WHEN (pg_trigger_depth() = 0)
EXECUTE FUNCTION public.reject_tool_execution_event_mutation();
