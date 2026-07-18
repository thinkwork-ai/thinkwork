#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
region="$(jq -r '.region // empty' <<<"$input")"
workload_name="$(jq -r '.workload_identity_name // empty' <<<"$input")"
provider_name="$(jq -r '.credential_provider_name // empty' <<<"$input")"
twenty_provider_name="$(jq -r '.twenty_credential_provider_name // empty' <<<"$input")"
if [[ -z "$region" || -z "$workload_name" || -z "$provider_name" || -z "$twenty_provider_name" ]]; then
  printf '%s\n' '{"error":"region and identity names are required"}' >&2
  exit 1
fi

workload_json="$(aws bedrock-agentcore-control get-workload-identity \
  --region "$region" --name "$workload_name" --output json)"
provider_json="$(aws bedrock-agentcore-control get-oauth2-credential-provider \
  --region "$region" --name "$provider_name" --output json)"
twenty_provider_json="$(aws bedrock-agentcore-control get-oauth2-credential-provider \
  --region "$region" --name "$twenty_provider_name" --output json)"

jq -n \
  --arg workload_identity_arn "$(jq -r '.workloadIdentityArn // empty' <<<"$workload_json")" \
  --arg credential_provider_arn "$(jq -r '.credentialProviderArn // empty' <<<"$provider_json")" \
  --arg credential_secret_arn "$(jq -r '
    if (.clientSecretArn | type) == "object"
    then .clientSecretArn.secretArn // empty
    else .clientSecretArn // empty
    end
  ' <<<"$provider_json")" \
  --arg twenty_credential_provider_arn "$(jq -r '.credentialProviderArn // empty' <<<"$twenty_provider_json")" \
  --arg twenty_oauth_callback_url "$(jq -r '.callbackUrl // empty' <<<"$twenty_provider_json")" \
  'if ($workload_identity_arn == "" or $credential_provider_arn == "" or $credential_secret_arn == "" or $twenty_credential_provider_arn == "" or $twenty_oauth_callback_url == "")
   then error("AgentCore Identity readback omitted required ARNs")
   else {
     workload_identity_arn: $workload_identity_arn,
     credential_provider_arn: $credential_provider_arn,
     credential_secret_arn: $credential_secret_arn,
     twenty_credential_provider_arn: $twenty_credential_provider_arn,
     twenty_oauth_callback_url: $twenty_oauth_callback_url
   } end'
