#!/usr/bin/env bash
# Upload the deployable ThinkWork release assets to an existing GitHub Release.
#
# Usage:
#   bash scripts/release/publish-release-assets.sh <tag> [release-dir]

set -Eeuo pipefail

on_error() {
  local exit_code=$?
  echo "publish-release-assets failed at line ${BASH_LINENO[0]} with exit code ${exit_code}" >&2
  exit "$exit_code"
}
trap on_error ERR

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: publish-release-assets.sh <tag> [release-dir]" >&2
  exit 64
fi

TAG="$1"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RELEASE_DIR="${2:-$REPO_ROOT/dist/release}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to publish release assets" >&2
  exit 69
fi

MANIFEST="$RELEASE_DIR/thinkwork-release.json"
if [[ ! -f "$MANIFEST" ]]; then
  echo "Release manifest is missing: $MANIFEST" >&2
  exit 66
fi

delete_release_asset_if_present() {
  local asset_name="$1"
  gh release delete-asset "$TAG" "$asset_name" --yes >/dev/null 2>&1 || true
}

ASSETS=()
SIGNATURE="$RELEASE_DIR/thinkwork-release.sig.json"
if [[ -f "$SIGNATURE" ]]; then
  ASSETS+=("$SIGNATURE")
fi

PLATFORM_BUNDLE="$RELEASE_DIR/platform-artifacts.tar.gz"
if [[ -f "$PLATFORM_BUNDLE" ]]; then
  ASSETS+=("$PLATFORM_BUNDLE")
else
  if compgen -G "$RELEASE_DIR/lambdas/*.zip" >/dev/null; then
    while IFS= read -r asset; do
      ASSETS+=("$asset")
    done < <(find "$RELEASE_DIR/lambdas" -maxdepth 1 -type f -name '*.zip' | LC_ALL=C sort)
  fi

  if compgen -G "$RELEASE_DIR/static/*.tar.gz" >/dev/null; then
    while IFS= read -r asset; do
      ASSETS+=("$asset")
    done < <(find "$RELEASE_DIR/static" -maxdepth 1 -type f -name '*.tar.gz' | LC_ALL=C sort)
  fi
fi

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  echo "No deployable assets found under $RELEASE_DIR" >&2
  exit 66
fi

echo "Removing stale release manifest assets from ${TAG}"
delete_release_asset_if_present "thinkwork-release.json"
delete_release_asset_if_present "thinkwork-release.sig.json"
delete_release_asset_if_present "thinkwork-release.json.sig"

echo "Uploading ${#ASSETS[@]} non-manifest release assets to ${TAG}"
gh release upload "$TAG" "${ASSETS[@]}" --clobber

echo "Uploading finalized release manifest to ${TAG}"
gh release upload "$TAG" "$MANIFEST" --clobber
