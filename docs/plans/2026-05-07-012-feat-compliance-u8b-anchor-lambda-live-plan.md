---
title: "feat: Compliance U8b — Anchor Lambda live (S3 PutObject + Object Lock retention)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat: Compliance U8b — Anchor Lambda live (S3 PutObject + Object Lock retention)

## Summary

The live phase of the inert→live seam swap. `_anchor_fn_inert` is replaced with `_anchor_fn_live`, which writes WORM-protected anchor JSON to `s3://thinkwork-${stage}-compliance-anchors/anchors/cadence-{cadence_id}.json` (SSE-KMS, Object Lock retention = 365 days) and per-tenant proof slices to `proofs/tenant-{tenant_id}/cadence-{cadence_id}.json` (no Object Lock — slices are derivable from the chain + anchor). The watchdog flips from `mode: "inert"` → `"live"`, lists newest anchors via `ListObjectsV2`, computes `oldest_unanchored_age_ms`, and emits `ComplianceAnchorGap` (1 if gap > 30 min). The CloudWatch alarm flips `treat_missing_data` from `notBreaching` → `breaching` and gains a sibling alarm on `ComplianceAnchorWatchdogHeartbeat IS MISSING` so a watchdog metrics-IAM regression doesn't masquerade as a real anchor gap. U8a's `getWiredAnchorFn() === _anchor_fn_inert` Vitest assertion is **replaced** (not deleted) with `expect(S3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))` — the structural body-swap safety the U8a forcing function was set up to demand. Watchdog gets a sibling IAM role with S3 read perms scoped to `${bucket_arn}/anchors/*` (closing the U8a SEC-U8A-002 finding).

---

## Problem Frame

U8a shipped the inert anchor pipeline (schedule, chain-head SELECT, Merkle compute, dispatch-pin response) and ran for less than 24h in dev before this PR opens — the soak window is the operator's manual checklist item, not the merge gate. U8b is the body-only diff that flips the seam call from a return-only stub to real S3 PutObject + Object Lock retention writes, turning the per-tenant Merkle leaves + global root into externally-verifiable WORM evidence that survives database compromise. From this PR forward the dev `compliance-anchors` bucket starts accumulating GOVERNANCE-mode-locked objects that survive `terraform destroy` until retention expires.

---

## Requirements

- R1. `_anchor_fn_live` writes the global anchor JSON to `${COMPLIANCE_ANCHOR_BUCKET_NAME}/anchors/cadence-{cadence_id}.json` via `PutObjectCommand` with `ContentType: "application/json"`, `ServerSideEncryption: "aws:kms"`, `SSEKMSKeyId: ${COMPLIANCE_ANCHOR_KMS_KEY_ARN}`, **`ChecksumAlgorithm: "SHA256"` (explicit — defends against future SDK default-checksum drift)**, `ObjectLockMode: ${COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE}` ("GOVERNANCE" or "COMPLIANCE"), `ObjectLockRetainUntilDate: now + retention_days * 86400000ms` (UTC `Date` instance). Anchor object body: `{schema_version: 1, cadence_id, recorded_at, merkle_root, tenant_count, anchored_event_count, recorded_at_range: {min, max}, leaf_algorithm: "sha256_rfc6962", proof_keys: [...]}`. **`proof_keys` is derived from `tenantSlices` in the same expression that constructs the slice S3 keys** — single source of truth, no copy-paste divergence (security defense from cross-reviewer SEC-U8B-006). (Origin: master plan U8 line 553 — the U8b approach paragraph; this requirement is U8b-specific, not a master-plan requirement.)
- R2. Per-tenant proof slices written to `${COMPLIANCE_ANCHOR_BUCKET_NAME}/proofs/tenant-{tenant_id}/cadence-{cadence_id}.json` with the same SSE-KMS configuration + **`ChecksumAlgorithm: "SHA256"`**. **No per-object Object Lock retention override** — the bucket-default applies (Decision #4). Slice body: `{schema_version: 1, tenant_id, latest_event_hash, latest_recorded_at, latest_event_id, leaf_hash, proof_path, global_root, cadence_id}`. (Origin: master plan U8 line 554 — U8b approach paragraph.)
- R3. Anchor PutObject + slice PutObjects happen in **slices-first, anchor-last order** so a partial-write failure leaves no anchor object pointing at missing slice keys (Decision #3). All slice writes parallel via `Promise.all` with bounded concurrency via `p-limit` (already a `packages/lambda` dependency).
- R3a. **Cadence ID is deterministic from the chain-head fingerprint** (`sha256(JSON.stringify(sorted chain heads))[0:32]` → UUIDv7-shaped string). Same chain heads → same cadence_id. This makes retries idempotent on the slice keys: a failed write that retries on the next cadence (with the same un-advanced `tenant_anchor_state`) reuses the same `cadence-{id}.json` keys, overwriting the partial state cleanly. With UUIDv7 (per-cadence-run timestamps), retry under the same heads would generate a NEW cadence_id and orphan the prior slices for 365 days. Decision #5a.
- R4. AnchorResult adds two optional fields when `anchored: true`: `s3_key: "anchors/cadence-{cadence_id}.json"` and `retain_until_date: ISO8601 string`. Existing fields are unchanged (master plan Decision #1, R13 from U8a plan). The smoke gate (existing `compliance-anchor-smoke.ts`) updates assertions to `dispatched: true && anchored: true && s3_key matches /^anchors\/cadence-[0-9a-f-]+\.json$/ && retain_until_date is ISO8601`.
- R5. Watchdog flips to live: `getWatchdogResult()` lists the `anchors/` prefix via `ListObjectsV2Command` (paginated; aborts after one page since most-recent objects are within the first 1000), sorts client-side by `LastModified` desc, takes max. Computes `oldest_unanchored_age_ms = (now - max(LastModified))`. Emits `ComplianceAnchorGap` (value `1` if gap > 30 min, else `0`) with the same dimensions as the heartbeat. Heartbeat continues firing every invocation. Returns `{mode: "live", checked_at, oldest_unanchored_age_ms}` — note `oldest_unanchored_age_ms` is now a number, not nullable (or nullable only when zero objects exist in the bucket — first-cadence-after-deploy edge case).
- R6. CloudWatch alarm `compliance_anchor_gap` flips `treat_missing_data` from `notBreaching` → `breaching`. New sibling alarm `compliance_anchor_watchdog_heartbeat_missing` watches `ComplianceAnchorWatchdogHeartbeat` with `treat_missing_data = "breaching"`, threshold = 1, statistic `SampleCount`, evaluation_periods = 2, period = 300; description names "watchdog Lambda is not invoking — anchor-gap alarm cannot be trusted". Both alarms keep `alarm_actions = []` (no SNS topic in repo).
- R7. Watchdog moves to a **new sibling IAM role** `thinkwork-${stage}-compliance-anchor-watchdog-lambda-role` (closing U8a SEC-U8A-002). Trust policy: `lambda.amazonaws.com` + `aws:SourceAccount = var.account_id` + `aws:SourceArn` pinned to the watchdog function ARN via string-construction (mirrors U8a anchor role pattern). Inline policies: `AWSLambdaBasicExecutionRole` (managed), `s3:ListBucket` on `${bucket_arn}` with `Condition.StringLike.s3:prefix = "anchors/*"`, `s3:GetObject` on `${bucket_arn}/anchors/*`, `kms:Decrypt` + `kms:DescribeKey` on the CMK (HeadObject on SSE-KMS objects requires Decrypt), `cloudwatch:PutMetricData` on `*` with namespace condition `Thinkwork/Compliance`. The shared `compliance_watchdog_metrics` policy on the shared lambda role is **removed** (cleanup; the metric capability moves with the watchdog).
- R8. `_anchor_fn_inert` is **replaced** with `_anchor_fn_live` — the inert export is removed. The body-swap forcing function in `compliance-anchor.integration.test.ts` is replaced (NOT deleted) with: (a) `getWiredAnchorFn() === _anchor_fn_live` (sibling change to U8a's assertion); (b) **a new mock-based unit test that spies on `S3Client.send` and asserts it was called with at least one `PutObjectCommand` instance** when running `runAnchorPass` against the production-wired handler. This is the structural body-swap safety the U8a comment promised.
- R9. Module-load env snapshot in `getAnchorEnv()` adds `mode` and `kmsKeyArn`. `mode` reads `process.env.COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE || "GOVERNANCE"`; `kmsKeyArn` reads `process.env.COMPLIANCE_ANCHOR_KMS_KEY_ARN || ""` with a runtime guard that throws `"compliance-anchor: COMPLIANCE_ANCHOR_KMS_KEY_ARN is required"` on first invocation if empty. Terraform threads both env vars on the standalone `aws_lambda_function.compliance_anchor` resource — `kmsKeyArn` is sourced from `module.compliance_anchors.kms_key_arn` (new module output that mirrors `module.kms.key_arn`).
- R10. README at `terraform/modules/data/compliance-audit-bucket/README.md` adds a "Dev cleanup after U8b ships" section explaining (a) GOVERNANCE-mode dev buckets contain real WORM bytes from this point — the existing playbook still works (admin role + `s3:BypassGovernanceRetention`); (b) bucket-name reuse latency applies post-cleanup; (c) S3 ListBucket/GetObject permissions in the operator's admin role are required for the cleanup script.
- R11. Smoke gate update: `packages/api/src/__smoke__/compliance-anchor-smoke.ts` updates the anchor assertion from `anchored === false` → `anchored === true` and adds `s3_key` + `retain_until_date` shape checks. Watchdog assertion updates from `mode === "inert"` → `mode === "live"`. The inline `WatchdogMode` const-union `"inert" | "live"` already supports both; only the runtime literal changes.

---

## Scope Boundaries

- COMPLIANCE-mode prod cutover. Master plan defers; U8b ships GOVERNANCE-by-default for all stages including prod. The COMPLIANCE flip is a separate one-line tfvars change at audit-engagement time, gated by U7's plan-time precondition (Decision #1 in U7 plan).
- Verifier CLI (U9). U8b's anchor JSON shape is the contract U9 consumes; locking the schema here prevents an awkward U9 renegotiation, but the verifier itself is U9 scope.
- Admin Compliance UI (U10).
- Async export job (U11).
- Cross-region replication of the anchor bucket.
- Per-object retention overrides shorter than the bucket default for `proofs/`. Decision #4 picks "let bucket default apply" for v1; revisit when U10's UI surfaces "expected slice retention" to operators.
- KMS key rotation policy changes; the existing thinkwork CMK rotation cadence applies.
- Migration changes — none. `compliance.tenant_anchor_state` schema is unchanged from U8a.

### Deferred to Follow-Up Work

- **Anchor object schema versioning.** The body includes `schema_version: 1`. A `schema_version: 2` is foreseeable when (e.g.) per-tenant slice manifests change. Versioning is the explicit lever; consumers (U9 verifier) must reject unknown versions.
- **`proofs/` lifecycle rule** for cost containment when slice volume grows. Today the bucket-default Object Lock retention applies (365 days). A separate lifecycle rule moving `proofs/` to Glacier IR after 30 days would cut cost but adds complexity. Defer until production volume informs the threshold.
- **Watchdog "first cadence after deploy" guard.** When the bucket has zero anchor objects (greenfield deploy), `oldest_unanchored_age_ms = now - epoch` which is huge and trips the alarm immediately. Decision #6 mitigates by defaulting to `null` when zero objects, suppressing the gap metric. A more graceful version checks `compliance.tenant_anchor_state` for "any tenant has un-anchored events, but anchor bucket is empty" and emits a separate one-shot setup metric. Defer.
- **SNS topic + alarm routing.** Both alarms still have `alarm_actions = []`. Once a shared `module.alarms.alarm_topic_arn` exists, wire it. Out of U8b scope.

---

## Context & Research

### Relevant Code and Patterns

- `packages/lambda/compliance-anchor.ts` (U8a) — the file U8b modifies. `_anchor_fn_inert` returns `{anchored: false}`; replace with `_anchor_fn_live` that calls S3. Module-load env snapshot, lazy `_readerDb`/`_drainerDb`, `runAnchorPass` shape, `AnchorResult` with optional `s3_key`/`retain_until_date` are all preserved.
- `packages/lambda/compliance-anchor-watchdog.ts` (U8a) — the file U8b modifies for the live watchdog. Heartbeat metric emit + lazy CW client + error-invalidation continue.
- `packages/lambda/github-workspace.ts` lines 491-540 (existing `PutObjectCommand` pattern) and lines 583-605 (existing `ListObjectsV2Command` pattern). Closest in-repo analog for the SDK shapes.
- `packages/lambda/routine-task-python.ts` lines 358-366 — another `PutObjectCommand` example with structured body + ContentType.
- `packages/lambda/compliance-outbox-drainer.ts` (U4) — error-handling pattern: structured-log + rethrow, no swallow-and-continue.
- `terraform/modules/data/compliance-audit-bucket/main.tf` (U7) — module that owns the anchor IAM role; new `kms_key_arn` output and watchdog sibling role land here.
- `terraform/modules/app/lambda-api/handlers.tf` (U8a) — alarm + watchdog Lambda + scheduler. Watchdog moves from for_each (with `aws_iam_role.lambda` shared role) to a standalone `aws_lambda_function` resource using the new sibling role; the alarm definition flips `treat_missing_data` and gains a sibling.
- `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts` (U8a) — body-swap forcing function lives here; replace per R8.
- `packages/api/src/__smoke__/compliance-anchor-smoke.ts` (U8a) — smoke gate; update per R11.
- `terraform/modules/data/compliance-audit-bucket/README.md` (U7 + U8a) — playbook; update per R10.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — the pattern this PR is the live phase of. U8a was the first compliance instance; U8b is the cutover. The doc names the body-swap safety test as the structural protection — U8a deferred it to U8b, and R8 lands it.
- `feedback_smoke_pin_dispatch_status_in_response` — anchor smoke continues to pin response payload, now flipping to `anchored: true`.
- `feedback_completion_callback_snapshot_pattern` + `feedback_vitest_env_capture_timing` — env snapshot in `getAnchorEnv()` adds `mode` and `kmsKeyArn`; never re-read inside per-invocation paths.
- `feedback_lambda_zip_build_entry_required` — no new Lambda zip entries; both `compliance-anchor` and `compliance-anchor-watchdog` already have build entries from U8a.
- `feedback_async_retry_idempotency_lessons` — Scheduler retry-0 still applies. S3 PutObject is idempotent on key (last-writer-wins); UUIDv7 prevents same-cadence collision; reserved-concurrency = 1 prevents two anchors racing.
- `feedback_handrolled_migrations_apply_to_dev` — N/A (no migration in U8b).
- `feedback_gha_env_context_job_if` — the existing `compliance-anchor-smoke` GHA job already uses `needs.terraform-apply.result == 'success'`, not `env.X`. No change.

### External References

- AWS [PutObject API reference](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html) — `ObjectLockMode` accepts `GOVERNANCE` | `COMPLIANCE`; `ObjectLockRetainUntilDate` is a `Date` (the SDK serializes to ISO 8601). With Object Lock enabled at bucket level, every PutObject either inherits the bucket-default or sets per-object overrides; setting per-object explicitly is required when the API caller wants a different mode/duration than the bucket default.
- AWS [Object Lock checksum requirement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html) — PutObject with retention requires `Content-MD5` or `x-amz-sdk-checksum-algorithm`. AWS SDK v3 includes a default checksum (SHA-256) starting with v3.502.0; verify the pinned version in `packages/lambda/package.json` is recent enough.
- AWS [ListObjectsV2 API reference](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) — does NOT sort by LastModified server-side. Sort client-side after fetch. With `MaxKeys = 1000` (default) and a 15-min cadence, the first page covers ~10 days of anchors; pagination is unnecessary for the watchdog's "newest anchor" query.

---

## Key Technical Decisions

1. **Per-object Object Lock retention is set explicitly** for `anchors/`, not relying on the bucket default. Pro: portable across buckets, makes the retention policy visible at the call site for review. Con: must be kept in sync with the bucket-default. Mitigation: both come from the same `var.compliance_anchor_object_lock_mode` + `var.compliance_anchor_object_lock_retention_days` Terraform vars; one source of truth.

2. **Anchor JSON body schema** (`schema_version: 1`):
   ```
   {
     schema_version: 1,
     cadence_id: "<UUIDv7>",
     recorded_at: "<ISO8601 — when the cadence ran>",
     merkle_root: "<64-hex>",
     tenant_count: <int>,
     anchored_event_count: <int>,
     recorded_at_range: {
       min: "<ISO8601 — earliest event_recorded_at in this cadence>",
       max: "<ISO8601 — latest>"
     },
     leaf_algorithm: "sha256_rfc6962",
     proof_keys: ["proofs/tenant-<tenant_id>/cadence-<cadence_id>.json", ...]
   }
   ```
   Per-tenant slice body (`schema_version: 1`):
   ```
   {
     schema_version: 1,
     tenant_id: "<UUID>",
     latest_event_hash: "<64-hex>",
     latest_recorded_at: "<ISO8601>",
     latest_event_id: "<UUIDv7>",
     leaf_hash: "<64-hex>",
     proof_path: [{hash: "<64-hex>", position: "left" | "right"}, ...],
     global_root: "<64-hex>",
     cadence_id: "<UUIDv7>"
   }
   ```
   Both bodies serialize via `JSON.stringify(...)` (no canonical-JSON discipline — these objects are not hashed; the Merkle tree was computed before serialization). U9 verifier consumes both.

3. **Slices-first, anchor-last write order with `p-limit` concurrency.** Decision rationale: a partial failure during slice writes leaves slices in S3 but no anchor object pointing at them — verifier never sees them, treated as junk. The reverse (anchor-first) leaves an anchor with `proof_keys` referencing slice keys that don't exist — verifier fails at slice fetch time. Slices-first is the safer order. Concurrency limit: 8 (matches the `p-limit` usage pattern in github-workspace.ts).

4. **`proofs/` retention: bucket-default applies (365 days).** Per-object retention override for proofs is left for a future PR. Pro: simpler, no special-cased call site. Con: proofs accumulate at the same rate as anchors and never expire under v1 lifecycle. Cost analysis at 400 tenants × hourly cadence: 35M slices/year. At ~2KB/slice = 70GB/year. Acceptable for v1; revisit when SOC2 Type 2 conversation lands.

5. **Watchdog sibling IAM role.** Closes U8a SEC-U8A-002. The shared `aws_iam_role.lambda` does NOT need S3 read on the anchor bucket. New `aws_iam_role.compliance_anchor_watchdog` is defined inside `terraform/modules/data/compliance-audit-bucket/main.tf` (alongside the U7 anchor role) so the bucket-scoped grants stay in the same module. The watchdog Lambda is **moved out of the for_each handler set** and becomes a standalone `aws_lambda_function` resource using the sibling role. Mirrors the U8a anchor Lambda's standalone-resource pattern.
   - **Watchdog role does NOT get `kms:Decrypt`.** Closes SEC-U8B-003. The watchdog calls only `ListObjectsV2` (which doesn't touch object bodies) and `cloudwatch:PutMetricData`. SSE-KMS Decrypt is unnecessary and would expand the role's blast radius unnecessarily. R7's IAM grant is `kms:DescribeKey` only on the CMK (used by some SDK pre-flight calls); future GetObject/HeadObject additions add Decrypt at that time.

5a. **Cadence ID is deterministic from chain-head fingerprint, not UUIDv7.** Closes ADV-001 orphan-slice gap. The seam function computes `cadence_id = hexToUuidv7Like(sha256(canonical_chain_heads))` where `canonical_chain_heads = JSON.stringify(heads.sort((a,b) => a.tenant_id.localeCompare(b.tenant_id)).map(h => ({tenant_id: h.tenant_id, event_hash: h.event_hash})))`. Same chain heads → same `cadence_id`. Retry behavior: when an anchor write fails and `tenant_anchor_state` rolls back, the next cadence (15 min later) sees the SAME chain heads and computes the SAME `cadence_id`. Slice writes overwrite the prior partial-state slices in-place (S3 last-writer-wins on key). No orphans. The U8a inert phase used `uuidv7()` for cadence IDs (no S3 writes meant no orphan risk); U8b's switch is bounded to the seam function.

6. **Watchdog "zero objects" first-cadence-after-deploy guard.** When `ListObjectsV2` returns zero `Contents`, return `{mode: "live", checked_at, oldest_unanchored_age_ms: null}` and emit `ComplianceAnchorGap = 0` (suppressed via not-emitting the metric). This prevents the alarm from firing on a fresh deploy before the first anchor cadence runs. Once the first anchor is written, subsequent cadences see ≥ 1 object and switch to the gap-computing path.

7. **Sibling alarm `compliance_anchor_watchdog_heartbeat_missing`.** Distinguishes "real anchor gap" (gap metric > 0) from "watchdog metric path broken" (heartbeat missing). Without it, an IAM regression on the watchdog's PutMetricData path makes `ComplianceAnchorGap IS MISSING`, which under `treat_missing_data = "breaching"` flips the gap alarm to ALARM — false positive. The heartbeat-missing alarm is the ground truth for "watchdog is alive"; if it's clear AND the gap alarm is in ALARM, the gap is real.
   - **Born-state mitigation (closes ADV-004).** The new heartbeat-missing alarm ships with `treat_missing_data = "notBreaching"` initially (not `breaching`). Reason: a fresh alarm has no prior data points, and `treat_missing_data = "breaching"` flips it from INSUFFICIENT_DATA → ALARM after `evaluation_periods × period = 10 min` even when the watchdog Lambda hasn't been invoked yet (the destroy-recreate window during this very deploy guarantees ≥ 1 missed cadence). Once the standalone watchdog has emitted the heartbeat metric for ≥ 2 evaluation periods (~10 min post-first-cadence), a follow-up PR flips `treat_missing_data` to `breaching`. Documented as a U8b deploy-runbook step.

8. **Anchor PutObject failure rolls back `tenant_anchor_state`.** U8a's `runAnchorPass` already wraps the drainer-side UPDATE in a transaction. U8b extends `_anchor_fn_live` to throw on any S3 failure; the transaction rolls back automatically. Next cadence retries with the same chain heads. S3 partial state (orphan slices, no anchor) is recovered on the next cadence — the slices are overwritten under the same key with the new cadence's content (idempotent on key).

9. **Watchdog migrates to standalone Lambda — env vars.** Existing for_each-managed env vars (STAGE, AWS_NODEJS_CONNECTION_REUSE_ENABLED) carry over. New env vars: `COMPLIANCE_ANCHOR_BUCKET_NAME` (already pre-plumbed in U8a). No new env vars beyond those.

10. **`@aws-sdk/client-s3` SDK version pin.** Already in `packages/lambda/devDependencies` from U8a (transitive). Verify ≥ 3.502.0 for default checksum; bump if older. AWS SDK v3 default ChecksumAlgorithm covers the Object Lock `Content-MD5`-or-checksum requirement.

11. **No new IAM grants for the anchor role.** U7 already granted `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:GetObjectRetention` on `${bucket}/anchors/*` AND `${bucket}/proofs/*`, plus `kms:GenerateDataKey` + `kms:Decrypt` + `kms:DescribeKey` on the CMK. The explicit Deny on `s3:BypassGovernanceRetention` + `s3:PutObjectLegalHold` continues to apply.

12. **Body-swap safety test pattern.** Two layers:
    - **Layer 1 (forcing function preserved from U8a)**: `getWiredAnchorFn() === _anchor_fn_live` — the sibling assertion. When a future PR rewires to a third function (`_anchor_fn_v2`?), this assertion fails and forces the rewrite to be deliberate.
    - **Layer 2 (substantive body-swap safety, NEW in U8b)**: Vitest test that builds the production handler WITHOUT injecting `anchorFn`, mocks `@aws-sdk/client-s3`'s `S3Client` constructor + `send` method, runs `runAnchorPass({readerDb, drainerDb})`, asserts `S3Client.prototype.send` was called with at least one `PutObjectCommand` instance. Pattern mirrors `packages/lambda/__tests__/routine-task-python.test.ts:43` (that file mocks `PutObjectCommand` via `vi.mock('@aws-sdk/client-s3', ...)`).

13. **Schema-version field for forward compatibility.** Both anchor JSON and slice JSON ship with `schema_version: 1`. U9 verifier rejects unknown versions; future schema changes increment the version. Cheap insurance.

14. **Cleanup of inert-only artifacts.** Delete: `_anchor_fn_inert` export, the `getWiredAnchorFn() === _anchor_fn_inert` assertion (replaced with `=== _anchor_fn_live`), the inline comment block in U8a's plan referencing "the inert function returns no S3 fields". Update: the README dev-cleanup playbook (now describes WORM-bytes-in-dev). The U7 + U8a cross-references in CHANGELOG-equivalent comments are kept.

15. **U8a soak window.** The master plan recommends ≥ 24h soak before U8b ships. U8b is shipping in the same day as U8a. Risk: any latent U8a bug surfaces here. Mitigation: U8b's smoke gate continues to assert `dispatched: true` (so any structural regression in the cadence pipeline is caught at deploy), and the body-swap safety test (Layer 2 above) explicitly verifies the seam call shape — the inert phase's primary purpose was proving the schedule + chain-head SELECT + Merkle compute paths; those paths haven't changed in U8b. **Plus** Decision #16 below adds a Merkle self-check defense.

16. **`_anchor_fn_live` Merkle self-check before PutObject** (closes ADV-002 wrong-bytes-in-WORM risk). Before writing the anchor JSON, the live function recomputes the Merkle root from the leaves it just received and asserts equality against the `merkleRoot` argument. Throws if mismatch. Cheap insurance: an arithmetic bug in `runAnchorPass`'s leaf assembly that produces an inconsistent (root, leaves) pair gets caught here before WORM-locking 365 days of poisoned audit evidence. The check is local-only (no S3 round-trip), runs once per cadence, ~1ms compute.

17. **Watchdog Lambda standalone migration uses `terraform state mv`** (closes FEAS-001 destroy-recreate ordering). U4 includes an explicit operator step in the merge runbook: `terraform state mv 'module.api.aws_lambda_function.handler["compliance-anchor-watchdog"]' 'module.api.aws_lambda_function.compliance_anchor_watchdog'` BEFORE running `terraform apply`. State move preserves the Lambda function (no destroy-recreate), and the subsequent apply only updates the role attachment + env vars in-place. Without this step, Terraform would attempt to create the new standalone (with the same `function_name`) before destroying the old for_each entry, throwing `ResourceConflictException: Function already exists`. The state-move is documented in U4's Approach + the U8b PR description as a required pre-merge operator step.

18. **Dev-stage COMPLIANCE-mode guard** (closes ADV-003 immovable-dev risk). U4 adds a sibling Terraform `precondition` to the U7 module's `aws_s3_bucket_object_lock_configuration.anchor` resource: `condition = !(var.stage != "prod" && var.mode == "COMPLIANCE")`. Plain English: dev / staging / any-non-prod stage cannot apply COMPLIANCE mode. The existing prod-side precondition (Decision #3 in U7 plan) covers prod-must-be-COMPLIANCE; this is the symmetric defense. Override exists for special-purpose audit-engagement testing via a new `var.allow_compliance_in_non_prod` flag (default false).

19. **Body-swap safety Layer 2 mock pattern** (closes ADV-005). The mock uses the proven pattern from `packages/lambda/__tests__/routine-task-python.test.ts:39-46`:
    ```
    const mockS3Send = vi.fn().mockResolvedValue({});
    vi.mock("@aws-sdk/client-s3", () => ({
      S3Client: class { send = mockS3Send; },
      PutObjectCommand: class PutObjectCommand { constructor(public input: any) {} },
      ListObjectsV2Command: class { constructor(public input: any) {} },
      HeadObjectCommand: class { constructor(public input: any) {} },
    }));
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    ```
    NOT `vi.fn().mockImplementation(() => ({send: vi.fn()}))` (which would give every `new S3Client()` a fresh per-instance spy and assertion fails to find calls). The shared `mockS3Send` instance property pattern is what intercepts the lazy-built `_s3` in production code.

20. **Watchdog ListObjectsV2 1000-key boundary guard** (closes ADV-006). When `IsTruncated == true` in the response, the watchdog logs `console.warn({level: "warn", msg: "compliance-anchor-watchdog: anchor bucket has > 1000 keys; sort-and-take-newest may be inaccurate", contents_count: 1000, is_truncated: true})`. Today the bucket-default key shape `cadence-{UUIDv7}.json` is approximately time-ordered AND we read+sort the entire page client-side, so the watchdog returns the correct newest WHEN total count ≤ 1000 (~10 days at 15-min cadence in dev). At >1000, the watchdog will return a stale newest from the first page; the warning surfaces it before false alarms fire. Pagination is deferred to a follow-up PR with a date-prefixed key scheme.

---

## Open Questions

### Resolved During Planning

- **Per-object retention vs bucket-default for `anchors/`.** Set explicitly per-object (Decision #1) — portable, visible at call site.
- **`proofs/` retention semantics.** Inherit bucket-default (Decision #4); cost-tighten in a follow-up.
- **Slice / anchor write ordering.** Slices-first, anchor-last (Decision #3).
- **Watchdog IAM model.** Sibling role in the U7 module (Decision #5).
- **Watchdog "no anchors yet" handling.** Suppress gap metric, return `null` for `oldest_unanchored_age_ms` (Decision #6).
- **Body-swap safety test shape.** Two-layer (preserve forcing function + add substantive S3-spy test) (Decision #12).
- **Cleanup scope.** Delete `_anchor_fn_inert`; preserve forcing-function pattern with sibling assertion (Decision #14).
- **U8a soak window.** Risk acknowledged, mitigated by smoke + body-swap safety; no calendar-time gate (Decision #15).

### Deferred to Implementation

- Whether to ship `_anchor_fn_inert` as `@deprecated` for one cycle vs delete immediately. Implementer choice; deletion is the recommendation.
- Specific `p-limit` concurrency value for parallel slice writes (8 is the recommendation; tune at first prod-volume run).
- Exact ContentType + Cache-Control headers on slice + anchor PutObject. `application/json` is the obvious answer; defer Cache-Control until U10's UI surface needs it.
- Which dimensions to include on the `ComplianceAnchorGap` metric (Stage is the only U8a heartbeat dimension; gap should match for alarm-cardinality consistency).

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                          AWS Scheduler rate(15 min)                AWS Scheduler rate(5 min)
                                    │                                          │
                                    ▼                                          ▼
                  ┌─────────────────────────────────┐         ┌──────────────────────────────────┐
                  │ Lambda compliance-anchor (LIVE) │         │ Lambda compliance-anchor-        │
                  │                                 │         │ watchdog (LIVE)                  │
                  │ readChainHeads (compliance_     │         │                                  │
                  │   reader)                       │         │ ListObjectsV2(prefix="anchors/") │
                  │ buildMerkleTree(0x00 leaf,      │         │ sort by LastModified desc        │
                  │   0x01 node prefixes)           │         │ newest = max(LastModified)       │
                  │ tenantSlices = [...proof_path]  │         │ gap_ms = now - newest            │
                  │                                 │         │                                  │
                  │ for slice in tenantSlices:      │         │ PutMetricData ComplianceAnchor   │
                  │   p-limit(8).PutObjectCommand(  │         │   Gap = (gap_ms > 30min ? 1 : 0) │
                  │     proofs/tenant-{id}/         │         │ PutMetricData                    │
                  │     cadence-{cid}.json,         │         │   ComplianceAnchorWatchdog       │
                  │     SSE-KMS, no lock override)  │         │   Heartbeat = 1                  │
                  │                                 │         │                                  │
                  │ // anchor LAST                  │         │ return {mode: "live",            │
                  │ PutObjectCommand(               │         │   checked_at, gap_ms or null}    │
                  │   anchors/cadence-{cid}.json,   │         │                                  │
                  │   SSE-KMS,                      │         │ // Standalone aws_lambda_        │
                  │   ObjectLockMode=$mode,         │         │ // function with sibling IAM     │
                  │   ObjectLockRetainUntilDate=    │         │ // role (S3 read scoped to      │
                  │     now+365d)                   │         │ // anchors/*, KMS Decrypt on CMK)│
                  │                                 │         └──────────────────────────────────┘
                  │ tx: UPDATE                      │                       │
                  │   tenant_anchor_state           │                       ▼
                  │   (compliance_drainer)          │       ┌──────────────────────────────────┐
                  │                                 │       │ CW alarm                         │
                  │ return {dispatched:true,        │       │ compliance_anchor_gap            │
                  │   anchored:true,                │       │   threshold=1, period=300        │
                  │   merkle_root, tenant_count,    │       │   evaluation_periods=2           │
                  │   anchored_event_count,         │       │   treat_missing_data=BREACHING   │
                  │   cadence_id,                   │       │   (was notBreaching in U8a)      │
                  │   s3_key, retain_until_date}    │       │                                  │
                  └─────────────────────────────────┘       │ CW alarm (NEW)                   │
                                                            │ compliance_anchor_watchdog_      │
                                                            │ heartbeat_missing                │
                                                            │   metric=Heartbeat,              │
                                                            │   threshold=1, statistic=Sample  │
                                                            │   Count, treat_missing_data=     │
                                                            │   BREACHING                      │
                                                            └──────────────────────────────────┘

                  Aurora compliance.audit_events (read as compliance_reader) — UNCHANGED
                  Aurora compliance.tenant_anchor_state (write as compliance_drainer) — UNCHANGED
                  S3 thinkwork-${stage}-compliance-anchors/anchors/* — NEW WRITES
                  S3 thinkwork-${stage}-compliance-anchors/proofs/tenant-{id}/* — NEW WRITES

                  Body-swap safety test (Layer 2, NEW):
                    vi.mock('@aws-sdk/client-s3', () => ({...spies...}));
                    runAnchorPass({readerDb, drainerDb});  // no anchorFn injection
                    expect(S3Client.prototype.send).toHaveBeenCalledWith(
                      expect.any(PutObjectCommand)
                    );
```

---

## Implementation Units

- U1. **Replace `_anchor_fn_inert` with `_anchor_fn_live` in `compliance-anchor.ts`**

**Goal:** Ship the live S3 PutObject + Object Lock retention writes for both the global anchor object and per-tenant proof slices. Keep the `runAnchorPass` shape unchanged; the seam swap is body-only.

**Requirements:** R1, R2, R3, R4, R8, R9, R14

**Dependencies:** None (file already exists from U8a)

**Files:**
- Modify: `packages/lambda/compliance-anchor.ts` — replace `_anchor_fn_inert` export + `getWiredAnchorFn` body; add `_anchor_fn_live` performing parallel slice PutObjects + final anchor PutObject; extend `getAnchorEnv` with `mode` + `kmsKeyArn`; extend `AnchorResult` shape with `s3_key` + `retain_until_date` (already optional in U8a, just populate).

**Approach:**
- Module-load env snapshot adds `mode` and `kmsKeyArn`. `kmsKeyArn` empty → throw on first invocation only (lazy guard in `getAnchorEnv` returns the env value; the seam function's first call validates it's non-empty before constructing the PutObjectCommand). Mirror U7's `kms_key_arn` validation pattern.
- Lazy `_s3` cache mirrors `_readerDb` / `_drainerDb` — `S3Client({region, requestHandler: {requestTimeout: 5000, connectionTimeout: 3000}})`, error-invalidation on `_s3` on `.send()` failure that originates from connection-level errors.
- `_anchor_fn_live(merkleRoot, tenantSlices, cadenceId)`:
  1. **Merkle self-check** (Decision #16): recompute `expectedRoot = computeRoot(tenantSlices.map(s => s.leaf_hash))` from the leaves we just received and assert `expectedRoot === merkleRoot`. Throws `"compliance-anchor: leaf-set / merkleRoot mismatch — caller passed inconsistent inputs"` on mismatch. Cheap insurance: ~1ms compute, prevents WORM-locking poisoned audit evidence on a `runAnchorPass` arithmetic bug.
  2. Compute `retainUntilDate = new Date(Date.now() + ENV.retentionDays * 86400 * 1000)`.
  3. **Construct slice keys ONCE** in a single expression that's reused for both PutObject and the anchor's `proof_keys` (closes SEC-U8B-006 referential-integrity gap): `const sliceKeyFor = (s) => \`proofs/tenant-${s.tenant_id}/cadence-${cadenceId}.json\`; const proofKeys = tenantSlices.map(sliceKeyFor);`.
  4. **Slices first**: build `slicePromises = tenantSlices.map(slice => limit(() => _s3.send(new PutObjectCommand({Bucket, Key: sliceKeyFor(slice), Body: JSON.stringify({schema_version: 1, ...slice, global_root: merkleRoot, cadence_id: cadenceId}), ContentType: "application/json", ServerSideEncryption: "aws:kms", SSEKMSKeyId: ENV.kmsKeyArn, ChecksumAlgorithm: "SHA256"}))))` — note no `ObjectLockMode`/`ObjectLockRetainUntilDate` (bucket-default applies for proofs/).
  5. `await Promise.all(slicePromises)`. Any rejection bubbles up; the outer `runAnchorPass` rolls back the drainer transaction.
  6. **Anchor last**: build anchor body with `proof_keys: proofKeys` (NOT a separately-constructed list). Then `await _s3.send(new PutObjectCommand({Bucket, Key: anchorKey, Body: anchorJson, ContentType: "application/json", ServerSideEncryption: "aws:kms", SSEKMSKeyId: ENV.kmsKeyArn, ChecksumAlgorithm: "SHA256", ObjectLockMode: ENV.mode, ObjectLockRetainUntilDate: retainUntilDate}))`.
  7. Return `{anchored: true, s3_key: anchorKey, retain_until_date: retainUntilDate.toISOString()}`.
- `getWiredAnchorFn()` returns `_anchor_fn_live` (sibling change to U8a's forcing function).
- Delete `_anchor_fn_inert` export. Tests inject custom `anchorFn` via `runAnchorPass({anchorFn: ...})` for stubs.
- `AnchorFn` type signature changes from `(merkleRoot, tenantSlices) => Pick<AnchorResult, "anchored"> & ...optional...` to `(merkleRoot, tenantSlices, cadenceId) => Promise<Pick<AnchorResult, "anchored"> & ...optional...>`. Async because S3.send returns a Promise. (Folded-in U2 — same file.)
- `runAnchorPass` awaits the now-async `anchorFn` call. Seam result spread into `AnchorResult` unchanged.
- **`runAnchorPass` cadence-id derivation flips from UUIDv7 to deterministic** (Decision #5a, closes ADV-001 orphan-slice gap). New helper `deriveCadenceId(heads: ChainHead[]): string`: sort `heads` by `tenant_id` ascending, JSON-stringify the canonical `[{tenant_id, event_hash}]` pairs, sha256, slice the first 32 hex chars and reshape to UUIDv7 form (set version + variant nibbles per RFC 9562). Same chain heads produce the same `cadence_id`; retries under unchanged `tenant_anchor_state` overwrite their own slices in-place. The seam contract's `cadence_id` field shape is unchanged (still UUIDv7-formatted hex string).

**Patterns to follow:**
- `packages/lambda/github-workspace.ts:491-540` (PutObjectCommand idiom)
- `packages/lambda/routine-task-python.ts:358-366` (PutObjectCommand with structured body)
- `packages/lambda/compliance-outbox-drainer.ts` (lazy `_db` + error-invalidation pattern, mirrored for `_s3`)

**Test scenarios:**
- *Happy path:* 2 tenants, slices first then anchor — verify call order via spy. Assert anchor's `ObjectLockMode = "GOVERNANCE"`, `ObjectLockRetainUntilDate ≈ now + 365 days`, `SSEKMSKeyId` matches env.
- *Edge case:* 0 tenants (empty heads) — Decision #6 path. `_anchor_fn_live` is still called, but `tenantSlices.length === 0` so no slice writes; anchor still writes (with empty `proof_keys: []` array). Verify the empty anchor object is created and `anchored: true`.
- *Edge case:* `var.kmsKeyArn = ""` — first invocation throws `"compliance-anchor: COMPLIANCE_ANCHOR_KMS_KEY_ARN is required"` before any S3 call.
- *Error path:* slice 5 of 10 throws — `Promise.all` rejects, `_anchor_fn_live` rejects, `runAnchorPass` rejects, drainer transaction rolls back, no anchor object written. Verify by checking S3 spy call count = 5 (5 succeeded before the rejection) and the anchor key is NOT in the spy call list.
- *Error path:* anchor PutObject throws (e.g., KMS access denied) — slices already in S3 (orphan), but `tenant_anchor_state` rolled back. Next cadence overwrites slices with same key, retries anchor. Idempotent.
- *Error path:* connection error on `_s3.send` — error-invalidation kicks in, `_s3 = undefined`, next invocation rebuilds.
- *Body-swap safety (Layer 2):* `vi.mock('@aws-sdk/client-s3', ...)`, run `runAnchorPass` with no `anchorFn` injection, assert `S3Client.prototype.send` called ≥ 1 time with PutObjectCommand for the anchor key. Decision #12 Layer 2.
- *Forcing function (Layer 1):* `expect(getWiredAnchorFn()).toBe(_anchor_fn_live)`.

**Verification:**
- TS compiles in `packages/lambda` with strict mode.
- Unit tests pass (mocked S3).
- Integration test (against dev DB) confirms `tenant_anchor_state.last_anchored_recorded_at` advances after `_anchor_fn_live` succeeds.
- Smoke gate's anchor invoke returns `anchored: true` with `s3_key` matching `/^anchors\/cadence-[0-9a-f-]+\.json$/`.

---

- U2. **(Folded into U1.)** The `AnchorFn` signature change + `runAnchorPass` await is part of U1's `compliance-anchor.ts` edit — same file, same logical change. U-ID U2 is reserved (per stability rule) but the unit's content lives in U1.

**Goal:** N/A (folded into U1 per scope-guardian SG-001).

**Requirements:** Covered by R8 in U1.

**Dependencies:** N/A.

**Files:**
- N/A — see U1.

**Approach:**
- `AnchorFn` becomes `(merkleRoot: string, tenantSlices: TenantSlice[], cadenceId: string) => Promise<{anchored: boolean; s3_key?: string; retain_until_date?: string}>`.
- `runAnchorPass`'s seam call: `const seamResult = await anchorFn(merkleRoot, tenantSlices, cadenceId)`.
- Update the integration test stubs to match (the existing `anchorFn: () => { throw new Error("simulated seam failure") }` becomes `async () => { throw new Error(...) }` — already a Promise via `async`).

**Patterns to follow:**
- U8a's `AnchorPassDeps.anchorFn` shape; just adding the third parameter.

**Test scenarios:**
- *Static review:* TS compiles with the updated signature.
- *Test stub update:* the existing rollback test passes after stub becomes async.

**Verification:**
- `pnpm --filter @thinkwork/lambda typecheck` clean.

---

- U3. **Replace inert watchdog body with live S3-listing logic**

**Goal:** Watchdog now actually checks anchor freshness. Lists `anchors/` prefix, computes gap, emits `ComplianceAnchorGap` metric, returns `{mode: "live", ...}`.

**Requirements:** R5, R7 (env var carries over)

**Dependencies:** None (file exists from U8a)

**Files:**
- Modify: `packages/lambda/compliance-anchor-watchdog.ts` — replace inert handler body with live S3 logic.

**Approach:**
- Module-load env snapshot now also reads `kmsKeyArn` (for SSE-KMS GetObject — though HeadObject/ListObjectsV2 don't strictly need Decrypt, the IAM policy in R7 grants both for clarity).
- Lazy `_s3` cache mirrors the anchor Lambda pattern.
- `runWatchdog`:
  1. `ListObjectsV2Command({Bucket: ENV.anchorBucketName, Prefix: "anchors/", MaxKeys: 1000})`.
  2. If `Contents` is empty or undefined → return `{mode: "live", checked_at, oldest_unanchored_age_ms: null}` and emit only the heartbeat (no `ComplianceAnchorGap` emit). Decision #6.
  3. Otherwise, sort `Contents` by `LastModified` desc client-side. Take `[0].LastModified`. Compute `gap_ms = Date.now() - newest.getTime()`.
  4. Emit `ComplianceAnchorGap = (gap_ms > 30 * 60 * 1000) ? 1 : 0` to namespace `Thinkwork/Compliance` with `Stage` dimension.
  5. Emit heartbeat as before.
  6. Return `{mode: "live", checked_at, oldest_unanchored_age_ms: gap_ms}`.
- `mode: "live"` is the new literal; `WatchdogMode` const-union from U8a already covers both values.

**Patterns to follow:**
- `packages/lambda/github-workspace.ts:583-605` (ListObjectsV2Command idiom)
- U8a watchdog's heartbeat-emit + error-invalidation pattern

**Test scenarios:**
- *Happy path:* dev bucket has 5 anchor objects, newest 2 minutes ago — `oldest_unanchored_age_ms ≈ 120000`, `ComplianceAnchorGap = 0` emitted, return `mode: "live"`.
- *Edge case:* anchor bucket is empty (greenfield deploy) — `oldest_unanchored_age_ms: null`, no `ComplianceAnchorGap` emit, heartbeat still fires.
- *Edge case:* newest anchor is 31 minutes old — `ComplianceAnchorGap = 1` emitted.
- *Error path:* `ListObjectsV2` throws (e.g., IAM regression) — heartbeat NOT emitted (the throw propagates before the metric call), watchdog Lambda returns error to Scheduler; the `compliance_anchor_watchdog_heartbeat_missing` alarm catches this.
- *Error path:* `PutMetricData` for gap throws (e.g., CloudWatch regional blip) — caught + logged + invalidate `_cw`, but watchdog still returns success (heartbeat already fired).

**Verification:**
- TS compiles.
- Unit tests pass.
- Smoke gate's watchdog invoke returns `mode: "live"`.

---

- U4. **Terraform: watchdog standalone Lambda + sibling IAM role + alarm cutover + new heartbeat-missing alarm**

**Goal:** Move the watchdog out of the for_each handler set into a standalone resource using the new sibling IAM role. Flip the gap alarm's `treat_missing_data` to `breaching`. Add the heartbeat-missing alarm. Remove the now-orphaned `compliance_watchdog_metrics` policy on the shared lambda role.

**Requirements:** R6, R7

**Dependencies:** U3 (the Lambda body must exist when Terraform references the function ARN for `aws:SourceArn`)

**Files:**
- Modify: `terraform/modules/data/compliance-audit-bucket/main.tf`:
  - Add `aws_iam_role.compliance_anchor_watchdog` + inline policies: (a) `AWSLambdaBasicExecutionRole` managed-policy attachment, (b) `s3:ListBucket` on `${bucket_arn}` with `Condition.StringLike.s3:prefix = "anchors/*"`, (c) `s3:GetObject` on `${bucket_arn}/anchors/*`, (d) `kms:DescribeKey` on the CMK (NOT `kms:Decrypt` — Decision #5 closing SEC-U8B-003), (e) `cloudwatch:PutMetricData` with namespace condition `Thinkwork/Compliance`. Trust policy mirrors the U7 anchor role pattern: `aws:SourceAccount = var.account_id` + `aws:SourceArn` constructed from `${var.region}/${var.account_id}/${var.stage}` (with the same `length(var.region) > 0 && var.region == trimspace(var.region)` validation block on `var.region` — already exists from U7/U8a).
  - **Add `lifecycle.precondition` to `aws_s3_bucket_object_lock_configuration.anchor`** rejecting `(var.stage != "prod" && var.mode == "COMPLIANCE")` unless `var.allow_compliance_in_non_prod == true` (new variable, default `false`). Closes ADV-003 dev-COMPLIANCE-tfvars-typo immovability risk. Decision #18.
- Modify: `terraform/modules/data/compliance-audit-bucket/variables.tf` — add `allow_compliance_in_non_prod` (bool, default false).
- Modify: `terraform/modules/data/compliance-audit-bucket/outputs.tf` — add `watchdog_lambda_role_arn` + `watchdog_lambda_role_name` + `kms_key_arn` (the U7 module already has the bucket but doesn't expose the KMS ARN — the consumer Lambda needs it for the SSE-KMS env var).
- Modify: `terraform/modules/app/lambda-api/handlers.tf`:
  - **Remove** `compliance-anchor-watchdog` from the for_each handler set (line ~390 of handlers.tf).
  - **Add standalone** `aws_lambda_function.compliance_anchor_watchdog` (mirrors the U8a anchor Lambda's standalone shape; uses `var.compliance_anchor_watchdog_lambda_role_arn`; `function_name = "thinkwork-${var.stage}-api-compliance-anchor-watchdog"` — same name as the for_each-derived name so the schedule resource's invoke continues to work).
  - **Update** `aws_iam_role_policy.scheduler_invoke.Resource` to extend the existing `concat()` with `aws_lambda_function.compliance_anchor_watchdog[*].arn` (explicit step, not parenthetical — closes SEC-U8B-005).
  - **Update** `aws_scheduler_schedule.compliance_anchor_watchdog.target.arn` to reference `aws_lambda_function.compliance_anchor_watchdog[0].arn`.
  - **Remove** `aws_iam_role_policy.compliance_watchdog_metrics` from the shared `aws_iam_role.lambda` — closes SEC-U8B-004. Operator pre-merge audit step: `grep -rn "Thinkwork/Compliance" packages/lambda packages/api/src` confirms no other handler in the for_each set emits to that namespace (currently only the watchdog does).
  - **Flip** `aws_cloudwatch_metric_alarm.compliance_anchor_gap.treat_missing_data` from `notBreaching` → `breaching`. Update description.
  - **Add** `aws_cloudwatch_metric_alarm.compliance_anchor_watchdog_heartbeat_missing` per R6, with `treat_missing_data = "notBreaching"` initially per Decision #7's born-state mitigation.
  - **Add COMPLIANCE_ANCHOR_KMS_KEY_ARN env var** to the existing standalone `aws_lambda_function.compliance_anchor.environment.variables` (per folded-in U5).
- Modify: `terraform/modules/app/lambda-api/variables.tf` — add `compliance_anchor_watchdog_lambda_role_arn` + `compliance_anchor_watchdog_lambda_role_name` + `compliance_anchor_kms_key_arn` (default empty, threaded from U7 module via composite root).
- Modify: `terraform/modules/thinkwork/main.tf` — thread the three new variables from `module.compliance_anchors` outputs to `module.api`.

**Pre-merge operator step (REQUIRED — Decision #17):**

Before merging this PR (and before the post-merge `terraform apply` runs in CI), an operator with dev tfstate access runs:

```
terraform state mv \
  'module.api.aws_lambda_function.handler["compliance-anchor-watchdog"]' \
  'module.api.aws_lambda_function.compliance_anchor_watchdog'
```

This preserves the existing watchdog Lambda (no destroy-recreate) — the subsequent apply only updates the role attachment + env vars in-place. Without this step, `terraform apply` throws `ResourceConflictException: Function already exists` because both the for_each and the standalone declare the same `function_name`. The state-move is a one-line operation; documented here + in the U8b PR description as a required pre-merge gate.

**Approach:**
- Sibling watchdog role lives in U7 module (not in lambda-api) so the bucket-scoped grants (`s3:ListBucket` on `${aws_s3_bucket.anchor.arn}`) are co-located with the bucket resource. Same idiom U7 used for the anchor role.
- Watchdog standalone resource: `function_name = "thinkwork-${var.stage}-api-compliance-anchor-watchdog"` (matches the existing for_each-derived name so `aws:SourceArn` continues to match the Scheduler's invoke). `role = var.compliance_anchor_watchdog_lambda_role_arn`. `timeout = 30`, `memory_size = 512`. Env vars: `STAGE`, `AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"`, `COMPLIANCE_ANCHOR_BUCKET_NAME`.
- Removing the watchdog from for_each is a `terraform plan` destroy-recreate at the function level — but the function NAME is preserved, so the Scheduler target update is in-place and the smoke gate continues to work. Terraform graph: destroy `aws_lambda_function.handler["compliance-anchor-watchdog"]`, create `aws_lambda_function.compliance_anchor_watchdog`. Brief downtime window during apply (~30s); acceptable for a watchdog metric (alarm period is 5 min).
- New heartbeat-missing alarm: `metric_name = "ComplianceAnchorWatchdogHeartbeat"`, `statistic = "SampleCount"`, `threshold = 1`, `comparison_operator = "LessThanThreshold"`, `evaluation_periods = 2`, `period = 300`, `treat_missing_data = "breaching"`, `dimensions = {Stage = var.stage}`.

**Patterns to follow:**
- U8a's standalone `aws_lambda_function.compliance_anchor` pattern (handlers.tf around the anchor block).
- U7's `aws_iam_role.anchor_lambda` IAM pattern (trust policy with SourceAccount + SourceArn, inline policies in same file).

**Test scenarios:**
- *Happy path:* `terraform validate` from `terraform/examples/greenfield/` succeeds.
- *Static review:* `compliance_watchdog_metrics` policy is removed; `compliance_anchor_watchdog` role's CloudWatch policy has the namespace condition; S3 list policy has the prefix condition.
- *Static review:* `aws:SourceArn` on the watchdog role is constructed via `${var.region}` etc, matches the standalone function name.
- *Drift:* second `terraform plan` after first `apply` shows zero diff.
- *Integration:* after deploy, `aws lambda get-function --function-name thinkwork-dev-api-compliance-anchor-watchdog` returns the function with the new sibling role attached.

**Verification:**
- `terraform validate` succeeds.
- `terraform fmt -check` clean.
- `terraform plan` shows the expected destroy-recreate of the watchdog Lambda + the new role + alarm changes; zero diff on unrelated handlers.

---

- U5. **(Folded into U4.)** The `kms_key_arn` U7 module output + `COMPLIANCE_ANCHOR_KMS_KEY_ARN` env var threading + composite-root pass-through is part of U4's Terraform edits — same files, same Terraform plan/apply cycle. U-ID U5 is reserved (per stability rule) but the unit's content lives in U4 (per scope-guardian SG-002).

**Goal:** N/A (folded into U4).

**Requirements:** Covered by R9 in U4.

**Dependencies:** N/A.

**Files:**
- N/A — see U4.

---

- U6. **Update integration tests + body-swap safety test (Layer 2)**

**Goal:** Replace U8a's forcing-function assertion with the U8b sibling assertion. Add a new mock-based test that asserts `S3Client.send` is called with `PutObjectCommand` when `runAnchorPass` runs against the production-wired handler. Decision #12 Layer 2.

**Requirements:** R8

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts`:
  - **Drop the `_anchor_fn_inert` import** from the import block at the top of the file (deletion is part of U1; the symbol no longer exists post-U1).
  - **Delete the test block at lines ~276-279** that calls `_anchor_fn_inert(...)` directly — the symbol is gone.
  - Replace the forcing-function assertion `expect(getWiredAnchorFn()).toBe(_anchor_fn_inert)` → `expect(getWiredAnchorFn()).toBe(_anchor_fn_live)` (sibling change to U8a's Layer 1).
  - **Add Layer 2 mock-based test** (Decision #19): mock `@aws-sdk/client-s3` per the proven pattern (see Approach below), run `runAnchorPass({readerDb, drainerDb})` (no `anchorFn` injection), assert `mockS3Send` was called with `PutObjectCommand` instances.
  - Update existing rollback test to use `async () => { throw new Error(...) }` (since `AnchorFn` is now async).
  - Update happy-path tests to assert `anchored: true` (not `false`) and check `result.s3_key` matches `/^anchors\/cadence-[0-9a-f-]+\.json$/`.

**Approach:**
- Mock pattern (Decision #19, closes ADV-005). Use the `class { send = sharedMock }` shape proven in `packages/lambda/__tests__/routine-task-python.test.ts:39-46`, NOT `vi.fn().mockImplementation(...)`:
  ```
  const mockS3Send = vi.fn().mockResolvedValue({});
  vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    PutObjectCommand: class PutObjectCommand { constructor(public input: any) {} },
    ListObjectsV2Command: class { constructor(public input: any) {} },
    HeadObjectCommand: class { constructor(public input: any) {} },
  }));
  ```
- The shared `mockS3Send` instance property is what intercepts the lazy-built `_s3` in production code. `vi.fn().mockImplementation(...)` would return per-instance spies — assertions against `S3Client.prototype.send` would silently find nothing. The `class { send = mockS3Send; }` pattern shares one mock across every `new S3Client()` instance, which is the only shape that satisfies the body-swap safety contract.
- Layer 2 assertion: `expect(mockS3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand))`.
- Integration tests against dev DB still run with `describe.skipIf(!DATABASE_URL)`; the new mock-based test runs in CI without DB access.

**Patterns to follow:**
- `packages/lambda/__tests__/routine-task-python.test.ts:43-160` (`vi.mock('@aws-sdk/client-s3', ...)` + spy assertions on `PutObjectCommand`).

**Test scenarios:**
- *Happy path:* mocked S3, run runAnchorPass, assert `S3Client.send` called ≥ 1 time with PutObjectCommand. Verify the anchor key matches `/^anchors\/cadence-[0-9a-f-]+\.json$/`.
- *Forcing function:* `getWiredAnchorFn() === _anchor_fn_live` (positive assertion, replaces U8a's negative).
- *Edge case:* mocked S3 send rejects on the slice for tenant 3 → runAnchorPass throws, no anchor PutObject called (verify via spy call count = 3, not 4 if there were 3 tenants).
- *Existing rollback test:* converted to async-throw shape.

**Verification:**
- `pnpm --filter @thinkwork/lambda test` passes (all anchor unit tests).

---

- U7. **Update smoke gate assertions + README dev-cleanup playbook**

**Goal:** Smoke gate flips from `anchored: false` / `mode: "inert"` to `anchored: true` / `mode: "live"`. README playbook documents WORM-bytes-in-dev (no logic change to the cleanup path; just clarifies what's now in the bucket).

**Requirements:** R10, R11

**Dependencies:** U1, U3

**Files:**
- Modify: `packages/api/src/__smoke__/compliance-anchor-smoke.ts`:
  - Anchor: `anchored === false` → `anchored === true`. Add `s3_key` matches `/^anchors\/cadence-[0-9a-f-]+\.json$/i`. Add `retain_until_date` is ISO8601.
  - Watchdog: `mode === "inert"` → `mode === "live"`.
- Modify: `terraform/modules/data/compliance-audit-bucket/README.md`:
  - Add a "U8b cutover note" subsection: dev bucket now contains real WORM-protected anchor objects from this PR forward. The existing GOVERNANCE-mode cleanup playbook (admin role + bypass) still applies. Note that `terraform destroy` will fail until retention expires.
  - Clarify that COMPLIANCE-mode buckets (audit-time prod) cannot be cleaned up via this playbook — the only recovery is account-level intervention, by design.

**Approach:**
- Smoke gate code change is two literals + two regex assertions. The `WatchdogMode` const-union already supports both values.
- README update is prose-only; no behavior change.

**Test scenarios:**
- *Static review:* smoke regex matches the actual anchor key shape `anchors/cadence-{cadence_id}.json` where cadence_id is UUIDv7 (`[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`).
- *Integration:* (post-deploy) smoke job invokes both Lambdas, both return live-mode payloads.

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` clean.
- After PR merge + dev deploy, the `compliance-anchor-smoke` GHA job goes green with new assertions.

---

## System-Wide Impact

- **Interaction graph:** Anchor Lambda now writes to S3 (new). Watchdog now reads S3 (new) + emits two metrics (heartbeat continues, gap is new). The U7 anchor IAM role is unchanged. The U8a scheduler IAM role is unchanged. The shared lambda IAM role loses one inline policy (`compliance_watchdog_metrics`) — the watchdog's metric grant migrates to the sibling role. Integration tests + smoke gate pin the response shape.
- **Error propagation:** Anchor Lambda errors → drainer transaction rollback → next cadence retries with same chain heads (idempotent on cadence_id, S3 PutObject is last-writer-wins). Watchdog errors → Scheduler retry-0 → CloudWatch logs the error → heartbeat-missing alarm catches it.
- **State lifecycle risks:** The "orphan slices when anchor write fails" risk is mitigated by Decision #3 (slices-first, anchor-last); orphan slices are overwritten on the next cadence. The "WORM bytes in dev" risk is operator-discipline (README playbook).
- **API surface parity:** None — anchor + watchdog are scheduled Lambdas, not API endpoints.
- **Integration coverage:** Verified by `terraform validate` + integration tests + smoke gate. Cross-layer coverage: Scheduler → Lambda → S3 + Aurora is fully exercised by the smoke gate.
- **Unchanged invariants:** Master plan U7 bucket configuration (Object Lock, lifecycle, KMS, deny-DeleteObject bucket policy) is unchanged. U8a's anchor Lambda role's S3 + KMS allow + explicit deny is unchanged. The seam contract field set (`dispatched`, `anchored`, `merkle_root`, `tenant_count`, `anchored_event_count`, `cadence_id`) is preserved; U8b only adds optional fields.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U8a soak window not honored (Decision #15). | Smoke gate continues to assert dispatch-pin shape; body-swap safety test (Layer 2) explicitly verifies the seam call shape; the inert-phase paths (Aurora read, Merkle compute, dispatch-pin response) are unchanged in U8b. |
| Object Lock retention typos (`var.compliance_anchor_object_lock_mode = "GOVERNENCE"`) silently lock objects with bucket-default mode. | U7 already has variable validation rejecting unknown modes. The per-object override mirrors `var.mode`; if the bucket validation passes, the env var matches. |
| AWS SDK v3 default checksum requirement for Object Lock PutObject silently drops if SDK is < 3.502.0. | Verify SDK version in `packages/lambda/package.json` is recent. If not, bump explicitly (it's already ≥ 3.917.0 per U8a). |
| KMS key policy regression breaks anchor PutObject (the U7 anchor role's IAM policy is fine, but the CMK's key policy could be tightened in a future PR). | Acknowledged in U7 README; not solvable here. The smoke gate catches it on dev deploy. |
| Watchdog's first invocation after greenfield deploy emits `oldest_unanchored_age_ms = now - epoch` if the suppression in Decision #6 is buggy → alarm flips to ALARM immediately. | Decision #6 explicitly suppresses the gap metric when `Contents` is empty; integration test asserts this path. |
| Standalone watchdog Lambda destroy-recreate during `terraform apply` causes a brief watchdog downtime (~30s). | Acceptable: alarm period is 5 min, evaluation_periods = 2 (10 min total); a single missed cadence won't trip the alarm. Documented in U4. |
| Per-object retention overrides fight with bucket-default in odd ways (e.g., `proofs/` inheriting 365-day lock means slices can't be deleted until then; cost grows). | Decision #4 acknowledges; cost defer-able to a follow-up. The "deferred to follow-up work" section names this. |
| Body-swap safety test is mock-based; doesn't exercise real S3 IAM grants. | Smoke gate is the production-IAM gate. The mock-based test enforces the seam shape; the smoke gate enforces the live IAM path. |
| Anchor JSON `proof_keys` array can grow large at high tenant count (400 tenants × ~120-char key = ~48KB per anchor object). | Acceptable for v1 (single PutObject < 5GB limit; SSE-KMS overhead negligible). U10 / U11 may want a separate manifest object if proof_keys grows pathologically. |
| `_s3` lazy cache + error-invalidation might interact poorly with S3 connection-pool reuse. | Mirrors the U4 drainer's `_db` pattern which has been live since PR #893; no observed issues. |

---

## Documentation / Operational Notes

- **No new operator pre-merge step.** Migration 0073 was applied in U8a; no schema changes here.
- **Soak gate.** U8a soak window technically not met. Operator should verify dev anchor Lambda's CloudWatch logs show ≥ 1 cadence with `dispatched: true` before merging this PR (smoke gate is the structural gate; soak is the recommendation).
- **Post-merge.** Dev deploy will start writing real WORM bytes to `thinkwork-dev-compliance-anchors/anchors/`. Watchdog flips to live mode. Both alarms in OK state if the pipeline is healthy (`compliance_anchor_gap` should report `gap = 0` since the watchdog runs every 5 min and finds anchors no older than ~15 min); `compliance_anchor_watchdog_heartbeat_missing` requires the heartbeat to keep firing.
- **Dev cleanup operational note.** From this PR forward, `terraform destroy` against the dev compliance-anchor bucket will fail until either (a) Object Lock retention expires (365 days) or (b) an admin role with `s3:BypassGovernanceRetention` empties the bucket per the README playbook. Document in the U8b PR description so anyone tearing down dev later sees the expected behavior.

---

## Sources & References

- **Master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U8 entry lines 536-559; U8b sub-entry lines 552-558).
- **U8a plan (immediate predecessor):** `docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md` (the seam contract this PR consumes).
- **U7 plan:** `docs/plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md` (the WORM substrate).
- **Brainstorm:** `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` (Phase 3 origin).
- **Memory (active):** `project_system_workflows_revert_compliance_reframe`, `feedback_ship_inert_pattern`, `feedback_smoke_pin_dispatch_status_in_response`, `feedback_completion_callback_snapshot_pattern`, `project_automations_eb_provisioning`.
- **Recently merged compliance work:** PR #890 (U3), #903 (U5), #911 (U6), #917 (U7), #921 (U8a).
- **Related code:**
  - `packages/lambda/compliance-anchor.ts` — file modified by U1/U2.
  - `packages/lambda/compliance-anchor-watchdog.ts` — file modified by U3.
  - `packages/lambda/github-workspace.ts` — PutObjectCommand + ListObjectsV2Command idiom reference.
  - `packages/lambda/__tests__/routine-task-python.test.ts` — `vi.mock('@aws-sdk/client-s3', ...)` reference.
  - `terraform/modules/data/compliance-audit-bucket/{main,outputs}.tf` — sibling watchdog role + new outputs land here.
  - `terraform/modules/app/lambda-api/{handlers,variables}.tf` — watchdog standalone resource + alarm cutover + new env var land here.
- **Institutional learnings:**
  - `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — canonical pattern doc.
- **External docs:**
  - AWS S3 PutObject — https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
  - AWS S3 Object Lock managing — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html
  - AWS S3 ListObjectsV2 — https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
