#!/usr/bin/env bash
# Focused regression tests for scripts/build-web.sh.
#
# Run with:
#   bash scripts/build-web.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_SCRIPT="$ROOT/scripts/build-web.sh"
GREENFIELD_TF="$ROOT/terraform/examples/greenfield/main.tf"

missing_outputs=()

while IFS= read -r output_name; do
  if ! grep -Eq "^[[:space:]]*output[[:space:]]+\"${output_name}\"" "$GREENFIELD_TF"; then
    missing_outputs+=("$output_name")
  fi
done < <(
  grep -Eo 'tf_output_cached_raw[[:space:]]+[A-Za-z0-9_]+' "$BUILD_SCRIPT" \
    | awk '{print $2}' \
    | sort -u
)

if [[ ${#missing_outputs[@]} -gt 0 ]]; then
  printf 'build-web.sh reads Terraform outputs missing from greenfield root:\n' >&2
  printf '  - %s\n' "${missing_outputs[@]}" >&2
  exit 1
fi

for app_output in app_bucket_name app_distribution_id app_url; do
  if ! grep -Eq "tf_output_cached_raw[[:space:]]+${app_output}" "$BUILD_SCRIPT"; then
    printf 'build-web.sh should prefer Terraform output %s before legacy computer_* aliases\n' "$app_output" >&2
    exit 1
  fi
done

if ! grep -Eq '^VITE_RELEASE_VERSION=\$\{WEB_RELEASE_VERSION\}' "$BUILD_SCRIPT"; then
  printf 'build-web.sh should write VITE_RELEASE_VERSION into the runtime env\n' >&2
  exit 1
fi

if ! grep -Eq 'WEB_RELEASE_VERSION="v\$\{WEB_RELEASE_VERSION\}"' "$BUILD_SCRIPT"; then
  printf 'build-web.sh should derive a v-prefixed release version from VITE_APP_VERSION\n' >&2
  exit 1
fi

if ! grep -Eq 'RUNTIME_CONFIG_PATH="apps/web/dist/thinkwork-runtime-config.json"' "$BUILD_SCRIPT"; then
  printf 'build-web.sh should write thinkwork-runtime-config.json into the web dist\n' >&2
  exit 1
fi

if ! grep -Eq 'VITE_AUTH_IDENTITY_PROVIDERS: \$authIdentityProviders' "$BUILD_SCRIPT"; then
  printf 'build-web.sh runtime config should publish VITE_AUTH_IDENTITY_PROVIDERS\n' >&2
  exit 1
fi

if ! grep -Eq 's3://\$\{APP_BUCKET\}/thinkwork-runtime-config.json' "$BUILD_SCRIPT"; then
  printf 'build-web.sh should upload thinkwork-runtime-config.json to the app bucket\n' >&2
  exit 1
fi

if ! grep -Eq 'content-type "application/json"' "$BUILD_SCRIPT"; then
  printf 'build-web.sh should set application/json on thinkwork-runtime-config.json\n' >&2
  exit 1
fi

echo "build-web tests passed"
