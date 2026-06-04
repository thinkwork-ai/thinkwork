#!/usr/bin/env bash
# Update a Bedrock AgentCore Runtime to a specific container image and wait for
# the DEFAULT endpoint to serve the new runtime version.

set -euo pipefail

STAGE=""
REGION="${AWS_REGION:-us-east-1}"
RUNTIME=""
IMAGE=""
ACCOUNT_ID=""
WAIT_SECONDS=900

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/update-agentcore-runtime-image.sh \
    --stage dev \
    --region us-east-1 \
    --runtime pi \
    --image <ecr-image-uri> \
    [--account-id <aws-account-id>] \
    [--wait-seconds 900]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage|-s) STAGE="${2:?}"; shift 2 ;;
    --region) REGION="${2:?}"; shift 2 ;;
    --runtime) RUNTIME="${2:?}"; shift 2 ;;
    --image) IMAGE="${2:?}"; shift 2 ;;
    --account-id) ACCOUNT_ID="${2:?}"; shift 2 ;;
    --wait-seconds) WAIT_SECONDS="${2:?}"; shift 2 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$STAGE" || -z "$RUNTIME" || -z "$IMAGE" ]]; then
  echo "ERROR: --stage, --runtime, and --image are required" >&2
  exit 2
fi

case "$RUNTIME" in
  pi) ;;
  strands)
    echo "ERROR: legacy Strands runtime is retired; use --runtime pi" >&2
    exit 2
    ;;
  *)
    echo "ERROR: --runtime must be 'pi' (got '$RUNTIME')" >&2
    exit 2
    ;;
esac

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found on PATH" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found on PATH" >&2
  exit 2
fi

runtime_name="thinkwork_${STAGE}_${RUNTIME}"
ssm_name="/thinkwork/${STAGE}/agentcore/runtime-id-${RUNTIME}"

# Canonical IAM role per runtime type — used on both create and update paths
# so an existing runtime created against an earlier role naming reconciles to
# the canonical role on every deploy. Pi's role split out of the legacy shared
# `agentcore-role` in plan §005 U2; reading the role from `get-agent-runtime`
# (the prior pattern) preserved the stale role indefinitely.
canonical_role_name="thinkwork-${STAGE}-agentcore-pi-role"
if [[ -n "$ACCOUNT_ID" ]]; then
  canonical_role_arn="arn:aws:iam::${ACCOUNT_ID}:role/${canonical_role_name}"
else
  canonical_role_arn=""
fi

is_agentcore_forbidden() {
  grep -Eq 'ForbiddenException|(^|[^[:alnum:]_])Forbidden([^[:alnum:]_]|$)' <<<"$1"
}

runtime_id=$(aws ssm get-parameter \
  --name "$ssm_name" \
  --region "$REGION" \
  --query Parameter.Value --output text 2>/dev/null || echo "")

if [[ -z "$runtime_id" || "$runtime_id" == "None" ]]; then
  runtime_id=$(aws bedrock-agentcore-control list-agent-runtimes \
    --region "$REGION" \
    --query "agentRuntimes[?agentRuntimeName=='${runtime_name}'].agentRuntimeId | [0]" \
    --output text 2>/dev/null || echo "")
fi

create_runtime() {
  if [[ -z "$canonical_role_arn" ]]; then
    echo "ERROR: --account-id is required to create the Pi AgentCore runtime" >&2
    exit 2
  fi

  echo "Creating ${RUNTIME} AgentCore runtime ${runtime_name} with ${IMAGE}"
  runtime_id=$(aws bedrock-agentcore-control create-agent-runtime \
    --region "$REGION" \
    --agent-runtime-name "$runtime_name" \
    --agent-runtime-artifact "containerConfiguration={containerUri=$IMAGE}" \
    --role-arn "$canonical_role_arn" \
    --network-configuration "networkMode=PUBLIC" \
    --protocol-configuration "serverProtocol=HTTP" \
    --query agentRuntimeId \
    --output text)
  aws ssm put-parameter \
    --name "$ssm_name" \
    --value "$runtime_id" \
    --type String \
    --overwrite \
    --region "$REGION" >/dev/null
}

update_runtime() {
  local current network_mode server_protocol role_arn
  network_mode="PUBLIC"
  server_protocol="HTTP"

  # Force the canonical role for this runtime type. If --account-id wasn't
  # passed, fall back to whatever role the runtime already has — preserves
  # the prior behavior for callers that don't know the account ID up front
  # (e.g. ad-hoc operator invocations).
  if [[ -n "$canonical_role_arn" ]]; then
    role_arn="$canonical_role_arn"
  else
    current=$(aws bedrock-agentcore-control get-agent-runtime \
      --region "$REGION" \
      --agent-runtime-id "$runtime_id" \
      --output json)
    role_arn=$(echo "$current" | jq -r '.roleArn // empty')
    if [[ -z "$role_arn" ]]; then
      echo "ERROR: existing runtime ${runtime_id} did not report roleArn and --account-id was not provided" >&2
      exit 2
    fi
    network_mode=$(echo "$current" | jq -r '.networkConfiguration.networkMode // "PUBLIC"')
    server_protocol=$(echo "$current" | jq -r '.protocolConfiguration.serverProtocol // "HTTP"')
  fi

  echo "Updating ${RUNTIME} AgentCore runtime ${runtime_id} to ${IMAGE} with role ${role_arn}"
  local update_output
  update_output=$(aws bedrock-agentcore-control update-agent-runtime \
    --region "$REGION" \
    --agent-runtime-id "$runtime_id" \
    --role-arn "$role_arn" \
    --network-configuration "networkMode=$network_mode" \
    --protocol-configuration "serverProtocol=$server_protocol" \
    --agent-runtime-artifact "containerConfiguration={containerUri=$IMAGE}" \
    --query '{version:agentRuntimeVersion,status:status,image:agentRuntimeArtifact.containerConfiguration.containerUri}' \
    --output json 2>&1) || {
    if is_agentcore_forbidden "$update_output"; then
      echo "WARN: update-agent-runtime ${runtime_id} returned Forbidden; skipping AgentCore runtime image update." >&2
      return 0
    fi
    echo "ERROR: update-agent-runtime ${runtime_id} failed:" >&2
    echo "$update_output" >&2
    exit 2
  }
  echo "$update_output"
}

if [[ -z "$runtime_id" || "$runtime_id" == "None" ]]; then
  create_runtime
else
  update_runtime
fi

deadline=$((SECONDS + WAIT_SECONDS))
while true; do
  detail=$(aws bedrock-agentcore-control get-agent-runtime \
    --region "$REGION" \
    --agent-runtime-id "$runtime_id" \
    --output json 2>&1) || {
    if is_agentcore_forbidden "$detail"; then
      echo "WARN: get-agent-runtime ${runtime_id} returned Forbidden after update; skipping AgentCore readiness wait." >&2
      exit 0
    fi
    echo "ERROR: get-agent-runtime ${runtime_id} failed:" >&2
    echo "$detail" >&2
    exit 2
  }
  status=$(echo "$detail" | jq -r '.status // "UNKNOWN"')
  version=$(echo "$detail" | jq -r '.agentRuntimeVersion // "null"')
  current_image=$(echo "$detail" | jq -r '.agentRuntimeArtifact.containerConfiguration.containerUri // ""')

  endpoints=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --region "$REGION" \
    --agent-runtime-id "$runtime_id" \
    --output json 2>&1) || {
    if is_agentcore_forbidden "$endpoints"; then
      echo "WARN: list-agent-runtime-endpoints ${runtime_id} returned Forbidden after update; skipping AgentCore readiness wait." >&2
      exit 0
    fi
    echo "ERROR: list-agent-runtime-endpoints ${runtime_id} failed:" >&2
    echo "$endpoints" >&2
    exit 2
  }
  default_endpoint=$(echo "$endpoints" | jq -r '[.runtimeEndpoints[] | select(.name=="DEFAULT")][0] // null')

  if [[ "$default_endpoint" != "null" ]]; then
    endpoint_status=$(echo "$default_endpoint" | jq -r '.status // "UNKNOWN"')
    live_version=$(echo "$default_endpoint" | jq -r '.liveVersion // "null"')
    target_version=$(echo "$default_endpoint" | jq -r '.targetVersion // "null"')
  else
    endpoint_status="MISSING"
    live_version="null"
    target_version="null"
  fi

  if [[ "$status" == "READY" \
    && "$endpoint_status" == "READY" \
    && ( "$target_version" == "null" || "$target_version" == "None" ) \
    && "$live_version" == "$version" \
    && "$current_image" == "$IMAGE" ]]; then
    echo "${RUNTIME} AgentCore runtime ready: ${runtime_id} v${version} ${current_image}"
    break
  fi

  if (( SECONDS >= deadline )); then
    echo "ERROR: timed out waiting for ${RUNTIME} AgentCore runtime ${runtime_id}" >&2
    echo "  runtime status=${status} version=${version}" >&2
    echo "  endpoint status=${endpoint_status} live=${live_version} target=${target_version}" >&2
    echo "  image=${current_image}" >&2
    echo "  wanted=${IMAGE}" >&2
    exit 1
  fi

  echo "Waiting for ${RUNTIME} runtime ${runtime_id}: runtime=${status} endpoint=${endpoint_status} live=${live_version} target=${target_version} image=${current_image}"
  sleep 15
done
