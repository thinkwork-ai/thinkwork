-- 0263_drop_workos_auth_runtime.sql
--
-- Final guarded retirement of the WorkOS login broker. Historical migrations
-- 0174/0175 remain in the repository; this migration removes their runtime
-- tables only after a completed native-auth cutover proves identity,
-- client-shutdown, token-drain, realtime-drain, and zero-reader/writer gates.
-- Raw WorkOS profile/session data is deliberately purged, not archived.
--
-- drops: public.workos_auth_bridges
-- drops: public.workos_auth_sessions
-- drops-constraint: public.plugin_components.plugin_components_type_allowed
-- drops-constraint: public.auth_provider_resources.auth_provider_resources_lifecycle_state_allowed
-- drops-constraint: public.auth_route_clients.auth_route_clients_lifecycle_allowed
-- creates: public.plugin_components_type_allowed
-- creates: public.auth_provider_resources_lifecycle_state_allowed
-- creates: public.auth_route_clients_lifecycle_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

SELECT pg_advisory_xact_lock(hashtext('drop_workos_auth_runtime'));

DO $$
DECLARE
  cutover record;
  residue_exists boolean;
  pending_count bigint;
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;

  SELECT
    to_regclass('public.workos_auth_bridges') IS NOT NULL
    OR to_regclass('public.workos_auth_sessions') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.auth_provider_resources
      WHERE provider_kind = 'legacy_workos' OR lifecycle_state = 'coexistence'
    )
    OR EXISTS (
      SELECT 1 FROM public.auth_route_clients
      WHERE lifecycle_state = 'coexistence'
    )
    OR EXISTS (
      SELECT 1 FROM public.plugin_installs WHERE plugin_key = 'workos-auth'
    )
  INTO residue_exists;

  IF NOT residue_exists THEN
    RAISE NOTICE 'WorkOS auth runtime already absent — guarded cleanup is a no-op';
    RETURN;
  END IF;

  SELECT * INTO cutover
  FROM public.auth_cutover_runs
  WHERE status = 'complete' AND completed_at IS NOT NULL
  ORDER BY completed_at DESC
  LIMIT 1;

  IF cutover.id IS NULL THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: no completed auth_cutover_runs evidence';
  END IF;

  IF COALESCE((cutover.terminal_dispositions->>'allTerminal')::boolean, false) IS NOT TRUE
    OR COALESCE((cutover.terminal_dispositions->>'unresolved')::bigint, -1) <> 0
    OR COALESCE((cutover.terminal_dispositions->>'signoutFailures')::bigint, -1) <> 0
    OR COALESCE((cutover.terminal_dispositions->>'compatibilityFallbackReads')::bigint, -1) <> 0
  THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: identity/signout/fallback evidence is incomplete';
  END IF;

  IF COALESCE((cutover.client_shutdown_evidence->>'workosStartsEnabled')::boolean, true) IS NOT FALSE
    OR COALESCE((cutover.client_shutdown_evidence->>'legacyClientsEnabled')::bigint, -1) <> 0
    OR COALESCE((cutover.client_shutdown_evidence->>'legacyAudiencesAccepted')::bigint, -1) <> 0
  THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: legacy clients or audiences remain enabled';
  END IF;

  IF COALESCE((cutover.drain_evidence->>'drainCompleted')::boolean, false) IS NOT TRUE
    OR COALESCE((cutover.drain_evidence->>'legacyRouteTraffic')::bigint, -1) <> 0
    OR COALESCE((cutover.drain_evidence->>'workosTableReads')::bigint, -1) <> 0
    OR COALESCE((cutover.drain_evidence->>'workosTableWrites')::bigint, -1) <> 0
    OR COALESCE((cutover.drain_evidence->>'activeLegacySubscriptions')::bigint, -1) <> 0
  THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: traffic, persistence, or realtime drain evidence is incomplete';
  END IF;

  SELECT count(*) INTO pending_count
  FROM public.auth_identity_enrollments enrollment
  JOIN public.auth_provider_resources resource
    ON resource.id = enrollment.auth_provider_resource_id
  WHERE (resource.provider_kind = 'legacy_workos' OR resource.lifecycle_state = 'coexistence')
    AND enrollment.status = 'pending'
    AND enrollment.expires_at > now();
  IF pending_count <> 0 THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: % live legacy identity enrollment(s)', pending_count;
  END IF;

  IF to_regclass('public.workos_auth_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workos_auth_sessions WHERE status = ''active'' AND expires_at > now()'
      INTO pending_count;
    IF pending_count <> 0 THEN
      RAISE EXCEPTION 'WorkOS retirement blocked: % active WorkOS session(s)', pending_count;
    END IF;
  END IF;

  IF to_regclass('public.workos_auth_bridges') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.workos_auth_bridges WHERE status = ''pending'' AND expires_at > now()'
      INTO pending_count;
    IF pending_count <> 0 THEN
      RAISE EXCEPTION 'WorkOS retirement blocked: % live WorkOS bridge(s)', pending_count;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS public.workos_auth_bridges;
DROP TABLE IF EXISTS public.workos_auth_sessions;

DELETE FROM public.auth_identity_proofs proof
USING public.user_auth_identities identity, public.auth_provider_resources resource
WHERE proof.user_auth_identity_id = identity.id
  AND identity.auth_provider_resource_id = resource.id
  AND (resource.provider_kind = 'legacy_workos' OR resource.lifecycle_state = 'coexistence');

DELETE FROM public.auth_identity_enrollments enrollment
USING public.auth_provider_resources resource
WHERE enrollment.auth_provider_resource_id = resource.id
  AND (resource.provider_kind = 'legacy_workos' OR resource.lifecycle_state = 'coexistence');

DELETE FROM public.user_auth_identities identity
USING public.auth_provider_resources resource
WHERE identity.auth_provider_resource_id = resource.id
  AND (resource.provider_kind = 'legacy_workos' OR resource.lifecycle_state = 'coexistence');

DELETE FROM public.tenant_auth_provider_references reference
USING public.auth_provider_resources resource
WHERE reference.auth_provider_resource_id = resource.id
  AND (resource.provider_kind = 'legacy_workos' OR resource.lifecycle_state = 'coexistence');

DELETE FROM public.auth_provider_resources
WHERE provider_kind = 'legacy_workos' OR lifecycle_state = 'coexistence';

DELETE FROM public.auth_route_clients WHERE lifecycle_state = 'coexistence';
DELETE FROM public.plugin_installs WHERE plugin_key = 'workos-auth';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.plugin_components WHERE component_type = 'auth-provider'
  ) THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: non-retired auth-provider plugin components remain';
  END IF;
END $$;

ALTER TABLE public.plugin_components
  DROP CONSTRAINT IF EXISTS plugin_components_type_allowed;
ALTER TABLE public.plugin_components
  ADD CONSTRAINT plugin_components_type_allowed
  CHECK (component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface'));

ALTER TABLE public.auth_provider_resources
  ALTER COLUMN connection_key DROP DEFAULT,
  ALTER COLUMN provider_kind DROP DEFAULT,
  ALTER COLUMN lifecycle_state SET DEFAULT 'native';
ALTER TABLE public.auth_provider_resources
  DROP CONSTRAINT IF EXISTS auth_provider_resources_lifecycle_state_allowed;
ALTER TABLE public.auth_provider_resources
  ADD CONSTRAINT auth_provider_resources_lifecycle_state_allowed
  CHECK (lifecycle_state IN ('native', 'denied'));

ALTER TABLE public.auth_route_clients
  DROP CONSTRAINT IF EXISTS auth_route_clients_lifecycle_allowed;
ALTER TABLE public.auth_route_clients
  ADD CONSTRAINT auth_route_clients_lifecycle_allowed
  CHECK (lifecycle_state IN ('native', 'denied'));

COMMIT;
