-- creates-constraint: public.agents.agents_runtime_check
-- Canonicalize the application runtime identifier from the proof-era
-- `harness` token to `agentcore`. AWS resource names, OAuth scopes, and
-- diagnostics may still use Harness terminology; persisted runtime routing
-- state must not.
--
-- Hand-rolled (NOT registered in meta/_journal.json) — apply via psql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0263_agentcore_runtime_identifier.sql

BEGIN;

UPDATE public.agents
SET runtime = 'agentcore'
WHERE lower(runtime) = 'harness';

UPDATE public.agents
SET runtime_config = jsonb_set(
  runtime_config,
  '{defaultThreadRuntime}',
  '"agentcore"'::jsonb,
  true
)
WHERE jsonb_typeof(runtime_config) = 'object'
  AND lower(runtime_config ->> 'defaultThreadRuntime') = 'harness';

UPDATE public.threads
SET metadata = jsonb_set(
  metadata,
  '{requestedRuntime}',
  '"agentcore"'::jsonb,
  true
)
WHERE jsonb_typeof(metadata) = 'object'
  AND lower(metadata ->> 'requestedRuntime') = 'harness';

UPDATE public.messages
SET metadata = jsonb_set(
  metadata,
  '{requestedRuntime}',
  '"agentcore"'::jsonb,
  true
)
WHERE jsonb_typeof(metadata) = 'object'
  AND lower(metadata ->> 'requestedRuntime') = 'harness';

UPDATE public.thread_turns
SET runtime_type = 'agentcore'
WHERE lower(runtime_type) = 'harness';

UPDATE public.cost_events
SET runtime_type = 'agentcore'
WHERE lower(runtime_type) = 'harness';

UPDATE public.trace_runs
SET runtime_type = 'agentcore'
WHERE lower(runtime_type) = 'harness';

UPDATE public.harness_managed_thread_enrollments
SET prior_runtime = 'agentcore'
WHERE lower(prior_runtime) = 'harness';

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_runtime_check;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'flue', 'pi', 'agentcore'));

COMMIT;
