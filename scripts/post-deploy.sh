#!/usr/bin/env bash
# Post-deploy probe for AgentCore runtimes.
#
# Background: after `terraform apply`, AgentCore cycles its warm container
# pool over the next 15 minutes as old-env containers idle out. During that
# window, a chat turn can land on a container booted before Terraform injected
# the new env vars — the canonical symptom is a skill_runs strand logging
# "missing THINKWORK_API_URL" (see memory: project_agentcore_deploy_race_env).
#
# AgentCore does not expose a "flush warm pool" API for DEFAULT endpoints:
# `UpdateAgentRuntimeEndpoint` rejects DEFAULT endpoints with "managed through
# agent updates." So this script does the next-best thing: verify that every
# Strands runtime reports a clean end-state after Terraform apply, and surface
# drift (runtime not READY, endpoint liveVersion behind runtime version) as
# warnings so an operator knows to wait or investigate.
#
# The 15-minute reconciler inside AgentCore is the real backstop; this probe
# is an early-warning channel, not a mitigation.
#
# Usage:
#   bash scripts/post-deploy.sh --stage <name>          # warn-only (default)
#   bash scripts/post-deploy.sh --stage dev --strict    # exit 1 on drift
#   bash scripts/post-deploy.sh --stage dev --region us-east-1 --json
#   bash scripts/post-deploy.sh --stage dev --runtime flue --min-source-sha <commit>

set -euo pipefail

STAGE=""
STRICT=0
JSON=0
REGION="${AWS_REGION:-us-east-1}"
MIN_SOURCE_SHA=""
RUNTIME="strands"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage|-s) STAGE="${2:?}"; shift 2 ;;
    --strict)   STRICT=1; shift ;;
    --json)     JSON=1; shift ;;
    --region)   REGION="${2:?}"; shift 2 ;;
    --runtime)  RUNTIME="${2:?}"; shift 2 ;;
    --min-source-sha) MIN_SOURCE_SHA="${2:?}"; shift 2 ;;
    --help|-h)
      sed -n '3,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$STAGE" ]]; then
  echo "ERROR: --stage <name> is required" >&2
  exit 2
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found on PATH" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found on PATH" >&2
  exit 2
fi

# Match any runtime whose name begins with `thinkwork_<stage>_<runtime>`. The
# Terraform module creates one per deployment and the name format has been
# stable since the maniflow→thinkwork rename.
case "$RUNTIME" in
  strands|flue) ;;
  *)
    echo "ERROR: --runtime must be 'strands' or 'flue' (got '$RUNTIME')" >&2
    exit 2
    ;;
esac
NAME_PREFIX="thinkwork_${STAGE}_${RUNTIME}"

log() {
  if [[ "$JSON" -eq 0 ]]; then
    echo "$@"
  fi
}

image_sha_from_uri() {
  local image_uri="$1"
  local tag="${image_uri##*:}"
  if [[ "$tag" =~ ([0-9a-f]{40}) ]]; then
    echo "${BASH_REMATCH[1]}"
  fi
}

image_contains_source_sha() {
  local image_sha="$1"
  local source_sha="$2"
  [[ -z "$source_sha" ]] && return 0
  [[ -z "$image_sha" ]] && return 1
  git cat-file -e "${image_sha}^{commit}" 2>/dev/null || return 1
  git cat-file -e "${source_sha}^{commit}" 2>/dev/null || return 1
  git merge-base --is-ancestor "$source_sha" "$image_sha"
}

log "[post-deploy] stage=$STAGE region=$REGION runtime=$RUNTIME matching runtimes: ${NAME_PREFIX}*"

runtimes_json=$(aws bedrock-agentcore-control list-agent-runtimes \
  --region "$REGION" --output json 2>&1) || {
  echo "ERROR: list-agent-runtimes failed:" >&2
  echo "$runtimes_json" >&2
  exit 2
}

ACTIVE_RUNTIME_ID=$(aws ssm get-parameter \
  --name "/thinkwork/${STAGE}/agentcore/runtime-id-${RUNTIME}" \
  --region "$REGION" \
  --query Parameter.Value --output text 2>/dev/null || true)

# Filter to our stage + runtime prefix, plus the active SSM runtime when a
# legacy/manual name does not follow the current prefix convention.
matched=$(echo "$runtimes_json" \
  | jq --arg p "$NAME_PREFIX" --arg active "$ACTIVE_RUNTIME_ID" \
       '[.agentRuntimes[] | select((.agentRuntimeName | startswith($p)) or (.agentRuntimeId == $active))]')

count=$(echo "$matched" | jq 'length')
if [[ "$count" -eq 0 ]]; then
  echo "WARN: no AgentCore runtimes match ${NAME_PREFIX}* — nothing to probe" >&2
  [[ "$JSON" -eq 1 ]] && echo '{"stage":"'"$STAGE"'","runtimes":[],"drift":0}'
  [[ "$STRICT" -eq 1 ]] && exit 1
  exit 0
fi

drift=0
results=()

while read -r rt_id rt_name rt_status; do
  # Each runtime's top-level status + current version
  rt_detail=$(aws bedrock-agentcore-control get-agent-runtime \
    --agent-runtime-id "$rt_id" --region "$REGION" --output json 2>&1) || {
    echo "ERROR: get-agent-runtime $rt_id failed:" >&2
    echo "$rt_detail" >&2
    drift=$((drift + 1))
    continue
  }

  rt_version=$(echo "$rt_detail" | jq -r '.agentRuntimeVersion // "null"')
  rt_image=$(echo "$rt_detail" | jq -r '.agentRuntimeArtifact.containerConfiguration.containerUri // ""')
  rt_image_sha=$(image_sha_from_uri "$rt_image")

  # DEFAULT endpoint is the one Terraform manages for us
  eps=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --agent-runtime-id "$rt_id" --region "$REGION" --output json 2>&1) || {
    echo "ERROR: list-agent-runtime-endpoints $rt_id failed:" >&2
    echo "$eps" >&2
    drift=$((drift + 1))
    continue
  }

  ep_row=$(echo "$eps" | jq -r '[.runtimeEndpoints[] | select(.name=="DEFAULT")][0] // null')
  if [[ "$ep_row" == "null" ]]; then
    echo "WARN: runtime $rt_name has no DEFAULT endpoint" >&2
    drift=$((drift + 1))
    continue
  fi

  ep_status=$(echo "$ep_row" | jq -r '.status // "UNKNOWN"')
  ep_live=$(echo "$ep_row" | jq -r '.liveVersion // "null"')
  ep_target=$(echo "$ep_row" | jq -r '.targetVersion // "null"')

  # Expected end-state after a clean deploy:
  #   runtime.status = READY
  #   endpoint.status = READY
  #   endpoint.targetVersion is null (no pending update)
  #   endpoint.liveVersion == runtime.agentRuntimeVersion
  is_clean=1
  reasons=()
  if [[ "$rt_status" != "READY" ]]; then
    is_clean=0
    reasons+=("runtime status=$rt_status (want READY)")
  fi
  if [[ "$ep_status" != "READY" ]]; then
    is_clean=0
    reasons+=("endpoint status=$ep_status (want READY)")
  fi
  if [[ "$ep_target" != "null" && "$ep_target" != "None" ]]; then
    is_clean=0
    reasons+=("endpoint targetVersion=$ep_target is set — deploy still settling")
  fi
  if [[ "$ep_live" != "$rt_version" ]]; then
    is_clean=0
    reasons+=("endpoint liveVersion=$ep_live != runtime version=$rt_version")
  fi
  if [[ -n "$MIN_SOURCE_SHA" && ( -z "$ACTIVE_RUNTIME_ID" || "$rt_id" == "$ACTIVE_RUNTIME_ID" ) ]] && ! image_contains_source_sha "$rt_image_sha" "$MIN_SOURCE_SHA"; then
    is_clean=0
    reasons+=("runtime image sha=${rt_image_sha:-unknown} does not include required source sha=$MIN_SOURCE_SHA")
  fi

  if [[ "$is_clean" -eq 1 ]]; then
    log "  ok   $rt_name (v$rt_version, endpoint DEFAULT live=$ep_live, image=${rt_image_sha:-unknown})"
  else
    drift=$((drift + 1))
    reason_str=$(IFS='; '; echo "${reasons[*]}")
    log "  WARN $rt_name — $reason_str"
  fi

  results+=("$(jq -n \
    --arg id "$rt_id" --arg name "$rt_name" --arg status "$rt_status" \
    --arg version "$rt_version" --arg ep_status "$ep_status" \
    --arg ep_live "$ep_live" --arg ep_target "$ep_target" \
    --arg image "$rt_image" --arg image_sha "$rt_image_sha" \
    --arg min_source_sha "$MIN_SOURCE_SHA" \
    --argjson clean "$is_clean" \
    '{agentRuntimeId:$id, agentRuntimeName:$name, runtimeStatus:$status, version:$version, endpointStatus:$ep_status, endpointLiveVersion:$ep_live, endpointTargetVersion:$ep_target, image:$image, imageSourceSha:$image_sha, minSourceSha:$min_source_sha, clean:($clean == 1)}')")
done < <(echo "$matched" | jq -r '.[] | "\(.agentRuntimeId)\t\(.agentRuntimeName)\t\(.status)"')

if [[ "$JSON" -eq 1 ]]; then
  printf '{"stage":"%s","region":"%s","drift":%d,"runtimes":[%s]}\n' \
    "$STAGE" "$REGION" "$drift" "$(IFS=,; echo "${results[*]}")"
else
  if [[ "$drift" -eq 0 ]]; then
    log "[post-deploy] ok — $count runtime(s) READY, endpoints caught up"
  else
    log "[post-deploy] $drift runtime(s) show drift. The 15-minute AgentCore"
    log "              reconciler may clear version/endpoint drift. Source-image"
    log "              drift requires a fresh container build and UpdateAgentRuntime."
  fi
fi

if [[ "$STRICT" -eq 1 && "$drift" -gt 0 ]]; then
  exit 1
fi
exit 0
