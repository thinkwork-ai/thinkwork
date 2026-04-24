-- pre-drop-row-counts.sql
--
-- Baseline row counts for tables that U5 of the thread-detail cleanup plan
-- drops destructively. Output is pasted into the PR 3b description so
-- reviewers can see what row volume is about to be lost (and confirm the
-- accepted-data-loss posture per origin R14).
--
-- Run on dev first, then prod (read-only):
--   psql "$DATABASE_URL" -f scripts/pre-drop-row-counts.sql
--
-- Plan reference:
--   docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
--   Unit U1 (pre-gate), Unit U5 (destructive migration).
--
-- NOTE: thread_attachments is NOT in this list — it is being preserved for
-- the upcoming photos/files-to-agent feature per user clarification 2026-04-24.

\echo '=== thread_comments (to be dropped) ==='
SELECT
  count(*)                      AS row_count,
  count(DISTINCT tenant_id)     AS distinct_tenants,
  min(created_at)               AS earliest_row,
  max(created_at)               AS latest_row
FROM thread_comments;

\echo ''
\echo '=== artifacts (to be dropped; backs message.durableArtifact) ==='
SELECT
  count(*)                      AS row_count,
  count(DISTINCT tenant_id)     AS distinct_tenants,
  min(created_at)               AS earliest_row,
  max(created_at)               AS latest_row
FROM artifacts;

\echo ''
\echo '=== message_artifacts (to be dropped; dangling after artifacts drop) ==='
SELECT
  count(*)                      AS row_count,
  count(DISTINCT tenant_id)     AS distinct_tenants,
  min(created_at)               AS earliest_row,
  max(created_at)               AS latest_row
FROM message_artifacts;

\echo ''
\echo '=== threads columns being dropped (non-null row counts per column) ==='
-- These columns are dropped but the rows themselves stay. Counts here
-- quantify how many threads carried task-era metadata we are discarding.
SELECT
  count(*) FILTER (WHERE status   IS NOT NULL) AS rows_with_status,
  count(*) FILTER (WHERE priority IS NOT NULL) AS rows_with_priority,
  count(*) FILTER (WHERE type     IS NOT NULL) AS rows_with_type,
  count(*) FILTER (WHERE parent_id IS NOT NULL) AS rows_with_parent_id,
  count(*)                                     AS total_threads
FROM threads;
