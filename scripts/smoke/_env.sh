#!/usr/bin/env bash
# _env.sh — shared env resolution for skill-runs smoke scripts.
#
# Source, don't execute. Sets the three values every script needs:
#
#   API_URL              — deployed API Gateway endpoint (trailing slash stripped)
#   API_AUTH_SECRET      — inter-service shared secret (bearer token)
#   DATABASE_URL         — postgres:// connection string to the deployed Aurora
#
# Resolution order (each falls back to the next):
#   1. Environment variable already set (caller override)
#   2. Terraform outputs from terraform/examples/greenfield + Secrets Manager
#   3. terraform.tfvars for API_AUTH_SECRET (plaintext — migrate-to-SSM pending)
#
# Honors:
#   STAGE (default: dev) — selects terraform workspace
#   AWS_REGION (default: us-east-1)

STAGE="${STAGE:-dev}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

SMOKE_REPO_ROOT="${SMOKE_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TF_DIR="$SMOKE_REPO_ROOT/terraform/examples/greenfield"

if [[ ! -d "$TF_DIR" ]]; then
  echo "_env.sh: terraform dir not found: $TF_DIR" >&2
  return 2 2>/dev/null || exit 2
fi

# Idempotent init+workspace-select. Needed on fresh machines; fast when state
# is already configured.
(cd "$TF_DIR" && terraform init -input=false >/dev/null 2>&1) || true
(cd "$TF_DIR" && terraform workspace select "$STAGE" >/dev/null 2>&1) || true

_tf_out() {
  (cd "$TF_DIR" && terraform output -raw "$1" 2>/dev/null)
}

if [[ -z "${API_URL:-}" ]]; then
  API_URL="$(_tf_out api_endpoint)"
  API_URL="${API_URL%/}"
fi
export API_URL

if [[ -z "${API_AUTH_SECRET:-}" ]]; then
  # Extract the first double-quoted value from the `api_auth_secret = "..."`
  # line. terraform.tfvars is gitignored — when this script runs from a
  # worktree, the file may not exist locally. Callers can always pre-set
  # API_AUTH_SECRET to skip this lookup entirely.
  for tfvars_candidate in \
      "$TF_DIR/terraform.tfvars" \
      "$SMOKE_REPO_ROOT/../../../terraform/examples/greenfield/terraform.tfvars" \
      ; do
    if [[ -f "$tfvars_candidate" ]]; then
      API_AUTH_SECRET="$(
        grep -E '^[[:space:]]*api_auth_secret[[:space:]]*=' "$tfvars_candidate" 2>/dev/null \
          | sed -E 's/^[^"]*"([^"]*)".*/\1/' \
          | head -1
      )"
      [[ -n "$API_AUTH_SECRET" ]] && break
    fi
  done
fi
export API_AUTH_SECRET

if [[ -z "${DATABASE_URL:-}" ]]; then
  DB_ENDPOINT="$(_tf_out db_cluster_endpoint)"
  DB_SECRET_ARN="$(_tf_out db_secret_arn)"
  DB_NAME="$(_tf_out database_name || echo thinkwork)"
  if [[ -z "$DB_ENDPOINT" || -z "$DB_SECRET_ARN" ]]; then
    echo "_env.sh: failed to resolve db_cluster_endpoint or db_secret_arn from terraform outputs" >&2
    return 3 2>/dev/null || exit 3
  fi
  SECRET_JSON="$(aws secretsmanager get-secret-value \
    --secret-id "$DB_SECRET_ARN" \
    --query SecretString --output text 2>/dev/null || true)"
  if [[ -z "$SECRET_JSON" ]]; then
    echo "_env.sh: failed to fetch db credentials secret $DB_SECRET_ARN" >&2
    return 3 2>/dev/null || exit 3
  fi
  DB_USER="$(echo "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])" 2>/dev/null)"
  DB_PASS="$(echo "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])" 2>/dev/null)"
  if [[ -z "$DB_USER" || -z "$DB_PASS" ]]; then
    echo "_env.sh: secret JSON did not contain username/password" >&2
    return 3 2>/dev/null || exit 3
  fi
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_ENDPOINT}:5432/${DB_NAME}?sslmode=require"
fi
export DATABASE_URL

# Pre-flight: every skill-runs smoke needs this table. If it's missing, fail
# with a sharp, grep-able message so run-all.sh reports the real problem
# instead of a generic psql error later.
preflight_skill_runs_schema() {
  local probe
  probe="$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.skill_runs')" 2>/dev/null || true)"
  if [[ -z "$probe" ]]; then
    echo "FAIL:schema_missing"
    exit 1
  fi
}

# Poll a skill_runs row by id until status transitions out of `running`, or
# the timeout expires. Echoes a `FAIL:…` line + exits 1 on timeout.
# Usage: wait_for_terminal_status <run-id> [<timeout-seconds>]
wait_for_terminal_status() {
  local run_id="$1"
  local timeout="${2:-60}"
  local deadline=$(( $(date +%s) + timeout ))
  local status reason
  while (( $(date +%s) < deadline )); do
    status="$(psql "$DATABASE_URL" -tAc \
      "SELECT status FROM skill_runs WHERE id = '$run_id'" 2>/dev/null || echo "")"
    if [[ -n "$status" && "$status" != "running" ]]; then
      reason="$(psql "$DATABASE_URL" -tAc \
        "SELECT coalesce(failure_reason, '') FROM skill_runs WHERE id = '$run_id'" 2>/dev/null || echo "")"
      export SMOKE_RESULT_STATUS="$status"
      export SMOKE_RESULT_REASON="$reason"
      return 0
    fi
    sleep 2
  done
  echo "FAIL:timeout_still_running run_id=$run_id after ${timeout}s"
  exit 1
}
