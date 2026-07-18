#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${TWENTY_OAUTH_ISSUER:?TWENTY_OAUTH_ISSUER is required}"
: "${TWENTY_CLIENT_SECRET_ARN:?TWENTY_CLIENT_SECRET_ARN is required}"
: "${TWENTY_ADMIN_TOKEN_SECRET_ARN:?TWENTY_ADMIN_TOKEN_SECRET_ARN is required}"

callback_url="${TWENTY_CALLBACK_URL:-https://bedrock-agentcore.${AWS_REGION}.amazonaws.com/identities/oauth2/callback}"

if existing_secret="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
  --query SecretString \
  --output text 2>/dev/null)" &&
  jq -e '.client_id | type == "string" and length > 0' <<<"$existing_secret" >/dev/null &&
  jq -e '.client_secret | type == "string" and length > 0' <<<"$existing_secret" >/dev/null; then
  existing_callback="$(jq -r '.redirect_uris[0] // empty' <<<"$existing_secret")"
  if [[ "$existing_callback" == "$callback_url" ]]; then
    printf 'Twenty confidential OAuth client already bootstrapped: secret=%s\n' \
      "$TWENTY_CLIENT_SECRET_ARN"
    exit 0
  fi
fi

# Twenty's RFC 7591 endpoint intentionally downgrades all dynamic clients to
# public clients. Its authenticated metadata API is the supported path for a
# confidential application registration: Twenty generates and bcrypt-hashes
# the secret server-side and returns the plaintext exactly once.
admin_record="$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$TWENTY_ADMIN_TOKEN_SECRET_ARN" \
  --query SecretString \
  --output text)"
admin_token="$(jq -r '.access_token // empty' <<<"$admin_record")"
if [[ -z "$admin_token" ]]; then
  printf '%s\n' 'Twenty administrator token secret has no access_token' >&2
  exit 1
fi

if [[ -n "${existing_secret:-}" ]] &&
  jq -e '.registration_id | type == "string" and length > 0' \
    <<<"$existing_secret" >/dev/null; then
  registration_id="$(jq -r '.registration_id' <<<"$existing_secret")"
  update_payload="$(jq -n \
    --arg id "$registration_id" \
    --arg callback "$callback_url" \
    '{
      query: "mutation UpdateAgentCoreRegistration($input: UpdateApplicationRegistrationInput!) { updateApplicationRegistration(input: $input) { id oAuthRedirectUris oAuthScopes } }",
      variables: {
        input: {
          id: $id,
          update: {oAuthRedirectUris: [$callback]}
        }
      }
    }')"
  update_response="$(curl --silent --show-error --fail-with-body \
    -H "authorization: Bearer $admin_token" \
    -H 'content-type: application/json' \
    --data-binary "$update_payload" \
    "${TWENTY_OAUTH_ISSUER%/}/metadata")"
  if jq -e '.errors | type == "array" and length > 0' <<<"$update_response" >/dev/null; then
    jq '{errors: [.errors[] | {message, extensions: {code: .extensions.code}}]}' \
      <<<"$update_response" >&2
    printf '%s\n' 'Twenty OAuth callback update failed' >&2
    exit 1
  fi
  updated_secret="$(jq --arg callback "$callback_url" \
    '.redirect_uris = [$callback]' <<<"$existing_secret")"
  printf '%s' "$updated_secret" | aws secretsmanager put-secret-value \
    --region "$AWS_REGION" \
    --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
    --secret-string file:///dev/stdin >/dev/null
  printf 'Twenty confidential OAuth client callback updated: secret=%s callback=%s\n' \
    "$TWENTY_CLIENT_SECRET_ARN" "$callback_url"
  exit 0
fi

graphql_payload="$(jq -n \
  --arg callback "$callback_url" \
  '{
    query: "mutation CreateAgentCoreRegistration($input: CreateApplicationRegistrationInput!) { createApplicationRegistration(input: $input) { applicationRegistration { id universalIdentifier oAuthClientId oAuthRedirectUris oAuthScopes } clientSecret } }",
    variables: {
      input: {
        name: "ThinkWork AgentCore Identity Twenty CRM",
        oAuthRedirectUris: [$callback],
        oAuthScopes: ["api", "profile"]
      }
    }
  }')"
graphql_response="$(curl --silent --show-error --fail-with-body \
  -H "authorization: Bearer $admin_token" \
  -H 'content-type: application/json' \
  --data-binary "$graphql_payload" \
  "${TWENTY_OAUTH_ISSUER%/}/metadata")"

if jq -e '.errors | type == "array" and length > 0' <<<"$graphql_response" >/dev/null; then
  jq '{errors: [.errors[] | {message, extensions: {code: .extensions.code}}]}' \
    <<<"$graphql_response" >&2
  printf '%s\n' 'Twenty confidential OAuth client bootstrap failed' >&2
  exit 1
fi

client_record="$(jq -e '{
  client_id: .data.createApplicationRegistration.applicationRegistration.oAuthClientId,
  client_secret: .data.createApplicationRegistration.clientSecret,
  registration_id: .data.createApplicationRegistration.applicationRegistration.id,
  universal_identifier: .data.createApplicationRegistration.applicationRegistration.universalIdentifier,
  redirect_uris: .data.createApplicationRegistration.applicationRegistration.oAuthRedirectUris,
  scopes: .data.createApplicationRegistration.applicationRegistration.oAuthScopes
} | select(
  (.client_id | type == "string" and length > 0) and
  (.client_secret | type == "string" and length > 0)
)' <<<"$graphql_response")"

printf '%s' "$client_record" | aws secretsmanager put-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$TWENTY_CLIENT_SECRET_ARN" \
  --secret-string file:///dev/stdin >/dev/null

printf 'Twenty confidential OAuth client bootstrapped: secret=%s callback=%s\n' \
  "$TWENTY_CLIENT_SECRET_ARN" "$callback_url"
