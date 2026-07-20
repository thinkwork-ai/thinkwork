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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
provider_response="$(bash "$script_dir/bootstrap_twenty_oauth_client.sh")"
callback_url="$(jq -r '.callbackUrl // empty' <<<"$provider_response")"
if [[ -z "$callback_url" || "$callback_url" == "None" ]]; then
  printf '%s\n' 'AgentCore Identity did not return the Twenty callback URL' >&2
  exit 1
fi

client_record="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
  --query SecretString \
  --output text)"
jq -e --arg callback "$callback_url" \
  '.bootstrap_state == "ready" and
   (.client_id | type == "string" and length > 0) and
   (.client_secret | type == "string" and length > 0) and
   (.redirect_uris | type == "array" and index($callback) != null) and
   .token_endpoint_auth_method == "client_secret_post"' \
  <<<"$client_record" >/dev/null

printf 'AgentCore Twenty provider reconciled: workload=%s provider=%s resource=%s callback=%s\n' \
  "$WORKLOAD_IDENTITY_NAME" "$TWENTY_CREDENTIAL_PROVIDER_NAME" \
  "$TWENTY_OAUTH_RESOURCE" "$callback_url"
