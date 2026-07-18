#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
region="$(jq -r '.region // empty' <<<"$input")"
gateway_name="$(jq -r '.gateway_name // empty' <<<"$input")"
target_name="$(jq -r '.target_name // empty' <<<"$input")"
engine_name="$(jq -r '.policy_engine_name // empty' <<<"$input")"
policy_name="$(jq -r '.policy_name // empty' <<<"$input")"
[[ -n "$region" && -n "$gateway_name" && -n "$target_name" && -n "$engine_name" && -n "$policy_name" ]]

gateway_id="$(aws bedrock-agentcore-control list-gateways --region "$region" --output json \
  | jq -r --arg name "$gateway_name" '(.items // .gateways // [])[] | select(.name == $name) | .gatewayId' | head -n 1)"
engine_id="$(aws bedrock-agentcore-control list-policy-engines --region "$region" --output json \
  | jq -r --arg name "$engine_name" '(.policyEngines // .items // [])[] | select(.name == $name) | .policyEngineId' | head -n 1)"
[[ -n "$gateway_id" && -n "$engine_id" ]]

gateway="$(aws bedrock-agentcore-control get-gateway --region "$region" --gateway-identifier "$gateway_id" --output json)"
target_id="$(aws bedrock-agentcore-control list-gateway-targets --region "$region" --gateway-identifier "$gateway_id" --output json \
  | jq -r --arg name "$target_name" '(.items // .targets // [])[] | select(.name == $name) | .targetId' | head -n 1)"
policy_id="$(aws bedrock-agentcore-control list-policies --region "$region" --policy-engine-id "$engine_id" --output json \
  | jq -r --arg name "$policy_name" '(.policies // .items // [])[] | select(.name == $name) | .policyId' | head -n 1)"

jq -n \
  --arg gateway_id "$gateway_id" \
  --arg gateway_arn "$(jq -r '.gatewayArn // empty' <<<"$gateway")" \
  --arg gateway_url "$(jq -r '.gatewayUrl // .url // empty' <<<"$gateway")" \
  --arg target_id "$target_id" \
  --arg policy_engine_id "$engine_id" \
  --arg policy_id "$policy_id" \
  'if ($gateway_arn == "" or $gateway_url == "" or $target_id == "" or $policy_id == "")
   then error("AgentCore Gateway readback omitted required identifiers")
   else {$gateway_id, $gateway_arn, $gateway_url, $target_id, $policy_engine_id, $policy_id} end'
