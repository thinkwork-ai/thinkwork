#!/usr/bin/env bash
################################################################################
# create_or_find_memory.sh
#
# Idempotent **ensure** for a Bedrock AgentCore Memory resource: guarantee
# that an ACTIVE memory with the desired strategy set exists, and return its
# live ID. Runs on every plan and every apply.
#
# Input (stdin, JSON):
#   {"name": "<logical name>", "region": "<aws-region>",
#    "execution_role_arn": "<optional>"}
# Output (stdout, JSON): {"memory_id": "<resource-id>"}
#
# Behavior:
#   1. Pages through `aws bedrock-agentcore-control list-memories` and
#      collects candidates matching by exact `name` OR by ID starting with
#      `name-` (the API uses `{name}-{randomSuffix}` for the resource ID,
#      and `name` sometimes comes back null on existing resources).
#   2. Probes each candidate with `get-memory`, which is the authoritative
#      answer. A candidate is usable only if get-memory succeeds AND its
#      status is ACTIVE (a CREATING memory is waited out). Candidates that
#      404, or that report DELETING / FAILED, are skipped.
#   3. Usable candidate: diff its current strategies against the desired set
#      and `update-memory` with addMemoryStrategies for any that are missing.
#      Adds new strategies without destructive recreation.
#   4. No usable candidate: `create-memory` with the full desired strategy
#      list, then wait for ACTIVE.
#
# **Self-healing (THINK-404).** The dev memory was deleted out from under
# Terraform while state still held its ID, so every runtime read 404'd until
# a human noticed. Steps 1-2 are what make that unrecoverable-by-hand state
# impossible: the ID is re-derived from a live probe on every plan, so a
# missing or dying memory is simply recreated on the next apply and the
# module output tracks the resource that actually exists. The probe never
# deletes anything — teardown remains the exclusive job of the destroy-time
# provisioner in main.tf, whose `triggers_replace` deliberately does NOT
# include the memory ID so healing can't cascade into a delete.
#
# Strategy set must match the namespaces read by
# `packages/api/src/lib/memory/adapters/agentcore-adapter.ts` and
# `packages/agentcore-pi/agent-container/src/tools/memory.ts` so recall
# finds records written by the extractors:
#   semantic     -> assistant_{actorId}
#   preferences  -> preferences_{actorId}
#   summaries    -> session_{sessionId}
#   episodes     -> episodes_{actorId}/{sessionId}   (built-in episodicMemoryStrategy)
#
# Called from terraform/modules/app/agentcore-memory/main.tf via
# `data "external"`. Keep stdout strictly JSON — any stray echo will break
# Terraform's JSON parser. All diagnostics go to stderr. Dependencies are
# bash, `aws`, and `jq` only, because this runs on the CI runner.
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
# Helpers
# ---------------------------------------------------------------------------

# Echo the memory's status, or nothing at all when get-memory fails (the
# resource is gone). get-memory — not the list output — is the authority:
# list-memories has been observed returning IDs that no longer resolve.
memory_status() {
  local id="$1" out
  # `|| true` twice, deliberately: under `set -e -o pipefail` a failing
  # get-memory (i.e. the memory is gone — the case this whole function
  # exists to detect) would otherwise abort the script through the command
  # substitution that calls it.
  out="$(aws bedrock-agentcore-control get-memory \
    --region "$region" \
    --memory-id "$id" \
    --output json 2>/dev/null || true)"
  jq -r '.memory.status // empty' <<<"$out" 2>/dev/null || true
  return 0
}

# Block until the memory reports ACTIVE. Returns non-zero if it never gets
# there (deleted mid-wait, stuck in FAILED, or the wait budget expires).
# ~5 minutes: creation is normally well under a minute.
wait_for_active() {
  local id="$1"
  local status
  for _ in $(seq 1 30); do
    status="$(memory_status "$id")"
    case "$status" in
      ACTIVE) return 0 ;;
      "" | FAILED | DELETING)
        echo "[create_or_find_memory] $id is ${status:-gone}; not usable" >&2
        return 1
        ;;
      *)
        echo "[create_or_find_memory] $id is $status; waiting for ACTIVE" >&2
        sleep 10
        ;;
    esac
  done
  echo "[create_or_find_memory] timed out waiting for $id to become ACTIVE" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Step 1: find a live memory with this name
#
# Paginated so a large account can't hide the existing resource behind a
# page boundary and trick us into creating a duplicate. Every candidate is
# probed with get-memory before it is trusted — that probe is what heals a
# memory that was deleted behind Terraform's back.
# ---------------------------------------------------------------------------

candidate_ids=()
next_token=""
list_err="$(mktemp)"
trap 'rm -f "$list_err"' EXIT
while :; do
  set +e
  if [[ -n "$next_token" ]]; then
    page="$(aws bedrock-agentcore-control list-memories \
      --region "$region" --max-results 100 --next-token "$next_token" \
      --output json 2>"$list_err")"
  else
    page="$(aws bedrock-agentcore-control list-memories \
      --region "$region" --max-results 100 \
      --output json 2>"$list_err")"
  fi
  list_status=$?
  set -e
  # Fail loudly rather than treating an API error as "no memories exist" —
  # that misreading would create a duplicate memory alongside the healthy
  # one and silently split the tenant's records across two resources.
  if [[ $list_status -ne 0 ]]; then
    echo '{"error": "list-memories failed"}' >&2
    cat "$list_err" >&2
    exit "$list_status"
  fi

  while IFS= read -r id; do
    [[ -n "$id" ]] && candidate_ids+=("$id")
  done < <(
    jq -r --arg n "$name" \
      '.memories[]? | select(.name == $n or ((.id // "") | startswith($n + "-"))) | .id' \
      <<<"$page"
  )

  next_token="$(jq -r '.nextToken // empty' <<<"$page")"
  [[ -z "$next_token" ]] && break
done

existing_id=""
for candidate in ${candidate_ids[@]+"${candidate_ids[@]}"}; do
  status="$(memory_status "$candidate")"
  case "$status" in
    ACTIVE)
      existing_id="$candidate"
      break
      ;;
    CREATING)
      if wait_for_active "$candidate"; then
        existing_id="$candidate"
        break
      fi
      ;;
    "")
      # Listed but unresolvable: the resource was deleted out from under us
      # (exactly the state THINK-404 found dev in). Fall through to create.
      echo "[create_or_find_memory] listed memory $candidate no longer exists; will recreate" >&2
      ;;
    *)
      echo "[create_or_find_memory] skipping $candidate in status $status" >&2
      ;;
  esac
done

if [[ -n "$existing_id" ]]; then
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
      | jq -r '.memory.strategies[]? | .name' || true
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

# CreateMemory validates the execution role's trust policy at call time. When
# Terraform created that role moments earlier in the same apply, IAM has not
# propagated yet and the API rejects it with ValidationException "Please
# provide a role with a valid trust policy" — empirically for ~20s after role
# creation (harness cycle-5 ledger entry). Retry that specific error with a
# bounded backoff; every other error fails immediately.
create_output=""
create_status=1
err_file="$(mktemp)"
trap 'rm -f "$err_file" "$list_err"' EXIT
for attempt in $(seq 1 12); do
  set +e
  create_output="$(
    aws bedrock-agentcore-control create-memory \
      --region "$region" \
      --name "$name" \
      --memory-strategies "$strategies_json" \
      --event-expiry-duration 365 \
      $role_arg \
      --output json 2>"$err_file"
  )"
  create_status=$?
  set -e
  if [[ $create_status -eq 0 ]]; then
    break
  fi
  if grep -qi "valid trust policy" "$err_file"; then
    echo "[create_or_find_memory] attempt $attempt: execution role not yet visible to AgentCore (IAM propagation); retrying in 15s" >&2
    sleep 15
    continue
  fi
  cat "$err_file" >&2
  exit "$create_status"
done

if [[ $create_status -ne 0 ]]; then
  echo "[create_or_find_memory] create-memory still failing after $attempt attempts:" >&2
  cat "$err_file" >&2
  exit "$create_status"
fi

new_id="$(echo "$create_output" | jq -r '.memory.id // .id')"

if [[ -z "$new_id" || "$new_id" == "null" ]]; then
  echo '{"error": "create-memory returned no id"}' >&2
  echo "create-memory output was: $create_output" >&2
  exit 1
fi

# Don't hand Terraform an ID the runtime can't use yet: a memory in CREATING
# rejects CreateEvent, and downstream SSM/runtime wiring is written in the
# same apply.
if ! wait_for_active "$new_id"; then
  echo '{"error": "created memory never became ACTIVE"}' >&2
  exit 1
fi

echo "[create_or_find_memory] created memory $new_id" >&2
jq -nc --arg id "$new_id" '{memory_id: $id}'
