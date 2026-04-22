#!/usr/bin/env bash
# webhook-smoke.sh — sign + POST a webhook payload to the deployed API.
#
# Does the HMAC-SHA256 signing + curl in one shot so an operator can
# smoke-test `/webhooks/crm-opportunity/<tenantId>` or
# `/webhooks/task-event/<tenantId>` without hand-rolling the signature.
#
# What this does NOT do:
#   * Provision the signing secret — see webhook-secret-put.sh.
#   * Verify the resulting skill_runs row — run the SQL one-liner from
#     scripts/smoke/README.md or connect to the dev DB directly.
#
# Usage:
#   scripts/smoke/webhook-smoke.sh \
#     --tenant-id <uuid> \
#     --integration <crm-opportunity|task-event> \
#     --payload <path-to-json-file> \
#     [--api-url <https://...>] \
#     [--secret <hex>]
#
# If --api-url is omitted, reads `api_endpoint` from
#   terraform/examples/greenfield/terraform output.
# If --secret is omitted, reads from AWS Secrets Manager at
#   thinkwork/tenants/<tenantId>/webhooks/<integration>/signing-secret.
#
# Env:
#   STAGE — defaults to dev (used for terraform workspace selection)
#   AWS_REGION — defaults to us-east-1
#
# Exit codes:
#   0 — request sent, response printed (check HTTP status in output)
#   2 — usage / missing deps
#   3 — secret fetch or signing failed

set -euo pipefail

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

TENANT_ID=""
INTEGRATION=""
PAYLOAD_FILE=""
API_URL=""
SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)    TENANT_ID="$2"; shift 2 ;;
    --integration)  INTEGRATION="$2"; shift 2 ;;
    --payload)      PAYLOAD_FILE="$2"; shift 2 ;;
    --api-url)      API_URL="$2"; shift 2 ;;
    --secret)       SECRET="$2"; shift 2 ;;
    --help|-h)      usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TENANT_ID" || -z "$INTEGRATION" || -z "$PAYLOAD_FILE" ]]; then
  usage >&2
  exit 2
fi
if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "payload file not found: $PAYLOAD_FILE" >&2
  exit 2
fi

STAGE="${STAGE:-dev}"
REGION="${AWS_REGION:-us-east-1}"

# Resolve API URL from terraform if not provided. Uses the same
# greenfield example that deploy.yml drives so outputs match the
# deployed state.
if [[ -z "$API_URL" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  pushd "$REPO_ROOT/terraform/examples/greenfield" >/dev/null
  terraform init -input=false >/dev/null
  terraform workspace select "$STAGE" >/dev/null
  API_URL=$(terraform output -raw api_endpoint)
  popd >/dev/null
fi

# Resolve secret from Secrets Manager if not provided.
if [[ -z "$SECRET" ]]; then
  SECRET_NAME="thinkwork/tenants/${TENANT_ID}/webhooks/${INTEGRATION}/signing-secret"
  SECRET=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString --output text \
    --region "$REGION" 2>/dev/null) || {
      echo "failed to fetch secret $SECRET_NAME — run scripts/smoke/webhook-secret-put.sh first" >&2
      exit 3
    }
fi

# Read raw body; compute HMAC-SHA256. Matches `computeSignature` in
# packages/api/src/handlers/webhooks/_shared.ts.
BODY=$(cat "$PAYLOAD_FILE")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

URL="${API_URL%/}/webhooks/${INTEGRATION}/${TENANT_ID}"

echo "POST $URL" >&2
echo "  body-bytes: ${#BODY}" >&2
echo "  signature:  sha256=${SIG:0:16}..." >&2
echo "" >&2

# -sS: silent but show errors. -D -: dump response headers to stdout
# before the body so the operator sees status + x-request-id inline.
curl -sS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-thinkwork-signature: sha256=${SIG}" \
  -D - \
  --data-binary "$BODY"
echo ""
