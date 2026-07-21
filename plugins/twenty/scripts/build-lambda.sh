#!/usr/bin/env bash
# Build a self-contained AWS Lambda deployment zip for the LastMile → Twenty
# nightly sync. The bundle inlines every dependency (pg, bcryptjs, aws-sdk),
# so the target account needs no `npm install` — just upload the zip.
#
# Usage:  bash scripts/build-lambda.sh
# Output: plugins/twenty/dist/tei-lastmile-sync-lambda.zip  (handler: index.handler)
set -euo pipefail

cd "$(dirname "$0")/.." # -> plugins/twenty
OUT_DIR="dist/tei-lastmile-sync-lambda"
ZIP="dist/tei-lastmile-sync-lambda.zip"

rm -rf "$OUT_DIR" "$ZIP"
mkdir -p "$OUT_DIR"

# CJS + .js so Lambda's Node runtime resolves `index.handler` with no wrapper.
npx esbuild scripts/lambda-handler.ts \
  --bundle --platform=node --format=cjs --target=node20 \
  --outfile="$OUT_DIR/index.js"

# The repo's plugins/twenty/package.json is "type":"module", which would make
# Node treat the CJS index.js as ESM. Ship a CommonJS marker inside the zip so
# the handler loads correctly regardless of the deploy environment.
printf '{\n  "type": "commonjs"\n}\n' >"$OUT_DIR/package.json"

(cd "$OUT_DIR" && zip -q -r "../../$ZIP" index.js package.json)
echo "built $(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"
echo "  handler: index.handler   size: $(du -h "$ZIP" | cut -f1)"
