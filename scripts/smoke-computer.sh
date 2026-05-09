#!/usr/bin/env bash
# smoke-computer — Computer v1 deployed-stage acceptance smoke.
#
# Usage:
#   scripts/smoke-computer.sh dev
#   scripts/smoke-computer.sh --stage dev --region us-east-1

set -euo pipefail

STAGE="dev"
REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    -*)
      echo "smoke-computer: unknown arg: $1" >&2
      exit 2
      ;;
    *)
      STAGE="$1"
      shift
      ;;
  esac
done

bash "$(cd "$(dirname "$0")" && pwd)/post-deploy-smoke-computer-thread-streaming.sh" \
  --stage "$STAGE" \
  --region "$REGION"
