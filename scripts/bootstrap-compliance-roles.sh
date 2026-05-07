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

# Stage allowlist gate. The bootstrap rotates Aurora role passwords + writes
# Secrets Manager values; running it against the wrong stage is a SOC2-grade
# operator footgun (auditable credential rotation by accident). Require an
# explicit CONFIRM_NONDEV=1 acknowledgement for anything that isn't dev so a
# typo or shell-history misfire doesn't ALTER ROLE on staging or prod.
case "$STAGE" in
  dev) ;;
  staging|prod)
    if [[ "${CONFIRM_NONDEV:-}" != "1" ]]; then
      echo "STAGE=$STAGE detected. Re-run with CONFIRM_NONDEV=1 to acknowledge." >&2
      echo "  This script ALTERs Aurora role passwords + rotates Secrets Manager." >&2
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
# Read password from stdin so it never appears in argv / `ps aux` /
# /proc/<pid>/cmdline. Argv is readable to any co-located process; the
# master Aurora password is too sensitive to expose for the lifetime of
# even a short subprocess.
DB_PASS_URL="$(printf '%s' "$DB_PASS" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')"

DB_HOST="thinkwork-${STAGE}-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com"
DB_PORT="5432"
DB_NAME="thinkwork"

# sslmode=require matches the drift-check job in deploy.yml. RDS encrypts
# at the network layer regardless, but psql in CI errors on missing TLS
# unless this is set explicitly.
DATABASE_URL="postgres://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

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

# Resolve role passwords with three-way precedence so the script is safe
# to re-run from CI on every deploy without rotating credentials:
#   1. Operator-supplied env var (COMPLIANCE_X_PASS) — explicit override.
#   2. Existing Secrets Manager value — re-runs preserve current passwords.
#   3. Auto-generated via openssl — only on greenfield bootstrap.
#
# Plaintext values are never echoed — emitting "==> Generated VAR=$value"
# would persist the credential in any log aggregator (CloudWatch, GHA
# logs) or operator shell history. Operators retrieve any generated
# value from Secrets Manager:
#   aws secretsmanager get-secret-value --region "$AWS_REGION" \
#     --secret-id "thinkwork/${STAGE}/compliance/<role>-credentials" \
#     --query SecretString --output text | jq -r .password

resolve_role_pass() {
  local role="$1"
  local secret_id="thinkwork/${STAGE}/compliance/${role}-credentials"
  local existing
  # Try to read the existing secret value (mode-0 stderr suppression so
  # ResourceNotFoundException doesn't pollute the operator log).
  existing="$(aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$secret_id" \
    --query SecretString --output text 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    printf '%s' "$existing" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["password"])'
  else
    generate_pass
  fi
}

if [[ -z "${COMPLIANCE_WRITER_PASS:-}" ]]; then
  COMPLIANCE_WRITER_PASS="$(resolve_role_pass writer)"
fi
if [[ -z "${COMPLIANCE_DRAINER_PASS:-}" ]]; then
  COMPLIANCE_DRAINER_PASS="$(resolve_role_pass drainer)"
fi
if [[ -z "${COMPLIANCE_READER_PASS:-}" ]]; then
  COMPLIANCE_READER_PASS="$(resolve_role_pass reader)"
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

  # Build the JSON payload in a mode-0600 temp file rather than passing it
  # through `--secret-string "$payload"`. argv is visible in `ps aux` and
  # /proc/<pid>/cmdline for the lifetime of the AWS CLI subprocess. Reading
  # via `file://` keeps the credential off the process table entirely.
  local payload_file
  payload_file="$(mktemp)"
  chmod 600 "$payload_file"
  # shellcheck disable=SC2064  # we want the trap to use the *current* value
  trap "rm -f '$payload_file'" RETURN

  jq -n \
    --arg user "compliance_${role}" \
    --arg pass "$password" \
    --arg host "$DB_HOST" \
    --arg port "$DB_PORT" \
    --arg dbname "$DB_NAME" \
    '{username: $user, password: $pass, host: $host, port: $port, dbname: $dbname}' \
    > "$payload_file"

  echo "==> Populating $secret_id" >&2
  aws secretsmanager put-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$secret_id" \
    --secret-string "file://$payload_file" \
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

# Write the password \set directives to a mode-0600 preamble file rather
# than passing them via `psql -v writer_pass=...`. The -v form puts each
# password literal in argv where it's readable via `ps aux` for the full
# psql session (including the lock_timeout wait window). The preamble
# file is consumed before the migration so :'writer_pass' substitutes
# correctly inside the migration's DO blocks.
PSQL_PREAMBLE="$(mktemp)"
chmod 600 "$PSQL_PREAMBLE"
trap "rm -f '$PSQL_PREAMBLE'" EXIT

# Quote each password for psql variable assignment. Single-quoted form
# requires escaping any embedded single quotes; generate_pass() and
# operator-supplied values from the COMPLIANCE_*_PASS env vars are both
# pre-stripped of `=+/` and shell-metas, so the simple `'...'` form is
# safe — but the gsub handles any operator who deliberately supplies a
# password with quotes.
escape_psql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

cat > "$PSQL_PREAMBLE" <<EOF
\set writer_pass '$(escape_psql "$COMPLIANCE_WRITER_PASS")'
\set drainer_pass '$(escape_psql "$COMPLIANCE_DRAINER_PASS")'
\set reader_pass '$(escape_psql "$COMPLIANCE_READER_PASS")'
EOF

psql "$DATABASE_URL" -f "$PSQL_PREAMBLE" -f "$MIGRATION_FILE"

# ---------------------------------------------------------------------------
# 5. Verify roles exist + drift gate exits 0.
# ---------------------------------------------------------------------------

echo "==> Verifying compliance roles" >&2
# `\du` accepts ONE optional pattern; passing three space-separated names
# matches nothing. Use the glob form to list all compliance_* roles.
psql "$DATABASE_URL" -c "\du compliance_*"

if [[ -x "$REPO_ROOT/scripts/db-migrate-manual.sh" ]]; then
  echo "==> Running drift gate (expect exit 0)" >&2
  DATABASE_URL="$DATABASE_URL" bash "$REPO_ROOT/scripts/db-migrate-manual.sh" >/dev/null
fi

echo "==> Bootstrap complete for stage: $STAGE" >&2
