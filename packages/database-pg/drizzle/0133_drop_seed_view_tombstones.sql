-- 0133_drop_seed_view_tombstones.sql
--
-- Drops the 11 sentinel/invariant-check views left behind by historical
-- seed and repair migrations. Each view was created by its owning
-- migration as a saved "did this work land?" query — operator-facing
-- introspection sugar that was useful at the time those migrations
-- applied, but is now dead schema noise.
--
-- None of these views are read by application code (verified via grep
-- across packages/api, packages/lambda, apps/*, scripts/, and the
-- Python Strands runtime). The drift reporter does its work via the
-- `-- creates:` and `-- drops:` markers in migration headers, not by
-- reading view contents — so dropping these views does not weaken the
-- migration-verification regime.
--
-- Companion edit: the 11 original migrations have their now-stale
-- `-- creates: public.view_*` markers removed in this same PR so the
-- drift reporter stays clean. The view SQL bodies in those files are
-- left in place — replaying any of those migrations on a fresh DB
-- still recreates its view, after which 0133 cleans it up again.
--
-- Apply manually (AFTER merge + deploy, per
-- feedback_migration_deploy_ordering):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0133_drop_seed_view_tombstones.sql
--
-- Then verify:
--   pnpm db:migrate-manual packages/database-pg/drizzle/0133_drop_seed_view_tombstones.sql
--   psql -c "\dv public.view_*"  -- 0 views expected
--
-- Rollback: re-run each source migration's CREATE VIEW statement. See
-- the inverse SQL in each of:
--   0022, 0030, 0085, 0086, 0089 (remove_maniflow_eval_seeds),
--   0096, 0102, 0103, 0104, 0106, 0116
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: public.view_brain_section_source_trigger_repaired
-- drops: public.view_composition_primitives_retired
-- drops: public.view_default_template_models_updated_0086
-- drops: public.view_eval_seed_maniflow_cleanup_0089
-- drops: public.view_eval_seed_true_redteam_cleanup_0096
-- drops: public.view_seed_ontology_triples_expanded
-- drops: public.view_seed_ontology_user_memory_expanded
-- drops: public.view_thinkwork_admin_permissions_seeded
-- drops: public.view_thinkwork_computer_default_template_seeded
-- drops: public.view_thread_participants_access_backfilled
-- drops: public.view_wiki_brain_owner_repaired

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

-- Serialize concurrent application attempts.
SELECT pg_advisory_xact_lock(hashtext('drop_seed_view_tombstones'));

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

DROP VIEW IF EXISTS public.view_brain_section_source_trigger_repaired;
DROP VIEW IF EXISTS public.view_composition_primitives_retired;
DROP VIEW IF EXISTS public.view_default_template_models_updated_0086;
DROP VIEW IF EXISTS public.view_eval_seed_maniflow_cleanup_0089;
DROP VIEW IF EXISTS public.view_eval_seed_true_redteam_cleanup_0096;
DROP VIEW IF EXISTS public.view_seed_ontology_triples_expanded;
DROP VIEW IF EXISTS public.view_seed_ontology_user_memory_expanded;
DROP VIEW IF EXISTS public.view_thinkwork_admin_permissions_seeded;
DROP VIEW IF EXISTS public.view_thinkwork_computer_default_template_seeded;
DROP VIEW IF EXISTS public.view_thread_participants_access_backfilled;
DROP VIEW IF EXISTS public.view_wiki_brain_owner_repaired;

COMMIT;
