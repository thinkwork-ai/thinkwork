#!/usr/bin/env bash
# Regenerate packages/lambda/rds-ca-bundle.ts from the AWS RDS global trust
# store (THINK-229 U1). Run when AWS rotates/extends the RDS CA bundle.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/packages/lambda/rds-ca-bundle.ts"
BUNDLE_URL="https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -sf "$BUNDLE_URL" -o "$tmp"

# Template-literal safety: the PEM alphabet (base64 + headers) never contains
# backticks or backslashes, but assert it anyway before embedding.
if grep -q '[`\\]' "$tmp"; then
  echo "bundle contains template-literal metacharacters — refusing to embed" >&2
  exit 1
fi

{
  echo '/**'
  echo " * AWS RDS global CA trust bundle ($BUNDLE_URL)."
  echo ' *'
  echo ' * Embedded as a TS constant so the esbuild single-file Lambda bundle'
  echo ' * carries it without a filesystem asset copy (THINK-229 U1 / R3: the'
  echo ' * broker connects to Aurora with rejectUnauthorized: true against this'
  echo ' * bundle instead of sslmode=no-verify). Public certificate material —'
  echo ' * safe to commit. Refresh: curl the URL above and regenerate this file'
  echo ' * (see scripts/update-rds-ca-bundle.sh).'
  echo ' */'
  echo ''
  echo 'export const RDS_CA_BUNDLE = `'
  cat "$tmp"
  echo '`;'
} > "$OUT"

echo "wrote $OUT ($(grep -c 'BEGIN CERTIFICATE' "$OUT") certificates)"
