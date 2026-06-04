-- Purpose: add Firecrawl-backed Web Extraction opt-in fields for agents and templates.
-- Plan: docs/plans/2026-06-04-002-feat-firecrawl-web-extraction-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0143_add_web_extract_builtin_config.sql
-- creates-column: public.agents.web_extract
-- creates-column: public.agent_templates.web_extract

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS web_extract jsonb DEFAULT '{"enabled": true}'::jsonb;

ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS web_extract jsonb DEFAULT '{"enabled": true}'::jsonb;

UPDATE public.agents
SET web_extract = '{"enabled": true}'::jsonb
WHERE web_extract IS NULL;

UPDATE public.agent_templates
SET web_extract = '{"enabled": true}'::jsonb
WHERE web_extract IS NULL;

COMMIT;
