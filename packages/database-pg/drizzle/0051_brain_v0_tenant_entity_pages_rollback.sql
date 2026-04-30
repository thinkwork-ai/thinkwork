-- Rollback only. Apply manually if Brain v0 tenant entity tables are abandoned.
--
-- drops: public.tenant_entity_section_sources
-- drops: public.tenant_entity_page_aliases
-- drops: public.tenant_entity_page_links
-- drops: public.tenant_entity_page_sections
-- drops: public.tenant_entity_pages

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS public.tenant_entity_section_sources;
DROP TABLE IF EXISTS public.tenant_entity_page_aliases;
DROP TABLE IF EXISTS public.tenant_entity_page_links;
DROP TABLE IF EXISTS public.tenant_entity_page_sections;
DROP TABLE IF EXISTS public.tenant_entity_pages;
DROP FUNCTION IF EXISTS public.enforce_tenant_entity_section_source_tenant();

COMMIT;
