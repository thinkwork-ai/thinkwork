#!/usr/bin/env bash
# Focused regression tests for scripts/build-spaces.sh.
#
# Run with:
#   bash scripts/build-spaces.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_SCRIPT="$ROOT/scripts/build-spaces.sh"
GREENFIELD_TF="$ROOT/terraform/examples/greenfield/main.tf"

missing_outputs=()

while IFS= read -r output_name; do
  if ! grep -Eq "^[[:space:]]*output[[:space:]]+\"${output_name}\"" "$GREENFIELD_TF"; then
    missing_outputs+=("$output_name")
  fi
done < <(
  grep -Eo 'tf_output_raw[[:space:]]+[A-Za-z0-9_]+' "$BUILD_SCRIPT" \
    | awk '{print $2}' \
    | sort -u
)

if [[ ${#missing_outputs[@]} -gt 0 ]]; then
  printf 'build-spaces.sh reads Terraform outputs missing from greenfield root:\n' >&2
  printf '  - %s\n' "${missing_outputs[@]}" >&2
  exit 1
fi

for app_output in app_bucket_name app_distribution_id app_url; do
  if ! grep -Eq "tf_output_raw[[:space:]]+${app_output}" "$BUILD_SCRIPT"; then
    printf 'build-spaces.sh should prefer Terraform output %s before legacy computer_* aliases\n' "$app_output" >&2
    exit 1
  fi
done

echo "build-spaces tests passed"
