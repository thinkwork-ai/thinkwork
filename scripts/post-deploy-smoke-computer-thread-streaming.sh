#!/usr/bin/env bash
# Post-deploy smoke for the Computer thread streaming path.
#
# This creates a real Computer thread against the deployed stage, subscribes to
# AppSync before sending a prompt, then verifies live chunks, durable assistant
# persistence, and task completion all agree.

set -euo pipefail

STAGE="dev"
REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "post-deploy-smoke-computer-thread-streaming: unknown arg: $1" >&2; exit 2 ;;
  esac
done

export STAGE
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$REPO_ROOT/terraform/examples/greenfield"

cd "$REPO_ROOT"

source "$REPO_ROOT/scripts/smoke/_env.sh"
source "$REPO_ROOT/scripts/lib/terraform-output.sh"

APPSYNC_API_URL="$(cd "$TF_DIR" && tf_output_raw appsync_api_url)"
APPSYNC_REALTIME_URL="$(cd "$TF_DIR" && tf_output_raw appsync_realtime_url)"
APPSYNC_API_KEY="$(cd "$TF_DIR" && tf_output_raw appsync_api_key)"

if [[ -z "${API_URL:-}" || -z "${DATABASE_URL:-}" || -z "$APPSYNC_API_URL" || -z "$APPSYNC_REALTIME_URL" || -z "$APPSYNC_API_KEY" ]]; then
  echo "post-deploy-smoke-computer-thread-streaming: failed to resolve deployed GraphQL/AppSync/database config" >&2
  exit 3
fi

export COMPUTER_ENV_FILE=none
export VITE_GRAPHQL_HTTP_URL="${API_URL}/graphql"
export VITE_GRAPHQL_URL="$APPSYNC_API_URL"
export VITE_GRAPHQL_WS_URL="$APPSYNC_REALTIME_URL"
export VITE_GRAPHQL_API_KEY="$APPSYNC_API_KEY"

node scripts/smoke/computer-shared-multi-user-smoke.mjs
node scripts/smoke/computer-thread-streaming-smoke.mjs
