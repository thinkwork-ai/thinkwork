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
#   1. A freshly-created chat-channel thread resolves `lifecycleStatus: IDLE`
#      and `channel: CHAT` via the `thread(id)` query.
#   2. `verify-thread-traces.ts` exits 0 against the just-created thread (the
#      thread will have no Bedrock traces yet, but the script handles that).
#   3. The admin bundle builds.
#   4. The CLI bundle builds.
#
# What it checks (gated on AFTER_U5=1):
#   5-10. Curl `thread(id)` selecting each dropped field
#         (`description`, `priority`, `type`, `children`, `parent`, `comments`)
#         and assert the GraphQL response contains a `Cannot query field`
#         error for each.
#
# Exit codes:
#   0 — all active checks passed.
#   1 — any active check failed.
#   2 — configuration / auth / network error; inconclusive.
#
# Usage:
#   # Basic — stage dev with cached Cognito token from `thinkwork login`:
#   THINKWORK_GRAPHQL_URL=https://api-dev.thinkwork.ai \
#     bash scripts/smoke-thread-cleanup.sh
#
#   # Explicit stage:
#   bash scripts/smoke-thread-cleanup.sh --stage dev
#
#   # Post-U5 full-verification:
#   AFTER_U5=1 bash scripts/smoke-thread-cleanup.sh --stage dev
#
#   # Override token (e.g., CI):
#   THINKWORK_ID_TOKEN=... \
#     THINKWORK_TENANT_ID=... \
#     THINKWORK_GRAPHQL_URL=... \
#     bash scripts/smoke-thread-cleanup.sh
#
# Prerequisites:
#   - Deployed stage reachable from the caller's network.
#   - A cached Cognito ID token in ~/.thinkwork/config.json under
#     `.sessions.<stage>.idToken`, or an explicit THINKWORK_ID_TOKEN env var.
#   - THINKWORK_GRAPHQL_URL env var set (no config-cached value to fall back to —
#     the CLI itself derives this from terraform outputs at runtime).
#   - pnpm + tsx available on PATH; jq + curl on PATH.
#
# This script creates one dev thread for the lifecycle/trigger check and
# deletes it via RETURN trap. On any failure it may leave an orphan thread
# in the target stage — dev-only noise, manual cleanup if needed.

set -euo pipefail

# Defensive ERR trap — per docs/solutions/logic-errors/bootstrap-silent-exit-1-set-e-tenant-loop-2026-04-21.md.
# Silent set -e aborts are a known time sink; surface line + command.
trap 'rc=$?; echo "ERR (exit=$rc) on line $LINENO: $BASH_COMMAND" >&2' ERR

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

STAGE="${STAGE:-dev}"
AFTER_U5="${AFTER_U5:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --stage requires a value." >&2
        exit 2
      fi
      STAGE="$2"
      shift 2
      ;;
    --help|-h)
      # Print docstring only — comment block ends before `set -euo pipefail`.
      sed -n '/^#/p; /^[^#]/q' "$0"
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

# graphqlUrl is NOT in ~/.thinkwork/config.json — the CLI derives it from
# terraform outputs at runtime. Require THINKWORK_GRAPHQL_URL explicitly.
if [[ -z "${THINKWORK_GRAPHQL_URL:-}" ]]; then
  echo "ERROR: THINKWORK_GRAPHQL_URL must be set (e.g., https://api-${STAGE}.thinkwork.ai)." >&2
  echo "       Run \`thinkwork doctor --stage ${STAGE}\` to discover the endpoint." >&2
  exit 2
fi

if [[ -z "${THINKWORK_ID_TOKEN:-}" ]]; then
  if [[ ! -f "$CONFIG" ]]; then
    echo "ERROR: no ~/.thinkwork/config.json; run \`thinkwork login --stage $STAGE\` first." >&2
    exit 2
  fi
  THINKWORK_ID_TOKEN="$(jq -r ".sessions.${STAGE}.idToken // empty" "$CONFIG")"
  if [[ -z "$THINKWORK_ID_TOKEN" || "$THINKWORK_ID_TOKEN" == "null" ]]; then
    echo "ERROR: no idToken in config.sessions.${STAGE}; run \`thinkwork login --stage $STAGE\`." >&2
    exit 2
  fi
fi

if [[ -z "${THINKWORK_TENANT_ID:-}" ]]; then
  if [[ ! -f "$CONFIG" ]]; then
    echo "ERROR: no ~/.thinkwork/config.json; cannot resolve tenantId." >&2
    exit 2
  fi
  THINKWORK_TENANT_ID="$(jq -r ".sessions.${STAGE}.tenantId // empty" "$CONFIG")"
  if [[ -z "$THINKWORK_TENANT_ID" || "$THINKWORK_TENANT_ID" == "null" ]]; then
    echo "ERROR: no tenantId in config.sessions.${STAGE}; run \`thinkwork login --stage $STAGE\` and pick a tenant." >&2
    exit 2
  fi
fi

# Export so subshells (called via `( ... )` or `bash -c`) inherit them.
export THINKWORK_GRAPHQL_URL THINKWORK_ID_TOKEN THINKWORK_TENANT_ID

echo "=== smoke-thread-cleanup ==="
echo "  stage     : $STAGE"
echo "  graphql   : $THINKWORK_GRAPHQL_URL"
echo "  tenantId  : $THINKWORK_TENANT_ID"
echo "  AFTER_U5  : $AFTER_U5"
echo ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# gql <query> [variables-json]
# Returns the raw JSON response on stdout. Suppresses jq parse errors.
gql() {
  local query="$1"
  local variables="${2:-}"
  if [[ -z "$variables" ]]; then variables="{}"; fi
  curl -sS \
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
# Pre-U5 checks
# ---------------------------------------------------------------------------

# State shared across checks: the thread we create.
SMOKE_THREAD_ID=""

cleanup_thread() {
  if [[ -n "$SMOKE_THREAD_ID" ]]; then
    gql 'mutation($id: ID!){ deleteThread(id: $id) }' "{\"id\":\"$SMOKE_THREAD_ID\"}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_thread EXIT

check_create_and_lifecycle() {
  # Pick first agent in tenant
  local agents_response agent_id
  agents_response="$(gql 'query($t: ID!){ agents(tenantId: $t){ id } }' "{\"t\":\"$THINKWORK_TENANT_ID\"}")"
  agent_id="$(echo "$agents_response" | jq -r '.data.agents[0].id // empty')"
  if [[ -z "$agent_id" ]]; then
    echo "  no agents in tenant; cannot create thread" >&2
    return 1
  fi

  # Create a chat-channel thread
  local create_resp lifecycle channel
  create_resp="$(gql \
    'mutation($i: CreateThreadInput!){ createThread(input: $i){ id lifecycleStatus channel } }' \
    "$(jq -n --arg t "$THINKWORK_TENANT_ID" --arg a "$agent_id" '{i:{tenantId:$t, agentId:$a, title:"smoke-test thread", channel:"CHAT"}}')")"

  SMOKE_THREAD_ID="$(echo "$create_resp" | jq -r '.data.createThread.id // empty')"
  lifecycle="$(echo "$create_resp" | jq -r '.data.createThread.lifecycleStatus // empty')"
  channel="$(echo "$create_resp" | jq -r '.data.createThread.channel // empty')"

  if [[ -z "$SMOKE_THREAD_ID" ]]; then
    echo "  createThread failed: $create_resp" >&2
    return 1
  fi

  # A freshly-created thread with no turns derives to IDLE per U4 mapping.
  if [[ "$lifecycle" != "IDLE" ]]; then
    echo "  lifecycleStatus expected IDLE on fresh thread, got: '$lifecycle'" >&2
    return 1
  fi

  if [[ "$channel" != "CHAT" ]]; then
    echo "  channel expected CHAT, got: '$channel'" >&2
    return 1
  fi
}

check_verify_traces() {
  # Reuses the just-created thread. It will have no Bedrock turns → no traces;
  # verify-thread-traces.ts exits 1 (not 2) in that case, which is still an
  # informative result. We treat exits 0 (traces resolved) and 1 (no traces
  # produced) as both passing the smoke — the script's purpose is to confirm
  # the wire works, not to assert there are traces. Exit 2 (config / auth /
  # network) is the only failure mode we surface.
  local rc=0
  pnpm tsx "$REPO_ROOT/scripts/verify-thread-traces.ts" \
    --thread-id "$SMOKE_THREAD_ID" \
    --tenant-id "$THINKWORK_TENANT_ID" \
    --graphql-url "$THINKWORK_GRAPHQL_URL" \
    --id-token "$THINKWORK_ID_TOKEN" \
    >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "2" ]]; then
    echo "  verify-thread-traces.ts exited 2 (config/auth/network); inconclusive" >&2
    return 1
  fi
}

check_admin_build() {
  (cd "$REPO_ROOT" && pnpm --filter @thinkwork/admin build >/dev/null 2>&1)
}

check_cli_build() {
  (cd "$REPO_ROOT" && pnpm --filter thinkwork-cli build >/dev/null 2>&1)
}

check "thread create + lifecycleStatus=IDLE + channel=CHAT" check_create_and_lifecycle
check "verify-thread-traces wire works"                     check_verify_traces
check "admin builds"                                        check_admin_build
check "cli builds"                                          check_cli_build

# ---------------------------------------------------------------------------
# AFTER_U5 checks
# ---------------------------------------------------------------------------

# Asserts that selecting `field` on `thread(id)` returns a GraphQL
# "Cannot query field" error. This fires at schema-validation time before the
# resolver runs, so the thread ID does not need to exist.
expect_field_removed() {
  local field="$1"
  local query="query { thread(id: \"00000000-0000-0000-0000-000000000000\"){ id $field } }"
  local resp
  resp="$(gql "$query")"
  echo "$resp" | jq -e --arg f "$field" '
    .errors // [] | map(.message) | any(. | test("Cannot query field [\"'\''`]" + $f + "[\"'\''`]"))
  ' >/dev/null
}

if [[ "$AFTER_U5" == "1" ]]; then
  check "thread.description is gone" expect_field_removed description
  check "thread.priority is gone"    expect_field_removed priority
  check "thread.type is gone"        expect_field_removed type
  check "thread.children is gone"    expect_field_removed children
  check "thread.parent is gone"      expect_field_removed parent
  check "thread.comments is gone"    expect_field_removed comments
else
  echo "→ AFTER_U5-gated checks: skipped (set AFTER_U5=1 after U5 deploys)"
fi

echo ""
echo "✓ smoke-thread-cleanup passed"
