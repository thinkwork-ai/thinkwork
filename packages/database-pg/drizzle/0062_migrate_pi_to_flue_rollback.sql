-- Rollback for 0062_migrate_pi_to_flue.sql.
-- Reverses the agents/agent_templates runtime backfill (flue → pi) so a
-- pre-U3 build of the API can dispatch the rows again. ONLY usable while
-- the U3 API code is still rolled back; once the new dispatcher lands and
-- old rows have been re-pi'd, runtime "pi" will route via the new
-- dispatcher path which throws RuntimeNotProvisionedError because the
-- selector value is no longer in the AgentRuntimeType union.

\echo '== plan §005 U3 rollback: flue → pi =='

UPDATE agents
SET runtime = 'pi', updated_at = NOW()
WHERE runtime = 'flue';

UPDATE agent_templates
SET runtime = 'pi', updated_at = NOW()
WHERE runtime = 'flue';
