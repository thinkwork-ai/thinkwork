#!/usr/bin/env bash
set -euo pipefail

psql "${DATABASE_URL:?DATABASE_URL is required}" <<'SQL'
SELECT to_regclass('public.tenant_entity_pages') AS tenant_entity_pages;
SELECT to_regclass('public.tenant_entity_section_sources') AS tenant_entity_section_sources;
SELECT to_regclass('public.tenant_entity_external_refs') AS tenant_entity_external_refs;
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('wiki_pages', 'wiki_unresolved_mentions')
  AND column_name = 'entity_subtype'
ORDER BY table_name;
SQL
