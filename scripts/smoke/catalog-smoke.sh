#!/usr/bin/env bash
# catalog-smoke.sh — end-to-end smoke for the catalog invocation path.
#
# POSTs a sales-prep composition to /api/skills/start with
# invocationSource=catalog, then polls skill_runs until the row
# transitions out of `running`. Exits 0 with a single `PASS …` line or
# 1 with `FAIL:<reason>`.
#
# What this covers:
#   * Service-endpoint auth (Bearer API_AUTH_SECRET)
#   * skill_runs insert under the correct (tenant, invoker, source)
#   * agentcore-invoke Lambda dispatch (RequestResponse)
#   * composition_runner lifecycle transition out of `running`
#
# What this does NOT cover:
#   * The admin UI's GraphQL startSkillRun mutation path (needs a
#     Cognito JWT — left to the manual "admin Run now" check).
#   * End-to-end delivery (no real connectors wired; the composition
#     will reach the gather step and fail at crm_account_summary or
#     similar — that failure IS the passing condition).
#
# Usage:
#   scripts/smoke/catalog-smoke.sh \
#     --tenant-id <uuid> \
#     --invoker-user-id <uuid> \
#     [--skill-id sales-prep] \
#     [--fixture scripts/smoke/fixtures/sales-prep-catalog.json] \
#     [--timeout 60]
#
# Env:
#   STAGE=dev                     terraform workspace
#   AWS_REGION=us-east-1
#   API_URL, API_AUTH_SECRET,
#   DATABASE_URL                  pre-set to skip terraform/secrets lookups
#
# Exit codes:
#   0 — PASS
#   1 — FAIL (composition stuck in running past timeout, or dispatch 4xx/5xx)
#   2 — usage / env resolution error

set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_env.sh
source "$SMOKE_DIR/_env.sh"

TENANT_ID=""
INVOKER_USER_ID=""
SKILL_ID="sales-prep"
FIXTURE="$SMOKE_DIR/fixtures/sales-prep-catalog.json"
TIMEOUT="60"

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)         TENANT_ID="$2"; shift 2 ;;
    --invoker-user-id)   INVOKER_USER_ID="$2"; shift 2 ;;
    --skill-id)          SKILL_ID="$2"; shift 2 ;;
    --fixture)           FIXTURE="$2"; shift 2 ;;
    --timeout)           TIMEOUT="$2"; shift 2 ;;
    --help|-h)           usage; exit 0 ;;
    *) echo "catalog-smoke: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TENANT_ID" || -z "$INVOKER_USER_ID" ]]; then
  echo "catalog-smoke: --tenant-id and --invoker-user-id are required" >&2
  usage >&2
  exit 2
fi
if [[ ! -f "$FIXTURE" ]]; then
  echo "catalog-smoke: fixture not found: $FIXTURE" >&2
  exit 2
fi
if [[ -z "$API_AUTH_SECRET" ]]; then
  echo "catalog-smoke: API_AUTH_SECRET not resolved (set env or terraform.tfvars)" >&2
  exit 2
fi

preflight_skill_runs_schema

REQ_BODY="$(
  TW_TENANT_ID="$TENANT_ID" \
  TW_INVOKER="$INVOKER_USER_ID" \
  TW_SKILL="$SKILL_ID" \
  TW_SOURCE="catalog" \
  TW_FIXTURE="$FIXTURE" \
  python3 -c '
import json, os
with open(os.environ["TW_FIXTURE"]) as f:
    inputs = json.load(f)
print(json.dumps({
    "tenantId": os.environ["TW_TENANT_ID"],
    "invokerUserId": os.environ["TW_INVOKER"],
    "skillId": os.environ["TW_SKILL"],
    "invocationSource": os.environ["TW_SOURCE"],
    "inputs": inputs,
}))
'
)"

echo "catalog-smoke: POST $API_URL/api/skills/start" >&2

HTTP_BODY="$(mktemp)"
trap 'rm -f "$HTTP_BODY"' EXIT
HTTP_CODE="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' -X POST \
  "$API_URL/api/skills/start" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_AUTH_SECRET" \
  --data-binary "$REQ_BODY" || echo 000)"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "catalog-smoke: HTTP $HTTP_CODE body=$(head -c 300 < "$HTTP_BODY")" >&2
  echo "FAIL:dispatch_http_$HTTP_CODE"
  exit 1
fi

RUN_ID="$(python3 -c "import json,sys; print(json.load(open('$HTTP_BODY'))['runId'])")"
echo "catalog-smoke: inserted skill_run id=$RUN_ID — polling up to ${TIMEOUT}s" >&2

wait_for_terminal_status "$RUN_ID" "$TIMEOUT"

# Passing condition: the row reached a terminal status — which today means
# the composition_runner tried the gather step and hit a missing connector.
# `complete` is also acceptable (connector wired, skill returned).
echo "PASS catalog run_id=$RUN_ID status=$SMOKE_RESULT_STATUS reason=${SMOKE_RESULT_REASON:-none}"
