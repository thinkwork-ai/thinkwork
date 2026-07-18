#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${GATEWAY_NAME:?GATEWAY_NAME is required}"
: "${TARGET_NAME:?TARGET_NAME is required}"
: "${POLICY_ENGINE_NAME:?POLICY_ENGINE_NAME is required}"
: "${POLICY_NAME:?POLICY_NAME is required}"

delete_error_file="$(mktemp)"
trap 'rm -f "$delete_error_file"' EXIT

is_not_found() {
  grep -Eqi 'ResourceNotFoundException|not[ -]?found|does not exist' "$delete_error_file"
}

delete_or_absent() {
  : >"$delete_error_file"
  if "$@" >/dev/null 2>"$delete_error_file"; then
    return 0
  fi
  if is_not_found; then
    return 0
  fi
  printf 'AgentCore delete failed: %s\n' "$(<"$delete_error_file")" >&2
  return 1
}

wait_absent() {
  local label="$1"
  shift
  for _ in $(seq 1 90); do
    : >"$delete_error_file"
    if "$@" >/dev/null 2>"$delete_error_file"; then
      sleep 2
      continue
    fi
    if is_not_found; then
      return 0
    fi
    sleep 2
  done
  : >"$delete_error_file"
  if "$@" >/dev/null 2>"$delete_error_file"; then
    printf 'Timed out waiting for %s deletion.\n' "$label" >&2
    return 1
  fi
  if is_not_found; then
    return 0
  fi
  printf 'Unable to verify %s deletion: %s\n' "$label" "$(<"$delete_error_file")" >&2
  return 1
}

gateway_json="$(aws bedrock-agentcore-control list-gateways --region "$AWS_REGION" --output json)"
gateway_id="$(jq -r --arg name "$GATEWAY_NAME" 'first((.items // .gateways // [])[] | select(.name == $name) | .gatewayId) // empty' <<<"$gateway_json")"
engine_json="$(aws bedrock-agentcore-control list-policy-engines --region "$AWS_REGION" --output json)"
engine_id="$(jq -r --arg name "$POLICY_ENGINE_NAME" 'first((.policyEngines // .items // [])[] | select(.name == $name) | .policyEngineId) // empty' <<<"$engine_json")"

if [[ -n "$engine_id" ]]; then
  policy_json="$(aws bedrock-agentcore-control list-policies --region "$AWS_REGION" --policy-engine-id "$engine_id" --output json)"
  policy_id="$(jq -r --arg name "$POLICY_NAME" 'first((.policies // .items // [])[] | select(.name == $name) | .policyId) // empty' <<<"$policy_json")"
  if [[ -n "$policy_id" ]]; then
    delete_or_absent aws bedrock-agentcore-control delete-policy --region "$AWS_REGION" \
      --policy-engine-id "$engine_id" --policy-id "$policy_id"
    wait_absent "policy $policy_id" aws bedrock-agentcore-control get-policy --region "$AWS_REGION" \
      --policy-engine-id "$engine_id" --policy-id "$policy_id"
  fi
fi

if [[ -n "$gateway_id" ]]; then
  target_json="$(aws bedrock-agentcore-control list-gateway-targets --region "$AWS_REGION" --gateway-identifier "$gateway_id" --output json)"
  target_id="$(jq -r --arg name "$TARGET_NAME" 'first((.items // .targets // [])[] | select(.name == $name) | .targetId) // empty' <<<"$target_json")"
  if [[ -n "$target_id" ]]; then
    delete_or_absent aws bedrock-agentcore-control delete-gateway-target --region "$AWS_REGION" \
      --gateway-identifier "$gateway_id" --target-id "$target_id"
    wait_absent "gateway target $target_id" aws bedrock-agentcore-control get-gateway-target --region "$AWS_REGION" \
      --gateway-identifier "$gateway_id" --target-id "$target_id"
  fi
  delete_or_absent aws bedrock-agentcore-control delete-gateway --region "$AWS_REGION" \
    --gateway-identifier "$gateway_id"
  wait_absent "gateway $gateway_id" aws bedrock-agentcore-control get-gateway --region "$AWS_REGION" \
    --gateway-identifier "$gateway_id"
fi

if [[ -n "$engine_id" ]]; then
  delete_or_absent aws bedrock-agentcore-control delete-policy-engine --region "$AWS_REGION" \
    --policy-engine-id "$engine_id"
  wait_absent "policy engine $engine_id" aws bedrock-agentcore-control get-policy-engine --region "$AWS_REGION" \
    --policy-engine-id "$engine_id"
fi

printf 'AgentCore Gateway proof resources deleted or absent.\n'
