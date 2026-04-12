#!/usr/bin/env bash
################################################################################
# create_or_find_memory.sh
#
# Idempotent create-or-find for a Bedrock AgentCore Memory resource, plus
# drift-correction for the strategy list on already-existing resources.
#
# Input (stdin, JSON):
#   {"name": "<logical name>", "region": "<aws-region>",
#    "execution_role_arn": "<optional>"}
# Output (stdout, JSON): {"memory_id": "<resource-id>"}
#
# Behavior:
#   1. Lists existing memories via `aws bedrock-agentcore-control list-memories`
#      and matches by exact `name` OR by ID starting with `name-` (the API
#      uses `{name}-{randomSuffix}` for the resource ID, and `name` sometimes
#      comes back null on existing resources).
#   2. If a match exists: get-memory, diff its current strategies against the
#      desired set, and call update-memory with addMemoryStrategies for any
#      that are missing. This lets us add new strategies to an existing
#      memory without destructive recreation.
#   3. If no match: create-memory with the full desired strategy list.
#
# Strategy set must match memory.py:STRATEGY_NAMESPACES exactly so the
# agent container's recall() finds records written by the extractors:
#   semantic     -> assistant_{actorId}
#   preferences  -> preferences_{actorId}
#   summaries    -> session_{sessionId}
#   episodes     -> episodes_{actorId}/{sessionId}   (built-in episodicMemoryStrategy)
#
# Called from terraform/modules/app/agentcore-memory/main.tf via
# `data "external"`. Keep stdout strictly JSON — any stray echo will break
# Terraform's JSON parser. All diagnostics go to stderr.
################################################################################

set -euo pipefail

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

input="$(cat)"
name="$(echo "$input" | jq -r '.name // empty')"
region="$(echo "$input" | jq -r '.region // empty')"
execution_role_arn="$(echo "$input" | jq -r '.execution_role_arn // empty')"

if [[ -z "$name" || -z "$region" ]]; then
  echo '{"error": "name and region are required"}' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Desired strategy set
#
# The full list passed to create-memory. Each entry is also a valid item
# for update-memory's addMemoryStrategies list, so we can reuse the same
# shape for drift correction. `episodes` uses the built-in
# `episodicMemoryStrategy` type (NOT customMemoryStrategy — that was the
# bug that silently dropped episodes on the first deploy).
#
# IMPORTANT: episodicMemoryStrategy REQUIRES a reflectionConfiguration whose
# namespace is a prefix of the episodic namespace. If omitted, the API
# synthesizes a default reflection namespace of
# `/strategies/{memoryStrategyId}/actors/{actorId}/` which is NOT a prefix
# of our flat `episodes_{actorId}/{sessionId}` template, and update-memory
# fails with ValidationException. We set it to `episodes_{actorId}/` which
# IS a prefix and gives cross-session reflection records a stable home.
# ---------------------------------------------------------------------------

strategies_json='[
  {
    "semanticMemoryStrategy": {
      "name": "semantic",
      "namespaces": ["assistant_{actorId}"]
    }
  },
  {
    "userPreferenceMemoryStrategy": {
      "name": "preferences",
      "namespaces": ["preferences_{actorId}"]
    }
  },
  {
    "summaryMemoryStrategy": {
      "name": "summaries",
      "namespaces": ["session_{sessionId}"]
    }
  },
  {
    "episodicMemoryStrategy": {
      "name": "episodes",
      "namespaces": ["episodes_{actorId}/{sessionId}"],
      "reflectionConfiguration": {
        "namespaces": ["episodes_{actorId}/"]
      }
    }
  }
]'

# Map logical strategy name -> the top-level key used in the create/update
# payload. Used to drift-correct existing memory resources by picking out
# the entries whose names don't yet exist.
desired_names=("semantic" "preferences" "summaries" "episodes")

# ---------------------------------------------------------------------------
# Step 1: look for an existing memory with this name
# ---------------------------------------------------------------------------

existing_id="$(
  aws bedrock-agentcore-control list-memories \
    --region "$region" \
    --output json 2>/dev/null \
    | jq -r --arg n "$name" '.memories[]? | select(.name == $n or (.id | startswith($n + "-"))) | .id' \
    | head -n1 || true
)"

if [[ -n "$existing_id" && "$existing_id" != "null" ]]; then
  # ---------------------------------------------------------------------------
  # Step 2a: memory exists — drift-correct its strategy list
  #
  # Fetch current strategies, compute the set of desired strategy names that
  # don't already exist, and call update-memory with addMemoryStrategies for
  # the missing ones. This is idempotent — if everything matches, we call
  # nothing and just return the existing ID.
  # ---------------------------------------------------------------------------
  current_names="$(
    aws bedrock-agentcore-control get-memory \
      --region "$region" \
      --memory-id "$existing_id" \
      --output json 2>/dev/null \
      | jq -r '.memory.strategies[]? | .name'
  )"

  missing=()
  for d in "${desired_names[@]}"; do
    if ! grep -qxF "$d" <<<"$current_names"; then
      missing+=("$d")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "[create_or_find_memory] existing memory $existing_id is missing strategies: ${missing[*]}" >&2

    # Build the addMemoryStrategies list from the entries in strategies_json
    # whose .name field matches a missing strategy.
    add_json="$(
      echo "$strategies_json" \
        | jq --argjson wanted "$(printf '%s\n' "${missing[@]}" | jq -R . | jq -s .)" '
            map(
              select(
                (.semanticMemoryStrategy.name // .userPreferenceMemoryStrategy.name //
                 .summaryMemoryStrategy.name // .episodicMemoryStrategy.name //
                 .customMemoryStrategy.name) as $n
                | $wanted | index($n)
              )
            )
          '
    )"

    update_payload="$(jq -nc --argjson add "$add_json" '{addMemoryStrategies: $add}')"

    # update-memory takes memory-strategies as a structured object with
    # add/modify/delete lists.
    if aws bedrock-agentcore-control update-memory \
        --region "$region" \
        --memory-id "$existing_id" \
        --memory-strategies "$update_payload" \
        --output json >/dev/null 2>&1; then
      echo "[create_or_find_memory] added missing strategies to $existing_id" >&2
    else
      # Capture the error for diagnostics but don't fail the whole apply —
      # retention on the existing strategies still works.
      err="$(aws bedrock-agentcore-control update-memory \
        --region "$region" \
        --memory-id "$existing_id" \
        --memory-strategies "$update_payload" 2>&1 || true)"
      echo "[create_or_find_memory] WARNING: update-memory failed: $err" >&2
    fi
  fi

  jq -nc --arg id "$existing_id" '{memory_id: $id}'
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2b: no existing memory — create one with the full strategy set
# ---------------------------------------------------------------------------

role_arg=""
if [[ -n "$execution_role_arn" ]]; then
  role_arg="--memory-execution-role-arn $execution_role_arn"
fi

create_output="$(
  aws bedrock-agentcore-control create-memory \
    --region "$region" \
    --name "$name" \
    --memory-strategies "$strategies_json" \
    --event-expiry-duration 365 \
    $role_arg \
    --output json
)"

new_id="$(echo "$create_output" | jq -r '.memory.id // .id')"

if [[ -z "$new_id" || "$new_id" == "null" ]]; then
  echo '{"error": "create-memory returned no id"}' >&2
  echo "create-memory output was: $create_output" >&2
  exit 1
fi

jq -nc --arg id "$new_id" '{memory_id: $id}'
