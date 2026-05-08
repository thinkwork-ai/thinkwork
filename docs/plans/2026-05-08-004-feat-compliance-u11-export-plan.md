---
title: U11 — async compliance export job + admin Exports page
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# U11 — Async Compliance Export

## Summary

Final unit of the compliance audit-event arc. Adds an async CSV/NDJSON export of filtered audit events: a GraphQL mutation queues a job, an SQS-triggered runner Lambda streams events to a 7-day-lifecycle S3 bucket, the admin SPA polls and surfaces a presigned download link. Each export emits its own `data.export_initiated` audit event, completing the self-auditing loop.

---

## Problem Frame

SOC2 walkthroughs need an exportable artifact (CSV/NDJSON) of the audit events filtered to the auditor's date range and event-type slate. The U10 admin browse is for live navigation; the export is for archival evidence the auditor takes with them. Synchronous resolver-time export would block the GraphQL Lambda's 30s timeout for any non-trivial slice. Async with presigned-URL delivery is the standard pattern; this plan implements it as the last of 11 master-plan units.

See origin: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (master plan, U11 entry).

---

## Requirements

- R1. New table `compliance.export_jobs` tracks job state across `queued → running → complete | failed`. Hand-rolled migration `0075_compliance_export_jobs.sql` with canonical prologue + `-- creates:` markers. Operator must `psql -f` to dev before merge per institutional pattern.
- R2. Mutation `createComplianceExport(filter, format)`: validates filter (max 90-day window, max 4 KB serialized), checks rate limit (10 exports / hour per requesting email), inserts `compliance.export_jobs` row in `QUEUED` state, sends SQS message with `{ jobId }`, emits `data.export_initiated` audit event with the filter as payload, returns the job. Typed errors: `RATE_LIMIT_EXCEEDED`, `FILTER_RANGE_TOO_WIDE`, `FILTER_TOO_LARGE`.
- R3. Query `complianceExports` returns the caller's recent jobs (LIMIT 50, sorted `requested_at DESC`). Operators see all tenants; non-operators are tenant-scoped via the existing `requireComplianceReader` auth. Reuses the U10 auth helper without forking.
- R4. SQS-triggered runner Lambda (`packages/lambda/compliance-export-runner.ts`):
  - Reads `{ jobId }` from the SQS event (single-record batch, `MaximumRetryAttempts=0`, DLQ catches poison).
  - Updates job → `RUNNING`, `started_at = now()`.
  - Streams from `compliance.audit_events` using a server-side cursor (`pg.Cursor`) to avoid loading all rows into memory.
  - Writes to S3 multipart upload, key `${tenantId}/${jobId}.${ext}` (or `multi-tenant/${jobId}.${ext}` when operator + cross-tenant).
  - On completion: generates 15-min presigned `GetObject` URL, updates job → `COMPLETE`, sets `s3_key`, `presigned_url`, `presigned_url_expires_at`, `completed_at`.
  - On failure: updates job → `FAILED` with `error_message`. Does NOT throw out of the SQS handler (would re-enqueue; we want one shot only).
- R5. New Terraform module `terraform/modules/data/compliance-exports-bucket/` provisions:
  - S3 bucket with 7-day lifecycle expiration (NOT Object Lock — exports are ephemeral).
  - Public access block, SSE-S3 encryption, versioning suspended.
  - IAM role for the runner Lambda: `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetObject` (for presigned URL signing) on this bucket only; explicit deny on every other S3 bucket.
- R6. New SQS queue `thinkwork-${stage}-compliance-exports` + DLQ `thinkwork-${stage}-compliance-exports-dlq` (max 14-day retention; alarm on DLQ depth > 0).
- R7. Runner Lambda handler entry in `terraform/modules/app/lambda-api/handlers.tf` as a standalone resource (NOT in the for_each pool — isolates blast radius from the 60+ unrelated handlers, mirrors the U8a anchor Lambda pattern). `event_source_mapping` wires the SQS queue → handler. `MaximumRetryAttempts = 0` on the function.
- R8. Build entry in `scripts/build-lambdas.sh`. The runner imports `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs` — likely needs the BUNDLED_AGENTCORE_ESBUILD_FLAGS list expansion (verify in implementation).
- R9. Admin Exports page at `apps/admin/src/routes/_authed/_tenant/compliance/exports/index.tsx`:
  - "Request export" button opens a dialog with: format radio (CSV / NDJSON), filter summary preview (read from URL `?from=current-filter` if present), date range pickers.
  - Table of jobs: status badge (with icon — green CheckCircle for COMPLETE, amber Loader2 for QUEUED/RUNNING, red AlertCircle for FAILED), requested at (relativeTime), format, filter summary, action column (Download when COMPLETE + URL not expired; "Re-export" when expired or FAILED).
  - Polling at 3s interval ONLY when at least one job is in QUEUED or RUNNING state; otherwise render once and stop.
  - Pre-select the current `?range=` / `?since=` / `?until=` filter when navigating from the events list "Export this view" button.
- R10. New "Export" button on the events list page header (apps/admin/src/routes/_authed/_tenant/compliance/index.tsx) → `Link` to `/compliance/exports?from=current-filter` so the URL state carries the filter into the export dialog.

**Origin requirements:** Master plan §U11 maps onto R1-R10 here. R9-R10 (admin page + entry point) split out from origin's single "Admin Exports page" requirement to make sequencing clear.

---

## Scope Boundaries

- AppSync subscription for live job status — out of scope; v1 polling at 3s is sufficient.
- Glue / Athena for >1M-row exports — out of scope; the 90-day filter cap + 1M-event practical ceiling keeps Lambda within its 15-min timeout.
- Mobile compliance export browse — admin-tier only.
- Per-format styling (Excel-friendly column ordering, CSV BOM for spreadsheet apps) — v1 is auditor-friendly NDJSON-and-CSV; cosmetic polish deferred.
- Dedicated Aurora role `compliance_exporter` — extending `compliance_reader` is enough for v1; the runner uses the same SELECT path as the read API plus job-table UPDATE which is granted to the writer pool.
- Encryption at rest with customer-managed KMS — v1 uses SSE-S3; CMK is a future hardening pass per the same pattern as compliance-audit-bucket.

### Deferred to Follow-Up Work

- **Re-export retry button** when a job is FAILED — clones the filter into a new request. UI affordance, no backend change. Cheap follow-up.
- **Email notification when COMPLETE** — would let auditors close the SPA tab during a long export. Requires SES wiring; deferred.
- **CSV column-ordering control** — auditors may want fields reordered for spreadsheet ergonomics; default ordering matches the GraphQL field set.

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/drizzle/0074_compliance_event_hash_index.sql` — canonical hand-rolled migration shape with `-- creates:` markers + operator pre-merge step header.
- `packages/database-pg/drizzle/0069_compliance_schema.sql` lines 200-215 — `compliance.audit_events` table + indexes the runner queries against.
- `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` — `compliance_reader` role + GRANT pattern. Extending grants to the new table goes here in shape.
- `packages/api/src/lib/compliance/resolver-auth.ts` — `requireComplianceReader` + `isPlatformOperator`. The mutation reuses both unchanged.
- `packages/api/src/graphql/resolvers/compliance/query.ts` — resolver shape (lazy pg client, sslmode=require, microsecond-fidelity timestamptz, etc.).
- `packages/lambda/compliance-anchor.ts` — module-load env snapshot pattern via `getAnchorEnv()`. The runner mirrors this for `getRunnerEnv()`.
- `packages/lambda/compliance-anchor.ts` lines 1-50 — `MaximumRetryAttempts=0` + DLQ pattern (per `project_async_retry_idempotency_lessons`).
- `terraform/modules/data/compliance-audit-bucket/` — module shape for the new exports bucket (variables.tf + main.tf + outputs.tf). Differences: 7-day lifecycle vs Object Lock; no per-cadence prefix policy.
- `terraform/modules/app/lambda-api/handlers.tf` lines for `aws_lambda_function.compliance_anchor` — standalone resource pattern. The runner mirrors this shape.
- `scripts/build-lambdas.sh` lines 150-160 — `build_handler "compliance-anchor" ...` entry shape.
- `apps/admin/src/components/compliance/ComplianceFilterBar.tsx` — filter shape + range presets. The export dialog pre-fills from this.
- `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` — list page with PageHeader + Outlet pattern. The Exports page mirrors this shape.

### Institutional Learnings

- `project_async_retry_idempotency_lessons` — Lambda Event invokes default to 2 retries; for non-idempotent SQS-driven loops set `MaximumRetryAttempts = 0` + DLQ + CAS (here: status guard in UPDATE).
- `feedback_handrolled_migrations_apply_to_dev` — the `psql -f` to dev is required before merge or the deploy drift gate fails. The U10 PR followed the pattern; this PR repeats it for `0075`.
- `feedback_completion_callback_snapshot_pattern` — Snapshot env at coroutine entry; never re-read `os.environ` mid-handler.
- `feedback_lambda_zip_build_entry_required` — every new Lambda needs both Terraform handlers.tf + scripts/build-lambdas.sh entry; missing the second blocks every deploy with `filebase64sha256` error.
- `feedback_avoid_fire_and_forget_lambda_invokes` — User-driven create/update mutations must use RequestResponse for direct invokes. SQS message-send is async-by-design here, so this rule does not apply to the queue dispatch — but the mutation must check the SQS send response and surface failures synchronously rather than returning success on a queue write that never landed.
- `feedback_smoke_pin_dispatch_status_in_response` — the mutation should return the queued status in the response payload so smokes can pin it.

### External References

None — every required pattern has a precedent in this repo. AWS S3 multipart-upload + presigned-URL signing are documented in `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; established APIs.

---

## Key Technical Decisions

- **CSV streaming via inline writer, NOT a heavyweight CSV library.** The shape is 13 columns: `event_id, tenant_id, occurred_at, recorded_at, actor, actor_type, source, event_type, event_hash, prev_hash, payload_json, anchor_state, anchor_cadence_id`. A 30-line inline writer (RFC 4180-compliant: quote when value contains `,` `"` or newline; double internal `"`) is simpler than `csv-stringify` and avoids the SDK-bundle expansion. NDJSON is `JSON.stringify(row) + "\n"` per row — trivial.
- **Server-side pg cursor** via `client.query(new Cursor("SELECT ..."))`. Streams 1000 rows per `cursor.read()` batch. Avoids OOM on million-event exports while keeping DB roundtrips bounded.
- **S3 multipart upload** for any export > 5 MB. Use `@aws-sdk/lib-storage`'s `Upload` class — handles partitioning, concurrency, and abort on failure. For exports < 5 MB, single PutObject is fine; let `Upload` decide.
- **Single SQS queue + DLQ** (no FIFO). Ordering doesn't matter — each job is independently identified by jobId. FIFO would force per-tenant message-group-id complexity for negligible benefit.
- **`MaximumRetryAttempts = 0`** on the SQS event-source mapping. Failed jobs fall to the DLQ + the runner already wrote `FAILED` status to the DB before the SQS message acks (so the DLQ is just a poison-message sink for handler crashes). Runner code is "no throw on business failure" so SQS sees success on FAILED status writes.
- **Rate limit via DB query, not Redis.** `SELECT count(*) FROM compliance.export_jobs WHERE requested_by_user_email = $email AND requested_at > now() - INTERVAL '1 hour'`. Index on `(requested_by_user_email, requested_at DESC)` makes this O(log n). Adding Redis for one rate-limit check is over-engineering at v1 scale (one-digit operators).
- **Filter validation: 90-day cap + 4 KB filter byte cap + 1M event soft estimate.** First two are deterministic checks; the soft estimate uses `EXPLAIN (FORMAT JSON) SELECT count(*)` against the planner's row estimate. Skip the COUNT estimate at v1 — the 90-day cap implicitly caps row volume given current dev tenant sizes; revisit if production tenants regularly fill the window.
- **Reuse `requireComplianceReader` for both mutation and query.** The auth model is identical (operator vs tenant-scoped). The runner's pg client uses the writer pool (DATABASE_URL) since it's writing to `compliance.export_jobs`; the SELECT against `compliance.audit_events` does not require the reader role for an operator-scoped service principal. Document the tradeoff: runner has full DB access by virtue of the writer pool, BUT the runner Lambda is the only consumer of its IAM role and the role's S3 grants restrict export persistence to the new bucket only.
- **S3 key format `${tenantId}/${jobId}.${ext}`** for tenant-scoped jobs; **`multi-tenant/${jobId}.${ext}`** for operator + no-tenant-filter jobs. Bucket policy enforces no cross-key access for the runner role beyond `${jobId}.${ext}` prefix matches; the path scoping is for human ops legibility.
- **Audit event payload contains the filter** (with the requesting user's email already in `actor` field). Stored verbatim — auditors can later see "this auditor exported these slices on these dates," which is itself the meta-audit trail.
- **No client-side filter validation** — the server is the source of truth. Mutation rejects bad filters with typed errors; the dialog surfaces them via the existing GraphQL error path. Avoids drift between client-only and server-side rules.
- **Polling cadence 3 seconds** — fast enough that auditors don't refresh, slow enough to not hammer GraphQL. Stops once no jobs are QUEUED/RUNNING; resumes on user action.
- **Today's date: 2026-05-08** for any test-fixture relative-time display.

---

## Open Questions

### Resolved During Planning

- **One mutation invocation per export, or batch?** One per export — the SQS dispatch is per-job, and the rate limit is a hard 10/hour ceiling.
- **Tenant in S3 key for operator + cross-tenant export?** `multi-tenant/${jobId}` prefix for operator exports; per-tenant prefix otherwise. Operators can read both via the runner's IAM grant; non-operators only see their own jobs in the listing query so the prefix doesn't leak.
- **Presigned URL refresh?** UI detects expiry via `presigned_url_expires_at` < now and shows "URL expired — re-export" rather than refreshing. v1 simplicity; auditors typically download immediately on completion.
- **Should the runner write to the writer DB pool or a new exporter role?** Writer pool — adding a third Aurora role (compliance_exporter) for one consumer is over-engineering when the runner is the only writer of `compliance.export_jobs` and the IAM bucket grant scopes its blast radius.

### Deferred to Implementation

- **Specific column ordering in CSV** — implementer picks; convention is `event_id` first, `payload_json` last.
- **`payload_json` column escape** — JSON.stringify the AWSJSON, then CSV-quote the whole thing. Works because `JSON.stringify` produces a single line with no newlines.
- **Error UI for FAILED jobs** — implementer picks between inline error message in the table cell vs a "View error" expander. Default: inline truncated message + tooltip with full text.
- **Dialog vs inline form for export request** — implementer picks based on what's already in the admin SPA. shadcn `Dialog` is the obvious choice.
- **Date-range picker component** — reuse the existing datetime-local inputs from ComplianceFilterBar (UTC-anchored after the U10 autofix).
- **Whether to surface the operator's 1-hour rate-limit window in the UI proactively** (e.g., "8/10 exports used") — defer; the rate-limit error is clear enough as feedback.

---

## Output Structure

    packages/database-pg/
    ├── drizzle/
    │   └── 0075_compliance_export_jobs.sql       # NEW: hand-rolled migration
    └── graphql/types/
        └── compliance.graphql                     # MODIFY: add ComplianceExport, mutation, query

    packages/api/src/graphql/resolvers/compliance/
    ├── exports.ts                                  # NEW: createComplianceExport mutation + complianceExports query
    └── index.ts                                    # MODIFY: register the new resolvers

    packages/api/src/lib/compliance/
    └── export-rate-limit.ts                        # NEW: 10/hour DB query helper

    packages/api/test/integration/
    └── compliance-exports.test.ts                  # NEW: mutation + query + rate-limit + audit-event integration

    packages/lambda/
    ├── compliance-export-runner.ts                 # NEW: SQS-triggered runner
    └── __tests__/integration/
        └── compliance-export-runner.integration.test.ts  # NEW: runner body tests

    packages/api/src/__smoke__/
    └── compliance-exports-smoke.ts                 # NEW: post-deploy smoke

    terraform/modules/data/compliance-exports-bucket/
    ├── main.tf                                     # NEW: bucket + lifecycle + IAM
    ├── variables.tf                                # NEW
    └── outputs.tf                                  # NEW

    terraform/modules/app/lambda-api/
    ├── handlers.tf                                 # MODIFY: standalone runner Lambda + event_source_mapping
    ├── variables.tf                                # MODIFY: 3 new vars (bucket arn, sqs arn, runner role arn)
    └── main.tf                                     # MODIFY: pass env vars (EXPORTS_BUCKET, EXPORTS_SQS_URL)

    terraform/modules/thinkwork/
    └── main.tf                                     # MODIFY: wire compliance-exports-bucket → app/lambda-api

    scripts/
    ├── build-lambdas.sh                            # MODIFY: build_handler "compliance-export-runner"
    └── post-deploy-smoke-compliance-exports.sh     # NEW

    .github/workflows/
    └── deploy.yml                                  # MODIFY: compliance-exports-smoke job

    apps/admin/src/
    ├── lib/compliance/
    │   └── export-queries.ts                       # NEW: createComplianceExport mutation + complianceExports query
    ├── components/compliance/
    │   └── ComplianceExportDialog.tsx              # NEW: format + filter preview
    └── routes/_authed/_tenant/compliance/
        ├── exports/
        │   └── index.tsx                           # NEW: Exports page with table + dialog + polling
        └── index.tsx                               # MODIFY: "Export this view" button in PageHeader actions

---

## Implementation Units

- U1. **Migration + GraphQL schema + resolvers + rate-limit helper**

**Goal:** Hand-rolled `compliance.export_jobs` migration; GraphQL type + mutation + query; resolver implementation with auth reuse + rate limit + filter validation; audit-event emission. Lands as one PR-able cluster because the GraphQL surface is meaningless without the table and pointless without the resolvers.

**Requirements:** R1, R2, R3.

**Dependencies:** None — backend-first land enables the runner Lambda to wire against a stable contract.

**Files:**
- Create: `packages/database-pg/drizzle/0075_compliance_export_jobs.sql` (canonical prologue + `-- creates: compliance.export_jobs` markers + table + indexes + GRANT extensions for compliance_reader)
- Modify: `packages/database-pg/graphql/types/compliance.graphql` (add `ComplianceExportFormat`, `ComplianceExportStatus`, `ComplianceExport` type, `Mutation.createComplianceExport`, `Query.complianceExports`)
- Create: `packages/api/src/graphql/resolvers/compliance/exports.ts` (mutation + query)
- Modify: `packages/api/src/graphql/resolvers/compliance/index.ts` (register new resolvers)
- Create: `packages/api/src/lib/compliance/export-rate-limit.ts` (helper: `await checkExportRateLimit(client, email)` → `{allowed, remaining, retryAfter}`)
- Create: `packages/api/test/integration/compliance-exports.test.ts`

**Approach:**
- Migration: `compliance.export_jobs` with columns documented above (Summary). Indexes: `(requested_by_user_email, requested_at DESC)` for rate-limit, `(tenant_id, requested_at DESC)` for the listing query, `(status, requested_at)` partial index where `status IN ('QUEUED','RUNNING')` for the polling query. CHECK constraints on `status`, `format`. GRANT SELECT/INSERT/UPDATE on `compliance.export_jobs` to `compliance_reader` (extending the role; see `0070_compliance_aurora_roles.sql` for the pattern).
- GraphQL schema: types follow the `complianceEvents` shape. `filter` is reused from `ComplianceEventFilter` so the UI passes the same shape it uses for the read API — no duplication. The mutation result includes the inserted job (with QUEUED status); the query is a plain `[ComplianceExport!]!`.
- Mutation: validate filter (call shared validator that enforces 90-day cap + 4 KB serialized cap → throws typed errors), call `requireComplianceReader(ctx, args.filter.tenantId)` for auth + scope, call `checkExportRateLimit` (10/hour), insert job row, send SQS message via `@aws-sdk/client-sqs` (env: `COMPLIANCE_EXPORTS_QUEUE_URL`), check the SendMessage response, emit `data.export_initiated` audit event with the filter as payload, return job. All in a single transaction (insert + audit emit must atomically land or both fail).
- Query: single SELECT scoped by `requireComplianceReader` result; LIMIT 50.
- Audit emit: existing `emitAuditEvent` helper with `eventType='data.export_initiated'`, `actor=email`, `actorType='USER'`, `source='admin.compliance.export'`, `payload={filter, format}`.
- Test scenarios: see below.

**Patterns to follow:**
- `packages/database-pg/drizzle/0074_compliance_event_hash_index.sql` — migration shape.
- `packages/api/src/graphql/resolvers/compliance/query.ts` — resolver shape with auth + lazy pg client.
- `packages/api/src/lib/compliance/resolver-auth.ts` — auth reuse.

**Test scenarios:**
- *Happy path:* Operator submits valid filter (last 7d, event_type=AGENT_CREATED, CSV) → mutation returns QUEUED job; row in DB; audit event emitted; SQS message sent.
- *Edge case:* Filter spans 91 days → rejected with `FILTER_RANGE_TOO_WIDE`.
- *Edge case:* Filter JSON > 4 KB → rejected with `FILTER_TOO_LARGE`.
- *Edge case:* 11th request within 1 hour from same email → rejected with `RATE_LIMIT_EXCEEDED`.
- *Auth:* apikey caller → FORBIDDEN.
- *Auth:* Non-operator passing another tenant's tenantId → tenantId silently overridden to caller's own tenant in DB row.
- *Auth:* Non-operator with no resolved tenant → UNAUTHENTICATED.
- *Audit emission:* successful mutation produces a `compliance.audit_events` row with `event_type='data.export_initiated'` containing the filter.
- *Listing:* operator sees all jobs (including those for other tenants); non-operator sees only their tenant's jobs.
- *Listing:* sorted `requested_at DESC` LIMIT 50.

**Verification:**
- `pnpm --filter @thinkwork/database-pg db:migrate-manual` reports the new objects present after `psql -f` apply.
- `pnpm --filter @thinkwork/api test` clean.
- `pnpm typecheck` from repo root.

---

- U2. **Terraform — exports bucket module + SQS queue + runner Lambda infra + IAM**

**Goal:** Provision the S3 bucket, SQS queue + DLQ, runner Lambda IAM role, function resource, event-source mapping, and CloudWatch alarms. Function ships with a stub body in U2; U3 swaps in the live body.

**Requirements:** R5, R6, R7.

**Dependencies:** U1 (the migration must define the table the runner reads/writes).

**Files:**
- Create: `terraform/modules/data/compliance-exports-bucket/main.tf` (bucket, lifecycle, public access block, SSE-S3, IAM role for runner)
- Create: `terraform/modules/data/compliance-exports-bucket/variables.tf`
- Create: `terraform/modules/data/compliance-exports-bucket/outputs.tf`
- Modify: `terraform/modules/thinkwork/main.tf` (instantiate compliance-exports-bucket; pass outputs to app/lambda-api)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (3 new vars: `compliance_exports_bucket_name`, `compliance_exports_sqs_queue_arn`, `compliance_export_runner_lambda_role_arn`)
- Modify: `terraform/modules/app/lambda-api/main.tf` (pass `COMPLIANCE_EXPORTS_BUCKET` + `COMPLIANCE_EXPORTS_QUEUE_URL` env to graphql-http and runner Lambdas; new SQS queue + DLQ + alarm)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (standalone `aws_lambda_function.compliance_export_runner` resource — NOT in the for_each pool; `aws_lambda_event_source_mapping` for SQS → handler; `aws_cloudwatch_metric_alarm` for DLQ depth)
- Modify: `scripts/build-lambdas.sh` (add `build_handler "compliance-export-runner"` entry; verify whether new SDK clients require BUNDLED_AGENTCORE_ESBUILD_FLAGS expansion)

**Approach:**
- Bucket module mirrors `compliance-audit-bucket/` shape — same versioning, public access block, SSE-S3, owner-enforced ACL — minus the Object Lock + per-cadence prefix policy. Lifecycle rule: single rule, `expiration { days = 7 }`, prefix=""—applies to all objects.
- IAM role for runner: trust policy is the standard Lambda service principal; inline allow policies grant `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetObject` on the bucket only; explicit deny on every other S3 ARN; SQS receive/delete on the new queue; KMS decrypt for the existing compliance_reader / writer secrets if SSE-KMS later. Document the role's blast radius in a Terraform comment.
- SQS queue: standard queue (not FIFO), `visibility_timeout_seconds=900` (matches Lambda 15-min timeout), `message_retention_seconds=86400` (1 day — DLQ catches longer-stuck messages).
- DLQ: standard queue, `message_retention_seconds=1209600` (14 days).
- Event-source mapping: `batch_size=1`, `maximum_concurrency=2` (operator + at-most-1-per-tenant cap; revisit if v2 demand grows), `function_response_types=["ReportBatchItemFailures"]` so the runner can mark individual messages failed without re-enqueuing the batch.
- Lambda function resource: standalone (NOT for_each); `reserved_concurrent_executions=2`; `timeout=900`; `memory_size=1024`; environment from variables; trust policy on its own IAM role.
- CloudWatch alarm: `aws_cloudwatch_metric_alarm` on `ApproximateNumberOfMessagesVisible` for the DLQ > 0 → SNS topic (existing platform alerts topic if any; document if not).
- Function's filename initially points at a stub `compliance-export-runner.zip` produced by build-lambdas.sh entry. Stub body is a 5-line "throw not-implemented" function.
- `aws_iam_role_policy_attachment` for AWSLambdaBasicExecutionRole + the inline runner role policy.

**Patterns to follow:**
- `terraform/modules/data/compliance-audit-bucket/main.tf` — bucket module shape.
- `terraform/modules/app/lambda-api/handlers.tf` — `aws_lambda_function.compliance_anchor` standalone resource pattern.
- `terraform/modules/data/compliance-audit-bucket/main.tf` lines for IAM role + explicit-deny — the runner mirrors the explicit-deny defense.
- `terraform/modules/app/lambda-api/main.tf` — SQS queue + DLQ + event-source mapping pattern (existing job-trigger handler if any; otherwise document this as the first SQS-driven Lambda in lambda-api).

**Test scenarios:**
- *Test expectation: none (Terraform-only unit; no behavioral test).* Verification is `terraform validate` + `terraform plan` against an existing dev workspace showing the new resources without changes to unrelated handlers.

**Verification:**
- `terraform -chdir=terraform/modules/data/compliance-exports-bucket validate` clean.
- `terraform -chdir=terraform/examples/greenfield validate` clean.
- `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` shows: 1 new bucket, 2 new queues, 1 new function, 1 new event-source mapping, 1 new alarm, 1 new IAM role + policy. NO changes to the 60+ existing handlers.

---

- U3. **Runner Lambda body + smoke + GitHub Actions wiring**

**Goal:** Replace the U2 stub with the real export runner. SQS handler reads jobId, opens cursor, streams CSV/NDJSON to S3 multipart, generates presigned URL, updates job to COMPLETE | FAILED.

**Requirements:** R4, R8.

**Dependencies:** U1 (table exists), U2 (Lambda + bucket + queue exist).

**Files:**
- Modify: `packages/lambda/compliance-export-runner.ts` (replace stub with real body)
- Create: `packages/lambda/__tests__/integration/compliance-export-runner.integration.test.ts`
- Create: `packages/api/src/__smoke__/compliance-exports-smoke.ts` (issues a tiny export, polls until COMPLETE, downloads artifact, asserts row count + format)
- Create: `scripts/post-deploy-smoke-compliance-exports.sh`
- Modify: `.github/workflows/deploy.yml` (new `compliance-exports-smoke` job after the existing compliance-anchor-smoke step, gated on stage=dev)

**Approach:**
- Module-load env snapshot via `getRunnerEnv()` → `{databaseUrl, bucket, region}`. Never re-read inside the handler (per `feedback_completion_callback_snapshot_pattern`).
- Handler signature: `async (event: SQSEvent): Promise<SQSBatchResponse>`. Returns `batchItemFailures` array per AWS Lambda partial-failure protocol.
- For each record: parse `{jobId}` from the body, open writer pg client, call `updateStatus(jobId, 'RUNNING')` with a CAS guard (`WHERE status='QUEUED'` so re-deliveries are no-ops). If 0 rows updated, log + skip (already running or done).
- Build the SQL with the same filter shape the U10 read API uses. SELECT `*` with the filter applied + tenant scope from the job row (NOT from caller — runner has no caller). Use `pg.Cursor` to stream batches of 1000 rows.
- For each batch: write rows to a streaming S3 upload via `@aws-sdk/lib-storage`'s `Upload` class. Format selector: `formatRowAsCsv` or `formatRowAsNdjson`.
- On EOF: `await upload.done()`, generate 15-min presigned `GetObject` URL via `@aws-sdk/s3-request-presigner`, `updateStatus(jobId, 'COMPLETE', {s3Key, presignedUrl, presignedUrlExpiresAt, completedAt})`.
- On error: catch at the top level, `updateStatus(jobId, 'FAILED', {errorMessage: err.message})`, return success on the SQS message (do NOT throw — would re-enqueue and we have `MaximumRetryAttempts=0` set on the function which only counts service errors, not handler throws; explicit success keeps the message off the DLQ, which we want only for poison-message protection).
- CSV writer: 30-line inline implementation. Header row first; per-row quote-where-needed. Test the quoting against fixtures.
- NDJSON writer: `JSON.stringify(row) + "\n"` per row.

**Patterns to follow:**
- `packages/lambda/compliance-anchor.ts` — module-load env snapshot, lazy pg client, structured logging.
- `packages/lambda/compliance-anchor.ts` — UPDATE with CAS guard pattern.
- `packages/api/src/__smoke__/compliance-anchor-smoke.ts` — smoke shape.

**Test scenarios:**
- *Happy path:* SQS event with valid jobId → job transitions QUEUED → RUNNING → COMPLETE; S3 object exists with correct format; presigned URL is valid for 15 min.
- *Happy path NDJSON:* request format=NDJSON → S3 object is a single line per event, each parseable as JSON, no trailing newline issues.
- *Edge case:* job with no matching events → S3 object has just header (CSV) or empty (NDJSON); status COMPLETE; metadata reflects 0 rows.
- *Edge case:* job's filter spans >1M events (use a large dev tenant) → cursor streams without loading all into memory; completes within Lambda 15-min timeout.
- *Error path:* DB connection drops mid-stream → status FAILED with errorMessage; S3 multipart aborted (no half-uploaded artifact).
- *Error path:* S3 PutObject fails → status FAILED; no presigned URL set.
- *Idempotency:* SQS re-delivers the same message → second invocation sees status != QUEUED, skips with no-op.
- *Audit:* audit event was already emitted by the mutation; runner does NOT emit a second audit event for completion (avoid double-counting; Phase 4 may add a `data.export_completed` event slate).

**Verification:**
- `pnpm --filter @thinkwork/lambda test` clean.
- `pnpm typecheck` from repo root.
- Post-deploy smoke succeeds against dev (writes a 1-row export, downloads artifact, validates).
- CloudWatch logs show `MaximumRetryAttempts=0` is honored (no automatic retries on handler errors).
- DLQ alarm is OK (no poison messages from the smoke run).

---

- U4. **Admin Exports page + dialog + polling + GraphQL queries + codegen**

**Goal:** User-visible Exports page at `/compliance/exports/` with table + request dialog + 3-second polling. New "Export this view" affordance on the events list page.

**Requirements:** R9, R10.

**Dependencies:** U1 (GraphQL schema), U3 (runner produces complete jobs against the contract).

**Files:**
- Create: `apps/admin/src/lib/compliance/export-queries.ts` (`createComplianceExport` mutation + `complianceExports` query)
- Create: `apps/admin/src/components/compliance/ComplianceExportDialog.tsx` (format radio + filter preview + submit)
- Create: `apps/admin/src/routes/_authed/_tenant/compliance/exports/index.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` (add "Export this view" button → `Link` to `/compliance/exports?from=current-filter`)
- Modify: `apps/admin/src/components/Sidebar.tsx` — NO change (sub-route lives under existing /compliance entry).
- Modify: `apps/admin/src/gql/` (auto-generated via `pnpm --filter @thinkwork/admin codegen`)

**Approach:**
- Queries module mirrors `apps/admin/src/lib/compliance/queries.ts` shape — typed `graphql()` from `@/gql`, NOT untyped `gql\`\`` from `@urql/core`.
- Exports page component: `useQuery({ query: ComplianceExportsQuery })` with `pollInterval` derived dynamically. The pattern: derive `hasActiveJobs` from data; pass `pollInterval: hasActiveJobs ? 3000 : 0` (urql turns 0 into "no polling"). When polling, urql refetches automatically.
- Table columns: status (Badge with icon), requested at (relativeTime), format, filter summary (compact rendering of the JSON filter), actions (Download / Re-export / View error).
- Status badge: COMPLETE → green CheckCircle + "Complete"; QUEUED → amber Loader2 + "Queued"; RUNNING → amber Loader2 + "Running"; FAILED → red AlertCircle + "Failed".
- Download button: `<a href={presignedUrl} download>Download CSV</a>` — direct browser download, no JS interception. Presigned URL is from S3 so CORS works without admin-side proxy.
- "URL expired" detection: check `Date.parse(presignedUrlExpiresAt) < Date.now()` on render; if so, show "URL expired — re-export" instead of Download.
- Dialog component: shadcn Dialog. Format radio default = CSV. Filter preview is a read-only summary of `?from=current-filter`'s query params (range + tenantId + actorType + eventType + since + until). On submit: fire mutation, close dialog, optimistically prepend the QUEUED job to the table.
- "Export this view" entry: PageHeader actions slot on the events list page → `<Button asChild>...<Link to="/compliance/exports" search={...}>...</Link>` with the current `?range=` / `?xt=` etc. preserved.

**Patterns to follow:**
- `apps/admin/src/lib/compliance/queries.ts` — typed graphql() pattern.
- `apps/admin/src/routes/_authed/_tenant/compliance/index.tsx` — list page shape with PageHeader + filter/table.
- `apps/admin/src/components/compliance/ComplianceFilterBar.tsx` — filter shape reuse.
- shadcn Dialog primitives in `apps/admin/src/components/ui/dialog.tsx`.

**Test scenarios:**
- *Happy path:* Operator clicks "Export this view" with `?range=7d&eventType=AGENT_CREATED` → dialog pre-fills format=CSV + filter summary; click Submit → optimistic QUEUED row in table; polling detects RUNNING then COMPLETE; Download button appears.
- *Edge case:* Polling stops once all jobs are COMPLETE / FAILED.
- *Edge case:* Job's presignedUrlExpiresAt < now → table shows "URL expired" + Re-export.
- *Edge case:* Server returns RATE_LIMIT_EXCEEDED → dialog shows the typed error inline; user can dismiss + try later.
- *Edge case:* Server returns FILTER_RANGE_TOO_WIDE → dialog shows the typed error inline.
- *Edge case:* Operator with cross-tenant toggle ON → can request export across all tenants (passes no tenantId); result row shows "All tenants" in the filter summary.
- *Edge case:* Non-operator → only sees their own tenant's jobs in the listing.
- *Manual:* deep-link `/compliance/exports?from=current-filter&range=7d` works after browser reload.

**Verification:**
- `pnpm --filter @thinkwork/admin codegen && pnpm --filter @thinkwork/admin typecheck` clean.
- Vite dev server: full flow from list → "Export this view" → dialog → submit → polling → Download works against deployed dev.

---

- U5. **Verify + commit + push + ce-code-review autofix + open PR**

**Goal:** Repo-wide typecheck + admin codegen verify + manual SOC2 export rehearsal in dev + commit + push + ce-code-review autofix + open PR.

**Requirements:** R1-R10 (verification across the surface).

**Dependencies:** U1, U2, U3, U4.

**Files:** No new files; verification + ship pass.

**Approach:**
- `pnpm --filter @thinkwork/database-pg db:migrate-manual` — confirms migration objects present after `psql -f` apply to dev.
- `pnpm --filter @thinkwork/api test` + `pnpm --filter @thinkwork/lambda test` + `pnpm --filter @thinkwork/admin codegen && pnpm --filter @thinkwork/admin test` + `pnpm typecheck` from root all clean.
- `terraform -chdir=terraform/examples/greenfield plan` shows only the U11-introduced resources.
- Manual SOC2 export rehearsal in deployed dev:
  1. Sign in as operator
  2. /compliance loads
  3. Filter to last-7d event_type=AGENT_CREATED
  4. Click "Export this view" → dialog opens with filter preview
  5. Format=CSV, Submit
  6. Optimistic QUEUED row appears
  7. Polling transitions QUEUED → RUNNING → COMPLETE
  8. Download button works; CSV opens in spreadsheet correctly
  9. Verify a `data.export_initiated` audit event row exists in /compliance for this export
  10. Wait 16 minutes; reload Exports page; "URL expired" affordance renders
  11. Submit 11 exports in <1 hour → 11th rejects with RATE_LIMIT_EXCEEDED
  12. Submit a 91-day filter → rejects with FILTER_RANGE_TOO_WIDE
- Operator pre-merge step: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0075_compliance_export_jobs.sql` against dev BEFORE merging this PR (institutional pattern).
- Commit conventional message + push.
- Run ce-code-review autofix.
- Open PR documenting the SOC2 export walkthrough script + the `psql -f` pre-merge requirement.

**Test scenarios:**
- *Test expectation: none for unit-level coverage. The manual rehearsal IS the test.*

**Verification:**
- All checks pass.
- PR opened, CI green on the standard 5 checks.
- Final master-plan unit complete.

---

## System-Wide Impact

- **Interaction graph:** New mutation + query on the GraphQL HTTP API. New SQS queue + runner Lambda. New S3 bucket. graphql-http Lambda gains SQS write permission + new env vars. The existing `emitAuditEvent` helper picks up a new event type slot via the existing `data.export_initiated` enum value (already in 0069 schema).
- **Error propagation:** Mutation errors are typed GraphQL errors (RATE_LIMIT_EXCEEDED, FILTER_RANGE_TOO_WIDE, FILTER_TOO_LARGE, plus existing FORBIDDEN/UNAUTHENTICATED). Runner failures land in DB as `status='FAILED'` + `error_message`; SQS DLQ catches handler-level crashes only. UI surfaces all three states with clear semantics.
- **State lifecycle risks:** export_jobs table is unbounded; 7-day S3 lifecycle takes care of artifact storage but DB rows persist forever. Acceptable at v1 scale (≤ 10/hour × 24 hours × 7 days × few operators = small). Phase 4 retention enforcement may add a 90-day truncation policy.
- **API surface parity:** GraphQL HTTP only. No REST. No subscription. No mobile.
- **Integration coverage:** Mutation → SQS → runner → DB → S3 → admin polling is exercised by the U5 SOC2 rehearsal. Unit tests cover individual seams (mutation validation, rate limit, runner CSV/NDJSON writers, CAS guard).
- **Unchanged invariants:** No changes to existing complianceEvents/complianceEvent/complianceEventByHash queries. No changes to the compliance.audit_events table or its indexes. Anchor Lambda + verifier CLI unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hand-rolled migration not applied to dev before merge → drift gate fails the deploy | U5 mandates `psql -f` to dev before PR open; PR body surfaces the pre-merge step explicitly |
| Runner Lambda OOMs on >1M event exports despite cursor | Cursor batch size = 1000; memory_size=1024MB; if production export volumes regularly hit this ceiling, escalate to a Glue/Athena fallback (Phase 4) |
| 15-min Lambda timeout for very-large filter | 90-day filter cap is the practical ceiling at current dev tenant sizes; revisit per-tenant if production timing data shows otherwise |
| Presigned URL leaks via shoulder-surfing or copy-paste | 15-min expiry + private S3 bucket + audit-trail of `data.export_initiated` events. Auditors typically download immediately; expired URLs require a re-export, which is also audited |
| Rate-limit DB query becomes hot under multi-operator load | Index on `(requested_by_user_email, requested_at DESC)` makes it O(log n); Aurora capacity is the bound, not the query — current scale is one-digit operators |
| SQS message lost mid-flight | DLQ catches; CloudWatch alarm on DLQ depth > 0 surfaces; runner is idempotent via the QUEUED→RUNNING CAS guard |
| Cross-tenant export by operator without explicit cross-tenant toggle in UI | Mutation reuses `requireComplianceReader` which only allows non-tenantId filters for operators (allowlist enforced); the UI's existing cross-tenant toggle from U10 propagates into the export filter |
| New Lambda's IAM role too permissive | Inline policy is bucket-scoped + explicit deny on every other S3 ARN; reviewer focus during ce-code-review |
| Runner's writer-pool DB access widens blast radius | Documented tradeoff; the runner's only consumer is itself; the IAM bucket grant restricts persistence; future hardening may add a dedicated `compliance_exporter` Aurora role |
| 4 KB filter cap collides with very-targeted exports | 4 KB is generous (the entire `ComplianceEventFilter` shape is 5 fields); cap exists for payload-balloon defense, not legitimate filter complexity |
| `data.export_initiated` audit event payload itself bloats the audit table | Filter is small + bounded; payload is < 4 KB by the same cap that gates the mutation |

---

## Documentation / Operational Notes

- **Operator pre-merge step:** `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0075_compliance_export_jobs.sql` against dev BEFORE merging this PR. The PR body must surface this requirement; the deploy drift gate will fail otherwise (per `feedback_handrolled_migrations_apply_to_dev`).
- **Runbook update** (optional, post-rehearsal): `docs/runbooks/compliance-export-walkthrough.md` documenting the operator flow ("/compliance → filter → Export this view → wait → Download → file is valid CSV/NDJSON for auditor handoff").
- **Cognito CallbackURLs:** No change. The `/compliance/exports` sub-route is already covered by the existing `/compliance` parent route's allowed redirect.
- **CloudWatch:** Watch the new DLQ depth alarm + Lambda runtime / errors alarms. Document the SOC2-relevance: anchor failures + export failures are operationally visible, demonstrating the audit substrate is monitored.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U11 entry).
- **U10 backend / extensions / admin UI PRs:** #937, #939, #941 (all merged on origin/main).
- **Migration shape reference:** `packages/database-pg/drizzle/0074_compliance_event_hash_index.sql`.
- **Resolver-auth reference:** `packages/api/src/lib/compliance/resolver-auth.ts`.
- **Anchor Lambda module-load env pattern:** `packages/lambda/compliance-anchor.ts`.
- **Bucket Terraform module reference:** `terraform/modules/data/compliance-audit-bucket/`.
- **Build script entry reference:** `scripts/build-lambdas.sh` lines 150-160.
- **Institutional learnings:** `project_async_retry_idempotency_lessons`, `feedback_handrolled_migrations_apply_to_dev`, `feedback_completion_callback_snapshot_pattern`, `feedback_lambda_zip_build_entry_required`, `feedback_smoke_pin_dispatch_status_in_response`.
