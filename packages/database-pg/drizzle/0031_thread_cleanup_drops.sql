-- U5 (narrowed): drop retired thread_comments table + two orphan indices.
--
-- Plan reference:
--   docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
--   (U5 destructive migration; original scope also listed `artifacts` and
--   `message_artifacts`, but a fresh survey found those tables are still
--   load-bearing — `Artifact` GraphQL type, full CRUD resolvers, and mobile
--   `Message.durableArtifact` rendering are all live. Narrowed scope here.)
--
-- What this drops:
--   1. public.thread_comments — retired by U2 (escalateThread/delegateThread
--      refactored onto thread_turns kind=system_event). Live writes are
--      gone; tests assert no inserts; only retired-comment doc strings
--      remain in the resolvers.
--   2. public.idx_threads_tenant_status — orphaned. Admin U7 retired the
--      list-view filter that used this index; no other call site reads it.
--      The `thread.status` column itself remains (Strands
--      `update_thread_status` skill still writes it).
--   3. public.idx_threads_parent_id — orphaned. Parent/child thread
--      queries were retired with the GraphQL `Thread.parent` /
--      `Thread.children` fields; the `parent_id` column remains for now
--      (no consumer reads it but it's recoverable from row data if needed).
--
-- What this preserves:
--   - public.thread.status column (still mutated by the Strands skill).
--   - public.thread.parent_id column (orphan but cheap to keep).
--   - public.artifacts and public.message_artifacts tables and all their
--     CRUD resolvers + Drizzle declarations.
--
-- Recoverability:
--   Pre-drop, this migration uses `aws_s3.query_export_to_s3` to snapshot
--   `thread_comments` rows to s3://thinkwork-${stage}-backups/pre-drop/.
--   Provisioned by U13 (terraform/modules/data/s3-backups-bucket +
--   terraform/modules/data/aurora-postgres aws_s3 IAM role). The
--   `aws_s3` extension itself is enabled by drizzle/0028_aws_s3_extension.sql.
--   Required role association feature_name = "s3Export" must already be
--   attached (operator confirms via the post-deploy runbook before
--   applying this migration).
--
-- Apply manually (matches the 0018+ hand-rolled convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0031_thread_cleanup_drops.sql
--
-- The `${stage}` literal in the S3 URI below must be substituted at
-- apply time (psql does not expand env vars in SQL literals). Replace
-- with the target deploy stage before running, or use psql variables:
--   psql "$DATABASE_URL" -v stage=dev -f .../0031_thread_cleanup_drops.sql
-- and reference `:'stage'` in the snapshot lines (see SET BLOCK below).
--
-- Drift detection:
--   pnpm db:migrate-manual reports `drops:` markers as DROPPED (target
--   table/index absent) or STILL_PRESENT (target still in DB). After
--   apply, the markers below should report DROPPED.
--
-- Pre-migration invariants:
--   - aws_s3 extension installed (\dx aws_s3).
--   - Aurora cluster has the `feature_name = "s3Export"` role association
--     to a role that grants s3:PutObject on
--     thinkwork-${stage}-backups/pre-drop/*.
--   - Caller has rds_superuser (required for cross-schema DROP CASCADE
--     paths and aws_s3 calls).
--
-- Rollback runbook:
--   1. Recover thread_comments rows from
--      s3://thinkwork-${stage}-backups/pre-drop/thread_comments_<date>.csv.
--   2. Recreate the table from the prior schema definition (see
--      packages/database-pg/src/schema/threads.ts at commit before this
--      migration; threadComments table block).
--   3. `\copy public.thread_comments FROM '<csv>' WITH (FORMAT csv, HEADER true);`
--   4. Re-add `idx_threads_tenant_status` and `idx_threads_parent_id`
--      with `CREATE INDEX CONCURRENTLY ...` if needed (rare — the
--      indices weren't read by any production path).
--
-- drops: public.thread_comments
-- drops: public.idx_threads_tenant_status
-- drops: public.idx_threads_parent_id

\set ON_ERROR_STOP on

-- Default stage to 'dev' so accidental copy/paste runs don't write to a
-- mis-named bucket. Override with `psql -v stage=prod ...`.
\if :{?stage}
\else
\set stage dev
\endif

BEGIN;

-- Fail fast on lock contention rather than wedging the cluster behind
-- long-held locks. thread_comments has no production traffic post-U2 so
-- a 5s wait is more than sufficient.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Pre-drop snapshot to S3 (recoverable forever; lifecycle policy on the
-- bucket expires pre-drop/ objects after 90 days).
-- ---------------------------------------------------------------------------

SELECT aws_s3.query_export_to_s3(
  'SELECT * FROM public.thread_comments',
  aws_commons.create_s3_uri(
    'thinkwork-' || :'stage' || '-backups',
    'pre-drop/thread_comments_2026_04_24.csv',
    current_setting('cluster_region', true)
  ),
  options := 'format csv, header true'
);

-- ---------------------------------------------------------------------------
-- Drop the orphan indices first. DROP INDEX is metadata-only on Aurora
-- Postgres so it's nearly free; doing it before the table drop keeps the
-- transaction's order-of-operations explicit.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_threads_tenant_status;
DROP INDEX IF EXISTS public.idx_threads_parent_id;

-- ---------------------------------------------------------------------------
-- Drop thread_comments. CASCADE removes any incidental FKs from other
-- tables that referenced thread_comments (none expected at this point —
-- the U2 refactor moved all callers off this table).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.thread_comments CASCADE;

COMMIT;

-- Post-apply verification (run as a separate statement, outside the txn):
--   \dt public.thread_comments     -- should report no relation found
--   \d  public.threads             -- should not list idx_threads_tenant_status or idx_threads_parent_id
--   pnpm db:migrate-manual         -- the three `drops:` markers above should report DROPPED
