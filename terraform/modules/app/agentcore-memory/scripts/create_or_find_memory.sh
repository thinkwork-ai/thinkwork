#!/usr/bin/env bash
################################################################################
# create_or_find_memory.sh
#
# Idempotent create-or-find for a Bedrock AgentCore Memory resource.
#
# Input (stdin, JSON): {"name": "<logical name>", "region": "<aws-region>"}
# Output (stdout, JSON): {"memory_id": "<resource-id>"}
#
# Behavior:
#   1. Lists existing memories via `aws bedrock-agentcore-control list-memories`
#   2. If a memory with the exact logical name already exists, returns its ID
#   3. Otherwise creates a new memory with the four strategies that the
#      thinkwork agent container expects (semantic, preferences, summaries,
#      episodes — namespace templates match memory.py:STRATEGY_NAMESPACES)
#
# Called from terraform/modules/app/agentcore-memory/main.tf via
# `data "external"`. Keep stdout strictly JSON — any stray echo will break
# Terraform's JSON parser.
################################################################################

set -euo pipefail

# Read JSON input from stdin. `jq -r '.missing'` returns the literal
# string "null" for absent keys, so treat that as empty.
input="$(cat)"
name="$(echo "$input" | jq -r '.name // empty')"
region="$(echo "$input" | jq -r '.region // empty')"

if [[ -z "$name" || -z "$region" ]]; then
  echo '{"error": "name and region are required"}' >&2
  exit 1
fi

# Step 1: list existing memories and look for one with matching name.
# AgentCore Memory uses a `name` field on the resource. The list API returns
# a page of summaries; we filter client-side for the exact name match.
existing_id="$(
  aws bedrock-agentcore-control list-memories \
    --region "$region" \
    --output json 2>/dev/null \
    | jq -r --arg n "$name" '.memories[]? | select(.name == $n) | .id' \
    | head -n1 || true
)"

if [[ -n "$existing_id" && "$existing_id" != "null" ]]; then
  jq -nc --arg id "$existing_id" '{memory_id: $id}'
  exit 0
fi

# Step 2: no existing memory — create one with the four strategies.
# Namespace templates must match memory.py:STRATEGY_NAMESPACES exactly so
# the agent container's recall() finds records written by the strategies.
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
    "customMemoryStrategy": {
      "name": "episodes",
      "description": "Episodic memory — stores experience-based memories per actor and session",
      "namespaces": ["episodes_{actorId}/{sessionId}"]
    }
  }
]'

create_output="$(
  aws bedrock-agentcore-control create-memory \
    --region "$region" \
    --name "$name" \
    --memory-strategies "$strategies_json" \
    --event-expiry-duration 365 \
    --output json
)"

new_id="$(echo "$create_output" | jq -r '.memory.id // .id')"

if [[ -z "$new_id" || "$new_id" == "null" ]]; then
  echo '{"error": "create-memory returned no id"}' >&2
  echo "create-memory output was: $create_output" >&2
  exit 1
fi

jq -nc --arg id "$new_id" '{memory_id: $id}'
