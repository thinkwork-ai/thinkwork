-- NOTE: skill_runs.completion_hmac_secret was intentionally stripped from
-- this generated migration. It was already applied to every stage by the
-- hand-rolled drizzle/0021_skill_runs_completion_hmac.sql that shipped with
-- the composable-skills hardening work (#422). The drizzle journal wasn't
-- refreshed, so db:generate re-included the column when it ran for this
-- unit. Keeping that line here would fail with "column already exists" on
-- every environment. The 0020 snapshot file does capture the column so
-- future db:generate runs stay consistent.
ALTER TABLE "agent_templates" ADD COLUMN "sandbox" jsonb;
