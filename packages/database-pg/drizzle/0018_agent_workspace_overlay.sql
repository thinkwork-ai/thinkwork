-- Agent workspace overlay foundation — schema additions for Unit 1 of
-- docs/plans/2026-04-21-006-feat-agent-workspace-overlay-and-seeding-plan.md.
--
-- Adds:
--   • user_profiles.title / .timezone / .pronouns — rendered into agent USER.md
--     as {{HUMAN_TITLE}} / {{HUMAN_TIMEZONE}} / {{HUMAN_PRONOUNS}} during the
--     assignment write (Unit 6). Null → renders as "—" so the shape is stable.
--   • agents.agent_pinned_versions — per-file SHA-256 pins for guardrail-class
--     workspace files (GUARDRAILS.md, PLATFORM.md, CAPABILITIES.md). Keys are
--     canonical basenames; values are `sha256:<64-hex>` strings. Null until the
--     agent is created via createAgentFromTemplate (Unit 8) or converted by the
--     one-shot migration (Unit 10). Template edits to pinned files surface a
--     "Template update available" badge; acceptTemplateUpdate advances the hash.
--
-- Purely additive; no backfill needed. Column additions with NULL default are
-- non-blocking in Postgres regardless of row count.
--
-- No CI migration runner — apply manually via
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0018_agent_workspace_overlay.sql
-- after this PR merges and before any Phase 3 Lambda code (Units 6, 8, 10) that
-- references these columns deploys to production. See the plan's Documentation
-- / Operational Notes section.
ALTER TABLE "user_profiles" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_pinned_versions" jsonb;
