# Hindsight dedicated-database cutover kit (THINK-220)

Moves Hindsight from the `hindsight` schema of the shared thinkwork database
to its own database (`thinkwork_hindsight`, same Aurora cluster) where its
schema is `public` — the vanilla upstream layout its maintenance-loop
discovery queries require. Plan:
`docs/plans/2026-07-07-004-feat-hindsight-dedicated-database-plan.md`.
Rehearsal findings (2026-07-07):
`docs/solutions/tooling-decisions/hindsight-dedicated-db-rehearsal-2026-07-07.md`.

Pre-conditions (Phase 4 gate):

- Phase 1 seam deployed (#3491) and Phase 2 terraform merged (#3493).
- The two `CUTOVER BLOCKER (THINK-220)` statements reshaped
  (`hindsight-adapter.ts inspectTenant`, `dream/runner.ts enumerateDreamBanks`)
  — grep for the marker; it must return nothing outside comments explaining
  history.
- Target database exists with pgvector: on dev this was bootstrap SQL
  (2026-07-07); customer stages get it from the deploy-runner automation
  (Phase 6) before this kit runs there.

## Steps (retain pause window, ~15 min)

1. **Pause retains** — accept the window; retains fail loud (#3485), not
   silently.
2. **Dump** the live schema from the primary database:
   `pg_dump "$PRIMARY_URL" -n hindsight -Fc -f hindsight-cutover.dump`
3. **Restore** into the target database (which already has `CREATE EXTENSION
   vector` in `public`):
   `pg_restore -d "$TARGET_URL" --no-owner --no-privileges hindsight-cutover.dump`
   (An ignorable `SET transaction_timeout` error appears only when restoring
   to an older server major — not cluster-internal moves.)
4. **Move objects to `public`** — a plain `ALTER SCHEMA hindsight RENAME TO
   public` collides with the extension-holding `public` schema. Instead:

   ```sql
   SELECT format('ALTER TABLE hindsight.%I SET SCHEMA public;', tablename)
   FROM pg_tables WHERE schemaname='hindsight' \gexec
   SELECT format('ALTER MATERIALIZED VIEW hindsight.%I SET SCHEMA public;', matviewname)
   FROM pg_matviews WHERE schemaname='hindsight' \gexec
   DROP SCHEMA hindsight;
   ```

5. **Install the maintenance discovery functions** —
   `psql "$TARGET_URL" -f maintenance-functions.sql`.
   Upstream installs `banks_needing_consolidation` /
   `mental_models_with_cron` / `schemas_with_expired_rows` via a repair
   migration that only runs on base-schema installs; the restored
   `alembic_version` is already at head, so they never appear on a migrated
   copy without this step. DDL extracted verbatim from a vanilla 0.8.4
   install (`pg_get_functiondef`); re-extract when bumping the image tag.
6. **Flip terraform** — set `hindsight_database_name = "thinkwork_hindsight"`
   (one variable: Hindsight service URL/schema, api Lambdas via the SSM
   runtime-config document, Pi runtime env). Apply. AgentCore warm containers
   boot pre-injection — the 15-min reconciler catches stragglers, or force a
   runtime restart.
7. **Smoke** — retain (attempt metadata shows nonzero `extractedUnitCount`),
   recall tiers, Memory graph UI, promotion gate, bank-merge dry-run,
   `recordMemoryAccess` increments.
8. **Acceptance** — Hindsight service logs over one maintenance cycle show
   `Consolidation reconcile: scheduled N bank(s)` and `Maintenance:
   retention took …` with **no** `does not exist` warnings.

## Rollback

Unset `hindsight_database_name` and re-apply. The old `hindsight.*` schema
in the primary database stays intact until the Phase 5 soak completes;
post-cutover writes land only in the new database, so roll back quickly or
accept replaying the delta.

## Decommission (old-schema drop, after soak + explicit approval)

Take a final dump first (`pg_dump -Fc -n hindsight`), then verify the old
schema is frozen (newest `memory_units.created_at` == the cutover freeze
time) and the new database is live and ahead.

**Extension gotcha (hit on dev, 2026-07-08):** the `pg_trgm` extension was
homed *inside* the `hindsight` schema, so `DROP SCHEMA hindsight CASCADE`
also dropped the extension — and with it five trigram indexes on *other*
schemas (`wiki.idx_pages_title_trgm`, `wiki.idx_page_aliases_alias_trgm`,
`brain.idx_pages_title_trgm`, `brain.idx_page_aliases_alias_trgm`,
`public.idx_kg_entities_label_trgm`), silently degrading wiki/brain fuzzy
matching and KG entity lookup. Before dropping any schema, check for
extensions homed in it:

```sql
SELECT e.extname FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE n.nspname = 'hindsight';
```

Relocate them first (`ALTER EXTENSION pg_trgm SET SCHEMA public;`) — or, if
the CASCADE already ate them, recreate the extension in `public` and rebuild
the dependent indexes from their definitions in
`packages/database-pg/src/schema/{wiki,brain}.ts`, then
smoke `similarity()` / `%` queries against the rebuilt indexes.
