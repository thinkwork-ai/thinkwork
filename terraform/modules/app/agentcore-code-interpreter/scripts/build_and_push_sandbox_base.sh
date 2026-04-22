#!/usr/bin/env bash
################################################################################
# build_and_push_sandbox_base.sh — build + push the AgentCore sandbox base
# image to the stage's ECR repo. Invoked by CI; also safe to run locally
# once ``thinkwork doctor`` reports green.
#
# Usage (from repo root):
#   bash terraform/modules/app/agentcore-code-interpreter/scripts/build_and_push_sandbox_base.sh \
#        --stage dev --region us-east-1
#
# The script:
#   1. Reads the ECR repo URL from ``terraform output -raw`` (must be run
#      after ``terraform apply`` lands the agentcore-code-interpreter
#      module for the target stage).
#   2. docker build the Dockerfile.sandbox-base with the repo root as
#      context (so the COPY can reach packages/).
#   3. Tags with the current git SHA (immutable tag per the ECR repo
#      config) and ``:latest``.
#   4. docker push both tags after ``aws ecr get-login-password``.
################################################################################
set -euo pipefail

STAGE=""
REGION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)   STAGE="$2";   shift 2 ;;
    --region)  REGION="$2";  shift 2 ;;
    *)         echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

: "${STAGE:?--stage is required}"
: "${REGION:?--region is required}"

# Resolve the repo URL from terraform state. Tolerant: if the caller runs
# this before the module applies, fall back to the deterministic name.
REPO_URL="$(
  terraform -chdir="terraform/examples/greenfield" output -raw \
    sandbox_base_ecr_repository_url 2>/dev/null \
    || echo ""
)"
if [[ -z "$REPO_URL" ]]; then
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  REPO_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/thinkwork-${STAGE}-sandbox-base"
fi

GIT_SHA="$(git rev-parse --short HEAD)"
IMAGE_TAG="${GIT_SHA}"

echo "[sandbox-base] repo: ${REPO_URL}"
echo "[sandbox-base] tag:  ${IMAGE_TAG}"

# ECR login
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REPO_URL%/*}"

# Build with repo root as the context so COPY can reach packages/.
docker build \
  --platform=linux/amd64 \
  -f terraform/modules/app/agentcore-code-interpreter/Dockerfile.sandbox-base \
  -t "${REPO_URL}:${IMAGE_TAG}" \
  -t "${REPO_URL}:latest" \
  .

docker push "${REPO_URL}:${IMAGE_TAG}"
docker push "${REPO_URL}:latest"

echo "[sandbox-base] pushed ${REPO_URL}:${IMAGE_TAG}"
