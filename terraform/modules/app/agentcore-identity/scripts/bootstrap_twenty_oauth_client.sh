#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${TWENTY_OAUTH_ISSUER:?TWENTY_OAUTH_ISSUER is required}"
: "${TWENTY_CLIENT_SECRET_ARN:?TWENTY_CLIENT_SECRET_ARN is required}"
: "${TWENTY_CREDENTIAL_PROVIDER_NAME:?TWENTY_CREDENTIAL_PROVIDER_NAME is required}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
issuer="${TWENTY_OAUTH_ISSUER%/}"

read_client_record() {
  aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
    --query SecretString \
    --output text 2>/dev/null || printf '{}'
}

write_client_record() {
  aws secretsmanager put-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
    --secret-string file:///dev/stdin >/dev/null
}

# Twenty's authorize endpoint is "$issuer/authorize" (NOT /oauth/authorize —
# observed live on tei-e2e: the previously hard-coded path 404s). Fetch the
# issuer's discovery document once and take both provider endpoints from it,
# falling back to the documented paths when discovery is unavailable.
discovery="$(curl --silent --fail --max-time 15 \
  "$issuer/.well-known/oauth-authorization-server" 2>/dev/null || printf '')"
provider_endpoint() {
  local field="$1" fallback="$2"
  local discovered
  discovered="$(jq -r --arg f "$field" '.[$f] // empty' <<<"$discovery" 2>/dev/null)"
  if [[ -n "$discovered" ]]; then
    printf '%s' "$discovered"
  else
    printf '%s' "$fallback"
  fi
}

reconcile_provider() {
  local client_id="$1"
  local runtime_script="$script_dir/reconcile_twenty_provider.mjs"
  if [[ -n "${THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR:-}" ]]; then
    runtime_script="$THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR/reconcile_twenty_provider.js"
    if [[ ! -f "$runtime_script" ]]; then
      printf '%s\n' 'Managed AgentCore control runtime is missing reconcile_twenty_provider.js' >&2
      return 66
    fi
  fi
  jq -n \
    --arg region "$AWS_REGION" \
    --arg name "$TWENTY_CREDENTIAL_PROVIDER_NAME" \
    --arg issuer "$issuer" \
    --arg authorizationEndpoint "$(provider_endpoint authorization_endpoint "$issuer/authorize")" \
    --arg tokenEndpoint "$(provider_endpoint token_endpoint "$issuer/oauth/token")" \
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
    }' | node "$runtime_script"
}

verify_provider() {
  local response="$1"
  local expected_client_id="$2"
  local expected_callback="$3"
  jq -e \
    --arg name "$TWENTY_CREDENTIAL_PROVIDER_NAME" \
    --arg client_id "$expected_client_id" \
    --arg callback "$expected_callback" \
    --arg secret_arn "$TWENTY_CLIENT_SECRET_ARN" \
    '.name == $name and
     .clientId == $client_id and
     .callbackUrl == $callback and
     .clientSecretArn == $secret_arn and
     .clientSecretJsonKey == "client_secret" and
     .clientSecretSource == "EXTERNAL" and
     .status == "READY"' <<<"$response" >/dev/null
}

client_record="$(read_client_record)"
if ! jq -e 'type == "object"' <<<"$client_record" >/dev/null 2>&1; then
  printf '%s\n' 'Twenty client secret must contain a JSON object' >&2
  exit 1
fi

client_id="$(jq -r '.client_id // empty' <<<"$client_record")"
client_secret_ready=false
if [[ -n "$client_id" ]] &&
  jq -e '.client_secret | type == "string" and length > 0' \
    <<<"$client_record" >/dev/null 2>&1 &&
  [[ "$(jq -r '.bootstrap_state // empty' <<<"$client_record")" == "ready" ]]; then
  client_secret_ready=true
else
  placeholder_id="thinkwork-bootstrap-$(openssl rand -hex 12)"
  placeholder_secret="$(openssl rand -base64 48 | tr -d '\n')"
  client_record="$(jq -n \
    --arg client_id "$placeholder_id" \
    --arg client_secret "$placeholder_secret" \
    '{
      bootstrap_state: "placeholder",
      client_id: $client_id,
      client_secret: $client_secret,
      token_endpoint_auth_method: "client_secret_post"
    }')"
  printf '%s' "$client_record" | write_client_record
  client_id="$placeholder_id"
fi

# AgentCore issues a provider-specific callback only after the provider exists.
# The placeholder is never used for a user grant; it only lets AgentCore return
# the callback that Twenty must bind to the confidential client registration.
provider_response="$(reconcile_provider "$client_id")"
callback_url="$(jq -r '.callbackUrl // empty' <<<"$provider_response")"
if [[ -z "$callback_url" ]]; then
  printf '%s\n' 'AgentCore Identity did not return a provider callback URL' >&2
  exit 1
fi

registered_callback_matches=false
if $client_secret_ready &&
  jq -e --arg callback "$callback_url" \
    '.redirect_uris | type == "array" and index($callback) != null' \
    <<<"$client_record" >/dev/null 2>&1 &&
  [[ "$(jq -r '.token_endpoint_auth_method // empty' <<<"$client_record")" == \
    "client_secret_post" ]]; then
  registered_callback_matches=true
fi

if $registered_callback_matches; then
  verify_provider "$provider_response" "$client_id" "$callback_url"
  printf 'Twenty confidential OAuth client reused: provider=%s callback=%s\n' \
    "$TWENTY_CREDENTIAL_PROVIDER_NAME" "$callback_url" >&2
  printf '%s' "$provider_response"
  exit 0
fi

if [[ -z "$discovery" ]]; then
  printf '%s\n' 'Twenty discovery document is unavailable' >&2
  exit 1
fi
registration_endpoint="$(jq -r '.registration_endpoint // empty' <<<"$discovery")"
if ! python3 - "$issuer" "$registration_endpoint" <<'PY'
import sys
from urllib.parse import urlsplit


def origin(url: str) -> tuple[str, str, int]:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("HTTPS origin without userinfo required")
    return parsed.scheme, parsed.hostname.lower(), parsed.port or 443


try:
    issuer_origin = origin(sys.argv[1])
    registration_origin = origin(sys.argv[2])
except (ValueError, IndexError):
    raise SystemExit(1)
raise SystemExit(0 if issuer_origin == registration_origin else 1)
PY
then
  printf '%s\n' 'Twenty registration endpoint is not on the exact issuer origin' >&2
  exit 1
fi
if ! jq -e \
    --arg issuer "$issuer" \
    '.issuer == $issuer and
     (.grant_types_supported | index("authorization_code") != null) and
     (.token_endpoint_auth_methods_supported | index("client_secret_post") != null) and
     (.scopes_supported | index("api") != null) and
     (.scopes_supported | index("profile") != null)' \
    <<<"$discovery" >/dev/null; then
  printf '%s\n' \
    'Twenty discovery does not advertise same-origin confidential authorization-code DCR' >&2
  exit 1
fi

registration_payload="$(jq -n \
  --arg callback "$callback_url" \
  '{
    client_name: "ThinkWork AgentCore Identity Twenty CRM",
    redirect_uris: [$callback],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: "api profile"
  }')"
registration_response="$(curl --silent --show-error --fail-with-body \
  -H 'content-type: application/json' \
  --data-binary "$registration_payload" \
  "$registration_endpoint")"

client_record="$(jq -e \
  --arg callback "$callback_url" \
  '{
    bootstrap_state: "ready",
    client_id: .client_id,
    client_secret: .client_secret,
    client_id_issued_at: .client_id_issued_at,
    client_secret_expires_at: .client_secret_expires_at,
    client_name: .client_name,
    redirect_uris: .redirect_uris,
    grant_types: .grant_types,
    response_types: .response_types,
    token_endpoint_auth_method: .token_endpoint_auth_method,
    scope: (.scope // "api profile"),
    registration_access_token: .registration_access_token,
    registration_client_uri: .registration_client_uri
  } | select(
    (.client_id | type == "string" and length > 0) and
    (.client_secret | type == "string" and length > 0) and
    (.redirect_uris | type == "array" and index($callback) != null) and
    .token_endpoint_auth_method == "client_secret_post"
  )' <<<"$registration_response")" || {
  printf '%s\n' 'Twenty DCR did not return a confidential callback-bound client' >&2
  exit 1
}

# A Secrets Manager version write is atomic. The plaintext client secret never
# enters Terraform state or process arguments and is not printed to logs.
printf '%s' "$client_record" | write_client_record
client_id="$(jq -r '.client_id' <<<"$client_record")"
provider_response="$(reconcile_provider "$client_id")"
verify_provider "$provider_response" "$client_id" "$callback_url"

printf 'Twenty confidential OAuth client registered: provider=%s callback=%s\n' \
  "$TWENTY_CREDENTIAL_PROVIDER_NAME" "$callback_url" >&2
printf '%s' "$provider_response"
