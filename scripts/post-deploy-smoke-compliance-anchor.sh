#!/usr/bin/env bash
# Post-deploy smoke for the Compliance Anchor pipeline (Phase 3 U8a).
#
# Invokes both the anchor Lambda and the watchdog Lambda and asserts
# their dispatch-pin response payloads:
#   - compliance-anchor → {dispatched: true, anchored: false, ...}
#   - compliance-anchor-watchdog → {mode: "inert", ...}
#
# Catches the class of bugs where the schedule fires but the Lambda
# response shape regresses (e.g., missing `dispatched`, wrong `mode`,
# or U8b accidentally landing without the body-swap safety test).
#
# Plan: docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md

set -euo pipefail

STAGE="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    *) echo "post-deploy-smoke-compliance-anchor: unknown arg: $1" >&2; exit 2 ;;
  esac
done

export STAGE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

pnpm exec tsx packages/api/src/__smoke__/compliance-anchor-smoke.ts
