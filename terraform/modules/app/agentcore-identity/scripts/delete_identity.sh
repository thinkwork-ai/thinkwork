#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${WORKLOAD_IDENTITY_NAME:?WORKLOAD_IDENTITY_NAME is required}"
: "${CREDENTIAL_PROVIDER_NAME:?CREDENTIAL_PROVIDER_NAME is required}"

if aws bedrock-agentcore-control get-oauth2-credential-provider \
  --region "$AWS_REGION" \
  --name "$CREDENTIAL_PROVIDER_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control delete-oauth2-credential-provider \
    --region "$AWS_REGION" \
    --name "$CREDENTIAL_PROVIDER_NAME" >/dev/null
fi

if aws bedrock-agentcore-control get-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control delete-workload-identity \
    --region "$AWS_REGION" \
    --name "$WORKLOAD_IDENTITY_NAME" >/dev/null
fi

printf 'AgentCore Identity proof resources deleted: workload=%s provider=%s\n' \
  "$WORKLOAD_IDENTITY_NAME" "$CREDENTIAL_PROVIDER_NAME"
