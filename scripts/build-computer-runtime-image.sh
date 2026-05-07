#!/usr/bin/env bash
# Build and optionally push the ThinkWork Computer runtime image.
#
# Usage:
#   scripts/build-computer-runtime-image.sh --repository-url <ecr-url> --tag <tag>
#   scripts/build-computer-runtime-image.sh --repository-url <ecr-url> --tag <tag> --push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY_URL="${COMPUTER_RUNTIME_REPOSITORY_URL:-}"
TAG="${COMPUTER_RUNTIME_IMAGE_TAG:-}"
PLATFORM="${COMPUTER_RUNTIME_PLATFORM:-linux/arm64}"
PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository-url)
      REPOSITORY_URL="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --push)
      PUSH=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ -z "$REPOSITORY_URL" ]]; then
  echo "--repository-url or COMPUTER_RUNTIME_REPOSITORY_URL is required" >&2
  exit 64
fi

if [[ -z "$TAG" ]]; then
  TAG="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)-arm64"
fi

IMAGE="${REPOSITORY_URL}:${TAG}"

pnpm --filter @thinkwork/computer-runtime build

if [[ "$PUSH" == "true" ]]; then
  REGISTRY="${REPOSITORY_URL%%/*}"
  REGION="$(echo "$REGISTRY" | sed -E 's/^[0-9]+\.dkr\.ecr\.([^.]+)\.amazonaws\.com$/\1/')"
  if [[ -z "$REGION" || "$REGION" == "$REGISTRY" ]]; then
    echo "Cannot infer ECR region from repository URL: $REPOSITORY_URL" >&2
    exit 64
  fi
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
fi

BUILD_ARGS=(
  --platform "$PLATFORM"
  --tag "$IMAGE"
)

if [[ "$PUSH" == "true" ]]; then
  BUILD_ARGS+=(--push)
else
  BUILD_ARGS+=(--load)
fi

docker buildx build "${BUILD_ARGS[@]}" "$REPO_ROOT/packages/computer-runtime"

echo "$IMAGE"
