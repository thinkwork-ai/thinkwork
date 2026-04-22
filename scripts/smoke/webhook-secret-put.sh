#!/usr/bin/env bash
# webhook-secret-put.sh — provision or rotate a webhook signing secret.
#
# Writes a per-(tenant, integration) signing secret to AWS Secrets Manager
# at the canonical path the `_shared.ts` webhook helper reads:
#
#   thinkwork/tenants/<tenantId>/webhooks/<integration>/signing-secret
#
# This is operator tooling. The webhook Lambdas (see
# packages/api/src/handlers/webhooks/README.md) fetch the secret at
# request time and fail closed with 401 if it's missing. Until an
# operator runs this script for a given (tenant, integration) pair,
# that webhook endpoint will reject every request — deliberately.
#
# Usage:
#   scripts/smoke/webhook-secret-put.sh <tenant-id> <integration>
#   scripts/smoke/webhook-secret-put.sh <tenant-id> <integration> <secret>
#
# With no third argument, generates a cryptographically random 32-byte
# hex secret and prints it to stdout so the operator can reuse it in
# webhook-smoke.sh. With an explicit secret, writes that instead —
# useful when the vendor requires you to configure their end first.
#
# Env:
#   AWS_REGION — defaults to us-east-1
#
# Exit codes:
#   0 — secret created or updated
#   2 — usage / environment error
#   3 — AWS error

set -euo pipefail

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" || $# -lt 2 ]]; then
  usage
  exit $([[ $# -lt 2 ]] && echo 2 || echo 0)
fi

TENANT_ID="$1"
INTEGRATION="$2"
SECRET_VALUE="${3:-}"
REGION="${AWS_REGION:-us-east-1}"

if [[ -z "$SECRET_VALUE" ]]; then
  # 32 bytes → 64 hex chars. Matches GitHub's convention shape.
  SECRET_VALUE=$(openssl rand -hex 32)
fi

SECRET_NAME="thinkwork/tenants/${TENANT_ID}/webhooks/${INTEGRATION}/signing-secret"

# Try update first; if the secret doesn't exist, create it. Two distinct
# API calls because PutSecretValue fails on a nonexistent secret.
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$SECRET_VALUE" \
    --region "$REGION" >/dev/null
  echo "rotated: $SECRET_NAME" >&2
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --secret-string "$SECRET_VALUE" \
    --region "$REGION" >/dev/null
  echo "created: $SECRET_NAME" >&2
fi

# Print secret on stdout so a pipeline can capture it. Stderr messages
# above keep the output clean for scripts.
echo "$SECRET_VALUE"
