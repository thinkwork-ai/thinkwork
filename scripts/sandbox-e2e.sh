#!/usr/bin/env bash
# sandbox-e2e.sh — thin wrapper that forwards to `pnpm sandbox:e2e` with
# a light env-var sanity check. Pre-validates the required vars so the
# operator sees "missing THINKWORK_API_URL" before vitest spins up.
#
# Usage:
#   bash scripts/sandbox-e2e.sh                  # all scenarios
#   bash scripts/sandbox-e2e.sh sandbox-pilot    # one suite
#   bash scripts/sandbox-e2e.sh --cleanup-only   # sweep stale fixtures
#
# See packages/api/test/integration/sandbox/README.md for the full env
# var list and how to source them from terraform outputs.

set -euo pipefail

REQUIRED=(
  THINKWORK_API_URL
  API_AUTH_SECRET
  DATABASE_URL
  AWS_REGION
  STAGE
  AGENTCORE_RUNTIME_LOG_GROUP
  THINKWORK_E2E_OPERATOR_EMAIL
)

missing=()
for var in "${REQUIRED[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "sandbox-e2e: missing required env vars:" >&2
  for var in "${missing[@]}"; do
    echo "  - $var" >&2
  done
  echo "" >&2
  echo "See packages/api/test/integration/sandbox/README.md for how to source them." >&2
  exit 2
fi

# Forward remaining args to vitest (scenario filter, --cleanup-only, etc.)
exec pnpm --filter @thinkwork/api sandbox:e2e -- "$@"
