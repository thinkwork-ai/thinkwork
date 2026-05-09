#!/usr/bin/env bash
# smoke-computer — Computer v1 deployed-stage acceptance smoke.
#
# Usage:
#   scripts/smoke-computer.sh dev
#   scripts/smoke-computer.sh --stage dev --region us-east-1

set -euo pipefail

STAGE="dev"
REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    -*)
      echo "smoke-computer: unknown arg: $1" >&2
      exit 2
      ;;
    *)
      STAGE="$1"
      shift
      ;;
  esac
done

bash "$(cd "$(dirname "$0")" && pwd)/post-deploy-smoke-computer-thread-streaming.sh" \
  --stage "$STAGE" \
  --region "$REGION"

export STAGE
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$REPO_ROOT/terraform/examples/greenfield"

cd "$REPO_ROOT"

source "$REPO_ROOT/scripts/smoke/_env.sh"
source "$REPO_ROOT/scripts/lib/terraform-output.sh"

APPSYNC_API_URL="$(cd "$TF_DIR" && tf_output_raw appsync_api_url)"
APPSYNC_API_KEY="$(cd "$TF_DIR" && tf_output_raw appsync_api_key)"
COMPUTER_URL="$(cd "$TF_DIR" && tf_output_raw computer_url)"

if [[ -z "${API_URL:-}" || -z "${DATABASE_URL:-}" || -z "$APPSYNC_API_URL" || -z "$APPSYNC_API_KEY" || -z "$COMPUTER_URL" ]]; then
  echo "smoke-computer: failed to resolve deployed GraphQL/AppSync/database config" >&2
  exit 3
fi

export COMPUTER_ENV_FILE=none
export SMOKE_COMPUTER_URL="$COMPUTER_URL"
export VITE_GRAPHQL_HTTP_URL="${API_URL}/graphql"
export VITE_GRAPHQL_URL="$APPSYNC_API_URL"
export VITE_GRAPHQL_API_KEY="$APPSYNC_API_KEY"

node scripts/smoke/computer-surface-smoke.mjs
node scripts/smoke/computer-applet-pipeline-smoke.mjs
node scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs
