#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: package-agentcore-control-runtime.sh [output-dir]" >&2
  exit 64
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="${1:-$repo_root/dist/release/runner}"
runtime_dir="$output_dir/agentcore-control-runtime"
manifest="$output_dir/agentcore-control-runtime.json"

if [[ "$runtime_dir" != "$output_dir/agentcore-control-runtime" ]]; then
  echo "Refusing to clear unexpected AgentCore runtime path: $runtime_dir" >&2
  exit 64
fi
rm -rf "$runtime_dir"
mkdir -p "$runtime_dir"
pnpm exec esbuild \
  "$repo_root/packages/agentcore-control-runtime/preflight.mjs" \
  "$repo_root/terraform/modules/app/agentcore-identity/scripts/reconcile_twenty_provider.mjs" \
  "$repo_root/terraform/modules/app/agentcore-pi/scripts/reconcile_pi_runtime.mjs" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --banner:js='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' \
  --splitting \
  --entry-names=[name] \
  --chunk-names=chunks/[name]-[hash] \
  --outdir="$runtime_dir"

# The bundled entrypoints use ESM syntax but intentionally retain a .js suffix
# because Terraform wrappers refer to stable filenames. Ship an explicit module
# boundary with the runtime so CodeBuild never falls back to CommonJS parsing.
printf '%s\n' '{"type":"module"}' >"$runtime_dir/package.json"

preflight="$(node "$runtime_dir/preflight.js")"
if ! jq -e '
  .package == "@aws-sdk/client-bedrock-agentcore-control" and
  .version == "3.1089.0" and
  (.requiredExports | length) == 4
' <<<"$preflight" >/dev/null; then
  echo "Bundled AgentCore control runtime failed its exact-version preflight" >&2
  exit 1
fi

files='[]'
while IFS= read -r file; do
  relative="${file#"$runtime_dir"/}"
  sha256="$(shasum -a 256 "$file" | awk '{print $1}')"
  files="$(jq -c \
    --arg path "$relative" \
    --arg sha256 "$sha256" \
    '. + [{path: $path, sha256: $sha256}]' <<<"$files")"
done < <(find "$runtime_dir" -type f | LC_ALL=C sort)

entrypoints="$(find "$runtime_dir" -maxdepth 1 -type f -name '*.js' -exec basename {} \; | LC_ALL=C sort)"
if [[ "$entrypoints" != $'preflight.js\nreconcile_pi_runtime.js\nreconcile_twenty_provider.js' ]]; then
  echo "Bundled AgentCore control runtime has an unexpected entrypoint set:" >&2
  printf '%s\n' "$entrypoints" >&2
  exit 1
fi

if [[ "$(jq -cS . "$runtime_dir/package.json")" != '{"type":"module"}' ]]; then
  echo "Bundled AgentCore control runtime has an invalid ESM module boundary" >&2
  exit 1
fi

generated_file_count="$(find "$runtime_dir" -type f | wc -l | tr -d ' ')"
manifest_file_count="$(jq 'length' <<<"$files")"
if [[ "$generated_file_count" != "$manifest_file_count" ]]; then
  echo "AgentCore runtime manifest does not account for every generated file" >&2
  exit 1
fi

jq -n \
  --arg directory "agentcore-control-runtime" \
  --argjson preflight "$preflight" \
  --argjson files "$files" \
  '{
    schemaVersion: 1,
    directory: $directory,
    sdk: $preflight,
    files: $files
  }' >"$manifest"

echo "Packaged AgentCore control runtime -> $runtime_dir"
