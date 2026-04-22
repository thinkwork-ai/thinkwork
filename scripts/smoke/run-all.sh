#!/usr/bin/env bash
# run-all.sh — aggregator for the skill_runs smoke suite.
#
# Runs each individual smoke script in sequence, fails fast on the first
# FAIL, and prints one line per path. Exits 0 only if every path passes.
#
# Usage:
#   scripts/smoke/run-all.sh \
#     --tenant-id <uuid> \
#     --invoker-user-id <uuid> \
#     [--ci]
#
# Flags:
#   --ci       Filter to the CI-safe subset: chat + catalog only.
#              Skips scheduled-smoke (mutates scheduled_jobs, gated on
#              --force) and webhook-smoke (needs a pre-provisioned
#              signing secret per tenant).
#
# Env:
#   STAGE=dev                     forwarded to each script
#   AWS_REGION=us-east-1
#
# Exit codes:
#   0 — every path PASSed
#   1 — at least one path FAILed
#   2 — usage / env error

set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"

TENANT_ID=""
INVOKER_USER_ID=""
CI_MODE=0

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)         TENANT_ID="$2"; shift 2 ;;
    --invoker-user-id)   INVOKER_USER_ID="$2"; shift 2 ;;
    --ci)                CI_MODE=1; shift ;;
    --help|-h)           usage; exit 0 ;;
    *) echo "run-all: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TENANT_ID" || -z "$INVOKER_USER_ID" ]]; then
  echo "run-all: --tenant-id and --invoker-user-id are required" >&2
  usage >&2
  exit 2
fi

declare -a PLAN
PLAN+=("chat")
PLAN+=("catalog")
if [[ "$CI_MODE" -ne 1 ]]; then
  PLAN+=("scheduled")
fi

FAILS=0
declare -a RESULTS

for path in "${PLAN[@]}"; do
  echo "" >&2
  echo "=== $path ===" >&2
  case "$path" in
    chat)
      if OUT=$(bash "$SMOKE_DIR/chat-smoke.sh" \
          --tenant-id "$TENANT_ID" \
          --invoker-user-id "$INVOKER_USER_ID" 2>&1); then
        RESULTS+=("${OUT##*$'\n'}")
      else
        RESULTS+=("${OUT##*$'\n'}")
        FAILS=$((FAILS + 1))
      fi
      ;;
    catalog)
      if OUT=$(bash "$SMOKE_DIR/catalog-smoke.sh" \
          --tenant-id "$TENANT_ID" \
          --invoker-user-id "$INVOKER_USER_ID" 2>&1); then
        RESULTS+=("${OUT##*$'\n'}")
      else
        RESULTS+=("${OUT##*$'\n'}")
        FAILS=$((FAILS + 1))
      fi
      ;;
    scheduled)
      if OUT=$(bash "$SMOKE_DIR/scheduled-smoke.sh" --force \
          --tenant-id "$TENANT_ID" \
          --invoker-user-id "$INVOKER_USER_ID" 2>&1); then
        RESULTS+=("${OUT##*$'\n'}")
      else
        RESULTS+=("${OUT##*$'\n'}")
        FAILS=$((FAILS + 1))
      fi
      ;;
  esac
done

echo "" >&2
echo "=== summary ===" >&2
for line in "${RESULTS[@]}"; do
  echo "$line"
done

if [[ "$FAILS" -gt 0 ]]; then
  echo "run-all: $FAILS path(s) FAILED" >&2
  exit 1
fi
echo "run-all: all paths PASSED" >&2
exit 0
