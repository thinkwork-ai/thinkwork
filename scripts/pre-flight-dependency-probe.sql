-- pre-flight-dependency-probe.sql
--
-- Enumerate dependencies on everything U5 of the thread-detail cleanup plan
-- drops: threads.{status,priority,type,parent_id} columns, and the
-- thread_comments / artifacts / message_artifacts tables. Output is pasted
-- into the PR 3b description alongside pre-drop-row-counts.sql so the
-- hand-rolled 0027 migration can be authored with full visibility into
-- CHECK constraints, foreign keys, views, materialized views, triggers, and
-- partial indexes that reference the dropped objects.
--
-- Run on dev first, then prod (read-only):
--   psql "$DATABASE_URL" -f scripts/pre-flight-dependency-probe.sql
--
-- Plan reference:
--   docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
--   Unit U1 (pre-gate), Unit U5 (destructive migration), deepening finding
--   "unexpected dependencies (view, matview, trigger, CHECK, FK) on dropped
--   columns" from the document-review pass.
--
-- NOTE: thread_attachments is NOT probed — it is preserved for the upcoming
-- photos/files-to-agent feature per user clarification 2026-04-24.

\echo '=== 1. Columns being dropped: current NOT NULL / DEFAULT / CHECK ==='
SELECT
  a.attname                                       AS column_name,
  format_type(a.atttypid, a.atttypmod)            AS column_type,
  NOT a.attnotnull                                AS is_nullable,
  pg_get_expr(ad.adbin, ad.adrelid)               AS default_expr
FROM pg_attribute a
LEFT JOIN pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attrelid = 'public.threads'::regclass
  AND a.attname IN ('status', 'priority', 'type', 'parent_id')
  AND NOT a.attisdropped
ORDER BY a.attname;

\echo ''
\echo '=== 2. CHECK constraints involving the dropped columns or tables ==='
SELECT
  c.conname                                       AS constraint_name,
  t.relname                                       AS table_name,
  pg_get_constraintdef(c.oid)                     AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
WHERE c.contype = 'c'
  AND (
    (t.relname = 'threads' AND pg_get_constraintdef(c.oid) ~ '(status|priority|type|parent_id)')
    OR t.relname IN ('thread_comments', 'artifacts', 'message_artifacts')
  )
ORDER BY t.relname, c.conname;

\echo ''
\echo '=== 3. Foreign keys INTO dropped tables OR referencing dropped columns ==='
-- FKs where the dropped objects are on either side of the relationship.
SELECT
  c.conname                                       AS fk_name,
  src.relname                                     AS source_table,
  tgt.relname                                     AS target_table,
  pg_get_constraintdef(c.oid)                     AS definition
FROM pg_constraint c
JOIN pg_class src ON src.oid = c.conrelid
JOIN pg_class tgt ON tgt.oid = c.confrelid
WHERE c.contype = 'f'
  AND (
    src.relname IN ('thread_comments', 'artifacts', 'message_artifacts')
    OR tgt.relname IN ('thread_comments', 'artifacts', 'message_artifacts')
    OR (src.relname = 'threads' AND pg_get_constraintdef(c.oid) ~ '(status|priority|type|parent_id)')
    OR (tgt.relname = 'threads' AND pg_get_constraintdef(c.oid) ~ '(status|priority|type|parent_id)')
  )
ORDER BY src.relname, tgt.relname, c.conname;

\echo ''
\echo '=== 4. Views referencing dropped tables or columns ==='
SELECT
  schemaname                                      AS schema,
  viewname                                        AS view_name,
  substring(definition, 1, 200)                   AS definition_excerpt
FROM pg_views
WHERE schemaname = 'public'
  AND (
    definition ~ '\m(thread_comments|artifacts|message_artifacts)\M'
    OR definition ~ 'threads\.(status|priority|type|parent_id)'
  )
ORDER BY viewname;

\echo ''
\echo '=== 5. Materialized views referencing dropped tables or columns ==='
SELECT
  schemaname                                      AS schema,
  matviewname                                     AS matview_name,
  substring(definition, 1, 200)                   AS definition_excerpt
FROM pg_matviews
WHERE schemaname = 'public'
  AND (
    definition ~ '\m(thread_comments|artifacts|message_artifacts)\M'
    OR definition ~ 'threads\.(status|priority|type|parent_id)'
  )
ORDER BY matviewname;

\echo ''
\echo '=== 6. Triggers on dropped tables or on threads (surface all; filter manually) ==='
SELECT
  trg.tgname                                      AS trigger_name,
  tbl.relname                                     AS on_table,
  pg_get_triggerdef(trg.oid)                      AS definition
FROM pg_trigger trg
JOIN pg_class tbl ON tbl.oid = trg.tgrelid
WHERE NOT trg.tgisinternal
  AND tbl.relname IN ('threads', 'thread_comments', 'artifacts', 'message_artifacts')
ORDER BY tbl.relname, trg.tgname;

\echo ''
\echo '=== 7. Partial indexes on threads referencing dropped columns ==='
SELECT
  i.relname                                       AS index_name,
  pg_get_indexdef(ix.indexrelid)                  AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
WHERE t.relname = 'threads'
  AND ix.indpred IS NOT NULL
  AND pg_get_indexdef(ix.indexrelid) ~ '(status|priority|type|parent_id)'
ORDER BY i.relname;

\echo ''
\echo '=== 8. All indexes on dropped tables (drop along with table) ==='
SELECT
  i.relname                                       AS index_name,
  t.relname                                       AS on_table,
  pg_get_indexdef(ix.indexrelid)                  AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
WHERE t.relname IN ('thread_comments', 'artifacts', 'message_artifacts')
ORDER BY t.relname, i.relname;

\echo ''
\echo '=== 9. Sequences owned by dropped columns/tables (will auto-drop via OWNED BY) ==='
SELECT
  c.relname                                       AS sequence_name,
  refobj.relname                                  AS owner_table
FROM pg_depend d
JOIN pg_class c       ON c.oid = d.objid AND c.relkind = 'S'
JOIN pg_class refobj  ON refobj.oid = d.refobjid
WHERE d.deptype = 'a'
  AND refobj.relname IN ('thread_comments', 'artifacts', 'message_artifacts')
ORDER BY refobj.relname, c.relname;

\echo ''
\echo '=== pre-flight complete. Review output for unexpected dependencies. ==='
