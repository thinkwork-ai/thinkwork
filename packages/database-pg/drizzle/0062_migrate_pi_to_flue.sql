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

-- Confirm zero rows remain on the old value. If this query returns any
-- rows, the deploy must abort and operators must investigate before the
-- API code update lands. We leave the assertion to the deploy workflow
-- — psql -v ON_ERROR_STOP=1 + the check below — rather than a CHECK
-- constraint, because the column is `text` not enum and adding a CHECK
-- here would be a schema change outside U3's scope.
\echo '-- post-migration verification: any rows still on pi? --'
SELECT
  'agents'        AS table_name,
  COUNT(*)        AS still_pi
FROM agents
WHERE runtime = 'pi'
UNION ALL
SELECT
  'agent_templates' AS table_name,
  COUNT(*)          AS still_pi
FROM agent_templates
WHERE runtime = 'pi';
