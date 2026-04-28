-- Defensive unique index on external task correlation key.
--
-- Background: a single external task-create can fire multiple webhooks in quick
-- succession (task.created + assigned/status_changed/updated). Each
-- lambda invocation races to ensure the thread; without a uniqueness
-- guarantee, concurrent inserts all succeed and we end up with 4
-- duplicate threads for the same external task. The application-side
-- fix (in-process stamping in chat-agent-invoke) closes the race for
-- MCP-driven creates, but this index is the backstop for any other
-- code path that could hit the race.
--
-- Partial index — only enforces when the external task id is
-- populated, so pre-sync threads (metadata.workflowId set, no
-- externalTaskId yet) remain unconstrained.
--
-- Heads up for operators: if there are existing duplicate rows with
-- the same (tenant_id, externalTaskId), this CREATE will fail. Clean
-- up duplicates manually before applying this migration, e.g.
--   SELECT tenant_id, metadata->'external'->>'externalTaskId' AS eid,
--          COUNT(*), array_agg(id ORDER BY created_at) AS ids
--     FROM threads
--    WHERE metadata->'external'->>'externalTaskId' IS NOT NULL
--    GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- then delete all but the first id per group.

CREATE UNIQUE INDEX IF NOT EXISTS "threads_tenant_external_task_id_unique"
  ON "threads" (
    "tenant_id",
    ((metadata -> 'external' ->> 'externalTaskId'))
  )
  WHERE (metadata -> 'external' ->> 'externalTaskId') IS NOT NULL;
