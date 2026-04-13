#!/usr/bin/env bash
# Build and deploy the public website (apps/www) to S3 + CloudFront.
#
# Usage:
#   bash scripts/build-www.sh <stage>
#
# Environment variables (optional overrides):
#   TF_DIR      — Terraform working directory (default: terraform/examples/greenfield)
#   AWS_REGION  — AWS region (default: us-east-1)

set -euo pipefail

STAGE="${1:?Usage: build-www.sh <stage>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform/examples/greenfield}"
REGION="${AWS_REGION:-us-east-1}"

echo "▸ Reading Terraform outputs for stage=$STAGE ..."
cd "$TF_DIR"

tf_out() {
  terraform output -raw "$1" 2>/dev/null || echo ""
}

WWW_BUCKET="$(tf_out www_bucket_name)"
WWW_CF_ID="$(tf_out www_distribution_id)"

if [[ -z "$WWW_BUCKET" || -z "$WWW_CF_ID" ]]; then
  echo "✗ Missing www_bucket_name or www_distribution_id in Terraform outputs." >&2
  echo "  Run terraform apply in $TF_DIR first." >&2
  exit 1
fi

echo "▸ Building www site ..."
cd "$REPO_ROOT"
pnpm --filter @thinkwork/www build

echo "▸ Syncing to S3 bucket: $WWW_BUCKET ..."
# Pass 1: content-hashed assets under /_astro/ — safe to mark immutable.
aws s3 sync apps/www/dist/_astro/ "s3://${WWW_BUCKET}/_astro/" \
  --delete \
  --region "$REGION" \
  --cache-control "public, max-age=31536000, immutable"

# Pass 2: everything else (HTML, sitemaps, favicon, og-image, robots) —
# short cache so fixed-path assets update on redeploy without being
# stuck in browser cache for a year.
aws s3 sync apps/www/dist/ "s3://${WWW_BUCKET}/" \
  --delete \
  --region "$REGION" \
  --exclude "_astro/*" \
  --cache-control "public, max-age=60, must-revalidate"

echo "▸ Invalidating CloudFront cache: $WWW_CF_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$WWW_CF_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text > /dev/null

WWW_URL="$(cd "$TF_DIR" && tf_out www_url)"
echo ""
echo "✓ www deployed: ${WWW_URL:-https://<pending>}"
