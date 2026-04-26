#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <ecr-repository-url> [tag]" >&2
  exit 64
fi

REPOSITORY_URL="$1"
TAG="${2:-$(git rev-parse --short=12 HEAD)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker buildx build \
  --platform linux/arm64 \
  --tag "${REPOSITORY_URL}:${TAG}" \
  --push \
  "${ROOT}/agent-container"

echo "${REPOSITORY_URL}:${TAG}"
