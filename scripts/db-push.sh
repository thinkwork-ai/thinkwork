#!/usr/bin/env bash
# Push Drizzle schema to the deployed Aurora database.
#
# Resolves connection details from Terraform outputs or environment variables.
# Requires either:
#   1. DATABASE_URL environment variable (direct connection string), or
#   2. --stage flag to resolve from Terraform outputs + Secrets Manager
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/thinkwork" bash scripts/db-push.sh
#   bash scripts/db-push.sh --stage dev

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=""

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --stage|-s) STAGE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# If no DATABASE_URL, resolve from Terraform + Secrets Manager
if [ -z "${DATABASE_URL:-}" ] && [ -n "$STAGE" ]; then
  echo "Resolving database connection for stage: $STAGE"

  TF_DIR="$REPO_ROOT/terraform/examples/greenfield"

  # Get outputs from Terraform
  DB_ENDPOINT=$(cd "$TF_DIR" && terraform output -raw db_cluster_endpoint 2>/dev/null || echo "")
  DB_SECRET_ARN=$(cd "$TF_DIR" && terraform output -raw db_secret_arn 2>/dev/null || echo "")
  DB_NAME=$(cd "$TF_DIR" && terraform output -raw database_name 2>/dev/null || echo "thinkwork")

  if [ -z "$DB_ENDPOINT" ]; then
    echo "ERROR: Could not resolve db_cluster_endpoint from Terraform outputs."
    echo "Make sure you've deployed the stack first: thinkwork deploy -s $STAGE"
    exit 1
  fi

  if [ -n "$DB_SECRET_ARN" ]; then
    # Resolve credentials from Secrets Manager
    SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET_ARN" --query SecretString --output text 2>/dev/null || echo "")
    if [ -n "$SECRET_JSON" ]; then
      DB_USER=$(echo "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('username',''))" 2>/dev/null || echo "")
      DB_PASS=$(echo "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('password',''))" 2>/dev/null || echo "")
    fi
  fi

  # Fallback to env vars
  DB_USER="${DB_USER:-${DB_USERNAME:-thinkwork_admin}}"
  DB_PASS="${DB_PASS:-${DB_PASSWORD:-}}"
  DB_NAME="${DB_NAME:-thinkwork}"

  if [ -z "$DB_PASS" ]; then
    echo "ERROR: Could not resolve database password."
    echo "Set DATABASE_URL directly or ensure the secret is accessible."
    exit 1
  fi

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_ENDPOINT}:5432/${DB_NAME}?sslmode=require"
  echo "Resolved: ${DB_ENDPOINT}:5432/${DB_NAME} (user: ${DB_USER})"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: No database connection."
  echo "Provide DATABASE_URL or use --stage <name> to resolve from Terraform."
  echo ""
  echo "Usage:"
  echo "  DATABASE_URL=\"postgresql://...\" bash scripts/db-push.sh"
  echo "  bash scripts/db-push.sh --stage dev"
  exit 1
fi

export DATABASE_URL

echo "Checking auth migration phase safety..."
AUTH_PHASE_STATE=$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
  SELECT CASE WHEN
    to_regclass('public.workos_auth_bridges') IS NOT NULL
    OR to_regclass('public.workos_auth_sessions') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = 'public'
        AND table_record.relname IN ('auth_provider_resources', 'auth_route_clients')
        AND constraint_record.contype = 'c'
        AND pg_get_constraintdef(constraint_record.oid) LIKE '%coexistence%'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_attrdef AS default_record
      JOIN pg_attribute AS column_record
        ON column_record.attrelid = default_record.adrelid
       AND column_record.attnum = default_record.adnum
      JOIN pg_class AS table_record ON table_record.oid = default_record.adrelid
      JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = 'public'
        AND table_record.relname = 'auth_provider_resources'
        AND column_record.attname = 'lifecycle_state'
        AND pg_get_expr(default_record.adbin, default_record.adrelid) LIKE '%coexistence%'
    )
  THEN 'transitional' ELSE 'safe' END;
")

if [ "$AUTH_PHASE_STATE" != "safe" ]; then
  echo "ERROR: Standard db:push is disabled while auth rollback tables or transitional lifecycle constraints exist."
  echo "Apply and verify the phase-specific auth migrations instead; db:push is safe again after migration 0263 retires the rollback boundary."
  exit 1
fi

echo ""
echo "Pushing Drizzle schema to database..."
cd "$REPO_ROOT/packages/database-pg"
npx drizzle-kit push --force

echo ""
echo "Schema push complete."
