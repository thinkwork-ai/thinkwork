-- Backfill: seed threads.description from metadata.external.latestEnvelope
-- for existing LastMile-synced tasks whose description column is null/empty.
--
-- Why this is needed: prior to the "stamp description on executeAction +
-- syncExternalTaskOnCreate" changes, tasks created via the workflow-form
-- path didn't persist their description to the first-class column — the
-- text lived only inside metadata.external.latestEnvelope.item.core. The
-- mobile Tasks list now renders thread.description as the subtitle, so
-- historical rows look blank until this backfill runs.
--
-- Idempotent: the WHERE clause only touches rows where description is
-- currently null/empty AND an envelope description exists. Re-running is
-- safe but a no-op.
--
-- Usage:
--   DATABASE_URL="postgresql://..." psql "$DATABASE_URL" \
--     -f scripts/migration/backfill_task_descriptions.sql
--
-- Or via the db-push.sh --stage mechanism:
--   scripts/db-push.sh --stage dev  # resolves DATABASE_URL, then run psql manually
UPDATE threads
SET description = metadata->'external'->'latestEnvelope'->'item'->'core'->>'description',
    updated_at = NOW()
WHERE channel = 'task'
  AND (description IS NULL OR description = '')
  AND metadata->'external'->'latestEnvelope'->'item'->'core'->>'description' IS NOT NULL
  AND metadata->'external'->'latestEnvelope'->'item'->'core'->>'description' <> '';
