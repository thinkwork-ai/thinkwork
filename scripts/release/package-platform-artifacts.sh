#!/usr/bin/env bash
# Bundle machine-consumed release payloads into one GitHub Release asset.
#
# Usage:
#   bash scripts/release/package-platform-artifacts.sh [release-dir]

set -Eeuo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: package-platform-artifacts.sh [release-dir]" >&2
  exit 64
fi

RELEASE_DIR="${1:-dist/release}"
BUNDLE_PATH="$RELEASE_DIR/platform-artifacts.tar.gz"

if [[ ! -d "$RELEASE_DIR/lambdas" ]]; then
  echo "Lambda artifact directory is missing: $RELEASE_DIR/lambdas" >&2
  exit 66
fi
if [[ ! -d "$RELEASE_DIR/static" ]]; then
  echo "Static artifact directory is missing: $RELEASE_DIR/static" >&2
  exit 66
fi
if [[ ! -f "$RELEASE_DIR/runner/thinkwork-runner.py" ]]; then
  echo "Deployment runner script is missing: $RELEASE_DIR/runner/thinkwork-runner.py" >&2
  exit 66
fi

if ! compgen -G "$RELEASE_DIR/lambdas/*.zip" >/dev/null; then
  echo "No Lambda zip artifacts found under $RELEASE_DIR/lambdas" >&2
  exit 66
fi
if ! compgen -G "$RELEASE_DIR/static/*.tar.gz" >/dev/null; then
  echo "No static site artifacts found under $RELEASE_DIR/static" >&2
  exit 66
fi

rm -f "$BUNDLE_PATH"
tar -C "$RELEASE_DIR" -czf "$BUNDLE_PATH" lambdas static runner
echo "Wrote platform release artifact bundle: $BUNDLE_PATH"
