#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_script="$script_dir/harness-lifecycle.mjs"
if [[ -n "${THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR:-}" ]]; then
  runtime_script="$THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR/harness-lifecycle.js"
  if [[ ! -f "$runtime_script" ]]; then
    echo "Managed AgentCore control runtime is missing harness-lifecycle.js" >&2
    exit 66
  fi
fi
exec node "$runtime_script" read
