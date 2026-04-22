#!/usr/bin/env bash
# scheduled-smoke.sh — end-to-end smoke for the scheduled invocation path.
#
# Inserts a minimal scheduled_jobs row (trigger_type=skill_run), then
# directly invokes the job-trigger Lambda with a synthetic event that
# matches what EventBridge Scheduler would send. The Lambda reads the
# scheduled_jobs row, resolves input bindings, inserts a skill_runs row,
# and calls agentcore-invoke. We then poll the resulting skill_runs row
# until it transitions out of `running`.
#
# This script MUTATES the scheduled_jobs table. Required --force flag
# acknowledges that. The row is best-effort-cleaned-up on exit (no
# EventBridge schedule is created since we bypass AWS Scheduler entirely).
#
# What this covers:
#   * scheduled_jobs → job-trigger → skill_runs dispatch chain
#   * Input-binding resolution (literal + today_plus_N)
#   * agentcore-invoke under invocation_source=scheduled
#
# What this does NOT cover:
#   * EventBridge Scheduler wiring (we invoke the Lambda directly)
#   * Cron-expression-to-fire-time correctness (rate() semantics are
#     tested elsewhere)
#
# Usage:
#   scripts/smoke/scheduled-smoke.sh --force \
#     --tenant-id <uuid> \
#     --invoker-user-id <uuid> \
#     [--skill-id sales-prep] \
#     [--timeout 60]
#
# Env:
#   STAGE=dev                     terraform workspace + lambda function prefix
#   AWS_REGION=us-east-1
#   API_URL, API_AUTH_SECRET,
#   DATABASE_URL                  pre-set to skip terraform/secrets lookups
#
# Exit codes:
#   0 — PASS
#   1 — FAIL
#   2 — usage / env error or missing --force

set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_env.sh
source "$SMOKE_DIR/_env.sh"

TENANT_ID=""
INVOKER_USER_ID=""
SKILL_ID="sales-prep"
TIMEOUT="60"
FORCE=0

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)         TENANT_ID="$2"; shift 2 ;;
    --invoker-user-id)   INVOKER_USER_ID="$2"; shift 2 ;;
    --skill-id)          SKILL_ID="$2"; shift 2 ;;
    --timeout)           TIMEOUT="$2"; shift 2 ;;
    --force)             FORCE=1; shift ;;
    --help|-h)           usage; exit 0 ;;
    *) echo "scheduled-smoke: unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$FORCE" -ne 1 ]]; then
  echo "scheduled-smoke: --force required (this script mutates scheduled_jobs)" >&2
  exit 2
fi
if [[ -z "$TENANT_ID" || -z "$INVOKER_USER_ID" ]]; then
  echo "scheduled-smoke: --tenant-id and --invoker-user-id are required" >&2
  usage >&2
  exit 2
fi

preflight_skill_runs_schema

JOB_TRIGGER_FN="thinkwork-${STAGE}-api-job-trigger"
JOB_NAME="smoke-scheduled-$(date +%s)-$$"

# Insert a minimal scheduled_jobs row. Use unique name + config to avoid
# dedup collisions with prior smoke runs (resolved_inputs_hash differs if
# `today_plus_N` stepped forward a day since the last run).
CONFIG_JSON="$(
  TW_SKILL="$SKILL_ID" \
  TW_INVOKER="$INVOKER_USER_ID" \
  python3 -c '
import json, os
print(json.dumps({
    "skillId": os.environ["TW_SKILL"],
    "invokerUserId": os.environ["TW_INVOKER"],
    "skillVersion": 1,
    "inputBindings": {
        "customer": {"literal": "Smoke Test Co"},
        "meeting_date": {"today_plus_N": 1},
        "focus": {"literal": "general"},
    },
    "deliveryChannels": [],
}))
'
)"

# psql's `-t` mode still leaks the command tag ("INSERT 0 1") on some
# installs, so grep out only the uuid line.
JOB_ID="$(psql "$DATABASE_URL" -tAc "
  INSERT INTO scheduled_jobs (tenant_id, trigger_type, name, config, enabled)
  VALUES ('$TENANT_ID', 'skill_run', '$JOB_NAME', '$CONFIG_JSON'::jsonb, true)
  RETURNING id
" 2>/dev/null | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | head -1)"

if [[ -z "$JOB_ID" ]]; then
  echo "scheduled-smoke: failed to insert scheduled_jobs row" >&2
  echo "FAIL:insert_scheduled_job"
  exit 1
fi
echo "scheduled-smoke: inserted scheduled_jobs id=$JOB_ID name=$JOB_NAME" >&2

cleanup() {
  psql "$DATABASE_URL" -c "DELETE FROM scheduled_jobs WHERE id = '$JOB_ID'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Record the highest started_at BEFORE invoke so we can find the new
# skill_runs row via > rather than by a narrow id match (job-trigger
# picks its own run id).
BASELINE="$(psql "$DATABASE_URL" -tAc "
  SELECT coalesce(max(started_at), '1970-01-01'::timestamptz)
  FROM skill_runs
  WHERE tenant_id = '$TENANT_ID'
    AND invoker_user_id = '$INVOKER_USER_ID'
    AND skill_id = '$SKILL_ID'
    AND invocation_source = 'scheduled'
")"
echo "scheduled-smoke: baseline scheduled-row high-water = $BASELINE" >&2

EVENT_PAYLOAD="$(
  TW_JOB_ID="$JOB_ID" \
  TW_TENANT_ID="$TENANT_ID" \
  python3 -c '
import json, os
print(json.dumps({
    "triggerId": os.environ["TW_JOB_ID"],
    "triggerType": "skill_run",
    "tenantId": os.environ["TW_TENANT_ID"],
}))
'
)"

echo "scheduled-smoke: invoking Lambda $JOB_TRIGGER_FN RequestResponse" >&2

LAMBDA_OUT="$(mktemp)"
LAMBDA_ERR="$(mktemp)"
INVOKE_RC=0
aws lambda invoke \
  --function-name "$JOB_TRIGGER_FN" \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload "$EVENT_PAYLOAD" \
  --region "$AWS_REGION" \
  "$LAMBDA_OUT" >/dev/null 2>"$LAMBDA_ERR" || INVOKE_RC=$?

if [[ "$INVOKE_RC" -ne 0 ]]; then
  echo "scheduled-smoke: lambda invoke failed rc=$INVOKE_RC" >&2
  head -c 500 "$LAMBDA_ERR" >&2 || true
  echo "" >&2
  echo "FAIL:lambda_invoke_rc_$INVOKE_RC"
  rm -f "$LAMBDA_OUT" "$LAMBDA_ERR"
  exit 1
fi
rm -f "$LAMBDA_OUT" "$LAMBDA_ERR"

# Find the new skill_runs row — the one with the matching (tenant,
# invoker, skill, source=scheduled) and started_at > our baseline.
RUN_ID=""
deadline=$(( $(date +%s) + 10 ))
while (( $(date +%s) < deadline )); do
  RUN_ID="$(psql "$DATABASE_URL" -tAc "
    SELECT id FROM skill_runs
    WHERE tenant_id = '$TENANT_ID'
      AND invoker_user_id = '$INVOKER_USER_ID'
      AND skill_id = '$SKILL_ID'
      AND invocation_source = 'scheduled'
      AND started_at > '$BASELINE'
    ORDER BY started_at DESC LIMIT 1
  " 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$RUN_ID" ]] && break
  sleep 1
done

if [[ -z "$RUN_ID" ]]; then
  echo "scheduled-smoke: job-trigger invoked but no scheduled skill_runs row appeared within 10s" >&2
  echo "FAIL:no_skill_run_row"
  exit 1
fi

echo "scheduled-smoke: found skill_run id=$RUN_ID — polling up to ${TIMEOUT}s" >&2
wait_for_terminal_status "$RUN_ID" "$TIMEOUT"

echo "PASS scheduled run_id=$RUN_ID status=$SMOKE_RESULT_STATUS reason=${SMOKE_RESULT_REASON:-none}"
