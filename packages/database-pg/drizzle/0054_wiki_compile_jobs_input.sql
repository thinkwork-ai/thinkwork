-- Add `input` jsonb column to wiki_compile_jobs.
--
-- Drives per-trigger input payloads on top of the shared compile job ledger.
-- The first consumer is `trigger='enrichment_draft'` jobs, which carry
-- { pageId, pageTable, candidates } so the draft-compile module can run
-- against an explicit page and a synthesized candidate list rather than
-- the cluster-driven input the default compile reads from.
--
-- Plan:
--   docs/plans/2026-05-01-002-feat-brain-enrichment-draft-page-review-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0054_wiki_compile_jobs_input.sql
--
-- Column path updated post-0089 (wiki schema extraction renamed parent table to wiki.compile_jobs).
-- creates-column: wiki.compile_jobs.input

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE wiki_compile_jobs
  ADD COLUMN IF NOT EXISTS input jsonb;

COMMIT;
