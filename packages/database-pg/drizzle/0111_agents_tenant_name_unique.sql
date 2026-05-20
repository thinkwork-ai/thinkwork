-- Purpose: make agent names tenant-unique so they can serve as mention identities.
-- Plan: docs/plans/2026-05-20-001-fix-agent-mentions-and-unread-routing-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0111_agents_tenant_name_unique.sql
-- creates: public.uq_agents_tenant_name_active

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO duplicate_count
  FROM (
    SELECT tenant_id, lower(trim(name)) AS normalized_name
    FROM public.agents
    WHERE status <> 'archived'
    GROUP BY tenant_id, lower(trim(name))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create uq_agents_tenant_name_active: % active tenant/name duplicate group(s) exist',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_name_active
  ON public.agents (tenant_id, lower(trim(name)))
  WHERE status <> 'archived';

COMMIT;
