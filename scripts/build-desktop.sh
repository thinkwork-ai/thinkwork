#!/usr/bin/env bash
# Build the Electron desktop shell from deployed stage configuration.
#
# Usage:
#   bash scripts/build-desktop.sh <stage> [--publish always|never|onTag] [--dir]
#
# Environment variables (optional overrides):
#   TF_DIR                Terraform working directory (default: terraform/examples/greenfield)
#   AWS_REGION            AWS region (default: us-east-1)
#   GITHUB_REF_NAME       Release tag such as desktop-v1.2.3-canary.1
#   BUILD_CHANNEL         stable, canary, or dev
#   DESKTOP_MAC_ARCHES    comma-separated macOS arches to package (default: arm64,x64)
#   DESKTOP_SKIP_TERRAFORM=1 to use existing VITE_* env vars instead of terraform outputs

set -euo pipefail

STAGE="${1:-${THINKWORK_STAGE:-dev}}"
shift || true

PUBLISH_MODE="never"
PACKAGE_MODE="--mac"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      PUBLISH_MODE="${2:?--publish requires a value}"
      shift 2
      ;;
    --publish=*)
      PUBLISH_MODE="${1#--publish=}"
      shift
      ;;
    --dir)
      PACKAGE_MODE="--dir"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${TF_DIR:-$REPO_ROOT/terraform/examples/greenfield}"
REGION="${AWS_REGION:-us-east-1}"
REF_NAME="${GITHUB_REF_NAME:-}"
DESKTOP_VERSION="${DESKTOP_VERSION:-$(node -p "require('$REPO_ROOT/apps/desktop/package.json').version")}"

if [[ "$REF_NAME" == desktop-v* ]]; then
  DESKTOP_VERSION="${REF_NAME#desktop-v}"
fi

if [[ -n "${BUILD_CHANNEL:-}" ]]; then
  DESKTOP_CHANNEL="$BUILD_CHANNEL"
elif [[ "$DESKTOP_VERSION" == *"-canary."* || "$DESKTOP_VERSION" == *"-canary"* ]]; then
  DESKTOP_CHANNEL="canary"
elif [[ "$STAGE" == "dev" ]]; then
  DESKTOP_CHANNEL="dev"
else
  DESKTOP_CHANNEL="stable"
fi

case "$DESKTOP_CHANNEL" in
  stable)
    DESKTOP_PRODUCT_NAME="ThinkWork Spaces"
    DESKTOP_APP_ID="ai.thinkwork.spaces.desktop"
    DESKTOP_SCHEME="thinkwork"
    DESKTOP_ICON="build/icons/icon.icns"
    ;;
  canary)
    DESKTOP_PRODUCT_NAME="ThinkWork Spaces (Canary)"
    DESKTOP_APP_ID="ai.thinkwork.spaces.desktop.canary"
    DESKTOP_SCHEME="thinkwork-canary"
    DESKTOP_ICON="build/icons/icon-canary.icns"
    ;;
  dev)
    DESKTOP_PRODUCT_NAME="ThinkWork Spaces (Dev)"
    DESKTOP_APP_ID="ai.thinkwork.spaces.desktop.dev"
    DESKTOP_SCHEME="thinkwork-dev"
    DESKTOP_ICON="build/icons/icon-dev.icns"
    ;;
  *)
    echo "BUILD_CHANNEL must be stable, canary, or dev; got '$DESKTOP_CHANNEL'" >&2
    exit 2
    ;;
esac

if [[ "${DESKTOP_SKIP_TERRAFORM:-0}" != "1" ]]; then
  echo "Reading Terraform outputs for stage=$STAGE ..."
  cd "$TF_DIR"
  source "$REPO_ROOT/scripts/lib/terraform-output.sh"

  API_ENDPOINT="$(tf_output_raw api_endpoint)"
  APPSYNC_API_URL="$(tf_output_raw appsync_api_url)"
  APPSYNC_REALTIME_URL="$(tf_output_raw appsync_realtime_url)"
  APPSYNC_API_KEY="$(tf_output_raw appsync_api_key)"
  USER_POOL_ID="$(tf_output_raw user_pool_id)"
  ADMIN_CLIENT_ID="$(tf_output_raw admin_client_id)"
  AUTH_DOMAIN="$(tf_output_raw auth_domain)"
  COMPUTER_SANDBOX_URL="$(tf_output_raw computer_sandbox_url 2>/dev/null || echo '')"
  COMPUTER_SANDBOX_PARENT_ORIGINS="$(tf_output_raw computer_sandbox_allowed_parent_origins 2>/dev/null || echo '')"
  MAPBOX_PUBLIC_TOKEN="${MAPBOX_PUBLIC_TOKEN:-$(tf_output_raw mapbox_public_token)}"

  if [[ -z "$COMPUTER_SANDBOX_URL" || -z "$COMPUTER_SANDBOX_PARENT_ORIGINS" ]]; then
    cat >&2 <<EOF
Desktop packaging requires sandbox iframe Terraform outputs.
Missing one or more outputs:
  computer_sandbox_url='${COMPUTER_SANDBOX_URL}'
  computer_sandbox_allowed_parent_origins='${COMPUTER_SANDBOX_PARENT_ORIGINS}'
EOF
    exit 1
  fi

  COGNITO_DOMAIN="https://${AUTH_DOMAIN}.auth.${REGION}.amazoncognito.com"

  cd "$REPO_ROOT"
  cat > apps/spaces/.env.production <<EOF
VITE_THINKWORK_STAGE=${STAGE}
VITE_GRAPHQL_HTTP_URL=${API_ENDPOINT}/graphql
VITE_GRAPHQL_URL=${APPSYNC_API_URL}
VITE_GRAPHQL_WS_URL=${APPSYNC_REALTIME_URL}
VITE_GRAPHQL_API_KEY=${APPSYNC_API_KEY}
VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${ADMIN_CLIENT_ID}
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_API_URL=${API_ENDPOINT}
VITE_MAPBOX_PUBLIC_TOKEN=${MAPBOX_PUBLIC_TOKEN}
VITE_SANDBOX_IFRAME_SRC=${COMPUTER_SANDBOX_URL:+${COMPUTER_SANDBOX_URL%/}/iframe-shell.html}
VITE_ALLOWED_PARENT_ORIGINS=${COMPUTER_SANDBOX_PARENT_ORIGINS}
EOF
else
  echo "Skipping Terraform output lookup; using existing VITE_* environment."
fi

echo "Building desktop app channel=${DESKTOP_CHANNEL} version=${DESKTOP_VERSION} ..."
cd "$REPO_ROOT"

export THINKWORK_STAGE="$STAGE"
export VITE_THINKWORK_STAGE="$STAGE"
export THINKWORK_DESKTOP_VERSION="$DESKTOP_VERSION"
export THINKWORK_DESKTOP_CHANNEL="$DESKTOP_CHANNEL"
export THINKWORK_DESKTOP_PRODUCT_NAME="$DESKTOP_PRODUCT_NAME"
export THINKWORK_DESKTOP_APP_ID="$DESKTOP_APP_ID"
export THINKWORK_DESKTOP_SCHEME="$DESKTOP_SCHEME"
export THINKWORK_DESKTOP_ICON="$DESKTOP_ICON"
export THINKWORK_APPLE_TEAM_ID="${APPLE_TEAM_ID:-${THINKWORK_APPLE_TEAM_ID:-}}"

DESKTOP_HAS_SIGNING=0
if [[ -n "${CSC_LINK:-${MAC_CSC_LINK:-}}" ]]; then
  DESKTOP_HAS_SIGNING=1
fi
if [[ -n "${CSC_NAME:-}" && "${CSC_NAME}" != "null" ]]; then
  DESKTOP_HAS_SIGNING=1
fi
if [[ "$DESKTOP_HAS_SIGNING" == "1" ]]; then
  DESKTOP_HARDENED_RUNTIME=true
  DESKTOP_NOTARIZE=true
else
  DESKTOP_HARDENED_RUNTIME=false
  DESKTOP_NOTARIZE=false
fi

DESKTOP_MAC_ARCHES="${DESKTOP_MAC_ARCHES:-arm64,x64}"
DESKTOP_ARCH_LINES=""
IFS=',' read -r -a DESKTOP_ARCH_ARRAY <<< "$DESKTOP_MAC_ARCHES"
for raw_arch in "${DESKTOP_ARCH_ARRAY[@]}"; do
  arch="${raw_arch//[[:space:]]/}"
  case "$arch" in
    arm64 | x64 | universal)
      DESKTOP_ARCH_LINES+="        - ${arch}"$'\n'
      ;;
    "")
      ;;
    *)
      echo "DESKTOP_MAC_ARCHES may only include arm64, x64, or universal; got '$arch'" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$DESKTOP_ARCH_LINES" ]]; then
  echo "DESKTOP_MAC_ARCHES must include at least one architecture" >&2
  exit 2
fi

cp "apps/desktop/${DESKTOP_ICON}" apps/desktop/build/icons/icon-active.icns
BUILDER_CONFIG="apps/desktop/.electron-builder.generated.yml"
trap 'rm -f "$BUILDER_CONFIG"' EXIT

cat > "$BUILDER_CONFIG" <<EOF
appId: ${DESKTOP_APP_ID}
productName: ${DESKTOP_PRODUCT_NAME}
artifactName: \${productName}-\${version}-\${arch}.\${ext}
asar: true

# Skip @electron/rebuild. Our only native modules are @mongodb-js/zstd
# (prebuilt N-API, ABI-stable, loads without a rebuild) and \`canvas\` — an
# unused optional transitive of unpdf/pdfjs that has no prebuild and fails
# node-gyp on the runner (no pangocairo). Rebuilding gained us nothing and
# broke the release; the JS deps are already bundled into out/** by
# electron-vite, so nothing here needs compiling against Electron's ABI.
npmRebuild: false

directories:
  output: dist
  buildResources: build

files:
  - out/**/*
  - package.json

extraMetadata:
  main: out/main/index.js
  version: ${DESKTOP_VERSION}

protocols:
  - name: ThinkWork Spaces
    schemes:
      - ${DESKTOP_SCHEME}

mac:
  category: public.app-category.productivity
  icon: build/icons/icon-active.icns
  hardenedRuntime: ${DESKTOP_HARDENED_RUNTIME}
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
EOF

if [[ -n "${CSC_NAME:-}" ]]; then
  printf '  identity: %s\n' "$CSC_NAME" >> "$BUILDER_CONFIG"
fi

cat >> "$BUILDER_CONFIG" <<EOF
  notarize: ${DESKTOP_NOTARIZE}
  target:
    - target: dmg
      arch:
${DESKTOP_ARCH_LINES}
    - target: zip
      arch:
${DESKTOP_ARCH_LINES}

dmg:
  sign: false

publish:
  - provider: github
    owner: thinkwork-ai
    repo: thinkwork
    vPrefixedTagName: true
    # Publish to a DRAFT release so the auto-updater can't see it until every
    # asset (the ~140 MB zip/dmg + *-mac.yml manifests) has finished uploading.
    # release-desktop.yml flips the draft to published once uploads complete.
    # Without this, electron-builder marks the release the moment it is created
    # — minutes before the zip lands — so any open app polling in that window
    # downloads a not-yet-present artifact and drops into the updater error
    # ("Retry"/"spins then stops") state.
    releaseType: draft
    publishAutoUpdate: true

generateUpdatesFilesForAllChannels: true
EOF

pnpm --filter @thinkwork/spaces build
pnpm --filter @thinkwork/desktop run build
pnpm --filter @thinkwork/desktop exec electron-builder --config .electron-builder.generated.yml "$PACKAGE_MODE" --publish "$PUBLISH_MODE"
