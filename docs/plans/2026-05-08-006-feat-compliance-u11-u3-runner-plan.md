---
title: U11.U3 — live compliance export runner Lambda body
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md
---

# U11.U3 — Live Export Runner

## Summary

Replace the U11.U2 stub `packages/lambda/compliance-export-runner.ts` with the live runner: SQS handler reads `{jobId}`, performs a CAS guard `QUEUED → RUNNING`, opens a `pg.Cursor` against `compliance.audit_events` with the row's filter, streams CSV / NDJSON to S3 via `@aws-sdk/lib-storage`, generates a 15-minute presigned URL via `@aws-sdk/s3-request-presigner`, marks the job `COMPLETE` with `s3_key`/`presigned_url`/`presigned_url_expires_at`, or `FAILED` with `job_error` on any error. Adds vitest integration tests + post-deploy smoke + GHA workflow gate.

After this PR + dev deploy, the U11.U1 mutation runs end-to-end: queue message → runner streams the slice → presigned URL appears on the job row. U11.U4 wires the admin Exports UI on top.

---

## Problem Frame

U11.U2 (PR #948, merged) provisioned the SQS queue + bucket + Lambda function with a stub body that throws. Queued jobs accumulate → DLQ → depth alarm fires (operator-visible inert state). This PR swaps in the live runner so jobs actually complete. See origin: `docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md`.

---

## Requirements

- R1. SQS handler signature `async (event: SQSEvent): Promise<SQSBatchResponse>` per AWS Lambda partial-failure protocol (function_response_types `ReportBatchItemFailures` was wired in U11.U2).
- R2. CAS guard via `UPDATE compliance.export_jobs SET status='running', started_at=now() WHERE job_id=$1 AND status='queued'`. If 0 rows updated, the job is already running/done — log + skip without throwing (re-deliveries are no-ops).
- R3. Server-side `pg.Cursor` against `compliance.audit_events` with filter from the row. Stream batches of 1000 rows so memory stays bounded for million-row exports.
- R4. CSV writer: 30-line inline RFC 4180 implementation. Header row first; per-row quote when value contains `"`, `,`, `\r`, or `\n`; double internal `"`. Columns: `event_id, tenant_id, occurred_at, recorded_at, actor, actor_type, source, event_type, event_hash, prev_hash, payload_json`.
- R5. NDJSON writer: one JSON object per line, `\n` separator (no trailing newline acceptable).
- R6. S3 multipart upload via `@aws-sdk/lib-storage`'s `Upload` class. Key `${tenantId}/${jobId}.${ext}` for tenant-scoped jobs, `multi-tenant/${jobId}.${ext}` when `tenant_id == ALL_TENANTS_SENTINEL`.
- R7. On success: `GetObjectCommand` presigned URL with 15-minute expiry via `@aws-sdk/s3-request-presigner`. Update job → `complete` with `s3_key`, `presigned_url`, `presigned_url_expires_at = now() + interval '15 minutes'`, `completed_at = now()`.
- R8. On failure: catch at the top of the handler. Update job → `failed` with `job_error = <message>`, `completed_at = now()`. **Return success on the SQS message** (don't throw — the runner's CAS guard makes re-delivery harmless but useless; we'd rather not bounce to the DLQ on business failures the runner already recorded). Handler re-throws on a Bad-Request shape (malformed SQS body) so it lands in the DLQ.
- R9. Module-load env snapshot via `getRunnerEnv()` (already shipped in U11.U2 stub) — never re-read inside the handler. Pass the env object into helpers explicitly.
- R10. Build entry already in `scripts/build-lambdas.sh` (U11.U2). Switch to `BUNDLED_AGENTCORE_ESBUILD_FLAGS` because `@aws-sdk/lib-storage` and `@aws-sdk/s3-request-presigner` aren't in the Lambda default runtime SDK.
- R11. Vitest integration test at `packages/lambda/__tests__/integration/compliance-export-runner.integration.test.ts` covering: happy CSV path, happy NDJSON path, empty result set, CAS guard re-delivery no-op, malformed SQS body throws, S3 upload failure marks job failed, presigned URL is non-empty + expires_at populated.
- R12. Post-deploy smoke at `packages/api/src/__smoke__/compliance-export-runner-smoke.ts` + shell wrapper at `scripts/post-deploy-smoke-compliance-export-runner.sh`. Smoke: invoke `createComplianceExport` with a tiny filter against dev API, poll the listing query until status=`complete`, fetch the presigned URL, validate the artifact is parseable. Caps at 60s; fails CI if status doesn't transition.
- R13. New `compliance-export-runner-smoke` job in `.github/workflows/deploy.yml` — runs after dev deploy + after `compliance-anchor-smoke`. Gated on stage=dev.
- R14. README inline note in `packages/lambda/compliance-export-runner.ts` documenting the runner's contract, error model, and re-delivery semantics.

---

## Scope Boundaries

- AppSync subscription for live job-status updates — out of scope (v1 polling at 3s, U11.U4).
- Glue / Athena fallback for >1M-row exports — out of scope; 90-day filter cap is the practical ceiling.
- Email notification on COMPLETE — out of scope.
- Customer-managed KMS for the exports bucket — out of scope; SSE-S3 is the v1 default.

### Deferred to Follow-Up Work

- **U11.U4** — admin SPA Exports page (table + dialog + 3s polling + Download button).
- **U11.U5** — final SOC2 export rehearsal + README runbook.

---

## Context & Research

### Relevant Code and Patterns

- `packages/lambda/compliance-anchor.ts` — module-load env snapshot, lazy pg client, structured logging, S3 SDK usage. The runner mirrors the env-snapshot + lazy-client pattern.
- `packages/api/src/lib/compliance/reader-db.ts` — pg client cache + Secrets Manager resolution. The runner uses the writer pool (DATABASE_URL_SECRET_ARN) but the cache pattern is reusable.
- `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts` — integration test shape (DB-backed via DATABASE_URL).
- `packages/api/src/__smoke__/compliance-anchor-smoke.ts` — smoke shape.
- `scripts/post-deploy-smoke-compliance-anchor.sh` — shell wrapper shape.
- `.github/workflows/deploy.yml` — `compliance-anchor-smoke` job shape.
- `scripts/build-lambdas.sh` — `build_handler` invocation; the BUNDLED_AGENTCORE_ESBUILD_FLAGS list shows which SDK clients are externalized vs bundled.

### Institutional Learnings

- `feedback_completion_callback_snapshot_pattern` — Snapshot env at coroutine entry; never re-read mid-handler.
- `project_async_retry_idempotency_lessons` — For SQS-driven non-idempotent loops, set `MaximumRetryAttempts=0` + DLQ + CAS. The runner gets the equivalent posture via the CAS guard + ReportBatchItemFailures.
- `feedback_smoke_pin_dispatch_status_in_response` — Smoke pins on the listing query's status field, NOT on log filtering.
- `feedback_lambda_zip_build_entry_required` — Already shipped in U11.U2.

### External References

- AWS Lambda + SQS partial batch failure docs: `function_response_types=["ReportBatchItemFailures"]` returns `batchItemFailures: [{itemIdentifier}]`.
- `@aws-sdk/lib-storage` Upload class: handles multipart automatically; `partSize >= 5MB`.
- `@aws-sdk/s3-request-presigner` `getSignedUrl(client, command, {expiresIn: 900})` produces a 15-min URL.

---

## Key Technical Decisions

- **Don't throw on business errors.** Return SQS success after writing FAILED to DB. Re-delivery via CAS guard is benign (no-op). DLQ is reserved for handler crashes (malformed SQS body, env vars empty, etc.).
- **Single-record batches.** `batch_size=1` was set in U11.U2; one record per invocation simplifies the partial-failure protocol — no batch loop, just one job.
- **`pg.Cursor` for streaming.** Avoids OOM on million-row exports while keeping DB roundtrips bounded. Read 1000 rows per `cursor.read()` batch.
- **`Upload` from `@aws-sdk/lib-storage` instead of manual multipart.** Handles partition + concurrency + abort-on-failure automatically. For exports < 5MB it falls through to single PutObject.
- **CSV inline writer (30 LOC) over `csv-stringify`.** Avoids new dep + the bundle expansion. RFC 4180 compliant.
- **Bundled flags for the runner build.** `lib-storage` + `s3-request-presigner` aren't in the Lambda runtime SDK; bundle them. `@aws-sdk/client-s3` + `@aws-sdk/client-secrets-manager` stay externalized (Lambda runtime provides them).
- **Use the writer DB pool, not a dedicated `compliance_exporter` Aurora role.** The runner is the only consumer; the IAM bucket grant + CAS guard scope its blast radius. A third role + secret + bootstrap-script extension is over-engineering at v1.
- **Filter validation lives in the resolver, not the runner.** The runner trusts the row's filter shape. If the row has a malformed filter (operator manually inserted invalid JSON), the cursor query fails → handler catches → job marked failed.

---

## Open Questions

### Resolved During Planning

- **One presigned URL, or refresh?** One; UI shows "URL expired" past `presigned_url_expires_at` and prompts re-export. v1 simplicity.
- **CSV column order?** `event_id, tenant_id, occurred_at, recorded_at, actor, actor_type, source, event_type, event_hash, prev_hash, payload_json`. Matches `complianceEvents` GraphQL field set.
- **`payload_json` escape?** `JSON.stringify(payload)` produces single-line; CSV-quote the whole thing. Multi-byte UTF-8 is byte-safe through Buffer.

### Deferred to Implementation

- **Exact integration test fixtures** — 3 sample audit events seeded inline; the test inserts then asserts the artifact contents.
- **Smoke timeout** — 60s with 3s poll; tunable if dev exports run longer.

---

## Implementation Units

- U1. **Live runner Lambda body**

**Goal:** Replace stub with live body. Module-load env snapshot retained. CAS guard + cursor stream + S3 upload + presigned URL + status update.

**Requirements:** R1-R9.

**Dependencies:** None (U11.U2 substrate is on origin/main).

**Files:**
- Modify: `packages/lambda/compliance-export-runner.ts`
- Modify: `packages/lambda/package.json` (add `@aws-sdk/lib-storage` + `@aws-sdk/s3-request-presigner` + `pg` deps)

**Approach:** As described above.

**Test scenarios:** Covered in U2.

**Verification:** `pnpm --filter @thinkwork/lambda typecheck` clean.

---

- U2. **Integration test + build-script flags**

**Goal:** Vitest integration test + flip the runner to `BUNDLED_AGENTCORE_ESBUILD_FLAGS`.

**Requirements:** R10, R11.

**Dependencies:** U1.

**Files:**
- Create: `packages/lambda/__tests__/integration/compliance-export-runner.integration.test.ts`
- Modify: `scripts/build-lambdas.sh`

**Verification:** `pnpm --filter @thinkwork/lambda test` clean (DB-backed integration tests skip cleanly without `DATABASE_URL`); `bash scripts/build-lambdas.sh compliance-export-runner` produces a working zip.

---

- U3. **Smoke + GHA workflow + verify + ship**

**Goal:** Post-deploy smoke + GHA gate + commit + push + ce-code-review autofix + open PR.

**Requirements:** R12, R13, R14.

**Dependencies:** U1, U2.

**Files:**
- Create: `packages/api/src/__smoke__/compliance-export-runner-smoke.ts`
- Create: `scripts/post-deploy-smoke-compliance-export-runner.sh`
- Modify: `.github/workflows/deploy.yml`

**Verification:** Repo-wide typecheck clean. Smoke shell script syntax-checks (`bash -n`).

---

## Sources & References

- **Origin plan:** `docs/plans/2026-05-08-004-feat-compliance-u11-export-plan.md` (U11 plan, U3 unit).
- **U11.U2 PR:** #948 (merged on origin/main).
- **U11.U1 PR:** #944 (merged on origin/main).
- **Anchor Lambda reference:** `packages/lambda/compliance-anchor.ts`.
- **Smoke shape reference:** `packages/api/src/__smoke__/compliance-anchor-smoke.ts`.
