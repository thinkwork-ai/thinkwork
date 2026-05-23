-- Rollback for 0126_migrate_flue_to_pi.sql.

\echo '== runtime selector rename rollback: pi -> flue =='

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_runtime_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

ALTER TABLE agent_templates DROP CONSTRAINT IF EXISTS agent_templates_runtime_check;
ALTER TABLE agent_templates
  ADD CONSTRAINT agent_templates_runtime_check
  CHECK (runtime IN ('strands', 'pi', 'flue'));

UPDATE agents
SET runtime = 'flue', updated_at = NOW()
WHERE runtime = 'pi';

UPDATE agent_templates
SET runtime = 'flue', updated_at = NOW()
WHERE runtime = 'pi';
