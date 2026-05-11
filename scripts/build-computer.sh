#!/usr/bin/env bash
# Build and deploy the computer app to S3 + CloudFront.
#
# Reads environment config from Terraform outputs, builds a production
# Vite bundle, syncs to S3, and invalidates the CloudFront cache.
#
# apps/computer reuses the existing ThinkworkAdmin Cognito client (same
# users, single sign-in across both surfaces) so VITE_COGNITO_CLIENT_ID
# is sourced from the admin_client_id Terraform output, not a separate
# computer client. The terraform/modules/thinkwork concat() extends that
# client's CallbackURLs to include computer.thinkwork.ai automatically.
#
# Usage:
#   bash scripts/build-computer.sh <stage>
#
# Environment variables (optional overrides):
#   TF_DIR          — Terraform working directory (default: terraform/examples/greenfield)
#   AWS_REGION      — AWS region (default: us-east-1)

set -euo pipefail

STAGE="${1:?Usage: build-computer.sh <stage>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform/examples/greenfield}"
REGION="${AWS_REGION:-us-east-1}"

echo "▸ Reading Terraform outputs for stage=$STAGE ..."
cd "$TF_DIR"

source "$REPO_ROOT/scripts/lib/terraform-output.sh"

API_ENDPOINT="$(tf_output_raw api_endpoint)"
APPSYNC_API_URL="$(tf_output_raw appsync_api_url)"
APPSYNC_REALTIME_URL="$(tf_output_raw appsync_realtime_url)"
APPSYNC_API_KEY="$(tf_output_raw appsync_api_key)"
USER_POOL_ID="$(tf_output_raw user_pool_id)"
ADMIN_CLIENT_ID="$(tf_output_raw admin_client_id)"
AUTH_DOMAIN="$(tf_output_raw auth_domain)"
COMPUTER_BUCKET="$(tf_output_raw computer_bucket_name)"
COMPUTER_CF_ID="$(tf_output_raw computer_distribution_id)"
COMPUTER_SANDBOX_BUCKET="$(tf_output_raw computer_sandbox_bucket_name 2>/dev/null || echo '')"
COMPUTER_SANDBOX_CF_ID="$(tf_output_raw computer_sandbox_distribution_id 2>/dev/null || echo '')"
COMPUTER_SANDBOX_URL="$(tf_output_raw computer_sandbox_url 2>/dev/null || echo '')"
COMPUTER_SANDBOX_PARENT_ORIGINS="$(tf_output_raw computer_sandbox_allowed_parent_origins 2>/dev/null || echo '')"
MAPBOX_PUBLIC_TOKEN="${MAPBOX_PUBLIC_TOKEN:-$(tf_output_raw mapbox_public_token)}"

if [[ -z "$COMPUTER_SANDBOX_URL" || -z "$COMPUTER_SANDBOX_BUCKET" || -z "$COMPUTER_SANDBOX_CF_ID" ]]; then
  cat >&2 <<EOF
Computer sandbox infrastructure is required for generated app rendering.
Missing one or more Terraform outputs:
  computer_sandbox_url='${COMPUTER_SANDBOX_URL}'
  computer_sandbox_bucket_name='${COMPUTER_SANDBOX_BUCKET}'
  computer_sandbox_distribution_id='${COMPUTER_SANDBOX_CF_ID}'
Provision var.computer_sandbox_domain before deploying apps/computer.
EOF
  exit 1
fi

if [[ -z "$COMPUTER_SANDBOX_PARENT_ORIGINS" ]]; then
  cat >&2 <<EOF
Computer sandbox parent-origin allowlist is required.
Missing Terraform output: computer_sandbox_allowed_parent_origins
EOF
  exit 1
fi

# Construct full Cognito domain URL from the short domain prefix
COGNITO_DOMAIN="https://${AUTH_DOMAIN}.auth.${REGION}.amazoncognito.com"

# Construct WebSocket URL from AppSync API URL
APPSYNC_WS_URL="${APPSYNC_REALTIME_URL}"

echo "▸ Building computer app ..."
cd "$REPO_ROOT"

# Write production env file.
#
# VITE_API_AUTH_SECRET is intentionally absent. The computer SPA authenticates
# REST calls with the user's Cognito id token (via apiFetch in
# apps/computer/src/lib/api-fetch.ts). Never re-add a service-to-service
# secret here — Vite inlines it into the public JS bundle.
cat > apps/computer/.env.production <<EOF
VITE_GRAPHQL_HTTP_URL=${API_ENDPOINT}/graphql
VITE_GRAPHQL_URL=${APPSYNC_API_URL}
VITE_GRAPHQL_WS_URL=${APPSYNC_WS_URL}
VITE_GRAPHQL_API_KEY=${APPSYNC_API_KEY}
VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${ADMIN_CLIENT_ID}
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_API_URL=${API_ENDPOINT}
VITE_MAPBOX_PUBLIC_TOKEN=${MAPBOX_PUBLIC_TOKEN}
VITE_SANDBOX_IFRAME_SRC=${COMPUTER_SANDBOX_URL:+${COMPUTER_SANDBOX_URL%/}/iframe-shell.html}
VITE_ALLOWED_PARENT_ORIGINS=${COMPUTER_SANDBOX_PARENT_ORIGINS}
EOF

pnpm --filter computer build

# Plan-012 U9 / U11.5: build the iframe-shell bundle. The shell hosts
# the cross-origin React applet substrate at sandbox.thinkwork.ai
# (or the dev/staging analogue) and is a separate Vite build from
# the host app. Only sync to the sandbox bucket if Terraform has
# provisioned it for this stage. Sandbox infra is mandatory for generated
# app rendering; this script fails before building when the sandbox outputs
# are missing.
echo "▸ Building iframe-shell bundle ..."
VITE_SANDBOX_IFRAME_SRC="${COMPUTER_SANDBOX_URL:+${COMPUTER_SANDBOX_URL%/}/iframe-shell.html}" \
VITE_ALLOWED_PARENT_ORIGINS="${COMPUTER_SANDBOX_PARENT_ORIGINS}" \
VITE_MAPBOX_PUBLIC_TOKEN="${MAPBOX_PUBLIC_TOKEN}" \
  pnpm --filter @thinkwork/computer build:iframe-shell

echo "▸ Syncing to S3 bucket: $COMPUTER_BUCKET ..."
aws s3 sync apps/computer/dist/ "s3://${COMPUTER_BUCKET}/" \
  --delete \
  --exclude "iframe-shell/*" \
  --region "$REGION"

echo "▸ Invalidating CloudFront cache: $COMPUTER_CF_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$COMPUTER_CF_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text > /dev/null

echo "▸ Syncing iframe-shell to sandbox bucket: $COMPUTER_SANDBOX_BUCKET ..."
aws s3 sync apps/computer/dist/iframe-shell/ "s3://${COMPUTER_SANDBOX_BUCKET}/" \
  --delete \
  --region "$REGION"

echo "▸ Invalidating sandbox CloudFront cache: $COMPUTER_SANDBOX_CF_ID ..."
aws cloudfront create-invalidation \
  --distribution-id "$COMPUTER_SANDBOX_CF_ID" \
  --paths "/*" \
  --region "$REGION" \
  --output text > /dev/null

COMPUTER_URL="$(cd "$TF_DIR" && tf_output_raw computer_url)"
echo ""
echo "✓ Computer deployed: ${COMPUTER_URL:-https://<pending>}"
if [[ -n "$COMPUTER_SANDBOX_URL" ]]; then
  echo "✓ Sandbox iframe-shell deployed: $COMPUTER_SANDBOX_URL"
fi
