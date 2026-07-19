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
-- creates-constraint: public.plugin_components.plugin_components_type_allowed
-- creates-constraint: public.auth_provider_resources.auth_provider_resources_lifecycle_state_allowed
-- creates-constraint: public.auth_route_clients.auth_route_clients_lifecycle_allowed
-- deployment-phase: auth-retired

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

SELECT pg_advisory_xact_lock(hashtext('drop_workos_auth_runtime'));
SELECT set_config('thinkwork.auth_retirement_stage', :'stage', true);

DO $$
DECLARE
  cutover record;
  residue_exists boolean;
  table_has_rows boolean;
  pending_count bigint;
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;

  SELECT
    EXISTS (
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

  IF to_regclass('public.workos_auth_bridges') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.workos_auth_bridges)'
      INTO table_has_rows;
    residue_exists := residue_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.workos_auth_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.workos_auth_sessions)'
      INTO table_has_rows;
    residue_exists := residue_exists OR table_has_rows;
  END IF;

  IF NOT residue_exists THEN
    RAISE NOTICE 'No WorkOS auth data exists — empty historical tables may be retired without cutover evidence';
    RETURN;
  END IF;

  SELECT * INTO cutover
  FROM public.auth_cutover_runs
  WHERE stage = current_setting('thinkwork.auth_retirement_stage')
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF cutover.id IS NULL THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: no auth_cutover_runs evidence for stage %',
      current_setting('thinkwork.auth_retirement_stage');
  END IF;

  IF cutover.status <> 'complete' OR cutover.completed_at IS NULL THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: newest auth_cutover_runs evidence for stage % is %',
      current_setting('thinkwork.auth_retirement_stage'), cutover.status;
  END IF;

  IF COALESCE((cutover.terminal_dispositions->>'allTerminal')::boolean, false) IS NOT TRUE
    OR COALESCE((cutover.terminal_dispositions->>'unresolved')::bigint, -1) <> 0
    OR COALESCE((cutover.terminal_dispositions->>'signoutExpected')::bigint, -1) <= 0
    OR COALESCE((cutover.terminal_dispositions->>'signoutAttempts')::bigint, -1)
      <> COALESCE((cutover.terminal_dispositions->>'signoutExpected')::bigint, -2)
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

  IF COALESCE(cutover.drain_evidence->'provenance'->>'domain', '')
      <> 'thinkwork.auth-cutover-evidence.v1'
    OR COALESCE(cutover.drain_evidence->'provenance'->>'source', '')
      <> 'verify-native-auth-cutover'
    OR COALESCE(cutover.drain_evidence->'provenance'->>'stage', '')
      <> current_setting('thinkwork.auth_retirement_stage')
    OR COALESCE(cutover.drain_evidence->'provenance'->>'runId', '') <> cutover.id::text
    OR COALESCE(cutover.drain_evidence->'provenance'->>'deploymentRevision', '')
      !~ '^([a-f0-9]{40}|[a-f0-9]{64})$'
    OR COALESCE(cutover.drain_evidence->'provenance'->>'payloadHash', '')
      !~ '^[a-f0-9]{64}$'
    OR length(COALESCE(cutover.drain_evidence->'provenance'->>'signature', '')) < 40
    OR (cutover.drain_evidence->'provenance'->>'observedAt')::timestamptz < cutover.started_at
    OR cutover.completed_at < (cutover.drain_evidence->'provenance'->>'observedAt')::timestamptz
    OR cutover.completed_at > (cutover.drain_evidence->'provenance'->>'expiresAt')::timestamptz
  THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: signed stage/revision/time provenance is missing or stale';
  END IF;

  IF COALESCE((cutover.drain_evidence->>'guardEnabled')::boolean, false) IS NOT TRUE
    -- AppSync GraphQL WebSocket connections can survive for 24 hours, longer
    -- than the legacy clients' one-hour ID/access tokens.
    OR COALESCE((cutover.drain_evidence->>'requiredSoakSeconds')::bigint, 0) < 86400
    OR COALESCE(cutover.drain_evidence->>'deploymentRevision', '')
      <> COALESCE(cutover.drain_evidence->'provenance'->>'deploymentRevision', '')
    OR cutover.drain_evidence->>'baselineDatabaseStatsResetAt' IS NULL
    OR cutover.drain_evidence->>'databaseStatsResetAt' IS NULL
    OR cutover.drain_evidence->>'baselineDatabaseStatsResetAt'
      <> cutover.drain_evidence->>'databaseStatsResetAt'
    OR cutover.drain_evidence->>'soakStartedAt' IS NULL
    OR (cutover.drain_evidence->'provenance'->>'observedAt')::timestamptz
      < (cutover.drain_evidence->>'soakStartedAt')::timestamptz
        + make_interval(secs => (cutover.drain_evidence->>'requiredSoakSeconds')::integer)
  THEN
    RAISE EXCEPTION 'WorkOS retirement blocked: revision-bound drain soak is missing or incomplete';
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
