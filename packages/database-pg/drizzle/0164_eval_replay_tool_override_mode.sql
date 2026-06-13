-- Purpose: turn the per-tenant eval-replay MCP tool allowlist into an
--          OPTIONAL OVERRIDE list (Evaluations Trust Core U14). Replay now
--          DEFAULT-ALLOWS read-shaped tools by a name heuristic and blocks
--          write-shaped tools (classified in @thinkwork/evals-core
--          classifyMcpToolAccess). This table stops being the gate and
--          becomes overrides: a row force-ALLOWS a tool the heuristic would
--          block (e.g. a trusted write) or force-BLOCKS a tool the heuristic
--          would allow (e.g. suppress a read). The `mode` column carries
--          which.
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U14)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0164_eval_replay_tool_override_mode.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- Semantics:
--   * Additive, nullable-with-default: every existing 0163 row defaults to
--     mode 'allow', which preserves its prior force-allow meaning exactly.
--   * mode is an enum-by-comment: 'allow' (force-allow this server/tool on
--     replay even if the heuristic blocks it) | 'block' (force-block this
--     server/tool on replay even if the heuristic allows it).
--   * The unique key stays (tenant_id, server_name, tool_name) — one
--     override per tool; toggling mode UPDATEs the existing row.
--
-- creates-column: public.eval_replay_tool_allowlist.mode
-- creates-constraint: public.eval_replay_tool_allowlist.eval_replay_tool_allowlist_mode_check

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.eval_replay_tool_allowlist
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'allow';

-- Guard the comment-enum at the DB so a stray write can't smuggle an
-- unknown mode (the selector treats only 'allow'/'block' meaningfully).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eval_replay_tool_allowlist_mode_check'
  ) THEN
    ALTER TABLE public.eval_replay_tool_allowlist
      ADD CONSTRAINT eval_replay_tool_allowlist_mode_check
      CHECK (mode IN ('allow', 'block'));
  END IF;
END $$;

COMMIT;
