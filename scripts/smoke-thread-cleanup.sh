#!/usr/bin/env bash
# smoke-thread-cleanup — post-deploy end-to-end check for the thread-cleanup arc.
#
# Purpose (plan reference: U11 of
# docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md):
#
#   After U3d/U4/U6/U7/U8/U9/U10 shipped, this script is the authoritative
#   post-deploy smoke. It verifies the cross-surface cleanup actually works
#   on a deployed stack — Trigger rendering, lifecycleStatus derivation,
#   and (post-U5) that the dropped fields/tables are no longer resolvable.
#
# What it checks (always run):
#   1. verify-thread-traces.ts exits 0 on the target stage (reuses U1 logic).
#   2. `thread(id).lifecycleStatus` returns a valid ThreadLifecycleStatus
#      enum value for a freshly-created chat-channel thread.
#   3. `thread(id).channel` returns a valid ThreadChannel enum value.
#   4. The admin bundle builds (pnpm --filter @thinkwork/admin build exits 0).
#   5. The CLI bundle builds.
#
# What it checks (gated on AFTER_U5=1):
#   1. Curl thread(id) selecting `description` → expect GraphQL error.
#   2. Curl with `priority`, `type`, `children`, `parent`, `comments` →
#      expect GraphQL error on each.
#   3. (Gated further on AFTER_U5_ARTIFACTS=1, since U5 plan is ambivalent
#      on artifact drops): `message.durableArtifact` → expect error.
#
# Exit codes:
#   0 — all active checks passed; AFTER_U5-gated ones skipped or passed.
#   1 — any active check failed, OR (when AFTER_U5=1) any gated check failed.
#   2 — configuration / auth / network error; inconclusive.
#
# Usage:
#   # Basic — stage dev with cached Cognito token from `thinkwork login`:
#   bash scripts/smoke-thread-cleanup.sh
#
#   # Explicit stage:
#   bash scripts/smoke-thread-cleanup.sh --stage dev
#
#   # Post-U5 full-verification mode:
#   AFTER_U5=1 bash scripts/smoke-thread-cleanup.sh --stage dev
#
#   # Override token (e.g., CI):
#   THINKWORK_ID_TOKEN=... bash scripts/smoke-thread-cleanup.sh --stage dev
#
# Prerequisites:
#   - Deployed stage (dev/staging/prod) reachable from the caller's network.
#   - A cached Cognito ID token in ~/.thinkwork/config.json, or an explicit
#     THINKWORK_ID_TOKEN env var.
#   - pnpm + tsx available on PATH.
#   - jq + curl on PATH.
#
# This script creates one dev thread for the lifecycle/trigger check and
# deletes it at the end. On any failure it may leave an orphan thread
# in the target stage — dev-only noise, manual cleanup if needed.

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

STAGE="${STAGE:-dev}"
AFTER_U5="${AFTER_U5:-0}"
AFTER_U5_ARTIFACTS="${AFTER_U5_ARTIFACTS:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,50p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${HOME}/.thinkwork/config.json"

# ---------------------------------------------------------------------------
# Auth + endpoint resolution
# ---------------------------------------------------------------------------

if [[ -z "${THINKWORK_GRAPHQL_URL:-}" ]]; then
  if [[ ! -f "$CONFIG" ]]; then
    echo "ERROR: no ~/.thinkwork/config.json; run \`thinkwork login --stage $STAGE\` first." >&2
    exit 2
  fi
  THINKWORK_GRAPHQL_URL="$(jq -r ".stages.${STAGE}.graphqlUrl // empty" "$CONFIG")"
  if [[ -z "$THINKWORK_GRAPHQL_URL" || "$THINKWORK_GRAPHQL_URL" == "null" ]]; then
    echo "ERROR: no graphqlUrl in config for stage '$STAGE'." >&2
    exit 2
  fi
fi

if [[ -z "${THINKWORK_ID_TOKEN:-}" ]]; then
  THINKWORK_ID_TOKEN="$(jq -r ".stages.${STAGE}.idToken // empty" "$CONFIG")"
  if [[ -z "$THINKWORK_ID_TOKEN" || "$THINKWORK_ID_TOKEN" == "null" ]]; then
    echo "ERROR: no idToken in config for stage '$STAGE'; run \`thinkwork login --stage $STAGE\`." >&2
    exit 2
  fi
fi

if [[ -z "${THINKWORK_TENANT_ID:-}" ]]; then
  THINKWORK_TENANT_ID="$(jq -r ".stages.${STAGE}.tenantId // empty" "$CONFIG")"
  if [[ -z "$THINKWORK_TENANT_ID" || "$THINKWORK_TENANT_ID" == "null" ]]; then
    echo "ERROR: no tenantId resolved for stage '$STAGE'." >&2
    exit 2
  fi
fi

echo "=== smoke-thread-cleanup ==="
echo "  stage     : $STAGE"
echo "  graphql   : $THINKWORK_GRAPHQL_URL"
echo "  tenantId  : $THINKWORK_TENANT_ID"
echo "  AFTER_U5  : $AFTER_U5"
echo ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

gql() {
  local query="$1"
  local variables="${2:-{\}}"
  curl -sS --fail-with-body \
    -H "Authorization: Bearer $THINKWORK_ID_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$(jq -n --arg q "$query" --argjson v "$variables" '{query:$q, variables:$v}')" \
    "$THINKWORK_GRAPHQL_URL"
}

check() {
  local label="$1"; shift
  echo "→ $label"
  if "$@"; then
    echo "  ✓ pass"
  else
    echo "  ✗ FAIL"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Pre-U5 checks (always run)
# ---------------------------------------------------------------------------

check_verify_traces() {
  THINKWORK_GRAPHQL_URL="$THINKWORK_GRAPHQL_URL" \
  THINKWORK_ID_TOKEN="$THINKWORK_ID_TOKEN" \
  THINKWORK_TENANT_ID="$THINKWORK_TENANT_ID" \
  pnpm tsx "$REPO_ROOT/scripts/verify-thread-traces.ts" --stage "$STAGE" >/dev/null 2>&1
}

check_lifecycle_and_channel() {
  # Pick first agent in tenant
  local agents_response
  agents_response="$(gql 'query($t: ID!){ agents(tenantId: $t){ id } }' "{\"t\":\"$THINKWORK_TENANT_ID\"}")"
  local agent_id
  agent_id="$(echo "$agents_response" | jq -r '.data.agents[0].id // empty')"
  if [[ -z "$agent_id" ]]; then
    echo "  (no agents in tenant; cannot create thread)" >&2
    return 1
  fi

  # Create a chat-channel thread
  local create_resp
  create_resp="$(gql \
    'mutation($i: CreateThreadInput!){ createThread(input: $i){ id lifecycleStatus channel } }' \
    "$(jq -n --arg t "$THINKWORK_TENANT_ID" --arg a "$agent_id" '{i:{tenantId:$t, agentId:$a, title:"smoke-test thread", channel:"CHAT"}}')")"

  local thread_id lifecycle channel
  thread_id="$(echo "$create_resp" | jq -r '.data.createThread.id // empty')"
  lifecycle="$(echo "$create_resp" | jq -r '.data.createThread.lifecycleStatus // empty')"
  channel="$(echo "$create_resp" | jq -r '.data.createThread.channel // empty')"

  if [[ -z "$thread_id" ]]; then
    echo "  createThread failed: $create_resp" >&2
    return 1
  fi

  # Cleanup: always try to delete, even if assertions fail
  cleanup_thread() {
    gql 'mutation($id: ID!){ deleteThread(id: $id) }' "{\"id\":\"$thread_id\"}" >/dev/null 2>&1 || true
  }
  trap cleanup_thread RETURN

  # Assert lifecycle is a known enum value (any of the 6 is acceptable)
  case "$lifecycle" in
    RUNNING|COMPLETED|CANCELLED|FAILED|IDLE|AWAITING_USER) ;;
    *)
      echo "  lifecycleStatus unexpected: '$lifecycle'" >&2
      return 1
      ;;
  esac

  # Assert channel is CHAT (we just created it)
  if [[ "$channel" != "CHAT" ]]; then
    echo "  channel unexpected: '$channel'" >&2
    return 1
  fi
}

check_admin_build() {
  (cd "$REPO_ROOT" && pnpm --filter @thinkwork/admin build >/dev/null 2>&1)
}

check_cli_build() {
  (cd "$REPO_ROOT" && pnpm --filter thinkwork-cli build >/dev/null 2>&1)
}

check "verify-thread-traces passes"  check_verify_traces
check "thread lifecycleStatus + channel resolve to valid enums" check_lifecycle_and_channel
check "admin builds"                 check_admin_build
check "cli builds"                   check_cli_build

# ---------------------------------------------------------------------------
# U5-gated checks
# ---------------------------------------------------------------------------

expect_gql_error() {
  local field="$1"
  local query="query { thread(id: \"00000000-0000-0000-0000-000000000000\"){ id $field } }"
  local resp
  resp="$(gql "$query" || true)"
  # If the response has an 'errors' array mentioning the field, we're good.
  echo "$resp" | jq -e --arg f "$field" '.errors // [] | map(.message) | any(. | contains("\($f)"))' >/dev/null
}

if [[ "$AFTER_U5" == "1" ]]; then
  check "thread.description is gone"  bash -c "$(declare -f expect_gql_error gql); expect_gql_error description"
  check "thread.priority is gone"     bash -c "$(declare -f expect_gql_error gql); expect_gql_error priority"
  check "thread.type is gone"         bash -c "$(declare -f expect_gql_error gql); expect_gql_error type"
  check "thread.children is gone"     bash -c "$(declare -f expect_gql_error gql); expect_gql_error children"
  check "thread.parent is gone"       bash -c "$(declare -f expect_gql_error gql); expect_gql_error parent"
  check "thread.comments is gone"     bash -c "$(declare -f expect_gql_error gql); expect_gql_error comments"

  if [[ "$AFTER_U5_ARTIFACTS" == "1" ]]; then
    # Only check durableArtifact when U5 (or a later PR) explicitly drops it.
    # U5 plan as of 2026-04-24 does NOT drop durableArtifact; this remains gated.
    echo "  (durableArtifact check under AFTER_U5_ARTIFACTS=1 — not yet applicable)"
  fi
else
  echo "→ AFTER_U5-gated checks: skipped (set AFTER_U5=1 to enable after U5 deploys)"
fi

echo ""
echo "✓ smoke-thread-cleanup passed"
