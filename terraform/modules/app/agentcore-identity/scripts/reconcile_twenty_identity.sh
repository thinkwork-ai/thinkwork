#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${WORKLOAD_IDENTITY_NAME:?WORKLOAD_IDENTITY_NAME is required}"
: "${OAUTH_RETURN_URLS_JSON:?OAUTH_RETURN_URLS_JSON is required}"
: "${TWENTY_CREDENTIAL_PROVIDER_NAME:?TWENTY_CREDENTIAL_PROVIDER_NAME is required}"
: "${TWENTY_CLIENT_SECRET_ARN:?TWENTY_CLIENT_SECRET_ARN is required}"
: "${TWENTY_OAUTH_ISSUER:?TWENTY_OAUTH_ISSUER is required}"
: "${TWENTY_OAUTH_RESOURCE:?TWENTY_OAUTH_RESOURCE is required}"

jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0)' \
  <<<"$OAUTH_RETURN_URLS_JSON" >/dev/null

# The core lifecycle owns this workload. Extend its allowlist in place; never
# delete or recreate it while adding a downstream user-federation provider.
aws bedrock-agentcore-control update-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" \
  --allowed-resource-oauth2-return-urls "$OAUTH_RETURN_URLS_JSON" >/dev/null

client_record="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
  --query SecretString \
  --output text 2>/dev/null || true)"
if [[ -z "$client_record" ]]; then
  client_record='{}'
fi
client_id="$(jq -r '.client_id // empty' <<<"$client_record")"
if [[ -z "$client_id" ]] ||
  ! jq -e '.client_secret | type == "string" and length > 0' \
    <<<"$client_record" >/dev/null 2>&1; then
  printf '%s\n' \
    'Twenty confidential client is not bootstrapped; run bootstrap_twenty_oauth_client.sh with an authenticated administrator token secret' >&2
  exit 1
fi

provider_payload="$(jq -n \
  --arg region "$AWS_REGION" \
  --arg name "$TWENTY_CREDENTIAL_PROVIDER_NAME" \
  --arg issuer "$TWENTY_OAUTH_ISSUER" \
  --arg authorizationEndpoint "${TWENTY_OAUTH_ISSUER%/}/authorize" \
  --arg tokenEndpoint "${TWENTY_OAUTH_ISSUER%/}/oauth/token" \
  --arg clientId "$client_id" \
  --arg secretArn "$TWENTY_CLIENT_SECRET_ARN" \
  '{
    region: $region,
    name: $name,
    issuer: $issuer,
    authorizationEndpoint: $authorizationEndpoint,
    tokenEndpoint: $tokenEndpoint,
    clientId: $clientId,
    secretArn: $secretArn
  }')"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
provider_response="$(printf '%s' "$provider_payload" | \
  node "$script_dir/reconcile_twenty_provider.mjs")"
callback_url="$(jq -r '.callbackUrl // empty' <<<"$provider_response")"
if [[ -z "$callback_url" || "$callback_url" == "None" ]]; then
  printf '%s\n' 'AgentCore Identity did not return the Twenty callback URL' >&2
  exit 1
fi

registered_callback="$(jq -r '.redirect_uris[0] // empty' <<<"$client_record")"
if [[ "$registered_callback" != "$callback_url" ]]; then
  printf 'Twenty callback mismatch: registered=%s agentcore=%s\n' \
    "$registered_callback" "$callback_url" >&2
  exit 1
fi

printf 'AgentCore Twenty provider reconciled: workload=%s provider=%s resource=%s\n' \
  "$WORKLOAD_IDENTITY_NAME" "$TWENTY_CREDENTIAL_PROVIDER_NAME" "$TWENTY_OAUTH_RESOURCE"
