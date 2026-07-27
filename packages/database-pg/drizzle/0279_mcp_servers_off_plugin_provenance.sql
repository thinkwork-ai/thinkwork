-- Hand-rolled — apply manually to each stage via:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0279_mcp_servers_off_plugin_provenance.sql
--
-- See docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
--
-- Plugin-system removal. The plugin engine's MCP component handler adopted
-- surviving MCP servers as management_source='plugin' + plugin_install_id
-- (migrations 0159/0161). Twenty CRM and n8n keep running after the plugin
-- system is deleted, so their MCP rows move back to plain 'manual'
-- registration — the same shape lastmile-dispatch and digital-twin already
-- use.
--
-- data-only-migration
-- No durable schema objects: this only rewrites provenance columns. The
-- in-transaction assertions below are the correctness gate, and the
-- verification queries at the bottom are the post-apply check.
--
-- Why this is safe:
--
--   * Credentials do not move. packages/api/src/lib/mcp-configs.ts resolves
--     service_credential from auth_config.secretRef and oauth from
--     user_mcp_tokens — in the plugin branch and the manual branch alike.
--     plugin_install_id is used for dispatch *ordering* (plugin rows win a
--     URL dedupe pass), never for auth.
--   * Both target shapes are already proven on the manual path:
--     manual|oauth (lastmile-dispatch, with live per-user tokens) and
--     manual|service_credential (digital-twin, thinkwork-hindsight,
--     postgres-dev).
--   * Nothing re-adopts these rows. The only writers of
--     management_source='plugin' are lib/plugins/handlers/mcp.ts and
--     lib/plugins/cutover/deps.ts, both reached only by an explicit plugin
--     install/activate — and both are deleted with the plugin system.
--
-- The CHECK constraint tenant_mcp_servers_managed_application_shape_check_v2
-- requires manual rows to carry NO ownership key, so managed_application_key
-- is cleared alongside plugin_install_id. Only dev's twenty--crm still has
-- one (its pre-plugin identity, retained through the 0161 cutover); the
-- customer stages already have it NULL.
--
-- Per-stage effect at time of writing:
--   dev        twenty--crm (oauth, 2 tokens), n8n--workflow-management,
--              company-brain--brain, plane--issues
--   tei-e2e    twenty--crm (oauth, 3 tokens)
--   mcpherson  n8n--workflow-management
--
-- company-brain--brain and plane--issues are flipped too rather than left
-- dangling: their plugin_install_id would become a broken reference once the
-- plugin tables drop. Their own removal is a separate decision.

BEGIN;

UPDATE tenant_mcp_servers
   SET management_source     = 'manual',
       plugin_install_id     = NULL,
       managed_application_key = NULL,
       updated_at            = now()
 WHERE management_source = 'plugin';

-- Fail loudly rather than commit a half-migration: no row anywhere may still
-- claim plugin provenance, and none may violate the manual shape.
DO $$
DECLARE
  leftover integer;
  malformed integer;
BEGIN
  SELECT count(*) INTO leftover
    FROM tenant_mcp_servers
   WHERE management_source = 'plugin' OR plugin_install_id IS NOT NULL;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'plugin provenance still present on % tenant_mcp_servers row(s)', leftover;
  END IF;

  SELECT count(*) INTO malformed
    FROM tenant_mcp_servers
   WHERE management_source = 'manual' AND managed_application_key IS NOT NULL;
  IF malformed > 0 THEN
    RAISE EXCEPTION 'manual rows still carry managed_application_key on % row(s)', malformed;
  END IF;
END $$;

COMMIT;

-- Verification (run after applying):
--
--   SELECT slug, management_source, auth_type,
--          (plugin_install_id IS NOT NULL) AS has_plugin
--     FROM tenant_mcp_servers ORDER BY slug;
--
--   -- per-user OAuth tokens must be untouched
--   SELECT s.slug, count(t.id)
--     FROM tenant_mcp_servers s
--     LEFT JOIN user_mcp_tokens t ON t.mcp_server_id = s.id
--    GROUP BY s.slug ORDER BY s.slug;
