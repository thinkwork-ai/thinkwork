-- THINK-263 U2/R14: thread backpointers on wiki section provenance.
-- Nullable text[] stamped at compile time from cited memory records'
-- provenance (U1 write-time stamps); backfilled for historical rows by
-- packages/api/scripts/backfill-section-source-thread-refs.mts. Additive — safe to apply
-- ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0243_section_sources_thread_refs.sql
-- creates-column: wiki.section_sources.source_thread_ids

ALTER TABLE wiki.section_sources
  ADD COLUMN IF NOT EXISTS source_thread_ids text[];
