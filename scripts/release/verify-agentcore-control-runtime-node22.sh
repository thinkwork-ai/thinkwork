#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: verify-agentcore-control-runtime-node22.sh [runner-dir]" >&2
  exit 64
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runner_dir="${1:-$repo_root/dist/release/runner}"
runtime_dir="$runner_dir/agentcore-control-runtime"

node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if [[ "$node_major" != "22" ]]; then
  echo "AgentCore control runtime verification requires Node.js 22; found $node_version" >&2
  exit 1
fi

if [[ "$(jq -cS . "$runtime_dir/package.json")" != '{"type":"module"}' ]]; then
  echo "AgentCore control runtime is missing its ESM module boundary" >&2
  exit 1
fi

node "$runtime_dir/preflight.js" |
  jq -e '.package == "@aws-sdk/client-bedrock-agentcore-control" and .version == "3.1089.0"' \
    >/dev/null
node "$runtime_dir/reconcile_twenty_provider.js" --runtime-preflight |
  jq -e '.sdkImportReady == true' >/dev/null

echo "Verified AgentCore control runtime with $node_version"
