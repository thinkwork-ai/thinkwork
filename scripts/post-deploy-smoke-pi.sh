#!/usr/bin/env bash
# Post-deploy smoke for the Pi runtime end-to-end path.
#
# Invokes the Pi dispatcher Lambda with a populated payload and asserts
# the response includes a USER.md fingerprint (Marco's author = "Eric").
# Catches the class of bugs that shipped silently on 2026-05-05 — LWA
# routing, Bedrock IAM, model-id inference profile, missing workspace
# prompt loader.

set -euo pipefail

STAGE="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    *) echo "post-deploy-smoke-pi: unknown arg: $1" >&2; exit 2 ;;
  esac
done

export STAGE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

# Marco's IDs are dev-tenant-specific. Other stages should set the
# SMOKE_* env vars before calling this wrapper.
if [[ "$STAGE" != "dev" && -z "${SMOKE_AGENT_ID:-}" ]]; then
  echo "post-deploy-smoke-pi: STAGE=$STAGE requires SMOKE_AGENT_ID + related SMOKE_* env vars (Marco defaults are dev-only)." >&2
  exit 2
fi

pnpm exec tsx packages/api/src/__smoke__/pi-marco-smoke.ts
