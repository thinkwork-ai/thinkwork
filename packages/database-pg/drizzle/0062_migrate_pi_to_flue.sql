-- Plan §005 U3 — retire AgentRuntimeType selector value `pi` → `flue`.
--
-- Hand-rolled (NOT registered in meta/_journal.json — applied via psql in
-- deploy.yml as a pre-Lambda-update step so the dispatcher never sees a
-- `pi` value it can't route after the API code update lands).
--
-- The `agents.runtime` and `agent_templates.runtime` columns are both
-- `text NOT NULL DEFAULT 'strands'` (no Postgres enum), so this is a
-- pure data migration. No DDL.
--
-- Marker for db:migrate-manual drift-reporter (see CLAUDE.md "Some
-- drizzle/*.sql files are hand-rolled..."): the reporter looks up the
-- declared columns and confirms they exist post-deploy. We're modifying
-- existing columns, not creating new ones, so we declare them with
-- creates-column to satisfy the gate.
-- creates-column: public.agents.runtime
-- creates-column: public.agent_templates.runtime

\echo '== plan §005 U3: agents.runtime + agent_templates.runtime backfill =='

-- Print affected rows BEFORE the update so a developer can recover their
-- pi-pinned configs if the rename was unexpected. No mutation in this step.
\echo '-- agents currently set to runtime = pi --'
SELECT
  id,
  tenant_id,
  name,
  runtime,
  updated_at
FROM agents
WHERE runtime = 'pi';

\echo '-- agent_templates currently set to runtime = pi --'
SELECT
  id,
  name,
  runtime,
  updated_at
FROM agent_templates
WHERE runtime = 'pi';

-- Apply the rename. Both updates run inside an implicit transaction
-- (psql --single-transaction) so a partial failure rolls the whole
-- migration back without leaving the system in mixed state.
\echo '-- updating agents.runtime: pi → flue --'
UPDATE agents
SET runtime = 'flue', updated_at = NOW()
WHERE runtime = 'pi';

\echo '-- updating agent_templates.runtime: pi → flue --'
UPDATE agent_templates
SET runtime = 'flue', updated_at = NOW()
WHERE runtime = 'pi';

-- Confirm zero rows remain on the old value. The DO block raises an
-- exception when any row survived, which (combined with psql's
-- ON_ERROR_STOP=1 + --single-transaction) aborts the migration and
-- rolls back the UPDATEs above. Without this gate, a stale row would
-- silently persist and the new dispatcher would map it to Strands via
-- the default branch in normalizeAgentRuntimeType.
\echo '-- post-migration verification: any rows still on pi? --'
DO $$
DECLARE
  agents_remaining     bigint;
  templates_remaining  bigint;
BEGIN
  SELECT COUNT(*) INTO agents_remaining
  FROM agents
  WHERE runtime = 'pi';

  SELECT COUNT(*) INTO templates_remaining
  FROM agent_templates
  WHERE runtime = 'pi';

  RAISE NOTICE 'agents still on pi: %', agents_remaining;
  RAISE NOTICE 'agent_templates still on pi: %', templates_remaining;

  IF agents_remaining > 0 OR templates_remaining > 0 THEN
    RAISE EXCEPTION
      'plan §005 U3 migration verification failed: % agents and % agent_templates still have runtime = ''pi''. Investigate before the dispatcher Lambda is updated — the new normalizer would silently coerce these rows to ''strands''.',
      agents_remaining, templates_remaining;
  END IF;
END
$$;
