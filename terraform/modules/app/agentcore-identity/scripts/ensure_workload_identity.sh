#!/usr/bin/env bash
set -euo pipefail

# THINK-324 — Twenty-side workload-identity guarantee. Create-if-missing
# ONLY: when the identity already exists (created by the proof lifecycle or a
# prior run) this script must not touch it — reconcile_twenty_identity.sh
# owns the return-url allowlist and always runs afterwards.

: "${AWS_REGION:?AWS_REGION is required}"
: "${WORKLOAD_IDENTITY_NAME:?WORKLOAD_IDENTITY_NAME is required}"
: "${OAUTH_RETURN_URLS_JSON:?OAUTH_RETURN_URLS_JSON is required}"

jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0)' \
  <<<"$OAUTH_RETURN_URLS_JSON" >/dev/null

if aws bedrock-agentcore-control get-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" >/dev/null 2>&1; then
  printf 'AgentCore workload identity already present: %s\n' "$WORKLOAD_IDENTITY_NAME"
  exit 0
fi

aws bedrock-agentcore-control create-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" \
  --allowed-resource-oauth2-return-urls "$OAUTH_RETURN_URLS_JSON" \
  --tags '{"purpose":"twenty-user-federation","managed-by":"terraform"}' >/dev/null

printf 'AgentCore workload identity created: %s\n' "$WORKLOAD_IDENTITY_NAME"
