-- archive-user-wiki-pages.sql
--
-- U11 cutover ops artifact (plan docs/plans/2026-06-09-004) — NOT a
-- migration. Run manually (psql) against the target stage at cutover,
-- AFTER the planner-retirement PR deploys.
--
-- What it does: archives every ACTIVE user-scoped wiki page (owner_id IS
-- NOT NULL). The planner that produced these pages is gone; the tenant
-- wiki rebuilds fresh from the knowledge-graph mirror (archive-and-
-- rematerialize, no page migration — avoids cross-user slug collisions).
-- The flip is recorded in `tags` ('u11-user-scope-archive') so it is
-- precisely reversible; the tag guard also makes the statement idempotent
-- and keeps it from touching pages a user archived themselves.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/ops/archive-user-wiki-pages.sql
--
-- Forward (the cutover):

UPDATE wiki.pages
SET status = 'archived',
    tags = array_append(tags, 'u11-user-scope-archive'),
    updated_at = now()
WHERE owner_id IS NOT NULL
  AND status = 'active'
  AND NOT ('u11-user-scope-archive' = ANY(tags));

-- Reverse (rollback — restores exactly the pages this script archived and
-- removes the marker tag; run instead of the UPDATE above):
--
-- UPDATE wiki.pages
-- SET status = 'active',
--     tags = array_remove(tags, 'u11-user-scope-archive'),
--     updated_at = now()
-- WHERE owner_id IS NOT NULL
--   AND status = 'archived'
--   AND 'u11-user-scope-archive' = ANY(tags);
