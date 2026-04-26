-- creates-constraint: public.agent_workspace_events.agent_workspace_events_type_check

ALTER TABLE public.agent_workspace_events
DROP CONSTRAINT IF EXISTS agent_workspace_events_type_check;

ALTER TABLE public.agent_workspace_events
ADD CONSTRAINT agent_workspace_events_type_check CHECK (
  event_type IN (
    'work.requested',
    'run.started',
    'run.blocked',
    'run.completed',
    'run.failed',
    'review.requested',
    'review.responded',
    'memory.changed',
    'event.rejected'
  )
);
