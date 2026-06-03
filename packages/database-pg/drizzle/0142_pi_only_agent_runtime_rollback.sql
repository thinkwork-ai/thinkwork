-- Roll back Pi-only runtime constraints to the prior strands/pi compatibility window.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

SELECT pg_advisory_xact_lock(hashtext('pi_only_agent_runtime'));

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi'));

ALTER TABLE public.agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi'));

ALTER TABLE public.agents
  ALTER COLUMN runtime SET DEFAULT 'pi';

ALTER TABLE public.agent_templates
  ALTER COLUMN runtime SET DEFAULT 'pi';

COMMIT;
