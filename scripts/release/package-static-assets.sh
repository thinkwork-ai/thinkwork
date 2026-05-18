#!/usr/bin/env bash
# Package built static sites as release assets for customer deployment repos.
#
# Usage:
#   bash scripts/release/package-static-assets.sh [output-dir]
#
# Expected build outputs:
#   apps/admin/dist      -> admin.tar.gz
#   apps/computer/dist   -> computer.tar.gz
#   docs/dist            -> docs.tar.gz

set -Eeuo pipefail

on_error() {
  local exit_code=$?
  echo "package-static-assets failed at line ${BASH_LINENO[0]} with exit code ${exit_code}" >&2
  exit "$exit_code"
}
trap on_error ERR

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist/release/static}"

mkdir -p "$OUT_DIR"

package_site() {
  local name="$1"
  local source_dir="$2"
  local output_file="$OUT_DIR/${name}.tar.gz"

  if [[ ! -d "$source_dir" ]]; then
    echo "Required static build output for ${name} is missing: ${source_dir}" >&2
    exit 66
  fi

  rm -f "$output_file"
  if tar --version 2>/dev/null | grep -qi "gnu tar"; then
    tar \
      --sort=name \
      --mtime="UTC 1980-01-01" \
      --owner=0 \
      --group=0 \
      --numeric-owner \
      -czf "$output_file" \
      -C "$source_dir" \
      .
  else
    COPYFILE_DISABLE=1 tar -czf "$output_file" -C "$source_dir" .
  fi

  echo "  ✓ ${name} -> ${output_file}"
}

echo "Packaging static release assets -> ${OUT_DIR}"
package_site "admin" "$REPO_ROOT/apps/admin/dist"
package_site "computer" "$REPO_ROOT/apps/computer/dist"
package_site "docs" "$REPO_ROOT/docs/dist"
