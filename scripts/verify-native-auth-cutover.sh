#!/usr/bin/env bash
# Live native-auth retirement gate. AUTH_CUTOVER_START_SOAK=true records a
# revision-bound baseline only after every legacy start path is disabled.
# A later default run requires the configured soak to have elapsed with zero
# legacy AWS routes/clients, database activity, sessions, or subscriptions,
# then emits a short-lived Ed25519 attestation for migration 0263.

set -euo pipefail

trap 'rc=$?; echo "verify-native-auth-cutover: failed (exit=$rc) on line $LINENO" >&2' ERR

STAGE="${THINKWORK_STAGE:-}"
EVIDENCE_PATH="${AUTH_CUTOVER_EVIDENCE:-}"
DATABASE_CONNECTION="${DATABASE_URL:-}"
DEPLOYMENT_REVISION="${THINKWORK_RELEASE_GIT_SHA:-${GITHUB_SHA:-}}"
SIGNED_EVIDENCE_OUTPUT="${AUTH_CUTOVER_SIGNED_EVIDENCE_OUTPUT:-}"
START_SOAK="${AUTH_CUTOVER_START_SOAK:-false}"
REQUIRED_SOAK_SECONDS="${AUTH_CUTOVER_REQUIRED_SOAK_SECONDS:-}"
USER_POOL_ID="${COGNITO_USER_POOL_ID:-}"
API_ID="${THINKWORK_API_ID:-}"

# The deployed legacy clients issue one-hour ID/access tokens. AWS AppSync
# GraphQL WebSocket connections can remain open for 24 hours, which is the
# dominant drain bound after all legacy start paths and clients are disabled.
MAX_LEGACY_TOKEN_LIFETIME_SECONDS=3600
MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS=86400
MIN_SAFE_SOAK_SECONDS=$MAX_LEGACY_TOKEN_LIFETIME_SECONDS
if [ "$MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS" -gt "$MIN_SAFE_SOAK_SECONDS" ]; then
  MIN_SAFE_SOAK_SECONDS=$MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS
fi

usage() {
  echo "usage: THINKWORK_STAGE=<stage> THINKWORK_RELEASE_GIT_SHA=<sha> DATABASE_URL=<url> COGNITO_USER_POOL_ID=<pool> THINKWORK_API_ID=<http-api> AUTH_CUTOVER_EVIDENCE=<inventory.json> [AUTH_CUTOVER_START_SOAK=true AUTH_CUTOVER_REQUIRED_SOAK_SECONDS=<seconds>] bash scripts/verify-native-auth-cutover.sh" >&2
}

if [ -z "$STAGE" ] || [ -z "$EVIDENCE_PATH" ] || [ -z "$DATABASE_CONNECTION" ] || [ -z "$DEPLOYMENT_REVISION" ] || [ -z "$USER_POOL_ID" ] || [ -z "$API_ID" ]; then
  usage
  exit 2
fi
if ! [[ "$DEPLOYMENT_REVISION" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]]; then
  echo "verify-native-auth-cutover: deployed revision must be a full Git SHA" >&2
  exit 2
fi
if [ "$START_SOAK" != "true" ] && [ "$START_SOAK" != "false" ]; then
  echo "verify-native-auth-cutover: AUTH_CUTOVER_START_SOAK must be true or false" >&2
  exit 2
fi
if [ "$START_SOAK" = "true" ] && ! [[ "$REQUIRED_SOAK_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "verify-native-auth-cutover: starting a soak requires a positive AUTH_CUTOVER_REQUIRED_SOAK_SECONDS" >&2
  exit 2
fi
if [ "$START_SOAK" = "true" ] && [ "$REQUIRED_SOAK_SECONDS" -lt "$MIN_SAFE_SOAK_SECONDS" ]; then
  echo "verify-native-auth-cutover: soak must be at least ${MIN_SAFE_SOAK_SECONDS}s (max of legacy token ${MAX_LEGACY_TOKEN_LIFETIME_SECONDS}s and AppSync connection ${MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS}s)" >&2
  exit 2
fi
if [ ! -f "$EVIDENCE_PATH" ]; then
  echo "verify-native-auth-cutover: evidence file not found: $EVIDENCE_PATH" >&2
  exit 2
fi
for command_name in aws jq psql pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "verify-native-auth-cutover: required command is unavailable: $command_name" >&2
    exit 2
  fi
done

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

inventory_fingerprint=$(jq -er '.inventoryFingerprint | select(test("^[a-f0-9]{64}$"))' "$EVIDENCE_PATH")

# These are live AWS control-plane measurements, not operator assertions.
legacy_clients_enabled=$(aws cognito-idp list-user-pool-clients \
  --user-pool-id "$USER_POOL_ID" --max-results 60 --output json \
  | jq '[.UserPoolClients[]? | select(.ClientName == "ThinkworkAdminLegacy" or .ClientName == "ThinkworkMobileLegacy")] | length')
workos_starts_enabled=$(aws apigatewayv2 get-routes --api-id "$API_ID" --output json \
  | jq '[.Items[]? | select((.RouteKey // "") | test(" /api/auth/workos/"))] | length')

# One compact read-only snapshot. pg_stat_user_tables gives a monotonic baseline
# for reads/writes to the two rollback tables, so activity during the soak is
# measurable even when it does not create a persistent row.
live_evidence=$(psql "$DATABASE_CONNECTION" -X -qAt \
  --set=ON_ERROR_STOP=1 \
  --set=stage="$STAGE" \
  --set=fingerprint="$inventory_fingerprint" <<'SQL'
WITH matching_run AS (
  SELECT id, status, terminal_dispositions, drain_evidence, started_at
  FROM auth_cutover_runs
  WHERE stage = :'stage'
    AND inventory_fingerprint = :'fingerprint'
), workos_stats AS (
  SELECT
    COALESCE(sum(seq_scan + idx_scan), 0)::bigint AS table_reads,
    COALESCE(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint AS table_writes
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
    AND relname IN ('workos_auth_bridges', 'workos_auth_sessions')
), database_stats AS (
  SELECT stats_reset
  FROM pg_stat_database
  WHERE datname = current_database()
), live_counts AS (
  SELECT
    (SELECT count(*) FROM matching_run) AS matching_runs,
    (SELECT id FROM matching_run LIMIT 1) AS run_id,
    (SELECT status FROM matching_run LIMIT 1) AS run_status,
    (SELECT started_at FROM matching_run LIMIT 1) AS started_at,
    (SELECT drain_evidence->>'soakStartedAt' FROM matching_run LIMIT 1) AS soak_started_at,
    COALESCE((SELECT (drain_evidence->>'requiredSoakSeconds')::integer FROM matching_run LIMIT 1), 0) AS required_soak_seconds,
    (SELECT drain_evidence->>'deploymentRevision' FROM matching_run LIMIT 1) AS soak_deployment_revision,
    COALESCE((SELECT (drain_evidence->>'baselineWorkosTableReads')::bigint FROM matching_run LIMIT 1), -1) AS baseline_table_reads,
    COALESCE((SELECT (drain_evidence->>'baselineWorkosTableWrites')::bigint FROM matching_run LIMIT 1), -1) AS baseline_table_writes,
    (SELECT drain_evidence->>'baselineDatabaseStatsResetAt' FROM matching_run LIMIT 1) AS baseline_database_stats_reset_at,
    (SELECT table_reads FROM workos_stats) AS current_table_reads,
    (SELECT table_writes FROM workos_stats) AS current_table_writes,
    (SELECT stats_reset FROM database_stats) AS current_database_stats_reset_at,
    COALESCE((SELECT (terminal_dispositions->>'workosDirectoryComplete')::boolean FROM matching_run LIMIT 1), false) AS workos_directory_complete,
    COALESCE((SELECT (terminal_dispositions->>'workosUnresolved')::integer FROM matching_run LIMIT 1), -1) AS workos_unresolved,
    COALESCE((SELECT (terminal_dispositions->>'signoutExpected')::integer FROM matching_run LIMIT 1), -1) AS signout_expected,
    COALESCE((SELECT (terminal_dispositions->>'signoutAttempts')::integer FROM matching_run LIMIT 1), -1) AS signout_attempts,
    COALESCE((SELECT (terminal_dispositions->>'signoutFailures')::integer FROM matching_run LIMIT 1), -1) AS signout_failures,
    (SELECT count(*) FROM workos_auth_bridges WHERE status = 'pending' AND expires_at > now()) AS pending_bridges,
    (SELECT count(*) FROM workos_auth_sessions WHERE status = 'active' AND expires_at > now()) AS active_sessions,
    (SELECT count(*) FROM auth_provider_resources
      WHERE (provider_kind = 'legacy_workos' OR lifecycle_state = 'coexistence')
        AND public_options_published = true) AS workos_starts_published,
    (SELECT count(*) FROM auth_route_clients WHERE lifecycle_state = 'coexistence') AS legacy_route_clients,
    (SELECT count(*) FROM auth_subscription_tickets ticket
      JOIN auth_route_clients client ON client.id = ticket.auth_route_client_id
      WHERE client.lifecycle_state = 'coexistence'
        AND ticket.status = 'issued'
        AND ticket.expires_at > now()) AS active_legacy_subscriptions,
    (SELECT count(*) FROM workos_auth_bridges bridge, matching_run run
      WHERE run.drain_evidence->>'soakStartedAt' IS NOT NULL
        AND bridge.created_at >= (run.drain_evidence->>'soakStartedAt')::timestamptz) +
    (SELECT count(*) FROM workos_auth_sessions session, matching_run run
      WHERE run.drain_evidence->>'soakStartedAt' IS NOT NULL
        AND session.created_at >= (run.drain_evidence->>'soakStartedAt')::timestamptz) AS recent_legacy_route_traffic,
    (SELECT count(*) FROM compliance.audit_outbox event, matching_run run
      WHERE run.drain_evidence->>'soakStartedAt' IS NOT NULL
        AND event.occurred_at >= (run.drain_evidence->>'soakStartedAt')::timestamptz
        AND event.action = 'workos_signout'
        AND COALESCE(event.outcome, '') NOT IN ('workos_logout_url_issued', 'workos_session_revoked')) AS legacy_signout_audit_failures
)
SELECT json_build_object(
  'matchingRuns', matching_runs,
  'runId', run_id,
  'runStatus', run_status,
  'startedAt', started_at,
  'databaseObservedAt', now(),
  'soakStartedAt', soak_started_at,
  'requiredSoakSeconds', required_soak_seconds,
  'soakDeploymentRevision', soak_deployment_revision,
  'soakElapsed', CASE WHEN soak_started_at IS NULL THEN false ELSE now() >= soak_started_at::timestamptz + make_interval(secs => required_soak_seconds) END,
  'workosDirectoryComplete', workos_directory_complete,
  'workosUnresolved', workos_unresolved,
  'signoutExpected', signout_expected,
  'signoutAttempts', signout_attempts,
  'pendingBridges', pending_bridges,
  'activeSessions', active_sessions,
  'workosStartsPublished', workos_starts_published,
  'legacyRouteClients', legacy_route_clients,
  'activeLegacySubscriptions', active_legacy_subscriptions,
  'recentLegacyRouteTraffic', recent_legacy_route_traffic,
  'signoutFailures', signout_failures,
  'legacySignoutAuditFailures', legacy_signout_audit_failures,
  'currentWorkosTableReads', current_table_reads,
  'currentWorkosTableWrites', current_table_writes,
  'baselineWorkosTableReads', baseline_table_reads,
  'baselineWorkosTableWrites', baseline_table_writes,
  'baselineDatabaseStatsResetAt', baseline_database_stats_reset_at,
  'currentDatabaseStatsResetAt', current_database_stats_reset_at,
  'statisticsResetEpochMatches', baseline_database_stats_reset_at IS NOT NULL
    AND current_database_stats_reset_at IS NOT NULL
    AND baseline_database_stats_reset_at::timestamptz = current_database_stats_reset_at,
  'statisticsCountersMonotonic', current_table_reads >= baseline_table_reads
    AND current_table_writes >= baseline_table_writes,
  'recentWorkosTableReads', current_table_reads - baseline_table_reads,
  'recentWorkosTableWrites', current_table_writes - baseline_table_writes
)::text
FROM live_counts;
SQL
)

base_gate=$(jq -n \
  --argjson live "$live_evidence" \
  --argjson aws_clients "$legacy_clients_enabled" \
  --argjson aws_starts "$workos_starts_enabled" \
  '$live.matchingRuns == 1 and
   $live.workosDirectoryComplete == true and
   $live.workosUnresolved == 0 and
   $live.pendingBridges == 0 and
   $live.activeSessions == 0 and
   $live.workosStartsPublished == 0 and
   $live.legacyRouteClients == 0 and
   $live.activeLegacySubscriptions == 0 and
   $aws_clients == 0 and
   $aws_starts == 0')

if [ "$base_gate" != "true" ]; then
  jq -cn --arg stage "$STAGE" --arg fingerprint "$inventory_fingerprint" \
    --argjson live "$live_evidence" --argjson legacyClients "$legacy_clients_enabled" \
    --argjson workosStarts "$workos_starts_enabled" \
    '{ok:false, stage:$stage, inventoryFingerprint:$fingerprint, live:$live, aws:{legacyClientsEnabled:$legacyClients,workosStartsEnabled:$workosStarts}}' >&2
  exit 1
fi

if [ "$START_SOAK" = "true" ]; then
  if ! jq -e '.runStatus == "ready" or .runStatus == "cutting_over" or .runStatus == "soaking"' <<<"$live_evidence" >/dev/null; then
    echo "verify-native-auth-cutover: inventory must be ready, cutting_over, or soaking before a soak can start" >&2
    exit 1
  fi
  soak_started_at=$(jq -er '.databaseObservedAt' <<<"$live_evidence")
  baseline_reads=$(jq -er '.currentWorkosTableReads' <<<"$live_evidence")
  baseline_writes=$(jq -er '.currentWorkosTableWrites' <<<"$live_evidence")
  baseline_stats_reset_at=$(jq -er '.currentDatabaseStatsResetAt | select(type == "string" and length > 0)' <<<"$live_evidence")

  # Revoke every distinct legacy Cognito principal before starting the drain
  # clock. Aggregate expected/attempt/failure counts are persisted on the run,
  # so a zero-row or partially attempted operation cannot satisfy retirement.
  principal_file="$tmp_dir/legacy-cognito-principals"
  psql "$DATABASE_CONNECTION" -X -qAt --set=ON_ERROR_STOP=1 \
    -c "SELECT DISTINCT cognito_username FROM workos_auth_sessions WHERE cognito_username IS NOT NULL AND btrim(cognito_username) <> '' ORDER BY cognito_username" \
    >"$principal_file"
  signout_expected=$(wc -l <"$principal_file" | tr -d ' ')
  signout_attempts=0
  signout_failures=0
  while IFS= read -r cognito_username; do
    [ -n "$cognito_username" ] || continue
    signout_attempts=$((signout_attempts + 1))
    if ! aws cognito-idp admin-user-global-sign-out \
      --user-pool-id "$USER_POOL_ID" --username "$cognito_username" >/dev/null 2>&1; then
      signout_failures=$((signout_failures + 1))
    fi
  done <"$principal_file"

  psql "$DATABASE_CONNECTION" -X -qAt --set=ON_ERROR_STOP=1 \
    --set=stage="$STAGE" --set=fingerprint="$inventory_fingerprint" \
    --set=signout_expected="$signout_expected" --set=signout_attempts="$signout_attempts" \
    --set=signout_failures="$signout_failures" <<'SQL'
UPDATE auth_cutover_runs
SET terminal_dispositions = COALESCE(terminal_dispositions, '{}'::jsonb) || jsonb_build_object(
      'signoutExpected', :'signout_expected'::integer,
      'signoutAttempts', :'signout_attempts'::integer,
      'signoutFailures', :'signout_failures'::integer
    )
WHERE stage = :'stage'
  AND inventory_fingerprint = :'fingerprint'
  AND status IN ('ready', 'cutting_over', 'soaking')
RETURNING id;
SQL
  if [ "$signout_expected" -le 0 ] || [ "$signout_attempts" -ne "$signout_expected" ] || [ "$signout_failures" -ne 0 ]; then
    echo "verify-native-auth-cutover: global sign-out incomplete (expected=$signout_expected attempts=$signout_attempts failures=$signout_failures)" >&2
    exit 1
  fi
  psql "$DATABASE_CONNECTION" -X -qAt --set=ON_ERROR_STOP=1 \
    --set=stage="$STAGE" --set=fingerprint="$inventory_fingerprint" \
    --set=soak_started_at="$soak_started_at" --set=required_soak_seconds="$REQUIRED_SOAK_SECONDS" \
    --set=revision="$DEPLOYMENT_REVISION" --set=baseline_reads="$baseline_reads" \
    --set=baseline_writes="$baseline_writes" --set=baseline_stats_reset_at="$baseline_stats_reset_at" <<'SQL'
UPDATE auth_cutover_runs
SET status = 'soaking',
    drain_evidence = COALESCE(drain_evidence, '{}'::jsonb) || jsonb_build_object(
      'guardEnabled', true,
      'soakStartedAt', :'soak_started_at',
      'requiredSoakSeconds', :'required_soak_seconds'::integer,
      'deploymentRevision', :'revision',
      'baselineWorkosTableReads', :'baseline_reads'::bigint,
      'baselineWorkosTableWrites', :'baseline_writes'::bigint,
      'baselineDatabaseStatsResetAt', :'baseline_stats_reset_at'
    )
WHERE stage = :'stage'
  AND inventory_fingerprint = :'fingerprint'
  AND status IN ('ready', 'cutting_over', 'soaking')
RETURNING id;
SQL
  jq -cn --arg stage "$STAGE" --arg fingerprint "$inventory_fingerprint" \
    --arg soakStartedAt "$soak_started_at" --argjson requiredSoakSeconds "$REQUIRED_SOAK_SECONDS" \
    --arg revision "$DEPLOYMENT_REVISION" \
    --argjson minimumSafeSoakSeconds "$MIN_SAFE_SOAK_SECONDS" \
    --arg databaseStatsResetAt "$baseline_stats_reset_at" \
    '{ok:true, mode:"soak-started", stage:$stage, inventoryFingerprint:$fingerprint, soakStartedAt:$soakStartedAt, requiredSoakSeconds:$requiredSoakSeconds, minimumSafeSoakSeconds:$minimumSafeSoakSeconds, databaseStatsResetAt:$databaseStatsResetAt, deploymentRevision:$revision}'
  exit 0
fi

if ! jq -e --arg revision "$DEPLOYMENT_REVISION" \
  --argjson minimumSoak "$MIN_SAFE_SOAK_SECONDS" '
  .runStatus == "soaking" and
  .soakDeploymentRevision == $revision and
  .requiredSoakSeconds >= $minimumSoak and
  .soakElapsed == true and
  .statisticsResetEpochMatches == true and
  .statisticsCountersMonotonic == true and
  .recentLegacyRouteTraffic == 0 and
  .recentWorkosTableReads == 0 and
  .recentWorkosTableWrites == 0 and
  .signoutExpected > 0 and
  .signoutAttempts == .signoutExpected and
  .signoutFailures == 0 and
  .legacySignoutAuditFailures == 0
' <<<"$live_evidence" >/dev/null; then
  jq -cn --arg stage "$STAGE" --arg fingerprint "$inventory_fingerprint" \
    --argjson live "$live_evidence" '{ok:false, reason:"soak-incomplete-or-active", stage:$stage, inventoryFingerprint:$fingerprint, live:$live}' >&2
  exit 1
fi

unsigned_path="$tmp_dir/auth-cutover-unsigned.json"
signed_path="$tmp_dir/auth-cutover-signed.json"
observed_at=$(jq -nr 'now | todateiso8601')
expires_at=$(jq -nr 'now + 600 | todateiso8601')
run_id=$(jq -er '.runId' <<<"$live_evidence")

# Build the attested document entirely from the inventory fingerprint plus live
# AWS/database measurements. No operator-supplied completion predicate survives.
jq -cn \
  --arg stage "$STAGE" --arg run_id "$run_id" --arg revision "$DEPLOYMENT_REVISION" \
  --arg observed_at "$observed_at" --arg expires_at "$expires_at" \
  --arg fingerprint "$inventory_fingerprint" --argjson live "$live_evidence" \
  --argjson aws_clients "$legacy_clients_enabled" --argjson aws_starts "$workos_starts_enabled" \
  '{
    schemaVersion:1,
    domain:"thinkwork.auth-cutover-evidence.v1",
    source:"verify-native-auth-cutover",
    stage:$stage,
    runId:$run_id,
    deploymentRevision:$revision,
    observedAt:$observed_at,
    expiresAt:$expires_at,
    inventoryFingerprint:$fingerprint,
    terminalDispositions:{
      allTerminal:($live.workosDirectoryComplete and $live.workosUnresolved == 0),
      unresolved:$live.workosUnresolved,
      signoutExpected:$live.signoutExpected,
      signoutAttempts:$live.signoutAttempts,
      signoutFailures:$live.signoutFailures,
      compatibilityFallbackReads:$live.recentLegacyRouteTraffic
    },
    clientShutdownEvidence:{
      workosStartsEnabled:($aws_starts != 0 or $live.workosStartsPublished != 0),
      legacyClientsEnabled:($aws_clients + $live.legacyRouteClients),
      legacyAudiencesAccepted:$aws_clients
    },
    drainEvidence:{
      drainCompleted:$live.soakElapsed,
      legacyRouteTraffic:$live.recentLegacyRouteTraffic,
      workosTableReads:$live.recentWorkosTableReads,
      workosTableWrites:$live.recentWorkosTableWrites,
      activeLegacySubscriptions:$live.activeLegacySubscriptions,
      databaseStatsResetAt:$live.currentDatabaseStatsResetAt
    }
  }' >"$unsigned_path"

THINKWORK_RELEASE_GIT_SHA="$DEPLOYMENT_REVISION" \
  pnpm --filter @thinkwork/api exec tsx scripts/finalize-auth-cutover.ts \
  --evidence "$unsigned_path" --attest >"$signed_path"

validated_evidence=$(THINKWORK_RELEASE_GIT_SHA="$DEPLOYMENT_REVISION" \
  pnpm --filter @thinkwork/api exec tsx scripts/finalize-auth-cutover.ts \
  --evidence "$signed_path")

if [ -n "$SIGNED_EVIDENCE_OUTPUT" ]; then
  mkdir -p "$(dirname "$SIGNED_EVIDENCE_OUTPUT")"
  install -m 600 "$signed_path" "$SIGNED_EVIDENCE_OUTPUT"
fi

jq -cn --arg stage "$STAGE" --arg fingerprint "$inventory_fingerprint" \
  --argjson validator "$validated_evidence" --argjson live "$live_evidence" \
  --argjson attested "$(cat "$signed_path")" --arg signedEvidenceOutput "$SIGNED_EVIDENCE_OUTPUT" \
  '{ok:true, stage:$stage, inventoryFingerprint:$fingerprint, validator:$validator, live:$live, attestedEvidence:$attested, signedEvidenceOutput:(if $signedEvidenceOutput == "" then null else $signedEvidenceOutput end)}'
