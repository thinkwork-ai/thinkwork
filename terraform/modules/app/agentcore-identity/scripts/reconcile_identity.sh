#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${WORKLOAD_IDENTITY_NAME:?WORKLOAD_IDENTITY_NAME is required}"
: "${CREDENTIAL_PROVIDER_NAME:?CREDENTIAL_PROVIDER_NAME is required}"
: "${OAUTH_ISSUER:?OAUTH_ISSUER is required}"
: "${OAUTH_CLIENT_ID:?OAUTH_CLIENT_ID is required}"
: "${OAUTH_CLIENT_SECRET:?OAUTH_CLIENT_SECRET is required}"
: "${OAUTH_RETURN_URL:?OAUTH_RETURN_URL is required}"

if aws bedrock-agentcore-control get-workload-identity \
  --region "$AWS_REGION" \
  --name "$WORKLOAD_IDENTITY_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control update-workload-identity \
    --region "$AWS_REGION" \
    --name "$WORKLOAD_IDENTITY_NAME" \
    --allowed-resource-oauth2-return-urls "$OAUTH_RETURN_URL" >/dev/null
else
  aws bedrock-agentcore-control create-workload-identity \
    --region "$AWS_REGION" \
    --name "$WORKLOAD_IDENTITY_NAME" \
    --allowed-resource-oauth2-return-urls "$OAUTH_RETURN_URL" \
    --tags '{"purpose":"think-316-proof","managed-by":"terraform"}' >/dev/null
fi

payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT
jq -n \
  --arg name "$CREDENTIAL_PROVIDER_NAME" \
  --arg issuer "$OAUTH_ISSUER" \
  --arg authorizationEndpoint "$OAUTH_ISSUER/authorize" \
  --arg tokenEndpoint "$OAUTH_ISSUER/token" \
  --arg clientId "$OAUTH_CLIENT_ID" \
  --arg clientSecret "$OAUTH_CLIENT_SECRET" \
  '{
    name: $name,
    credentialProviderVendor: "CustomOauth2",
    oauth2ProviderConfigInput: {
      customOauth2ProviderConfig: {
        oauthDiscovery: {
          authorizationServerMetadata: {
            issuer: $issuer,
            authorizationEndpoint: $authorizationEndpoint,
            tokenEndpoint: $tokenEndpoint,
            responseTypes: ["code"]
          }
        },
        clientId: $clientId,
        clientSecret: $clientSecret,
        clientAuthenticationMethod: "CLIENT_SECRET_BASIC",
        onBehalfOfTokenExchangeConfig: {
          grantType: "TOKEN_EXCHANGE",
          tokenExchangeGrantTypeConfig: {actorTokenContent: "NONE"}
        }
      }
    }
  }' >"$payload_file"

if aws bedrock-agentcore-control get-oauth2-credential-provider \
  --region "$AWS_REGION" \
  --name "$CREDENTIAL_PROVIDER_NAME" >/dev/null 2>&1; then
  aws bedrock-agentcore-control update-oauth2-credential-provider \
    --region "$AWS_REGION" \
    --cli-input-json "file://$payload_file" >/dev/null
else
  aws bedrock-agentcore-control create-oauth2-credential-provider \
    --region "$AWS_REGION" \
    --cli-input-json "file://$payload_file" >/dev/null
fi

printf 'AgentCore Identity proof resources reconciled: workload=%s provider=%s\n' \
  "$WORKLOAD_IDENTITY_NAME" "$CREDENTIAL_PROVIDER_NAME"
