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

echo ""
echo "Pushing Drizzle schema to database..."
cd "$REPO_ROOT/packages/database-pg"
npx drizzle-kit push --force

echo ""
echo "Schema push complete."
