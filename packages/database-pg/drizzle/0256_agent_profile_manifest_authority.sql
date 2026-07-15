-- 0256_agent_profile_manifest_authority.sql
--
-- Subagent-folders plan 2026-07-15-001 U10 (R17 flip half): per-agent
-- authority flip mirroring capability_folder_dispatch. When true, the
-- compiled capabilities manifest (agent entries + synced agents/<slug>/
-- folders) is the sub-agent profile truth: the dispatch payload carries
-- only space-local profiles in full and Pi assembles central profiles
-- from the manifest. Flipped per agent after the dual-read soak's
-- two-sided gate passes.
--
-- Hand-rolled (not in meta/_journal.json): drizzle-kit generate is
-- blocked on an unrelated interactive table-conflict prompt. Apply with:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0256_agent_profile_manifest_authority.sql
--
-- creates-column: public.agents.agent_profile_manifest_authority

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "agent_profile_manifest_authority" boolean NOT NULL DEFAULT false;
