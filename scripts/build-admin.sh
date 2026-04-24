#!/usr/bin/env bash
# Build and deploy the admin app to S3 + CloudFront.
#
# Reads environment config from Terraform outputs, builds a production
# Vite bundle, syncs to S3, and invalidates the CloudFront cache.
#
# Usage:
#   bash scripts/build-admin.sh <stage>
#
# Environment variables (optional overrides):
#   TF_DIR          — Terraform working directory (default: terraform/examples/greenfield)
#   API_AUTH_SECRET  — Inter-service auth secret (default: empty)
#   AWS_REGION       — AWS region (default: us-east-1)

set -euo pipefail

STAGE="${1:?Usage: build-admin.sh <stage>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform/examples/greenfield}"
REGION="${AWS_REGION:-us-east-1}"

echo "▸ Reading Terraform outputs for stage=$STAGE ..."
cd "$TF_DIR"

tf_out() {
  terraform output -raw "$1" 2>/dev/null || echo ""
}

API_ENDPOINT="$(tf_out api_endpoint)"
APPSYNC_API_URL="$(tf_out appsync_api_url)"
APPSYNC_REALTIME_URL="$(tf_out appsync_realtime_url)"
APPSYNC_API_KEY="$(tf_out appsync_api_key)"
USER_POOL_ID="$(tf_out user_pool_id)"
ADMIN_CLIENT_ID="$(tf_out admin_client_id)"
AUTH_DOMAIN="$(tf_out auth_domain)"
ADMIN_BUCKET="$(tf_out admin_bucket_name)"
ADMIN_CF_ID="$(tf_out admin_distribution_id)"

# Construct full Cognito domain URL from the short domain prefix
COGNITO_DOMAIN="https://${AUTH_DOMAIN}.auth.${REGION}.amazoncognito.com"

# Construct WebSocket URL from AppSync API URL
APPSYNC_WS_URL="${APPSYNC_REALTIME_URL}"

echo "▸ Building admin app ..."
cd "$REPO_ROOT"

# Write production env file.
#
# VITE_API_AUTH_SECRET is intentionally absent. The admin SPA authenticates
# REST calls with the user's Cognito id token (via apiFetch in
# apps/admin/src/lib/api-fetch.ts). Never re-add a service-to-service
# secret here — Vite inlines it into the public JS bundle.
cat > apps/admin/.env.production <<EOF
VITE_GRAPHQL_HTTP_URL=${API_ENDPOINT}/graphql
VITE_GRAPHQL_URL=${APPSYNC_API_URL}
VITE_GRAPHQL_WS_URL=${APPSYNC_WS_URL}
VITE_GRAPHQL_API_KEY=${APPSYNC_API_KEY}
VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${ADMIN_CLIENT_ID}
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_API_URL=${API_ENDPOINT}
EOF

pnpm --filter admin build

echo "▸ Syncing to S3 bucket: $ADMIN_BUCKET ..."
aws s3 sync apps/admin/dist/ "s3://${ADMIN_BUCKET}/" \
  --delete \
  --region "$REGION"

echo "▸ Invalidating CloudFront cache: $ADMIN_CF_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$ADMIN_CF_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text > /dev/null

ADMIN_URL="$(cd "$TF_DIR" && tf_out admin_url)"
echo ""
echo "✓ Admin deployed: ${ADMIN_URL:-https://<pending>}"
