#!/usr/bin/env bash
# Build and deploy the docs site to S3 + CloudFront.
#
# Usage:
#   bash scripts/build-docs.sh <stage>
#
# Environment variables (optional overrides):
#   TF_DIR      — Terraform working directory (default: terraform/examples/greenfield)
#   AWS_REGION  — AWS region (default: us-east-1)

set -euo pipefail

STAGE="${1:?Usage: build-docs.sh <stage>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform/examples/greenfield}"
REGION="${AWS_REGION:-us-east-1}"

echo "▸ Reading Terraform outputs for stage=$STAGE ..."
cd "$TF_DIR"

tf_out() {
  terraform output -raw "$1" 2>/dev/null || echo ""
}

DOCS_BUCKET="$(tf_out docs_bucket_name)"
DOCS_CF_ID="$(tf_out docs_distribution_id)"

echo "▸ Building docs site ..."
cd "$REPO_ROOT"
pnpm --filter @thinkwork/docs build

echo "▸ Syncing to S3 bucket: $DOCS_BUCKET ..."
aws s3 sync docs/dist/ "s3://${DOCS_BUCKET}/" \
  --delete \
  --region "$REGION"

echo "▸ Invalidating CloudFront cache: $DOCS_CF_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$DOCS_CF_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text > /dev/null

DOCS_URL="$(cd "$TF_DIR" && tf_out docs_url)"
echo ""
echo "✓ Docs deployed: ${DOCS_URL:-https://<pending>}"
