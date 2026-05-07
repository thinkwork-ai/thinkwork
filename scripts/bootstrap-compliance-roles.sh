#!/usr/bin/env bash
# bootstrap-compliance-roles.sh — one-time per-stage provisioning of the
# three Aurora compliance roles + their Secrets Manager values.
#
# Phase 3 U2 of the System Workflows revert + Compliance reframe.
# Plan:  docs/plans/2026-05-07-001-feat-compliance-u2-aurora-roles-plan.md
# Master: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
#
# Provisions:
#   - compliance_writer:  INSERT only on compliance.audit_outbox + export_jobs
#   - compliance_drainer: SELECT/UPDATE on audit_outbox + INSERT on audit_events
#   - compliance_reader:  SELECT only on all four compliance.* tables
#
# Requires (must already exist in the target stage):
#   - The compliance schema + tables (drizzle/0069_compliance_schema.sql,
#     applied via Phase 3 U1 — PR #880).
#   - The three AWS Secrets Manager containers
#     (terraform/modules/data/aurora-postgres/main.tf "compliance_*" blocks
#     applied via terraform-apply on this U2 PR's merge).
#   - A reachable Aurora dev DB at thinkwork-${STAGE}-db-1.
#
# Workflow (idempotent — safe to re-run):
#   1. Resolve master DB credentials from Secrets Manager.
#   2. Read three role passwords from environment OR auto-generate them.
#   3. Populate the three Secrets Manager secrets with the role JSON
#      (username, password, host, port, dbname).
#   4. Run drizzle/0070_compliance_aurora_roles.sql via psql with -v
#      substitution; the migration's DO blocks check pg_roles before
#      CREATE ROLE so re-runs ALTER the password rather than erroring.
#   5. Verify the three roles exist via `\du compliance_*`.
#
# Usage:
#   STAGE=dev bash scripts/bootstrap-compliance-roles.sh
#
# Optional env overrides:
#   COMPLIANCE_WRITER_PASS, COMPLIANCE_DRAINER_PASS, COMPLIANCE_READER_PASS
#     If unset, each is generated via `openssl rand -base64 32`. The script
#     prints generated values to stderr so the operator can capture them.
#   AWS_REGION
#     Default us-east-1.
#
# Exit codes:
#   0 — bootstrap complete, all three roles + secrets in sync.
#   1 — bootstrap failed (see error message).
#   2 — usage / environment error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION_FILE="$REPO_ROOT/packages/database-pg/drizzle/0070_compliance_aurora_roles.sql"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ -z "${STAGE:-}" ]]; then
  echo "STAGE env var is required (e.g. STAGE=dev)" >&2
  exit 2
fi

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

echo "==> Bootstrapping compliance roles for stage: $STAGE" >&2

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
DB_PASS_URL="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DB_PASS")"

DB_HOST="thinkwork-${STAGE}-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com"
DB_PORT="5432"
DB_NAME="thinkwork"

DATABASE_URL="postgres://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Sanity-check connectivity before generating passwords or touching secrets.
echo "==> Verifying DB connectivity" >&2
psql "$DATABASE_URL" -tAc "SELECT current_database()" >/dev/null

# ---------------------------------------------------------------------------
# 2. Resolve / generate role passwords.
# ---------------------------------------------------------------------------

generate_pass() {
  # 32 bytes of base64 — 43 chars after stripping `=`. Avoid `+/` since they
  # don't need URL-encoding for psql's -v but appear in some operator
  # tooling that does the encoding twice.
  openssl rand -base64 32 | tr -d '=+/' | head -c 32
}

if [[ -z "${COMPLIANCE_WRITER_PASS:-}" ]]; then
  COMPLIANCE_WRITER_PASS="$(generate_pass)"
  echo "==> Generated COMPLIANCE_WRITER_PASS=$COMPLIANCE_WRITER_PASS (capture this)" >&2
fi
if [[ -z "${COMPLIANCE_DRAINER_PASS:-}" ]]; then
  COMPLIANCE_DRAINER_PASS="$(generate_pass)"
  echo "==> Generated COMPLIANCE_DRAINER_PASS=$COMPLIANCE_DRAINER_PASS (capture this)" >&2
fi
if [[ -z "${COMPLIANCE_READER_PASS:-}" ]]; then
  COMPLIANCE_READER_PASS="$(generate_pass)"
  echo "==> Generated COMPLIANCE_READER_PASS=$COMPLIANCE_READER_PASS (capture this)" >&2
fi

# ---------------------------------------------------------------------------
# 3. Populate Secrets Manager.
#
# put-secret-value creates a new version on an existing secret. The U3
# `aws_secretsmanager_secret` containers must exist (terraform-applied)
# before this script runs; we don't create them here because Terraform
# owns the container lifecycle and bootstrap script ownership boundaries
# matter for SOC2 evidence ("operator wrote the value, not Terraform").
# ---------------------------------------------------------------------------

put_secret_value() {
  local role="$1"
  local password="$2"
  local secret_id="thinkwork/${STAGE}/compliance/${role}-credentials"

  local payload
  payload="$(jq -n \
    --arg user "compliance_${role}" \
    --arg pass "$password" \
    --arg host "$DB_HOST" \
    --arg port "$DB_PORT" \
    --arg dbname "$DB_NAME" \
    '{username: $user, password: $pass, host: $host, port: $port, dbname: $dbname}')"

  echo "==> Populating $secret_id" >&2
  aws secretsmanager put-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$secret_id" \
    --secret-string "$payload" \
    >/dev/null
}

put_secret_value "writer" "$COMPLIANCE_WRITER_PASS"
put_secret_value "drainer" "$COMPLIANCE_DRAINER_PASS"
put_secret_value "reader" "$COMPLIANCE_READER_PASS"

# ---------------------------------------------------------------------------
# 4. Apply the migration with psql variable substitution.
#
# psql -v writer_pass=... binds the password to :'writer_pass' in the
# migration's DO blocks. The migration's format(%L, ...) ensures the
# password literal is properly SQL-escaped even if it contains quotes
# or backslashes (the generate_pass function above strips problematic
# characters preemptively, but defense-in-depth at both layers is cheap).
# ---------------------------------------------------------------------------

echo "==> Applying migration $MIGRATION_FILE" >&2
psql "$DATABASE_URL" \
  -v writer_pass="$COMPLIANCE_WRITER_PASS" \
  -v drainer_pass="$COMPLIANCE_DRAINER_PASS" \
  -v reader_pass="$COMPLIANCE_READER_PASS" \
  -f "$MIGRATION_FILE"

# ---------------------------------------------------------------------------
# 5. Verify roles exist + drift gate exits 0.
# ---------------------------------------------------------------------------

echo "==> Verifying compliance roles" >&2
psql "$DATABASE_URL" -c "\du compliance_writer compliance_drainer compliance_reader"

if [[ -x "$REPO_ROOT/scripts/db-migrate-manual.sh" ]]; then
  echo "==> Running drift gate (expect exit 0)" >&2
  DATABASE_URL="$DATABASE_URL" bash "$REPO_ROOT/scripts/db-migrate-manual.sh" >/dev/null
fi

echo "==> Bootstrap complete for stage: $STAGE" >&2
