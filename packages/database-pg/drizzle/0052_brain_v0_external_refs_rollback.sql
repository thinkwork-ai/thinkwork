-- Rollback only. Apply manually if Brain v0 external refs are abandoned.
--
-- drops: public.tenant_entity_external_refs

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS public.tenant_entity_external_refs;

COMMIT;
