#!/usr/bin/env bash
# bootstrap-analyst-roles.sh — per-stage provisioning of the analyst_reader
# Aurora role + its Secrets Manager value (THINK-228 U2).
#
# Plan: docs/plans/2026-07-08-001-feat-thinkwork-analyst-plan.md (U2, KTD7)
#
# Provisions:
#   - analyst_reader: SELECT-only Aurora role for the analyst query-broker
#     Lambda (read-only default transaction mode, statement timeout, and
#     escalation hardening all live in the migration).
#
# Requires (must already exist in the target stage):
#   - The analyst reader secret container
#     (terraform/modules/data/aurora-postgres/main.tf "analyst_reader"
#     block, applied via terraform-apply).
#   - A reachable Aurora dev DB at thinkwork-${STAGE}-db-1.
#
# Workflow (idempotent — safe to re-run; re-running rotates nothing unless
# ANALYST_READER_PASS is supplied, because the existing Secrets Manager
# password is reused):
#   1. Resolve master DB credentials from Secrets Manager.
#   2. Read the role password from env OR the existing secret OR generate.
#   3. Populate thinkwork/${STAGE}/analyst/reader-credentials.
#   4. Apply drizzle/0227_analyst_reader_role.sql via psql (mode-0600
#      password preamble; migration DO blocks are idempotent).
#   5. Verify the role exists and cannot write.
#
# Usage:
#   STAGE=dev bash scripts/bootstrap-analyst-roles.sh
#
# Optional env overrides:
#   ANALYST_READER_PASS  — explicit password (rotates the role + secret).
#   AWS_REGION           — default us-east-1.
#
# Exit codes: 0 ok; 1 failure; 2 usage/environment error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION_FILE="$REPO_ROOT/packages/database-pg/drizzle/0227_analyst_reader_role.sql"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ -z "${STAGE:-}" ]]; then
  echo "STAGE env var is required (e.g. STAGE=dev)" >&2
  exit 2
fi

# Stage allowlist gate (mirrors bootstrap-compliance-roles.sh): rotating
# role passwords + Secrets Manager values on the wrong stage is an
# operator footgun, so non-dev requires explicit acknowledgement.
case "$STAGE" in
  dev) ;;
  staging|prod)
    if [[ "${CONFIRM_NONDEV:-}" != "1" ]]; then
      echo "STAGE=$STAGE detected. Re-run with CONFIRM_NONDEV=1 to acknowledge." >&2
      echo "  This script ALTERs the analyst_reader password + rotates Secrets Manager." >&2
      exit 2
    fi
    echo "==> CONFIRM_NONDEV=1 acknowledged for STAGE=$STAGE" >&2
    ;;
  *)
    echo "STAGE=$STAGE not in known allowlist (dev|staging|prod). Refusing." >&2
    exit 2
    ;;
esac

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "migration not found: $MIGRATION_FILE" >&2
  exit 2
fi

for cmd in psql aws jq openssl python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "required command not found on PATH: $cmd" >&2
    exit 2
  fi
done

echo "==> Bootstrapping analyst_reader for stage: $STAGE" >&2

# ---------------------------------------------------------------------------
# 1. Resolve master DB credentials + endpoint.
# ---------------------------------------------------------------------------

echo "==> Resolving master DB credentials" >&2
DB_SECRET_RAW="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "thinkwork-${STAGE}-db-credentials" \
  --query SecretString --output text)"

DB_USER="$(echo "$DB_SECRET_RAW" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["username"])')"
DB_PASS="$(echo "$DB_SECRET_RAW" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["password"])')"
DB_PASS_URL="$(printf '%s' "$DB_PASS" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')"

DB_HOST="thinkwork-${STAGE}-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com"
DB_PORT="5432"
DB_NAME="thinkwork"

DATABASE_URL="postgres://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

echo "==> Verifying DB connectivity" >&2
psql "$DATABASE_URL" -tAc "SELECT current_database()" >/dev/null

# ---------------------------------------------------------------------------
# 2. Resolve / generate the role password.
#
# Precedence: explicit env override > existing Secrets Manager value >
# freshly generated. Plaintext is never echoed; retrieve it from Secrets
# Manager if needed.
# ---------------------------------------------------------------------------

SECRET_ID="thinkwork/${STAGE}/analyst/reader-credentials"

generate_pass() {
  openssl rand -base64 32 | tr -d '=+/' | head -c 32
}

if [[ -z "${ANALYST_READER_PASS:-}" ]]; then
  existing="$(aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_ID" \
    --query SecretString --output text 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    ANALYST_READER_PASS="$(printf '%s' "$existing" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["password"])')"
  else
    ANALYST_READER_PASS="$(generate_pass)"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Populate Secrets Manager (container must exist — Terraform owns it).
# ---------------------------------------------------------------------------

payload_file="$(mktemp)"
chmod 600 "$payload_file"
trap 'rm -f "$payload_file"' EXIT

jq -n \
  --arg user "analyst_reader" \
  --arg pass "$ANALYST_READER_PASS" \
  --arg host "$DB_HOST" \
  --arg port "$DB_PORT" \
  --arg dbname "$DB_NAME" \
  '{username: $user, password: $pass, host: $host, port: $port, dbname: $dbname}' \
  > "$payload_file"

echo "==> Populating $SECRET_ID" >&2
aws secretsmanager put-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$SECRET_ID" \
  --secret-string "file://$payload_file" \
  >/dev/null

# ---------------------------------------------------------------------------
# 4. Apply the migration (mode-0600 preamble keeps the password off argv).
# ---------------------------------------------------------------------------

echo "==> Applying migration $MIGRATION_FILE" >&2

PSQL_PREAMBLE="$(mktemp)"
chmod 600 "$PSQL_PREAMBLE"
trap 'rm -f "$payload_file" "$PSQL_PREAMBLE"' EXIT

escape_psql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

cat > "$PSQL_PREAMBLE" <<EOF
\set reader_pass '$(escape_psql "$ANALYST_READER_PASS")'
EOF

psql "$DATABASE_URL" -f "$PSQL_PREAMBLE" -f "$MIGRATION_FILE"

# ---------------------------------------------------------------------------
# 5. Verify: role exists, is hardened, and cannot write.
# ---------------------------------------------------------------------------

echo "==> Verifying role" >&2
psql "$DATABASE_URL" -tAc \
  "SELECT rolname FROM pg_roles WHERE rolname = 'analyst_reader'" | grep -q analyst_reader

READER_URL="postgres://analyst_reader:$(printf '%s' "$ANALYST_READER_PASS" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

echo "==> Smoke: SELECT allowed" >&2
psql "$READER_URL" -tAc "SELECT count(*) FROM tenants" >/dev/null

echo "==> Smoke: write rejected" >&2
if psql "$READER_URL" -tAc "CREATE TABLE analyst_smoke_should_fail (id int)" 2>/dev/null; then
  echo "ERROR: analyst_reader was able to CREATE TABLE — hardening failed" >&2
  exit 1
fi
if psql "$READER_URL" -tAc "INSERT INTO tenants (id) VALUES (gen_random_uuid())" 2>/dev/null; then
  echo "ERROR: analyst_reader was able to INSERT — hardening failed" >&2
  exit 1
fi

echo "==> analyst_reader bootstrap complete for stage: $STAGE" >&2
