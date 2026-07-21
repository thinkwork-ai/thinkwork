#!/usr/bin/env bash
set -euo pipefail

# THINK-324 — final deletion of the SHARED workload identity, owned by the
# Twenty identity half (workload_identity_cleanup_owner). Runs only when the
# Twenty user-federation identity is itself being removed.

: "${AWS_REGION:?AWS_REGION is required}"
: "${WORKLOAD_IDENTITY_NAME:?WORKLOAD_IDENTITY_NAME is required}"

if aws bedrock-agentcore-control get-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control delete-workload-identity \
    --region "$AWS_REGION" \
    --name "$WORKLOAD_IDENTITY_NAME" >/dev/null
fi

printf 'AgentCore workload identity deleted: %s\n' "$WORKLOAD_IDENTITY_NAME"
