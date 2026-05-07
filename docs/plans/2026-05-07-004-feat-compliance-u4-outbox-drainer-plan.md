---
title: "feat(compliance): U4 — Outbox drainer Lambda (focused execution overlay)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat(compliance): U4 — Outbox drainer Lambda

## Summary

Focused execution overlay for U4 of the master Phase 3 plan. Ships the single-writer outbox drainer Lambda (reserved-concurrency=1, EventBridge `rate(1 minute)` schedule) that polls `compliance.audit_outbox` for un-drained rows, computes the per-tenant SHA-256 hash chain, copies each event to `compliance.audit_events`, and marks the outbox row drained. Idempotent on `outbox_id` UNIQUE; poison rows write `drainer_error` and are skipped on the next poll. This is the architectural cornerstone of master plan Decision #1 (single-writer outbox drainer) — without it, U3's writes accumulate in the outbox forever.

---

## Problem Frame

U3 shipped `emitAuditEvent` which inserts into `compliance.audit_outbox` inside the caller's transaction (control-evidence-fail-closed). The outbox is a durability tier; the `compliance.audit_events` log is the chained, immutable, anchored record. The drainer is the one-way bridge: reads outbox → computes chain → writes events → marks drained. Reserved-concurrency=1 is the entire safety story for the chain — two concurrent drainers would race the chain head lookup and produce orphan `prev_hash` links that verification would later report as broken.

(See origin: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` U4 + Decision #1.)

---

## Requirements

Carried from master plan U4:

- R5. Append-only audit-event log with the canonical envelope.
- R6. Two-tier write semantics. The drainer is the asynchronous half: outbox rows commit synchronously with the caller's transaction (R6 control-evidence); the drainer chains and copies to events asynchronously.
- R12. Per-tenant in-row cryptographic hash chain (`event_hash`, `prev_hash`); tampering detectable.

---

## Scope Boundaries

- **S3 spillover read for oversize payloads** — `payload_oversize_s3_key` is forwarded as-is from outbox to events. Drainer does NOT fetch the S3 object, hash its content separately, or do any S3 I/O. The `event_hash` covers only the in-row payload field; the S3 object integrity is a Phase 4 concern when retention + archival ship.
- **Tenant Merkle tree anchoring** — U7-U8.
- **Cross-tenant verification report** — U9 verifier CLI.
- **Phase 4 retention enforcement** — drainer never deletes rows; outbox grows unbounded until retention sweep ships.
- **Backfill / replay tooling** — if a tenant's chain breaks, recovery is a separate ops concern. Drainer doesn't ship a "rewrite chain from row N" mode; the chain is append-only by construction.

### Deferred to Follow-Up Work

- **Poison-row backoff with `drainer_skip_until`** — current schema doesn't have this column. v1 uses `drainer_error IS NULL` to skip permanent-failure rows; operator must clear `drainer_error` to retry. A future schema migration could add `drainer_skip_until` for time-based backoff if poison-row volume becomes a real ops concern.
- **Drainer metrics dashboard** — CloudWatch metric on lag (`max(now() - enqueued_at) WHERE drained_at IS NULL`) and error count. Defer to operations hardening; v1 uses structured logs.

---

## Context & Research

### Relevant Code and Patterns

- **`packages/lambda/job-trigger.ts`** — scheduled Lambda + Postgres connection + structured logging. Closest pattern for the drainer's main loop. Top of file imports `getDb` from `@thinkwork/database-pg`; reads master DB credentials at boot.
- **`terraform/modules/app/lambda-api/handlers.tf:213`** — `aws_lambda_function.handler` for_each pattern. Add `compliance-outbox-drainer` to the for_each set.
- **`handlers.tf:442` and `handlers.tf:479`** — `aws_lambda_function_event_invoke_config` examples for handlers that need MaximumRetryAttempts=0 + DLQ. Mirror for the drainer.
- **`handlers.tf` `aws_scheduler_schedule.wakeup_processor`** — `rate(1 minutes)` EventBridge schedule pattern. Mirror for the drainer's schedule.
- **`packages/api/src/lib/compliance/emit.ts`** — outbox row shape (caller of the helper writes the row that the drainer reads). The drainer must read every column and copy to `audit_events`.
- **`packages/api/src/lib/compliance/event-schemas.ts`** — registry; drainer does NOT re-redact (already happened in U3). Drainer trusts what's in outbox.
- **`packages/database-pg/src/schema/compliance.ts`** — both `auditOutbox` and `auditEvents` Drizzle tables. Drainer SELECTs from the first, INSERTs to the second.
- **`scripts/build-lambdas.sh`** — allowlist + esbuild bundling. Add a `build_handler compliance-outbox-drainer` line. Standard externalization (no `BUNDLED_AGENTCORE_ESBUILD_FLAGS` needed; only stable AWS SDK clients used).
- **U2 secret resolution** — drainer connects as `compliance_drainer` role; secret ARN exposed as `module.database.compliance_drainer_secret_arn` (added in #887).

### Institutional Learnings

- `feedback_lambda_zip_build_entry_required` (memory) — every new Lambda needs entries in BOTH Terraform handlers.tf AND scripts/build-lambdas.sh, or `filebase64sha256` blocks deploy.
- `project_async_retry_idempotency_lessons` (memory) — Lambda async invokes default to 2 retries; non-idempotent loops set `MaximumRetryAttempts=0` + SQS DLQ. Drainer's `INSERT ... ON CONFLICT (outbox_id) DO NOTHING` is idempotent on Lambda retry, but reserved-concurrency=1 + retry-0 is the cleanest contract.
- `feedback_completion_callback_snapshot_pattern` (memory) — snapshot env vars at handler entry; never re-read `os.environ` inside long-running operations. Applies to drainer's secret resolution and DB connection setup.
- `feedback_smoke_pin_dispatch_status_in_response` (memory) — drainer's response payload exposes `{drained_count, error_count, oldest_age_ms}` so smoke tests can pin observed activity.

### External References

- PostgreSQL `FOR UPDATE SKIP LOCKED` — single-writer queue pattern; the drainer's `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N WHERE drained_at IS NULL AND drainer_error IS NULL` is the canonical shape.
- RFC 8785 (JCS) — JSON Canonicalization Scheme; this plan uses simpler sorted-key serialization (Decision #2) instead.

---

## Key Technical Decisions

1. **Per-tenant chain head lookup via `(tenant_id, occurred_at DESC) LIMIT 1`.** No denormalized summary table. **Why:** the U1 index `idx_audit_events_tenant_occurred` already supports this in O(log n). A summary table (`tenant_chain_head`) would add a write-amplification path on every drainer commit and a consistency-management concern. With ≤ 50 rows per drainer batch, 50 lookups against a tenant-prefix index is cheap. If profiling at 400+ tenants shows lookup latency dominates, the summary table is a follow-up optimization, not a v1 requirement.

2. **Canonicalization: sorted-key JSON.stringify on the full envelope.** Hash input is the JSON of `{event_id, tenant_id, occurred_at (ISO 8601 UTC), actor, actor_type, source, event_type, resource_type, resource_id, action, outcome, request_id, thread_id, agent_id, payload, payload_schema_version, control_ids (sorted alphabetically), payload_redacted_fields (sorted alphabetically), payload_oversize_s3_key, prev_hash}` with all keys sorted alphabetically and no whitespace. **Why:** RFC 8785 JCS is more rigorous but adds dependency complexity for a v1 audit chain where the verifier (U9) ships in the same repo and can mirror our serializer. Sorted-key JSON.stringify with a recursive sort helper is ~30 lines of TS and fully deterministic. Includes ALL non-payload envelope fields so a tampered field (e.g., changed actor) breaks the chain.

3. **Trigger: AWS Scheduler `rate(1 minute)`.** Not SQS-on-write, not Lambda Web Adapter polling. **Why:** matches the existing `wakeup_processor` and `connector_poller` pattern in handlers.tf — proven, simple, Terraform-managed. SQS-on-write would couple outbox INSERTs to SQS publish (a partial-failure mode with no clear recovery), and Lambda Web Adapter polling adds cold-start and concurrency-management complexity. 1-minute drain latency is acceptable for SOC2 Type 1 evidence.

4. **Batch size: 50 rows per invocation.** **Why:** keeps the lock window short (single-writer means lock contention is in-process between rows, not cross-Lambda); 50 rows × ~10ms hash + insert ≈ 500ms total per invocation, well under the 1-minute schedule. If a backlog accumulates (drainer was offline), the next invocation drains the next 50, etc. — natural catch-up behavior. Tunable via env var if profiling shows different optimum.

5. **Idempotency: `audit_events.outbox_id` UNIQUE + `INSERT ... ON CONFLICT (outbox_id) DO NOTHING`.** **Why:** if the drainer crashes between `INSERT INTO audit_events` and `UPDATE audit_outbox SET drained_at`, the next invocation re-attempts: the audit_events insert no-ops (ON CONFLICT), and the outbox update re-runs (idempotent). Reserved-concurrency=1 means there's never a competing drainer racing the same row.

6. **Lock acquisition: `FOR UPDATE SKIP LOCKED`.** Defense-in-depth on top of reserved-concurrency=1. **Why:** if Lambda's reserved-concurrency guarantee ever fails (regional outage, manual config drift), `SKIP LOCKED` ensures two drainers don't race the same row. Cost is minimal (PG lock manager); benefit is a clear "this never produces double-write" property.

7. **Per-row transaction, not whole-batch transaction.** Each row gets its own `db.transaction(async (tx) => { compute hash; INSERT events; UPDATE outbox })`. **Why:** if row N has a malformed payload that breaks canonicalization, only row N rolls back; rows 1..N-1 already committed are durable. A batch transaction would lose the work on rows 1..N-1 to the row-N failure. Trade-off: 50 transactions per minute is fine for Aurora at this scale.

8. **Poison-row handling: `drainer_error` column.** If a row throws during canonicalization or chain lookup, write the error message to `audit_outbox.drainer_error` (column already exists from U1) and leave `drained_at` NULL. The drainer's poll WHERE clause filters on `drained_at IS NULL AND drainer_error IS NULL`, so poison rows are skipped on subsequent invocations. Operator clears `drainer_error` to retry. **Why:** Postgres-level state is durable, observable in the admin UI (U10) and CloudWatch logs, and doesn't require a separate DLQ for the in-DB error. The Lambda-level SQS DLQ + MaximumRetryAttempts=0 still catches Lambda-level failures (OOM, timeout, DB unreachable), but per-row failures are isolated in-DB.

9. **Drainer connects as `compliance_drainer` role.** Resolves the secret at handler boot via `aws-sdk/client-secrets-manager` from `compliance_drainer_secret_arn` env var (set by Terraform). **Why:** least-privilege per-role secret. compliance_drainer has SELECT/UPDATE on audit_outbox + INSERT on audit_events + SELECT on actor_pseudonym (per U2's GRANT matrix); cannot read other compliance tables, cannot DELETE anything.

10. **Empty batch returns successfully without error.** `drained_count: 0` is a valid result. **Why:** the schedule fires every minute regardless of pending rows; an empty backlog is the steady state most of the time. Returning success with `drained_count: 0` lets CloudWatch alarms differentiate "drainer healthy, no work" from "drainer failed".

11. **Hash function: SHA-256 via `node:crypto`.** Not pgcrypto's `digest()`. **Why:** computing in app code makes the hash function explicit and testable, lets the U9 verifier mirror it exactly without a Postgres dependency, and avoids the "is pgcrypto digest() bytea or text?" semantics question. SHA-256 hex output (64 chars), matching the `char(64)` columns from U1.

---

## Open Questions

### Resolved During Planning

- *Per-tenant chain head storage*: index lookup on (tenant_id, occurred_at DESC) (Decision #1).
- *Canonicalization scheme*: sorted-key JSON.stringify on the full envelope (Decision #2).
- *Trigger model*: AWS Scheduler rate(1 minute) (Decision #3).
- *Batch size*: 50 (Decision #4).
- *Idempotency mechanism*: outbox_id UNIQUE + ON CONFLICT DO NOTHING (Decision #5).
- *Lock acquisition*: FOR UPDATE SKIP LOCKED (Decision #6).
- *Transaction granularity*: per-row, not whole-batch (Decision #7).
- *Poison-row handling*: drainer_error column with operator-clear retry (Decision #8).
- *Drainer DB role*: compliance_drainer (Decision #9).
- *Empty batch behavior*: return success with drained_count: 0 (Decision #10).
- *Hash function location*: app-side SHA-256 via node:crypto (Decision #11).

### Deferred to Implementation

- Exact tunable env-var names for batch size and timeout — implementer chooses (`COMPLIANCE_DRAINER_BATCH_SIZE`, etc.).
- Exact CloudWatch alarm thresholds (lag minutes, error count) — operations follow-up.
- Whether to add structured `requestId` to each drainer log line for tracing — implementer decides based on existing log conventions in `job-trigger.ts`.
- Whether to memoize the tenant chain head within a single batch (subsequent rows for the same tenant could read from in-memory) — micro-optimization; defer until profiling.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Trigger: AWS Scheduler rate(1 minute)                                   │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ compliance-outbox-drainer Lambda (reserved-concurrency=1)               │
│                                                                         │
│  boot:                                                                  │
│    snapshot env (AURORA_HOST, COMPLIANCE_DRAINER_SECRET_ARN, ...)       │
│    fetch secret → connect as compliance_drainer                         │
│                                                                         │
│  poll:                                                                  │
│    SELECT * FROM compliance.audit_outbox                                │
│      WHERE drained_at IS NULL AND drainer_error IS NULL                 │
│      ORDER BY enqueued_at                                               │
│      LIMIT 50                                                           │
│      FOR UPDATE SKIP LOCKED;                                            │
│                                                                         │
│  for each row, in own transaction:                                      │
│    prev_hash = SELECT event_hash FROM compliance.audit_events           │
│                  WHERE tenant_id = $row.tenant_id                       │
│                  ORDER BY occurred_at DESC                              │
│                  LIMIT 1;  (NULL for genesis event of tenant)           │
│    canonical = sorted_json({                                            │
│      event_id, tenant_id, occurred_at, actor, actor_type, source,       │
│      event_type, resource_type, resource_id, action, outcome,           │
│      request_id, thread_id, agent_id, payload, payload_schema_version,  │
│      control_ids: sorted, payload_redacted_fields: sorted,              │
│      payload_oversize_s3_key, prev_hash                                 │
│    });                                                                  │
│    event_hash = sha256(canonical).hex;                                  │
│    INSERT INTO compliance.audit_events (...) VALUES (...)               │
│      ON CONFLICT (outbox_id) DO NOTHING;                                │
│    UPDATE compliance.audit_outbox SET drained_at = NOW()                │
│      WHERE outbox_id = $row.outbox_id;                                  │
│                                                                         │
│  on per-row error:                                                      │
│    UPDATE compliance.audit_outbox                                       │
│      SET drainer_error = $err.message                                   │
│      WHERE outbox_id = $row.outbox_id;                                  │
│    continue with next row.                                              │
│                                                                         │
│  return { drained_count, error_count, oldest_age_ms, dispatched: true } │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Units

- U1. **Hash chain helpers (`canonicalizeEvent`, `computeEventHash`) + unit tests**

**Goal:** Pure-function helpers that the drainer Lambda + the future U9 verifier CLI both consume. Sorted-key canonical JSON serializer + SHA-256 hash. Pulled into its own module so the verifier can import without pulling drainer / Lambda dependencies.

**Requirements:** R12.

**Dependencies:** None.

**Files:**
- Create: `packages/api/src/lib/compliance/hash-chain.ts` — `canonicalizeEvent(event) → string`, `computeEventHash(canonical, prevHash) → string`, helper types
- Modify: `packages/api/src/lib/compliance/index.ts` — re-export the helpers
- Test: `packages/api/src/lib/compliance/__tests__/hash-chain.test.ts`

**Approach:**
- `canonicalizeEvent(event)` recursively sorts object keys (alphabetical) and arrays in `control_ids` / `payload_redacted_fields` (alphabetical), serializes via `JSON.stringify(value, null, 0)` with a custom replacer that ensures: ISO 8601 UTC for Date values; `null` for undefined; arrays preserve insertion order EXCEPT the two listed sort-targets.
- `computeEventHash(canonical, prevHash)` returns `sha256(prevHash || canonical).hex` (64 chars). `prevHash = ""` for the genesis event (NOT null — null would change the hash input).
- Helpers are framework-free; no Drizzle, no AWS SDK, no Postgres. Pure functions for the verifier.

**Patterns to follow:**
- `packages/api/src/lib/compliance/redaction.ts` — module shape; pure functions with discrete unit tests.

**Test scenarios:**
- *Happy path:* `canonicalizeEvent({eventId: "a", tenantId: "b", occurredAt: new Date("2026-01-01T00:00:00Z"), payload: {z: 1, a: 2}, ...})` produces a string with keys sorted alphabetically and nested payload sorted.
- *Edge case (Date serialization):* `canonicalizeEvent({occurredAt: new Date("2026-01-01T12:34:56.789Z")})` produces the ISO string with millisecond precision.
- *Edge case (sorted arrays):* `control_ids: ["CC8.1", "CC6.1"]` and `payload_redacted_fields: ["b", "a"]` round-trip in alphabetical order in the canonical output.
- *Edge case (insertion-order arrays):* `payload.skillIds: ["skill-c", "skill-a"]` preserves input order (not in sort-target list).
- *Edge case (null vs undefined):* `resource_type: undefined` becomes `null` in canonical; `resource_type: null` stays null.
- *Happy path (hash):* `computeEventHash("{...}", "abc")` returns 64-char hex matching `sha256("abc{...}")`.
- *Edge case (genesis hash):* `computeEventHash("{...}", "")` returns `sha256("{...}")`.
- *Determinism:* calling `canonicalizeEvent` twice on the same input produces byte-identical output.
- *Tamper detection:* changing any envelope field changes the canonical string and thus the hash.

**Verification:** `pnpm --filter @thinkwork/api test src/lib/compliance/__tests__/hash-chain.test.ts` passes; helpers are pure (no I/O); function signatures exported from `index.ts`.

---

- U2. **Drainer Lambda implementation**

**Goal:** The Lambda handler that polls outbox, computes the chain, writes events, marks drained.

**Requirements:** R5, R6, R12.

**Dependencies:** U1 (hash helpers).

**Files:**
- Create: `packages/lambda/compliance-outbox-drainer.ts` — Lambda entry + main loop
- Modify: `scripts/build-lambdas.sh` — add `build_handler compliance-outbox-drainer` (standard externalization, no BUNDLED_AGENTCORE_ESBUILD_FLAGS)
- Test: `packages/lambda/__tests__/compliance-outbox-drainer.test.ts` — unit tests with mocked Drizzle tx

**Approach:**
- Boot: snapshot `AURORA_HOST`, `AURORA_PORT`, `AURORA_DBNAME`, `COMPLIANCE_DRAINER_SECRET_ARN`, `COMPLIANCE_DRAINER_BATCH_SIZE` (default 50). Resolve secret via `aws-sdk/client-secrets-manager` (lazy: cache the parsed credentials in module scope after first cold start). Build DATABASE_URL with `sslmode=no-verify` (CI / Lambda compatibility — same pattern as the U3 integration test).
- Main: open a single Drizzle connection. Poll outbox with `FOR UPDATE SKIP LOCKED LIMIT $batchSize WHERE drained_at IS NULL AND drainer_error IS NULL ORDER BY enqueued_at`. Important: this SELECT runs in its OWN transaction that holds the locks — but the per-row processing happens in nested transactions.

  **Implementer note:** Postgres `FOR UPDATE SKIP LOCKED` releases the locks when the SELECT transaction commits/rolls back. The drainer must keep the SELECT transaction open while iterating — or use a different pattern (single-row poll loop). Recommend single-row poll loop: each iteration does `BEGIN; SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1 WHERE ...; <process>; UPDATE outbox SET drained_at; COMMIT;` — simpler, lock window is per-row, no cross-row coupling. Loop until SELECT returns 0 rows OR `drained_count >= batchSize`.
- For each row:
  1. Look up `prev_hash` for `tenant_id` via `SELECT event_hash FROM audit_events WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 1`. NULL → genesis event for tenant; pass `""` to `computeEventHash`.
  2. Build envelope object from outbox row columns.
  3. `canonical = canonicalizeEvent(envelope)`; `event_hash = computeEventHash(canonical, prev_hash || "")`.
  4. `INSERT INTO audit_events (...event_id, outbox_id, tenant_id, ..., prev_hash, event_hash) ON CONFLICT (outbox_id) DO NOTHING`.
  5. `UPDATE audit_outbox SET drained_at = NOW() WHERE outbox_id = $row.outbox_id`.
  6. Commit per-row transaction.
- On per-row error (caught at the per-row try/catch): roll back the per-row tx, then in a new tx `UPDATE audit_outbox SET drainer_error = $err.message WHERE outbox_id = $row.outbox_id`. Increment `error_count`. Continue with next row.
- After batch: log structured summary `{ drained_count, error_count, oldest_age_ms, dispatched: true }`. Return same shape from the handler so smoke tests can pin.
- `oldest_age_ms`: max `(now - enqueued_at)` over rows still in outbox after the batch. Computed via a final SELECT (`SELECT MAX(EXTRACT(EPOCH FROM NOW() - enqueued_at) * 1000) FROM audit_outbox WHERE drained_at IS NULL`); if backlog is 0, returns null/0. Used by CloudWatch alarms (out of scope for U4 deploy; just emit it).

**Execution note:** Because the drainer touches the hash chain — the entire SOC2 evidence integrity story — write tests first for canonicalization + chain head lookup before the main loop. The chain bug class (off-by-one prev_hash, missed sort key) is silent until verification finds it 12 months later.

**Patterns to follow:**
- `packages/lambda/job-trigger.ts` — Lambda boot, getDb pattern, structured logging, response shape.
- `packages/lambda/job-schedule-manager.ts` — secret resolution at boot.

**Test scenarios:**
- *Happy path:* mock outbox with 3 rows for tenant T (genesis + 2 successors). Drainer runs. Assertions: 3 audit_events rows inserted; chain links correct (prev_hash of row 2 = event_hash of row 1, etc.); 3 outbox rows have drained_at set; return value `{drained_count: 3, error_count: 0}`.
- *Happy path (multi-tenant):* mock outbox with rows for tenants A and B interleaved. Each tenant's chain is independent (A's events don't affect B's prev_hash). Both chains are correctly linked.
- *Idempotency:* run drainer twice on the same outbox state. Second run: `INSERT ... ON CONFLICT` is a no-op; outbox UPDATE is a no-op (drained_at already set, WHERE clause filters); `drained_count: 0` from second invocation.
- *Replay safety:* simulate crash between INSERT events and UPDATE outbox (mock UPDATE throws). Next invocation: events row already exists (ON CONFLICT no-ops); outbox UPDATE retries and succeeds. End state: row drained, no duplicates.
- *Edge case (empty batch):* outbox has 0 un-drained rows. Drainer runs. `{drained_count: 0, error_count: 0, oldest_age_ms: null}`. No errors.
- *Edge case (lock contention defense-in-depth):* even though reserved-concurrency=1 guarantees single drainer, `FOR UPDATE SKIP LOCKED` in the SELECT means a hypothetical second drainer would skip locked rows.
- *Error path (poison row):* mock canonicalization throws on row 2. Rows 1 and 3 drain successfully; row 2 has `drainer_error` set, `drained_at` NULL; return `{drained_count: 2, error_count: 1}`. Next invocation skips row 2.
- *Error path (DB unreachable mid-batch):* simulate connection failure on row 5 of 10. Rows 1-4 already committed, durable. Row 5 onward not processed. Lambda return: throws (caught by Lambda framework, MaximumRetryAttempts=0 means no retry; CloudWatch alarm fires).
- *Edge case (chain head genesis):* first event for a new tenant. `SELECT prev_hash` returns no rows; pass `""` to computeEventHash; row inserted with `prev_hash: NULL`.
- *Integration scenario:* end-to-end via the U3 helper → outbox → drainer → audit_events. (Covered in U3 integration unit; this unit doesn't redo it but verifies the unit scenarios above.)

**Verification:** `pnpm --filter @thinkwork/lambda test` passes; the structured log output for a typical run includes the `dispatched: true` smoke pin.

---

- U3. **Terraform: Lambda function + EventBridge schedule + IAM + DLQ**

**Goal:** Provision the Lambda runtime, schedule, IAM role, secret access, and DLQ. Reserved-concurrency=1 enforced at the platform layer.

**Requirements:** R6, R12.

**Dependencies:** U2 (Lambda code must exist + build script entry must be present so Terraform's `filebase64sha256` can compute the zip hash).

**Files:**
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — add `compliance-outbox-drainer` to the `aws_lambda_function.handler` for_each set; add `aws_lambda_function_event_invoke_config` with `maximum_retry_attempts = 0` + `destination_config { on_failure { destination = aws_sqs_queue.compliance_drainer_dlq.arn } }`; add `aws_scheduler_schedule.compliance_outbox_drainer` with `rate(1 minutes)`; add `aws_sqs_queue.compliance_drainer_dlq` (mirror existing pattern).
- Modify: `terraform/modules/app/lambda-api/main.tf` (or wherever the lambda execution role lives) — extend the existing inline policy to include `secretsmanager:GetSecretValue` on `var.compliance_drainer_secret_arn` (the wildcard `thinkwork/*` already covers this; explicit ARN is documentation). Lambda env vars: `AURORA_HOST`, `AURORA_PORT`, `AURORA_DBNAME`, `COMPLIANCE_DRAINER_SECRET_ARN`, optional `COMPLIANCE_DRAINER_BATCH_SIZE`.
- Modify: `terraform/modules/app/lambda-api/variables.tf` — add `compliance_drainer_secret_arn` (string).
- Modify: `terraform/modules/thinkwork/main.tf` — pass `module.database.compliance_drainer_secret_arn` to `module "api"` (lambda-api).
- Test expectation: none -- pure infrastructure config. Verification is `terraform plan` clean against dev + post-deploy CloudWatch logs showing `dispatched: true`.

**Approach:**
- Reserved concurrency = 1 set on the `aws_lambda_function.handler["compliance-outbox-drainer"]` resource via `reserved_concurrent_executions = 1`.
- Schedule mirrors `aws_scheduler_schedule.wakeup_processor` with the new function ARN as target.
- DLQ as `aws_sqs_queue.compliance_drainer_dlq` with 14-day retention. Operator alarm on DLQ depth > 0 is a future ops follow-up (CloudWatch alarm; not in this PR).
- Output `compliance_drainer_function_arn` for downstream consumers (none today; future ops dashboards).

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf` `aws_lambda_function.handler` block (line ~213).
- `aws_scheduler_schedule.wakeup_processor` block (rate(1 minutes), default group, scheduler IAM role).
- `aws_lambda_function_event_invoke_config.wiki_compile` (line ~442) for the MaximumRetryAttempts=0 + DLQ pattern.

**Test scenarios:**
- *Manual smoke:* `terraform plan` against dev shows the new resources (1 Lambda, 1 schedule, 1 SQS queue, 1 invoke-config); no changes to existing resources. Apply succeeds. Lambda invokes per schedule visible in CloudWatch logs.
- *Manual verify:* CloudWatch log group `/aws/lambda/thinkwork-dev-compliance-outbox-drainer` shows structured `{drained_count, dispatched: true}` lines on every minute.

**Verification:** `terraform plan` clean; first deploy after merge shows the new Lambda + schedule active in dev.

---

- U4. **Integration test: end-to-end emit → drain → audit_events**

**Goal:** Black-box integration test that exercises the full Phase 3 write path (U3 helper + U4 drainer logic) against the real dev `compliance.audit_outbox` and `compliance.audit_events` tables. Doesn't deploy the Lambda — instead invokes the drainer's main function in-process so the test is hermetic.

**Requirements:** R5, R6, R12.

**Dependencies:** U1, U2.

**Files:**
- Create: `packages/api/test/integration/compliance-drainer/end-to-end.integration.test.ts`

**Approach:**
- Skip when `DATABASE_URL` env not set (matches existing integration test pattern from `compliance-emit/`).
- Test scenario: open db.transaction → call `emitAuditEvent` 3 times for tenant T (different events) → commit. Then call drainer's `processOutboxBatch(db, batchSize=10)` directly (extracted from the Lambda handler so it's testable). Then SELECT from `compliance.audit_events` for tenant T and assert: 3 rows; chain links correct; outbox rows all marked drained_at.
- Cleanup: explicitly DELETE the test rows (override the immutability trigger by using superuser credentials in the test path — but the trigger blocks DELETE for everyone, so the test must use an isolated tenant_id and accept the rows persist). Use `tenant_id = '99999999-9999-9999-9999-999999999999'` (test-only sentinel) so the rows are easy to identify in dev.

**Pattern to follow:**
- `packages/api/test/integration/compliance-emit/compliance-emit.integration.test.ts` — same skip-on-missing-DATABASE_URL pattern + Drizzle transaction shape.

**Test scenarios:**
- *Integration (covers R5 + R12):* 3 events emitted → drainer runs once → 3 events_audit rows present; chain verifies (each row's prev_hash matches predecessor's event_hash; first row has prev_hash NULL).
- *Integration (idempotency):* running `processOutboxBatch` twice on the same outbox state — second run is a no-op (drained_count: 0).
- *Integration (multi-tenant chain isolation):* emit events for two tenants interleaved; drain; assert tenant A's chain is independent of tenant B's (A's prev_hash links never reference B's event_hash).
- *Integration (poison-row):* Emit a row, then directly UPDATE outbox to set a malformed `payload` that breaks canonicalization (e.g., a circular reference — actually impossible from JSON-input, so simulate via mocking the canonicalizer to throw on a specific event_id). Run drainer. Assert: row has drainer_error set; subsequent run skips it; other rows drain successfully.

**Execution note:** Test needs to be hermetic — running from CI, it can't leave audit_events rows in dev because the immutability triggers prevent cleanup. Two options: (a) use a dedicated test-tenant_id and accept the rows persist (cheapest, fine for dev); (b) wrap each test in `DROP TRIGGER ... ENABLE TRIGGER` cycle (requires drainer role to have ALTER TABLE — bad). Recommend (a). Operator runbook: periodic cleanup of `tenant_id = '99999999-...'` rows from dev's `audit_events` is a Phase 4 retention concern.

**Verification:** Test passes against dev when DATABASE_URL is set. Run via `DATABASE_URL=... pnpm --filter @thinkwork/api test test/integration/compliance-drainer`.

---

## System-Wide Impact

- **Interaction graph:** EventBridge Scheduler fires drainer Lambda every minute. Lambda connects to Aurora as compliance_drainer. Reads outbox, writes events. No callbacks, no observers — purely scheduled batch work.
- **Error propagation:** Per-row failures land in `audit_outbox.drainer_error`; observable in admin UI (U10) + CloudWatch logs. Lambda-level failures (timeout, OOM, DB unreachable) hit the SQS DLQ; MaximumRetryAttempts=0 prevents retry storms.
- **State lifecycle risks:** Outbox grows unbounded (no retention sweep until Phase 4). Reserved-concurrency=1 + idempotent INSERT ... ON CONFLICT means crashes don't cause data corruption. The 1-minute drain latency is acceptable for SOC2 evidence; if Lambda is offline for > 24h, backlog catches up at 50/minute = ~72k events/day catch-up rate.
- **API surface parity:** None. Drainer is in-process Lambda only; no HTTP / GraphQL surface.
- **Integration coverage:** U3 + U4 integration tests together verify the full write path. U5 (when consumers wire) will assert end-to-end resolver→outbox→drainer→events flow with real mutations.
- **Unchanged invariants:** No GraphQL types change. No SQL schema change. No new packages — only `packages/lambda/compliance-outbox-drainer.ts` + Terraform additions. The U3 helper signature is unchanged; the drainer reads from outbox, doesn't extend the helper.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Reserved-concurrency=1 fails (regional Lambda misconfig); two drainers race the chain | `FOR UPDATE SKIP LOCKED` is defense-in-depth; second drainer skips locked rows. Worst case: one drainer's batch stalls until the other commits, which is just a serialization point. |
| Hash function or canonicalization changes; old chains can't be re-verified | `payload_schema_version` field is in the envelope; future canonicalization changes bump the version, verifier (U9) handles per-version. Schema is locked from U1. |
| Drainer crashes mid-batch; some rows have drained_at + corresponding audit_events row, others don't | Per-row transactions ensure each row commits atomically. Crash between INSERT events and UPDATE outbox → next run's ON CONFLICT no-ops the events insert and the UPDATE retries. |
| Poison row (e.g., extreme payload bloat in jsonb) blocks all downstream rows | `drainer_error` column + filter-on-NULL skips poison rows on subsequent invocations. Operator clears the column to retry. Lag metric (`oldest_age_ms`) flags accumulating backlog. |
| Aurora connection pool exhausted under sustained backlog | Single-writer drainer = single connection. Connection cached at module scope across Lambda warm invocations. Cold start re-fetches secret + reconnects (~200ms one-time cost). |
| Schedule fires faster than batch can drain → invocation overlap | `reserved_concurrent_executions = 1` rejects overlapping invocations (Lambda returns 429). Acceptable; the next minute's invocation drains the next batch. |
| `compliance_drainer` role doesn't exist in dev (U2 bootstrap not yet run) | The compliance-bootstrap CI step (added in PR #887 to deploy.yml) runs BEFORE migration-drift-check. Drainer Lambda boot fails fast on missing role → CloudWatch error. Operator runs `STAGE=dev bash scripts/bootstrap-compliance-roles.sh` to recover. |
| Tenant chain head SELECT becomes slow at 400+ tenants × millions of events | `idx_audit_events_tenant_occurred` is a btree on (tenant_id, occurred_at DESC); LIMIT 1 lookup is O(log n) per row. Memoize within batch (Phase 4 optimization). |
| The `oldest_age_ms` query scans full outbox each invocation at scale | Partial index `idx_audit_outbox_pending` from U1 covers `WHERE drained_at IS NULL`. Lookup is bounded by outbox depth, which is small at steady state. |
| `payload_oversize_s3_key` is opaque to the drainer; if S3 object is corrupted, the chain still includes the key but not the content | Documented scope boundary. Phase 4 anchoring + verification will need to read S3 objects to fully validate; v1 chain integrity is bounded by the in-row payload field only. |

---

## Documentation / Operational Notes

- **CloudWatch alarms (deferred to ops follow-up):** `oldest_age_ms > 5 min`, `error_count > 0`, `DLQ depth > 0`.
- **Runbook section in `terraform/modules/data/aurora-postgres/README.md` or new `docs/runbooks/compliance-drainer.md`:** how to investigate poison rows (`SELECT * FROM compliance.audit_outbox WHERE drainer_error IS NOT NULL`); how to clear and retry (`UPDATE ... SET drainer_error = NULL`); how to manually drain (`pnpm --filter @thinkwork/lambda invoke compliance-outbox-drainer`).
- **Memory update post-merge:** append U4 progress to `project_system_workflows_revert_compliance_reframe.md`.
- **Smoke pinning:** the drainer's response payload includes `dispatched: true` + `drained_count` so deploy smoke can pin observed activity (no log filter).

---

## Sources & References

- **Origin document (master plan):** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`
- **Master plan U4 spec:** see master plan §"Implementation Units / Phase B — Write path / U4"
- **Decision #1 (single-writer outbox drainer):** master plan §"Key Technical Decisions / 1. Hash chain linearization"
- **Phase 3 progression:** PR #880 (U1, merged), PR #887 (U2, merged with CI bootstrap), PR #890 (U3, merged)
- **Patterns:** `packages/lambda/job-trigger.ts`, `packages/lambda/job-schedule-manager.ts`, `terraform/modules/app/lambda-api/handlers.tf` (`aws_lambda_function.handler`, `aws_scheduler_schedule.wakeup_processor`)
- **External:** PostgreSQL `FOR UPDATE SKIP LOCKED` queue pattern docs.
