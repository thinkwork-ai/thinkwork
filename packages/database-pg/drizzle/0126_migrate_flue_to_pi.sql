-- Runtime selector rename: flue -> pi.
--
-- creates-constraint: public.agents.agents_runtime_check
-- creates-constraint: public.agent_templates.agent_templates_runtime_check

\echo '== runtime selector rename: flue -> pi =='

\echo '-- allowing strands, pi, and legacy flue during backfill --'

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

ALTER TABLE agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

\echo '-- updating agents.runtime: flue -> pi --'

UPDATE agents
SET runtime = 'pi', updated_at = NOW()
WHERE runtime = 'flue';

\echo '-- updating agent_templates.runtime: flue -> pi --'

UPDATE agent_templates
SET runtime = 'pi', updated_at = NOW()
WHERE runtime = 'flue';

\echo '-- tightening runtime CHECK constraints to strands/pi --'

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi'));

ALTER TABLE agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi'));
