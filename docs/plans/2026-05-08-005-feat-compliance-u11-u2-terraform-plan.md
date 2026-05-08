---
title: U11.U2 — Terraform infra for the compliance export runner
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md
---

# U11.U2 — Compliance Export Terraform Infra

## Summary

Provision the AWS substrate for the U11 export runner: ephemeral S3 bucket with 7-day lifecycle, SQS queue + DLQ + alarm, runner Lambda IAM role with bucket-scoped permissions, and a standalone `aws_lambda_function.compliance_export_runner` resource wired via `aws_lambda_event_source_mapping`. Ships a stub Lambda body (throws not-implemented) so the function deploys; U11.U3 swaps in the live runner. Pass `COMPLIANCE_EXPORTS_QUEUE_URL` env into the graphql-http Lambda so the U11.U1 mutation can dispatch.

This is the substrate-first PR of U11.U2; U11.U3 (live runner body + smoke + GHA job) ships next.

---

## Problem Frame

U11.U1 (PR #944, merged) added `Mutation.createComplianceExport` that needs to dispatch jobIds to SQS. Without `COMPLIANCE_EXPORTS_QUEUE_URL` configured on graphql-http, the mutation throws `INTERNAL_SERVER_ERROR` deterministically. This PR wires the queue, the bucket, the runner Lambda's IAM role + function (stub body), and the event source mapping. After this PR merges + dev deploys, the mutation succeeds end-to-end with the queued message landing in SQS — the runner just has no body yet.

See origin: `docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md` (U11 plan, U2 unit).

---

## Requirements

- R1. New Terraform module `terraform/modules/data/compliance-exports-bucket/` provisions the S3 bucket. NOT Object Lock — these are ephemeral export artifacts. SSE-S3 encryption (consistent with the dev-tier hardening for non-WORM buckets). Public access blocked. Versioning suspended. 7-day lifecycle expiration on every object.
- R2. New IAM role for the runner Lambda. Allow: `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetObject`, `s3:GetObjectAttributes`, `s3:ListBucket` (for multipart-upload management) on the new bucket only. Explicit Deny on every other S3 ARN. Trust policy pins `aws:SourceAccount` + `aws:SourceArn` to the predictable function ARN.
- R3. SQS queue `thinkwork-${stage}-compliance-exports` (standard, not FIFO; visibility 900s; retention 1 day) + DLQ `thinkwork-${stage}-compliance-exports-dlq` (retention 14 days). RedrivePolicy: maxReceiveCount=3 → DLQ.
- R4. Event source mapping (SQS queue → runner Lambda): batch_size=1, function_response_types=["ReportBatchItemFailures"], maximum_concurrency=2 (operator-scale ceiling at v1).
- R5. Standalone `aws_lambda_function.compliance_export_runner` resource (NOT in the for_each pool) — isolates the export runner's per-key role + env from the 60+ unrelated handlers. timeout=900s, memory_size=1024MB, reserved_concurrent_executions=2 (capacity matches event-source mapping concurrency cap).
- R6. CloudWatch alarm on DLQ depth > 0 → existing platform alerts SNS topic. Treats DLQ messages as a meaningful failure signal (the runner already writes FAILED status to DB on business errors, so DLQ messages are reserved for handler crashes).
- R7. Pass-through wiring through `terraform/modules/thinkwork/main.tf` — instantiate the new bucket module, pass outputs (bucket_name, runner_role_arn) to `terraform/modules/app/lambda-api`, which wires the SQS queue + Lambda function + event source mapping.
- R8. New variables in `terraform/modules/app/lambda-api/variables.tf`: `compliance_exports_bucket_name`, `compliance_exports_runner_role_arn`. The SQS queue + DLQ are created inside `lambda-api` (consistent with where other handler-adjacent queues live in this codebase) so no extra pass-through.
- R9. Pass `COMPLIANCE_EXPORTS_QUEUE_URL` env into the graphql-http Lambda (and any sibling handlers — chat-agent-invoke, etc. — that route through the same handlers.tf for_each pool) so the U11.U1 mutation can dispatch. Pass `COMPLIANCE_EXPORTS_BUCKET` + `COMPLIANCE_EXPORTS_QUEUE_URL` env into the runner Lambda.
- R10. Build entry in `scripts/build-lambdas.sh` for `compliance-export-runner`. The runner needs `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` + `@aws-sdk/client-sqs` (the U11.U3 body's deps) — verify whether the existing `BUNDLED_AGENTCORE_ESBUILD_FLAGS` allowlist needs expansion.
- R11. Stub runner Lambda body at `packages/lambda/compliance-export-runner.ts`. Module-load env snapshot (mirrors `compliance-anchor.ts:getAnchorEnv`). Handler throws `Error("compliance-export-runner: not implemented yet — U11.U3 ships the live body")`. Function deploys + appears in CloudWatch; SQS-driven invocations land in the DLQ after maxReceiveCount=3 attempts. This is the inert-substrate pattern (per `feedback_ship_inert_pattern`).
- R12. The SOC2 walkthrough rehearsal in dev should successfully complete the U11.U1 mutation end-to-end (mutation succeeds, audit event emitted, jobId visible in SQS) — but the job stays QUEUED forever because the runner is inert. Documented in the PR body.

---

## Scope Boundaries

- Live runner body — U11.U3.
- Admin Exports page — U11.U4.
- Daily cleanup of stale QUEUED jobs (running >> 15 min) — out of scope; CloudWatch alarms surface the pathology.
- Customer-managed KMS encryption on the exports bucket — v1 uses SSE-S3; CMK is a future hardening pass.
- AppSync subscription for live job-status updates — out of scope; v1 polling at 3s.

### Deferred to Follow-Up Work

- **U11.U3** — live runner Lambda body + post-deploy smoke + GHA workflow job.
- **U11.U4** — admin SPA Exports page (table + dialog + polling).
- **U11.U5** — final verify + manual SOC2 export rehearsal in deployed dev.

---

## Context & Research

### Relevant Code and Patterns

- `terraform/modules/data/compliance-audit-bucket/` — module shape for the new exports bucket. Differences: no Object Lock (drop versioning + lifecycle is just expiration); no per-cadence prefix policy; no compliance_reader/drainer secret grants (the runner uses the writer DB pool via SecretsManager).
- `terraform/modules/data/compliance-audit-bucket/main.tf` lines 195-256 — bucket policy with EnforceHTTPS + DenyDeleteObject + DenyBucketDelete pattern.
- `terraform/modules/data/compliance-audit-bucket/main.tf` lines 264-348 — IAM role + inline policies + explicit-deny pattern.
- `terraform/modules/app/lambda-api/handlers.tf` — `aws_lambda_function.compliance_anchor` standalone resource pattern (per-key blast-radius isolation).
- `terraform/modules/app/lambda-api/handlers.tf` — `aws_lambda_event_source_mapping` for SQS-triggered handlers (verify by grep).
- `packages/lambda/compliance-anchor.ts` — module-load env snapshot via `getAnchorEnv()`. The runner mirrors this pattern.
- `packages/lambda/compliance-anchor.ts` lines 1-30 — stub-body shape for inert phase.
- `scripts/build-lambdas.sh` lines 150-160 — `build_handler "compliance-anchor"` entry shape.

### Institutional Learnings

- `feedback_ship_inert_pattern` — new modules land with stubs + tests but no live wiring; integration waits for the plan's own dependency gate.
- `feedback_lambda_zip_build_entry_required` — every new Lambda needs both Terraform `handlers.tf` + `scripts/build-lambdas.sh` entry; missing the second blocks every deploy with `filebase64sha256` error.
- `project_async_retry_idempotency_lessons` — for non-idempotent SQS-triggered loops, set `MaximumRetryAttempts = 0` on Lambda invokes + DLQ + CAS guard. The runner is naturally idempotent via the QUEUED→RUNNING status CAS in the DB; we ship maxReceiveCount=3 + DLQ as belt-and-suspenders.
- `project_admin_worktree_cognito_callbacks` — no UI changes here; Cognito callbacks unchanged.

### External References

None — every required pattern has a precedent in this repo.

---

## Key Technical Decisions

- **NOT Object Lock for exports bucket.** Exports are ephemeral 7-day artifacts; auditor downloads happen within minutes of completion. The Object Lock + WORM posture is for the audit anchor (compliance-audit-bucket); inappropriate here.
- **SSE-S3 not SSE-KMS** at v1. The exports bucket is non-WORM ephemeral; SSE-S3 matches the dev-tier hardening for non-audit buckets. CMK migration is a future hardening pass.
- **Standalone Lambda function, not in the for_each pool.** Same reasoning as U8a anchor: per-key role + env isolation; blast radius bounded.
- **maxReceiveCount=3 + DLQ.** The runner is idempotent via QUEUED→RUNNING CAS guard, but a handler crash before the CAS update could re-deliver the same message. After 3 attempts it lands in DLQ; alarm fires; operator inspects.
- **Standard SQS queue, not FIFO.** Each export jobId is independently identified; ordering doesn't matter; FIFO would force per-tenant message-group complexity for negligible benefit.
- **Pass `COMPLIANCE_EXPORTS_QUEUE_URL` to graphql-http via the existing handlers env.** No new SSM parameter; the queue URL is a Terraform output that flows into the env vars for the GraphQL Lambda's existing env block.
- **Stub runner Lambda body throws, doesn't no-op.** A no-op stub would silently mark messages as processed and let queued jobs stay in QUEUED forever with no DLQ signal. A throw + DLQ + alarm makes the inert phase visible.
- **CloudWatch alarm on DLQ depth > 0 only.** Function-level error alarm is fine but redundant — handler crashes always land in DLQ via the maxReceiveCount=3 redrive. One alarm per failure mode.

---

## Open Questions

### Resolved During Planning

- **Object Lock for exports bucket?** No — ephemeral artifacts; 7-day expiration is the disposition.
- **Reuse the existing platform-alerts SNS topic for the DLQ alarm, or new?** Reuse — the topic exists; adding a per-feature topic for one alarm is over-engineering.
- **One Lambda function per format (CSV / NDJSON)?** No — single runner branches on the export_jobs.format column. CSV vs NDJSON are different write loops, not different infra.
- **Should the runner role read the export_jobs table directly or via a tighter compliance_writer-equivalent role?** Direct, via the writer pool's main DB role. The export_jobs table updates are scoped to the runner's IAM (which is bucket-scoped) + the Aurora roles already grant compliance_writer INSERT/UPDATE on export_jobs (per 0070 migration).

### Deferred to Implementation

- **Exact SSM parameter names for any cross-Lambda lookups** — the runner only consumes env vars + Aurora secrets, no cross-Lambda invocation. No new SSM params expected.
- **Whether the platform alerts SNS topic is gated on an existing variable** — implementer wires the alarm action to the existing topic ARN if available, otherwise documents a follow-up.
- **Build-lambdas.sh BUNDLED_AGENTCORE_ESBUILD_FLAGS expansion** — verify whether the SDK clients the runner imports (S3 + s3-request-presigner + SQS) are in the existing allowlist.

---

## Output Structure

    terraform/modules/data/compliance-exports-bucket/
    ├── main.tf                              # bucket + lifecycle + IAM role + inline policies
    ├── variables.tf
    └── outputs.tf

    terraform/modules/app/lambda-api/
    ├── main.tf                              # MODIFY: SQS queue + DLQ + alarm; pass COMPLIANCE_EXPORTS_QUEUE_URL env
    ├── handlers.tf                          # MODIFY: standalone aws_lambda_function.compliance_export_runner; event source mapping
    └── variables.tf                         # MODIFY: 2 new vars

    terraform/modules/thinkwork/
    └── main.tf                              # MODIFY: instantiate compliance-exports-bucket module; pass outputs to app/lambda-api

    packages/lambda/
    └── compliance-export-runner.ts          # NEW: stub body throws not-implemented

    scripts/
    └── build-lambdas.sh                     # MODIFY: add build_handler "compliance-export-runner" entry

---

## Implementation Units

- U1. **Compliance-exports-bucket Terraform module + IAM role**

**Goal:** New module provisions the S3 bucket + IAM role for the runner. Inert (no Lambda assumes the role yet).

**Requirements:** R1, R2.

**Dependencies:** None.

**Files:**
- Create: `terraform/modules/data/compliance-exports-bucket/main.tf` (bucket + lifecycle + public-access-block + bucket policy + IAM role + inline allow policies + explicit-deny policy)
- Create: `terraform/modules/data/compliance-exports-bucket/variables.tf` (stage, account_id, region, bucket_name)
- Create: `terraform/modules/data/compliance-exports-bucket/outputs.tf` (bucket_name, bucket_arn, runner_role_arn, runner_role_name)

**Approach:**
- Bucket: `aws_s3_bucket`, `aws_s3_bucket_versioning` (suspended — not needed for ephemeral exports), `aws_s3_bucket_server_side_encryption_configuration` (SSE-S3), `aws_s3_bucket_public_access_block`, `aws_s3_bucket_lifecycle_configuration` (one rule, expiration days=7, prefix=""), `aws_s3_bucket_policy` (EnforceHTTPS only — no DenyDelete since 7-day expiration handles cleanup).
- IAM role: trust policy with aws:SourceAccount + aws:SourceArn pin to `arn:aws:lambda:${region}:${account_id}:function:thinkwork-${stage}-api-compliance-export-runner`. Inline policies: `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetObject`, `s3:GetObjectAttributes` on the bucket (path-scoped wildcard); `s3:ListBucket` on the bucket itself (multipart upload listing); explicit Deny on every other S3 ARN (`Resource = "*", NotResource = bucket_arn` shape).
- Outputs expose bucket_name + bucket_arn + runner_role_arn + runner_role_name for the app-tier wiring.

**Patterns to follow:**
- `terraform/modules/data/compliance-audit-bucket/main.tf` — module shape minus Object Lock + KMS.

**Test scenarios:**
- *Test expectation: none — Terraform-only module. Verification is `terraform validate` from the composite root.*

**Verification:**
- `terraform -chdir=terraform/examples/greenfield validate` clean.
- `terraform -chdir=terraform/examples/greenfield fmt -check` clean.

---

- U2. **lambda-api: SQS queue + DLQ + alarm + runner Lambda function + event source mapping**

**Goal:** Wire the SQS queue + DLQ + CloudWatch alarm in `app/lambda-api/main.tf`, the runner Lambda function + event source mapping in `app/lambda-api/handlers.tf`, and pass `COMPLIANCE_EXPORTS_QUEUE_URL` env to the graphql-http Lambda.

**Requirements:** R3, R4, R5, R6, R8, R9.

**Dependencies:** U1 (the bucket module's runner_role_arn output is consumed here).

**Files:**
- Modify: `terraform/modules/app/lambda-api/variables.tf` (add `compliance_exports_bucket_name`, `compliance_exports_runner_role_arn` vars)
- Modify: `terraform/modules/app/lambda-api/main.tf` (add `aws_sqs_queue.compliance_exports`, `aws_sqs_queue.compliance_exports_dlq`, `aws_cloudwatch_metric_alarm.compliance_exports_dlq_depth`; pass `COMPLIANCE_EXPORTS_QUEUE_URL` env to handlers env block)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add standalone `aws_lambda_function.compliance_export_runner` + `aws_lambda_event_source_mapping.compliance_exports`)

**Approach:**
- SQS queue: name `thinkwork-${var.stage}-compliance-exports`, visibility_timeout_seconds=900, message_retention_seconds=86400 (1 day), redrive_policy → DLQ with maxReceiveCount=3.
- DLQ: name `thinkwork-${var.stage}-compliance-exports-dlq`, message_retention_seconds=1209600 (14 days).
- Alarm: `aws_cloudwatch_metric_alarm` on `ApproximateNumberOfMessagesVisible` for the DLQ > 0 over 1 evaluation period of 60s; alarm action = existing platform alerts SNS topic (variable: `var.platform_alerts_topic_arn`, optional — alarm declared regardless, action attached only when present).
- Runner Lambda function: `count = local.use_local_zips ? 1 : 0`, name `thinkwork-${var.stage}-api-compliance-export-runner`, role = var.compliance_exports_runner_role_arn, handler="index.handler", runtime=local.runtime, timeout=900, memory_size=1024, reserved_concurrent_executions=2, filename + source_code_hash via `${var.lambda_zips_dir}/compliance-export-runner.zip`. Env: STAGE, AWS_NODEJS_CONNECTION_REUSE_ENABLED, COMPLIANCE_EXPORTS_BUCKET, COMPLIANCE_EXPORTS_QUEUE_URL, DATABASE_URL_SECRET_ARN (writer pool, same as graphql-http).
- Event source mapping: function_name = aws_lambda_function.compliance_export_runner[0].function_name, event_source_arn = aws_sqs_queue.compliance_exports.arn, batch_size=1, function_response_types=["ReportBatchItemFailures"], maximum_concurrency=2, enabled=true.
- graphql-http env: extend the existing handlers env block with `COMPLIANCE_EXPORTS_QUEUE_URL = aws_sqs_queue.compliance_exports.url`. The compliance-events Lambda (U6) does not need this — only the GraphQL HTTP API path.

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf` `aws_lambda_function.compliance_anchor` — standalone-resource shape.
- `terraform/modules/app/lambda-api/main.tf` — existing SQS queue blocks (job-trigger queue if any).

**Test scenarios:**
- *Test expectation: none — Terraform-only.*

**Verification:**
- `terraform -chdir=terraform/examples/greenfield validate` clean.
- `terraform -chdir=terraform/examples/greenfield plan` shows: 1 new bucket + IAM role + 4 inline policies, 2 new SQS queues, 1 new alarm, 1 new Lambda function, 1 new event source mapping. NO changes to unrelated handlers' env blocks (verify the diff).

---

- U3. **Composite-root wiring + stub Lambda body + build-lambdas.sh entry**

**Goal:** Instantiate the compliance-exports-bucket module at the composite root, pass outputs to lambda-api, ship a stub runner body so the function deploys.

**Requirements:** R7, R10, R11, R12.

**Dependencies:** U1, U2.

**Files:**
- Modify: `terraform/modules/thinkwork/main.tf` (instantiate `module.compliance_exports_bucket`; pass `compliance_exports_bucket_name`, `compliance_exports_runner_role_arn` to `module.app.lambda_api`)
- Create: `packages/lambda/compliance-export-runner.ts` (stub: throws not-implemented)
- Modify: `scripts/build-lambdas.sh` (add `build_handler "compliance-export-runner"` entry; verify BUNDLED_AGENTCORE_ESBUILD_FLAGS for the runner's SDK imports)

**Approach:**
- Composite root: instantiate `module.compliance_exports_bucket` early (no dependency on KMS); pass its outputs as variables to `module.app.lambda_api`. Wire bucket_name + runner_role_arn.
- Stub Lambda body: 30-line file with module-load env snapshot via `getRunnerEnv()` (forward-compat with U11.U3) and a handler that throws `new Error("compliance-export-runner: not implemented yet — U11.U3 ships the live body")`. Imports nothing from `@aws-sdk/*` yet — keeps the inert phase's bundle small and confirms BUNDLED_AGENTCORE_ESBUILD_FLAGS isn't immediately required.
- build-lambdas.sh entry: mirror the `compliance-anchor` shape. The U11.U3 PR adds the SDK imports + flags expansion when needed.

**Patterns to follow:**
- `terraform/modules/thinkwork/main.tf` — composite-root pattern for U7's compliance-audit-bucket wiring.
- `packages/lambda/compliance-anchor.ts` — module-load env snapshot.
- `scripts/build-lambdas.sh` — `build_handler` entry pattern.

**Test scenarios:**
- *Test expectation: none — Terraform + stub Lambda; live behavior is U11.U3.*

**Verification:**
- `terraform -chdir=terraform/examples/greenfield validate` clean.
- `bash scripts/build-lambdas.sh compliance-export-runner` produces `dist/lambdas/compliance-export-runner/index.mjs`.
- `pnpm typecheck` from repo root clean.

---

- U4. **Verify + commit + push + ce-code-review autofix + open PR**

**Goal:** Repo-wide typecheck + `terraform validate` + `terraform fmt -check` + commit + push + ce-code-review autofix + open PR documenting the inert-substrate gate.

**Requirements:** R1-R12 (verification across the surface).

**Dependencies:** U1, U2, U3.

**Files:** No new files; verification + ship pass.

**Approach:**
- `pnpm typecheck` from root clean.
- `bash scripts/build-lambdas.sh compliance-export-runner` clean.
- `terraform -chdir=terraform/examples/greenfield validate` + `fmt -check` clean.
- Commit conventional message + push.
- Run ce-code-review autofix.
- Open PR documenting the inert phase: after this merges + dev deploys, the U11.U1 mutation succeeds end-to-end with messages landing in SQS, but the runner is inert (DLQ catches after 3 attempts). U11.U3 swaps in the live body.

**Test scenarios:**
- *Test expectation: none for unit-level coverage. The Terraform validate + plan IS the test.*

**Verification:**
- All checks pass.
- PR opened, CI green on the standard 5 checks.

---

## System-Wide Impact

- **Interaction graph:** New Terraform module + 2 new SQS queues + 1 new Lambda function + 1 new event source mapping + 1 new IAM role + 1 new alarm. No changes to existing handlers' code; their env blocks gain one new var (`COMPLIANCE_EXPORTS_QUEUE_URL`).
- **Error propagation:** Runner Lambda crashes → SQS retries up to 3x → DLQ → alarm → human inspects. The U11.U1 mutation already handles SendMessage failures (job marked FAILED + INTERNAL_SERVER_ERROR thrown).
- **State lifecycle risks:** Bucket lifecycle expiration is the only cleanup mechanism for export artifacts — 7-day TTL covers the SOC2 window. SQS DLQ retention is 14 days; operator must drain manually.
- **API surface parity:** No GraphQL changes. No REST changes.
- **Integration coverage:** Pre-merge: `terraform validate` + `terraform plan` against an existing dev workspace. Post-merge: dev deploy + verify the U11.U1 mutation succeeds end-to-end (queued message visible in SQS console; job stays QUEUED forever because runner is inert).
- **Unchanged invariants:** No changes to compliance.audit_events / outbox / anchor pipelines. No changes to U10 read API. No GraphQL schema changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| BUNDLED_AGENTCORE_ESBUILD_FLAGS doesn't include the runner's SDK imports | Stub body has no SDK imports yet — discover the need at U11.U3 when the live body adds them |
| Standalone Lambda function deploys before its env vars are populated | Terraform applies env + function in one plan; no race |
| Per-key blast radius unintentionally widens shared lambda role | Standalone resource means the runner has its own role; the shared lambda role is untouched |
| Operator forgets to apply this PR before U11.U3 merges | Plan dependency ordering enforces it; PR body documents the gate |
| Runner role's bucket allow grants accidentally include other buckets | Inline policy resource is path-scoped to the new bucket arn + explicit-Deny on all other S3 ARNs via NotResource (defense-in-depth) |
| 7-day expiration deletes an in-flight export's S3 object before download | 15-min Lambda timeout means objects exist for at most 15 min before completion; 7 days is the auditor download window |
| DLQ alarm noise from legitimate runtime errors | Runner's design writes FAILED to DB on business errors so messages ack successfully; DLQ-bound messages are reserved for handler crashes |
| Stub Lambda body silently no-ops queued messages | Stub explicitly throws; messages re-enqueue + land in DLQ; alarm signals the inert state visibly |

---

## Documentation / Operational Notes

- **Pre-merge:** `terraform plan` against the dev workspace to verify only U11.U2-introduced resources land. No migrations, no Lambda redeploys outside the new function, no SSM parameter changes.
- **Post-merge:** dev deploy. Verify in console: new SQS queue + DLQ visible, new Lambda function deployed, new bucket created, U11.U1 mutation creates a queued message in the SQS queue.
- **Cognito CallbackURLs:** No change.
- **Operator runbook:** N/A; runner is still inert. U11.U3 PR adds the runbook entry.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md` (U11 plan, U2 unit).
- **Master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U11 entry).
- **U11.U1 PR:** #944 (merged on origin/main).
- **Module reference:** `terraform/modules/data/compliance-audit-bucket/`.
- **Lambda standalone-resource reference:** `terraform/modules/app/lambda-api/handlers.tf` (compliance_anchor block).
- **Build script reference:** `scripts/build-lambdas.sh`.
- **Institutional learnings:** `feedback_ship_inert_pattern`, `feedback_lambda_zip_build_entry_required`, `project_async_retry_idempotency_lessons`.
