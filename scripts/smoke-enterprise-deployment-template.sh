#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thinkwork-enterprise-template.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "Rendering enterprise deployment repo into $TMP_DIR"
pnpm --filter thinkwork-cli exec tsx src/cli.ts enterprise bootstrap "$TMP_DIR" \
  --customer acme \
  --repo acme-corp/acme-thinkwork-deploy \
  --stage dev \
  --stage prod \
  --region us-east-1 \
  --account-id 111122223333 \
  --release-version v1.2.3 \
  --manifest-sha256 abc123 \
  --terraform-module-version 1.2.3 \
  --dry-run \
  > "$TMP_DIR/bootstrap-dry-run.log"

test -f "$TMP_DIR/thinkwork.lock"
test -f "$TMP_DIR/.github/workflows/deploy.yml"
test -f "$TMP_DIR/docs/runbook.md"
test -f "$TMP_DIR/customer/deployment.json"
test -f "$TMP_DIR/terraform/backend-dev.hcl"

node -e "
  const fs = require('fs');
  const lock = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  if (lock.thinkwork.release !== 'v1.2.3') throw new Error('release pin mismatch');
  if (lock.thinkwork.manifestSha256 !== 'abc123') throw new Error('manifest checksum mismatch');
" "$TMP_DIR/thinkwork.lock"

ruby -e "require 'yaml'; YAML.load_file(ARGV.fetch(0))" \
  "$TMP_DIR/.github/workflows/deploy.yml"

pnpm --filter thinkwork-cli exec tsx src/cli.ts --json enterprise overlay apply "$TMP_DIR" \
  --stage dev \
  --dry-run \
  > "$TMP_DIR/overlay-dry-run.json"

node -e "
  const fs = require('fs');
  const report = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  if (report.dryRun !== true) throw new Error('overlay dry-run did not report dryRun=true');
  if (report.plan.stage !== 'dev') throw new Error('overlay dry-run stage mismatch');
" "$TMP_DIR/overlay-dry-run.json"

grep -q "bootstrap -> workflow dispatch -> CI deploy -> overlay apply -> smoke summary" \
  "$TMP_DIR/docs/runbook.md"
grep -q "Never commit secrets" "$TMP_DIR/docs/runbook.md"

echo "Enterprise deployment template smoke passed."
