#!/usr/bin/env bash
# Post-deploy smoke for the Compliance Export Runner Lambda (Phase 3 U11.U3).
#
# Invokes the runner directly with a synthesized SQS event containing a
# non-existent UUIDv7 jobId. The runner should:
#   - Parse the body
#   - Connect to Aurora via DATABASE_URL_SECRET_ARN
#   - Attempt CAS guard on compliance.export_jobs (no-op since no row matches)
#   - Return {batchItemFailures: []}
#
# This catches deploy regressions on env vars, IAM role wiring, and
# Aurora connectivity — without depending on a queued job in the queue.
#
# Plan: docs/plans/2026-05-08-006-feat-compliance-u11-u3-runner-plan.md

set -euo pipefail

STAGE="${STAGE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) AWS_REGION="$2"; shift 2 ;;
    *) echo "post-deploy-smoke-compliance-export-runner: unknown arg: $1" >&2; exit 2 ;;
  esac
done

export STAGE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

pnpm exec tsx packages/api/src/__smoke__/compliance-export-runner-smoke.ts
