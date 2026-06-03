-- Retire legacy active Agent runtime values and make Pi the only stored runtime.
--
-- creates-constraint: public.agents.agents_runtime_check
-- creates-constraint: public.agent_templates.agent_templates_runtime_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

SELECT pg_advisory_xact_lock(hashtext('pi_only_agent_runtime'));

\echo '-- allowing legacy runtime values during backfill --'

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

ALTER TABLE public.agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

\echo '-- backfilling agents.runtime to pi --'

UPDATE public.agents
SET runtime = 'pi',
    updated_at = NOW()
WHERE runtime IN ('strands', 'flue');

\echo '-- backfilling agent_templates.runtime to pi --'

UPDATE public.agent_templates
SET runtime = 'pi',
    updated_at = NOW()
WHERE runtime IN ('strands', 'flue');

\echo '-- setting pi runtime defaults --'

ALTER TABLE public.agents
  ALTER COLUMN runtime SET DEFAULT 'pi';

ALTER TABLE public.agent_templates
  ALTER COLUMN runtime SET DEFAULT 'pi';

\echo '-- tightening runtime CHECK constraints to pi-only --'

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime = 'pi');

ALTER TABLE public.agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime = 'pi');

COMMIT;
