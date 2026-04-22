#!/usr/bin/env bash
# complete-smoke.sh — end-to-end smoke that a composition can reach
# `skill_runs.status = 'complete'`.
#
# Dispatches the `smoke-package-only` composition against the deployed
# stack and asserts the row terminates at `complete` (not `failed`).
# Proves the composable-skill system works end-to-end — the dispatch
# closure successfully invokes a script sub-skill (`package`),
# composition_runner aggregates the output, and the completion
# callback updates skill_runs.status.
#
# Usage:
#   scripts/smoke/complete-smoke.sh \
#     --tenant-id <uuid> \
#     --invoker-user-id <uuid> \
#     [--skill-id smoke-package-only] \
#     [--timeout 60]
#
# Env:
#   STAGE=dev                     terraform workspace
#   AWS_REGION=us-east-1
#   API_URL, API_AUTH_SECRET,
#   DATABASE_URL                  pre-set to skip terraform/secrets lookups
#
# Exit codes:
#   0 — PASS (status=complete)
#   1 — FAIL (status=failed, timeout, or dispatch error)
#   2 — usage / env error

set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_env.sh
source "$SMOKE_DIR/_env.sh"

TENANT_ID=""
INVOKER_USER_ID=""
SKILL_ID="smoke-package-only"
TIMEOUT="60"

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)         TENANT_ID="$2"; shift 2 ;;
    --invoker-user-id)   INVOKER_USER_ID="$2"; shift 2 ;;
    --skill-id)          SKILL_ID="$2"; shift 2 ;;
    --timeout)           TIMEOUT="$2"; shift 2 ;;
    --help|-h)           usage; exit 0 ;;
    *) echo "complete-smoke: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TENANT_ID" || -z "$INVOKER_USER_ID" ]]; then
  echo "complete-smoke: --tenant-id and --invoker-user-id are required" >&2
  usage >&2
  exit 2
fi

preflight_skill_runs_schema

# smoke-package-only composition accepts {synthesis, format}. Use a
# unique synthesis string per run so the dedup hash differs.
REQ_BODY="$(
  TW_TENANT_ID="$TENANT_ID" \
  TW_INVOKER="$INVOKER_USER_ID" \
  TW_SKILL="$SKILL_ID" \
  TW_STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$" \
  python3 -c '
import json, os
stamp = os.environ["TW_STAMP"]
synthesis = (
    "complete-smoke " + stamp +
    " — if this text appears in the rendered deliverable, the pipeline works."
)
print(json.dumps({
    "tenantId": os.environ["TW_TENANT_ID"],
    "invokerUserId": os.environ["TW_INVOKER"],
    "skillId": os.environ["TW_SKILL"],
    "invocationSource": "catalog",
    "inputs": {"synthesis": synthesis, "format": "sales_brief"},
}))
'
)"

echo "complete-smoke: POST $API_URL/api/skills/start (skillId=$SKILL_ID)" >&2

HTTP_BODY="$(mktemp)"
trap 'rm -f "$HTTP_BODY"' EXIT
HTTP_CODE="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' -X POST \
  "$API_URL/api/skills/start" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_AUTH_SECRET" \
  --data-binary "$REQ_BODY" || echo 000)"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "complete-smoke: HTTP $HTTP_CODE body=$(head -c 300 < "$HTTP_BODY")" >&2
  echo "FAIL:dispatch_http_$HTTP_CODE"
  exit 1
fi

RUN_ID="$(python3 -c "import json,sys; print(json.load(open('$HTTP_BODY'))['runId'])")"
echo "complete-smoke: inserted skill_run id=$RUN_ID — polling up to ${TIMEOUT}s" >&2

wait_for_terminal_status "$RUN_ID" "$TIMEOUT"

# Unlike the chat/catalog/scheduled smokes, this one REQUIRES status=complete.
# A clean failure-at-connector is NOT an acceptable outcome — the whole point
# of this probe is to confirm the dispatch path can reach complete.
if [[ "$SMOKE_RESULT_STATUS" != "complete" ]]; then
  echo "FAIL:expected_complete_got_${SMOKE_RESULT_STATUS} run_id=$RUN_ID reason=${SMOKE_RESULT_REASON:-none}"
  exit 1
fi

echo "PASS complete run_id=$RUN_ID status=complete"
