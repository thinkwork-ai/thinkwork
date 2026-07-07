#!/usr/bin/env bash
# THINK-201 lesson: the harness validated Hindsight 0.5.6+ while dev silently
# ran 0.5.0 (a parent-module terraform default override) — the Haiku retain
# swap then broke extraction in production shape. Eval results only transfer
# to the deployment when the harness runs the DEPLOYED image tag.
#
# Usage:  ./verify-deployed-tag.sh [stage]      (default: dev)
# Prints the deployed tag and fails if $HINDSIGHT_TAG (the compose override)
# doesn't match it. Run before any retain-model eval; export the printed tag:
#   export HINDSIGHT_TAG=$(./verify-deployed-tag.sh dev --print)
set -euo pipefail

STAGE="${1:-dev}"
MODE="${2:-check}"
CLUSTER="thinkwork-${STAGE}-cluster"
SERVICE="thinkwork-${STAGE}-hindsight"

TASK_DEF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)
IMAGE=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[0].image' --output text)
DEPLOYED_TAG="${IMAGE##*:}"

if [ "$MODE" = "--print" ]; then
  echo "$DEPLOYED_TAG"
  exit 0
fi

echo "deployed: $IMAGE (tag $DEPLOYED_TAG)"
if [ -z "${HINDSIGHT_TAG:-}" ]; then
  echo "HINDSIGHT_TAG is unset — the compose file will default to a pinned tag" >&2
  echo "that may not match the deployment. Export it first:" >&2
  echo "  export HINDSIGHT_TAG=$DEPLOYED_TAG" >&2
  exit 1
fi
if [ "$HINDSIGHT_TAG" != "$DEPLOYED_TAG" ]; then
  echo "MISMATCH: HINDSIGHT_TAG=$HINDSIGHT_TAG but $STAGE runs $DEPLOYED_TAG." >&2
  echo "Eval results will NOT transfer. Set HINDSIGHT_TAG=$DEPLOYED_TAG." >&2
  exit 1
fi
echo "OK: harness tag matches the deployed image."
