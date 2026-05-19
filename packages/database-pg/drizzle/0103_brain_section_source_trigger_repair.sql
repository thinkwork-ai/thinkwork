-- 0103_brain_section_source_trigger_repair.sql
--
-- Repair the Brain section-source tenant guard after the wiki/brain schema
-- extraction compat views were dropped in 0091. The trigger function created
-- by 0051 still joined public.tenant_entity_page_sections/pages; after 0090
-- those tables live at brain.page_sections/pages, and 0091 removed the public
-- bridge views.
--
-- creates: public.view_brain_section_source_trigger_repaired

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('repair_brain_section_source_trigger'));

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('brain.pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.pages does not exist';
  END IF;
  IF to_regclass('brain.page_sections') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.page_sections does not exist';
  END IF;
  IF to_regclass('brain.section_sources') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.section_sources does not exist';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_tenant_entity_section_source_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_tenant_id uuid;
BEGIN
  SELECT p.tenant_id
  INTO parent_tenant_id
  FROM brain.page_sections s
  INNER JOIN brain.pages p ON p.id = s.page_id
  WHERE s.id = NEW.section_id;

  IF parent_tenant_id IS NULL OR parent_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_entity_section_sources tenant_id must match parent page tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_entity_section_sources_tenant
  ON brain.section_sources;

CREATE TRIGGER trg_tenant_entity_section_sources_tenant
  BEFORE INSERT OR UPDATE ON brain.section_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_entity_section_source_tenant();

CREATE OR REPLACE VIEW public.view_brain_section_source_trigger_repaired AS
SELECT
  'public.enforce_tenant_entity_section_source_tenant'::text AS function_name,
  'brain.section_sources'::text AS trigger_table,
  true AS repaired;

COMMIT;
