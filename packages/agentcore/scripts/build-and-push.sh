#!/usr/bin/env bash
# Build the Agent Container Docker image and push to ECR.
#
# Usage:
#   bash scripts/build-and-push.sh --stage main --runtime sdk
#   bash scripts/build-and-push.sh --stage ericodom --runtime pi
#
# The --stage flag determines the ECR repository:
#   thinkwork-{stage}-agentcore-agent (managed by SST — infra/agentcore.ts)
#
# The --runtime flag selects the Dockerfile:
#   sdk (default) → packages/agentcore-sdk/agent-container/Dockerfile
#   pi            → packages/agentcore-pi/agent-container/Dockerfile
#
# Must be run from the monorepo root (packages/agentcore/scripts/../..).
set -euo pipefail

STAGE=""
REGION="us-east-1"
TAG=""
RUNTIME="sdk"

while [[ $# -gt 0 ]]; do
  case $1 in
    --stage) STAGE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$STAGE" ]]; then
  echo "Error: --stage is required (e.g. --stage main or --stage ericodom)"
  exit 1
fi

# Default tag includes runtime type to avoid collisions in shared ECR repo
TAG="${TAG:-${RUNTIME}-latest}"

# Select Dockerfile based on runtime type
case "$RUNTIME" in
  sdk)
    DOCKERFILE="packages/agentcore-sdk/agent-container/Dockerfile"
    ;;
  pi)
    DOCKERFILE="packages/agentcore-pi/agent-container/Dockerfile"
    ;;
  strands)
    DOCKERFILE="packages/agentcore-strands/agent-container/Dockerfile"
    ;;
  *)
    echo "Error: --runtime must be 'sdk', 'pi', or 'strands' (got '$RUNTIME')"
    exit 1
    ;;
esac

# ECR repository URI (managed by SST — infra/agentcore.ts)
ACCOUNT_ID="487219502366"
ECR_DOMAIN="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_DOMAIN}/thinkwork-${STAGE}-agentcore-agent"

echo "Building and pushing Agent Container..."
echo "  Stage:      $STAGE"
echo "  Runtime:    $RUNTIME"
echo "  Dockerfile: $DOCKERFILE"
echo "  ECR URI:    $ECR_URI"
echo "  Tag:        $TAG"
echo ""

# Login to ECR
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_DOMAIN"

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
  PLATFORM="linux/arm64"
else
  PLATFORM="linux/amd64"
fi

# Build from monorepo root (Dockerfile expects packages/ context)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$SCRIPT_DIR/../../.."

echo "Building for platform: $PLATFORM"
docker build \
  --platform "$PLATFORM" \
  -f "$DOCKERFILE" \
  -t "${ECR_URI}:${TAG}" \
  "$MONOREPO_ROOT"

# Push
docker push "${ECR_URI}:${TAG}"

echo ""
echo "Image pushed: ${ECR_URI}:${TAG}"
echo ""
echo "Next: Create or update the AgentCore Runtime with:"
echo "  bash packages/agentcore/scripts/create-runtime.sh --stage $STAGE --region $REGION --runtime $RUNTIME"
