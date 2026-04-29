#!/usr/bin/env bash
# Post-deploy smoke for the Fat-folder workspace model.
#
# Resolves the deployed workspace bucket from Terraform unless WORKSPACE_BUCKET
# is already set, then runs the TypeScript smoke scenarios.

set -euo pipefail

STAGE="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TF_DIR="$REPO_ROOT/terraform/examples/greenfield"
source "$REPO_ROOT/scripts/lib/terraform-output.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    *) echo "post-deploy-smoke-fat-folder: unknown arg: $1" >&2; exit 2 ;;
  esac
done

export STAGE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

if [[ -z "${WORKSPACE_BUCKET:-}" ]]; then
  if [[ ! -d "$TF_DIR" ]]; then
    echo "post-deploy-smoke-fat-folder: terraform dir not found: $TF_DIR" >&2
    exit 2
  fi
  (
    cd "$TF_DIR"
    terraform init -input=false >/dev/null
    terraform workspace select "$STAGE" >/dev/null
    tf_output_raw bucket_name
  ) > /tmp/thinkwork-fat-folder-bucket
  export WORKSPACE_BUCKET="$(cat /tmp/thinkwork-fat-folder-bucket)"
  rm -f /tmp/thinkwork-fat-folder-bucket
fi

if [[ -z "$WORKSPACE_BUCKET" ]]; then
  echo "post-deploy-smoke-fat-folder: WORKSPACE_BUCKET not resolved" >&2
  exit 2
fi

pnpm exec tsx packages/api/src/__smoke__/fat-folder-smoke.ts --stage="$STAGE"
