#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${TWENTY_CREDENTIAL_PROVIDER_NAME:?TWENTY_CREDENTIAL_PROVIDER_NAME is required}"

if aws bedrock-agentcore-control get-oauth2-credential-provider \
  --region "$AWS_REGION" \
  --name "$TWENTY_CREDENTIAL_PROVIDER_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control delete-oauth2-credential-provider \
    --region "$AWS_REGION" \
    --name "$TWENTY_CREDENTIAL_PROVIDER_NAME" >/dev/null
fi

printf 'AgentCore Twenty provider deleted: provider=%s\n' \
  "$TWENTY_CREDENTIAL_PROVIDER_NAME"
