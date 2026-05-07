---
title: "feat: Compliance U8a — Anchor Lambda inert + EventBridge Scheduler + watchdog + alarm"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat: Compliance U8a — Anchor Lambda inert + EventBridge Scheduler + watchdog + alarm

## Summary

Ship the inert phase of the compliance anchor pipeline. New TypeScript Lambda `compliance-anchor` runs every 15 minutes via AWS Scheduler, reads un-anchored events from `compliance.audit_events` (per-tenant chain heads), computes a global Merkle root, and calls `_anchor_fn_inert(merkleRoot, tenantSlices) → {dispatched: true, anchored: false, ...}` instead of writing to S3. New TypeScript Lambda `compliance-anchor-watchdog` runs every 5 minutes and short-circuits with `{mode: "inert"}` (U8b will switch it to S3 HeadObject). New CloudWatch alarm `ComplianceAnchorGap` is wired with `treat_missing_data = "notBreaching"` so it stays quiet during the inert soak window. New migration `0073_compliance_tenant_anchor_state.sql` adds the per-tenant high-water-mark table with INSERT/UPDATE granted to the existing `compliance_drainer` role. U7's anchor IAM role gets three additions: Secrets Manager read for the compliance_reader secret, CloudWatch PutMetricData scoped to the `Thinkwork/Compliance` namespace, and the deferred `aws:SourceArn` trust-policy pin. **No S3 PutObject in this PR** — that's U8b. The seam contract `_anchor_fn_inert/_live` is the body-swap point; U8b is the first PR allowed to call S3 from the anchor Lambda.

---

## Problem Frame

Master-plan-U2 ships per-tenant audit hash chains (`compliance.audit_events.event_hash`); U7 ships the WORM-protected S3 substrate. The chain is internally consistent but not externally verifiable until something outside Postgres pins the chain heads. U8a is the inert phase of the anchor pipeline: it makes the schedule, the chain-head SQL, the Merkle computation, and the response-shape contract all live and observable in dev for at least 24 hours before any WORM bytes land at U8b. The dispatch-pin pattern (`feedback_smoke_pin_dispatch_status_in_response`) means dev deploys can verify the pipeline is running by asserting `dispatched: true` on the Lambda response — no CloudWatch log filtering, no S3 inspection.

---

## Requirements

- R1. New Lambda `compliance-anchor` (TypeScript, nodejs22.x) runs on AWS Scheduler `rate(15 minutes)` with `reserved_concurrent_executions = 1`, returns `{dispatched: true, anchored: false, merkle_root, tenant_count, anchored_event_count, cadence_id}` on every invocation. (Master plan U8a)
- R2. New Lambda `compliance-anchor-watchdog` runs on AWS Scheduler `rate(5 minutes)`, returns `{mode: "inert", checked_at, oldest_unanchored_age_ms?}`. **No S3 HeadObject in U8a; no metric emit.** (Master plan U8a)
- R3. CloudWatch alarm `thinkwork-${stage}-compliance-anchor-gap` on metric `ComplianceAnchorGap` (namespace `Thinkwork/Compliance`), `threshold = 1`, `period = 300`, `evaluation_periods = 2`, `treat_missing_data = "notBreaching"`, `alarm_actions = []`. **The alarm sits in INSUFFICIENT_DATA / OK during U8a — by design.** (Master plan Decision #9 + AWS-best-practice for inert metrics)
- R4. Migration `packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql` (hand-rolled per the existing 0069/0070 pattern) creates `compliance.tenant_anchor_state(tenant_id uuid PK, last_anchored_seq bigint NOT NULL DEFAULT 0, last_anchored_at timestamptz, last_cadence_id uuid, updated_at timestamptz DEFAULT now())` with INSERT/UPDATE/SELECT granted to `compliance_drainer`. **Drizzle TS schema export added to `packages/database-pg/src/schema/compliance.ts`.**
- R5. Anchor Lambda reads from Aurora **directly** (not RDS Proxy — the repo has no Proxy today; master-plan reference was aspirational, see Decision #4 below) using the existing `compliance_reader` Aurora role + Secrets Manager secret (provisioned in master-plan-U2 / PR #887, exposed at `module.database.compliance_reader_secret_arn`). Connection follows the U4 drainer pattern: lazy-built `_db` cached at module scope, error-handler invalidates on connection drop, no `vpc_config`.
- R6. Anchor Lambda **updates `compliance.tenant_anchor_state`** after each cadence using the `compliance_drainer` role (which is the writer for `compliance.audit_events` outbox-drain operations from U4 + which we're extending with INSERT/UPDATE on `tenant_anchor_state`). Two PG connections per Lambda invocation: one as `compliance_reader` for the SELECT, one as `compliance_drainer` for the UPDATE. Both via Secrets Manager.
- R7. U7's existing IAM role `thinkwork-${stage}-compliance-anchor-lambda-role` (defined in `terraform/modules/data/compliance-audit-bucket/main.tf`) is extended with three new inline policies: `anchor_secrets` (GetSecretValue on the two compliance secrets), `anchor_cloudwatch_metrics` (PutMetricData scoped to namespace `Thinkwork/Compliance`), and the trust-policy `aws:SourceArn` condition pinned to `arn:aws:lambda:${region}:${account_id}:function:thinkwork-${stage}-api-compliance-anchor`. **The existing S3 + KMS allow + explicit-deny statements stay untouched** — U8b will exercise them.
- R8. AWS Scheduler resources for both Lambdas use the **shared** `aws_iam_role.scheduler` from `terraform/modules/app/lambda-api/handlers.tf:1144-1169` (already grants `lambda:InvokeFunction` to every handler in the for_each set). Each schedule sets `flexible_time_window { mode = "OFF" }` and `retry_policy { maximum_retry_attempts = 0 }` to prevent the default 185-attempt retry storm on inert failures.
- R9. New entries in `scripts/build-lambdas.sh` for both `compliance-anchor` and `compliance-anchor-watchdog`. Default `ESBUILD_FLAGS` (externalize `@aws-sdk/*`); no `BUNDLED_AGENTCORE_ESBUILD_FLAGS` needed (no Bedrock-AgentCore SDK dependency).
- R10. Integration test at `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts` mirrors the drainer integration test pattern (`describe.skipIf(!DATABASE_URL)`). Test scenarios: empty event set returns `tenant_count: 0` + `dispatched: true`; multi-tenant fixture produces stable Merkle root across runs; `_anchor_fn_inert` is called (not `_anchor_fn_live`) when no `anchorFn` override is injected.
- R11. Deploy smoke gate: new GHA job `compliance-anchor-smoke` in `.github/workflows/deploy.yml` after `terraform-apply`, modeled on the existing `flue-smoke-test` shape. Pins **two** response payloads: anchor Lambda `dispatched: true` AND watchdog `mode: "inert"`. New script `scripts/post-deploy-smoke-compliance-anchor.sh` + smoke entrypoint `packages/api/src/__smoke__/compliance-anchor-smoke.ts`.
- R12. Module-load env snapshot per `feedback_completion_callback_snapshot_pattern` and `feedback_vitest_env_capture_timing` — config env vars (`COMPLIANCE_READER_SECRET_ARN`, `COMPLIANCE_DRAINER_SECRET_ARN`, `COMPLIANCE_ANCHOR_BUCKET_NAME`, `STAGE`, `AWS_REGION`) read once at module top via a `getAnchorEnv()` helper; never re-read inside per-invocation paths. The bucket-name env var is plumbed through Terraform in U8a even though no S3 call site reads it; this keeps U8b's body-swap a small diff.
- R13. The seam contract `_anchor_fn_inert(merkleRoot: string, tenantSlices: TenantSlice[]) → AnchorResult` is **stable across U8a → U8b**. Field set: `dispatched: true`, `anchored: false | true`, `merkle_root`, `tenant_count`, `anchored_event_count`, `cadence_id`, plus optional `s3_key`/`retain_until_date` populated only when `anchored: true`. **U8b can ADD optional fields but must not remove or rename U8a's fields.**

---

## Scope Boundaries

- **No S3 PutObject from the anchor Lambda.** U8b ships `_anchor_fn_live` and the body-swap safety integration test that asserts `S3Client.send(PutObjectCommand)` was actually called. U8a's anchor Lambda must not import `@aws-sdk/client-s3`.
- **No live watchdog logic.** Watchdog is deployed but short-circuits before any S3 HeadObject. Its purpose in U8a is purely smoke-pinnable infrastructure (the schedule fires, the response shape is observable). U8b adds the real S3 LastModified read + metric emit.
- **No SNS topic / paging integration.** No `aws_sns_topic` exists in the repo today; U8a's CloudWatch alarm has `alarm_actions = []`. The watchdog metric is the audit-trail evidence; alarm-routing is a deferred operability follow-up.
- **No new Aurora role.** Reusing `compliance_drainer` for `tenant_anchor_state` writes (Decision #5). A separate `compliance_anchor` role is a future hardening unit if auditor feedback demands tighter role separation.
- **No RDS Proxy provisioning.** The master plan reference to "compliance_reader RDS Proxy endpoint" was aspirational; the repo has no Proxy today. U12 owns Proxy work. U8a connects directly to Aurora.
- **No cross-region failover for the anchor pipeline.** Single-region per master plan.
- **No GraphQL schema changes.** `tenant_anchor_state` is internal infra; U10 owns Compliance UI + GraphQL surface.

### Deferred to Follow-Up Work

- **Body-swap safety test (U8b).** Asserts `S3Client.send(PutObjectCommand)` was actually called when no `anchorFn` override is injected. Protects against a future hardcoded-success regression. Cannot land in U8a because U8a deliberately doesn't import the S3 SDK.
- **SNS topic + alarm routing (operability follow-up).** Once a shared `module.alarms` exists in the repo, wire the anchor-gap alarm to it. Until then, operator discovery via CloudWatch console + the dispatch-pin smoke gate is the v1 evidence surface.
- **Separate `compliance_anchor` Aurora role + 4th Secrets Manager secret.** Auditor-facing role-separation hardening; not required for SOC2 Type 1.
- **Documenting the "inert alarm in INSUFFICIENT_DATA" pattern in `docs/solutions/`.** No prior repo learning covers this; capture once U8a ships clean so the next inert Lambda + alarm pair has a precedent.

---

## Context & Research

### Relevant Code and Patterns

- `packages/lambda/compliance-outbox-drainer.ts` — closest analog. Mirror the module-load env snapshot, lazy `_db` cache + error-handler invalidation, Secrets Manager bootstrap with bounded request-timeout, bounded-loop pattern, smoke-pin response shape, and per-row transaction isolation. The drainer also documents the reasoning for `reserved_concurrent_executions = 1` and the DLQ + `maximum_retry_attempts = 0` posture.
- `packages/database-pg/drizzle/0069_compliance_schema.sql` — canonical hand-rolled migration shape: prologue (`\set ON_ERROR_STOP on`, `BEGIN`, `SET LOCAL lock_timeout`, current_database guard), `-- creates: compliance.X` markers consumed by the drift gate, function + trigger creation idiom.
- `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` — role/GRANT migration shape. U8a's 0071 is much smaller (one new table + one GRANT to existing `compliance_drainer`) but follows the same prologue.
- `packages/database-pg/src/schema/compliance.ts` — Drizzle schema TS export pattern. Mirror the `auditEvents` shape for `tenantAnchorState`.
- `terraform/modules/app/lambda-api/handlers.tf` — Lambda + Scheduler pattern. The compliance-outbox-drainer block (lines 222-391 for_each entry, 412-417 reserved-concurrency, 553-564 event_invoke_config DLQ + retry-0, 570-586 scheduler resource, 1144-1169 shared scheduler IAM role) is the freshest reference. Adding a Lambda is a multi-place edit: for_each set entry, per-key ternary overrides for timeout/memory/env vars, scheduler resource, optional alarm.
- `terraform/modules/data/compliance-audit-bucket/main.tf:255-356` — U7's IAM role + 3 inline policies + trust policy. U8a extends this in-place rather than creating a sibling role.
- `terraform/modules/data/aurora-postgres/main.tf:318-346` — Secrets Manager secret pattern for the three compliance roles. Reused as-is; no new secret in U8a.
- `packages/api/src/__smoke__/flue-marco-smoke.ts` — smoke-gate pattern. Lambda invoke via `LambdaClient.send(InvokeCommand)`, parse JSON response, assert specific dispatch-pin field. `scripts/post-deploy-smoke-flue.sh` is the bash wrapper. Mirror exactly for `compliance-anchor-smoke`.
- `.github/workflows/deploy.yml:706-740` — `flue-smoke-test` GHA job shape. New `compliance-anchor-smoke` job follows the same `if: always() && needs.terraform-apply.result == 'success'` shape; avoid `env.X` in job-level `if:` per `feedback_gha_env_context_job_if`.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — canonical writeup of the pattern. **U8a is the first true function-body seam-swap instance in compliance work.** U7 was Terraform-variable-shape-reservation (different idiom). The seam contract `_anchor_fn_inert` payload shape MUST stay stable across U8a → U8b; U8b's body-swap safety test is what protects against future hardcoded-success regression.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — hand-rolled migrations need `psql -f` against dev before merge; `-- creates:` markers consumed by drift gate. The drift gate is currently disabled (`#905` / `if: false`) so unmarked / unapplied migrations land silently. U8a's migration must be applied to dev manually.
- `feedback_smoke_pin_dispatch_status_in_response` — pin via response-payload field, not log filtering. U8a pins TWO payloads: anchor `dispatched: true` AND watchdog `mode: "inert"`. **Don't pin downstream state (S3 object presence) — that's U8b's smoke surface.**
- `feedback_lambda_zip_build_entry_required` — TWO entries needed (anchor + watchdog). Missing entry blocks deploy with `filebase64sha256` error.
- `feedback_completion_callback_snapshot_pattern` + `feedback_vitest_env_capture_timing` — TS Lambda env-snapshot rule. Wrap `process.env` reads in a `getAnchorEnv()` helper called once at handler entry; pass the snapshot through to the seam function as parameters so U8b's body swap is body-only.
- `project_automations_eb_provisioning` — `rate()` is creation-time + interval, not wall-clock. Bounded-staleness invariant (≤ 30 min) is what SOC2 cares about, not wall-clock alignment.
- `project_async_retry_idempotency_lessons` — **Scheduler invokes are SYNC**, not the `InvocationType=Event` async pattern. So `aws_lambda_function_event_invoke_config.maximum_retry_attempts` doesn't apply directly. Use `aws_scheduler_schedule.retry_policy.maximum_retry_attempts = 0` on each schedule.
- `feedback_gha_env_context_job_if` — `if: env.X` at job-level silently fails the workflow (0 jobs, 0s duration). Use `vars.X` or step-level `if`.
- `feedback_handrolled_migrations_apply_to_dev` — operator must `psql -f` to dev before merging; drift-gate currently disabled.

### External References

- AWS [EventBridge Scheduler retry policies](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-retry-policy.html) — defaults to 185 retries over 24h with exponential backoff; explicitly set `maximum_retry_attempts = 0` for non-idempotent inert dispatches.
- AWS [CloudWatch alarm states & treat_missing_data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation) — `notBreaching` is the correct setting for an inert metric so the alarm sits in OK/INSUFFICIENT_DATA rather than firing on the absence of data points.

---

## Key Technical Decisions

1. **Seam contract is the load-bearing artifact.** `_anchor_fn_inert(merkleRoot, tenantSlices) → {dispatched, anchored, merkle_root, tenant_count, anchored_event_count, cadence_id}`. The two booleans (`dispatched: true`, `anchored: false`) are what U8a's smoke gate pins. U8b can add optional fields (`s3_key`, `retain_until_date`) but cannot remove or rename U8a's fields. The seam function is exported from `compliance-anchor.ts` so the integration test can inject `_anchor_fn_live` (or a spy) without monkey-patching.

2. **Cadence ID is UUIDv7.** Time-ordered prefix gives operators a quick way to spot anchors out of order; consistent with U6.A's `audit_event_id` choice. Generated at handler entry via `node:crypto.randomUUID()` is NOT v7 — use a small inline UUIDv7 helper (or the existing helper from U6 at `packages/lambda/uuid7.ts` if it lives there; verify at implementation time and fall back to authoring locally).

3. **Merkle leaf format with RFC 6962-style domain separation.** `leaf_hash = sha256(0x00 || tenant_id_bytes || latest_event_hash_bytes)`; `node_hash = sha256(0x01 || left || right)`. The `0x00` / `0x01` prefix bytes prevent second-preimage forgery — without them, an attacker controlling audit-event content could craft a 48-byte leaf input whose hash equals an existing internal node hash, producing a fraudulent inclusion proof against the global root. **Endianness:** `tenant_id_bytes` is the 16-byte RFC 4122 network-byte-order representation (equivalent to Node `Buffer.from(uuid.replace(/-/g, ''), 'hex')` and Postgres `uuid_send`); `latest_event_hash_bytes` is the 32-byte raw SHA-256 digest. Verifier receives `(tenant_id, latest_event_hash, proof_path[], global_root, cadence_id)`. Proof-path encoding: array of `{hash: hex, position: "left" | "right"}` objects so the verifier doesn't need to know the leaf's index. This shape is finalized in U8a and consumed by U9's verifier CLI; the integration test in U6 ships a hardcoded `(tenant_id, event_hash) → leaf_hex` fixture so cross-implementation agreement is testable, not implicit. Citation: [RFC 6962 §2.1](https://datatracker.ietf.org/doc/html/rfc6962#section-2.1).

4. **No RDS Proxy in U8a.** The master-plan-U2 reference to "compliance_reader RDS Proxy endpoint" was aspirational; the repo has no Proxy today (`docs/plans/2026-05-07-001-feat-compliance-u2-aurora-roles-plan.md:21,52` defers Proxy provisioning to U12). U8a connects the anchor Lambda directly to the Aurora cluster endpoint as `compliance_reader`, mirroring how U4's drainer connects as `compliance_drainer`. The security boundary is the per-role Aurora user; the Proxy is a future optimization that doesn't change role separation.

5. **Reuse `compliance_drainer` role for `tenant_anchor_state` writes.** Adding a 4th Aurora role (`compliance_anchor`) plus a 4th Secrets Manager secret plus a `bootstrap-compliance-roles.sh` extension plus a 4th `aws_secretsmanager_secret` resource is non-trivial scope for an inert PR. The drainer is already a single-instance scheduled Lambda with reserved-concurrency = 1 writing to `compliance.audit_events`; granting it INSERT/UPDATE on `compliance.tenant_anchor_state` keeps the role count at 3 and the auditor narrative unchanged ("the drainer process owns writes to internal compliance bookkeeping tables"). Add `compliance_anchor` as a future hardening unit if auditor feedback demands stricter separation.

6. **Two PG connections per Lambda invocation.** The anchor Lambda needs `compliance_reader` for the SELECT against `compliance.audit_events` (preserves least-privilege on the read path) AND `compliance_drainer` for the UPDATE on `compliance.tenant_anchor_state`. Both are lazy-built + module-scope-cached + error-invalidated. Trade-off: two Secrets Manager fetches on cold start (~50ms each). Alternative would be running both queries as `compliance_drainer`, but that widens the read path to a writer role unnecessarily.

7. **Use the shared scheduler IAM role from `lambda-api/handlers.tf`, but harden its trust policy.** The existing `aws_iam_role.scheduler` (lines 1144-1169) auto-grants `lambda:InvokeFunction` to every handler in the for_each set via `[for k, v in aws_lambda_function.handler : v.arn]`. Adding the new Lambdas to the for_each set automatically extends invoke perms. **U8a also adds `Condition.StringEquals.aws:SourceAccount = var.account_id` to the scheduler role's trust policy** — a confused-deputy guard the role currently lacks. Without this, a foreign-account principal who learns the role ARN could construct a cross-account Scheduler event invoking the anchor Lambda, advancing `tenant_anchor_state.last_anchored_seq` without genuine Merkle coverage. The hardening lands in U8a even though it benefits every handler the scheduler touches — single-line trust-policy condition, no behavior change for legitimate Scheduler invocations, defensive-in-depth alongside the anchor Lambda's own `aws:SourceArn` pin (Decision #8).

8. **`aws:SourceArn` trust-policy pin uses ARN string-construction with `StringEquals` (not `StringEqualsIfExists`).** Avoids the circular dependency `aws_iam_role.assume_role_policy` → `aws_lambda_function.compliance_anchor.arn` → `aws_lambda_function.role` → `aws_iam_role.anchor_lambda.arn`. The function name follows the predictable `thinkwork-${var.stage}-api-compliance-anchor` pattern (verified against `handlers.tf:393`), so the trust policy can interpolate `arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-compliance-anchor` directly. This is the same trick already used for `CHAT_AGENT_INVOKE_FN_ARN` in the existing module. **`var.region` gets a `validation { condition = length(var.region) > 0 }` block** in the U7 module — without it, an empty region would produce a malformed ARN that silently fails to match at AssumeRole time (the smoke gate would catch it via the GHA invoke path, but variable-level validation fails at plan time which is cheaper). Use `StringEquals` (not `StringEqualsIfExists`) so a missing/empty `aws:SourceArn` on the AssumeRole call DENIES rather than no-ops.

9. **CloudWatch alarm `treat_missing_data = "notBreaching"` during inert phase.** The watchdog short-circuits in U8a and never emits the metric. With `notBreaching`, the alarm sits in OK / INSUFFICIENT_DATA (never ALARM) for the soak window. U8b flips this to `"breaching"` once metric emission becomes load-bearing. Document the inert-state expectation in the alarm's `description` field and in the PR body so on-call doesn't page on INSUFFICIENT_DATA.

10. **Scheduler `retry_policy.maximum_retry_attempts = 0`.** Scheduler invokes are sync, defaulting to 185 attempts over 24h with exponential backoff. For inert dispatches that's drowning CloudWatch with retries on a Lambda that can't actually fail in a meaningful way. Set retries to 0 from day one; U8b inherits the same posture.

11. **Anchor + watchdog Lambdas reference the bucket name via env var `COMPLIANCE_ANCHOR_BUCKET_NAME` even though U8a doesn't read it.** Plumbing the env var through Terraform now (sourced from `module.compliance_anchors.bucket_name`) makes U8b's body swap a code-only diff — no Terraform churn at swap time. Same for `COMPLIANCE_ANCHOR_RETENTION_DAYS` (read by U8b's `_anchor_fn_live` to set per-object retention).

12. **Handler env snapshot via `getAnchorEnv()` helper called at module top.** Returns a frozen object with all config strings; passed through every layer to the seam function. No `process.env.X` reads inside per-invocation code paths. Defense against the cold-start-shadowing class of bug.

13. **Seam function signature accepts injected `anchorFn` for tests.** `runAnchorPass(deps: { db, drainerDb, cw, anchorFn })` — production wires `anchorFn = _anchor_fn_inert` (and U8b: `anchorFn = _anchor_fn_live`); tests inject a spy or a stub. This is what makes integration tests body-swap-safe before U8b lands.

14. **Watchdog inert response shape locks in.** `{mode: "inert", checked_at: ISO8601, oldest_unanchored_age_ms: number | null}`. The smoke gate pins `mode: "inert"`. U8b changes `mode` to `"live"` and conditionally emits the metric; the `mode` field is what U8b's smoke updates from `"inert"` to `"live"`.

15. **Migration 0071 is small (one table + two indexes + GRANT) but hand-rolled per the 0069 pattern.** Drizzle Kit doesn't emit `CREATE TABLE IF NOT EXISTS` cleanly for `compliance.*` tables (the schema isn't in Drizzle's purview by convention; see master plan Decision #13). Markers: `-- creates: compliance.tenant_anchor_state`, `-- creates: compliance.idx_tenant_anchor_state_updated_at`. Operator must `psql -f` to dev before merging.

16. **Watchdog emits a `ComplianceAnchorWatchdogHeartbeat` metric in U8a even though it's inert.** Constant value `1.0` per invocation, namespace `Thinkwork/Compliance`. Two reasons: (a) exercises the IAM PutMetricData path during the soak window so a regression in the watchdog's metrics IAM gets caught BEFORE U8b's logic depends on it; (b) gives U8b a denominator-stable signal for distinguishing "real anchor gap" (`ComplianceAnchorGap >= 1`) from "watchdog metric path broken" (`ComplianceAnchorWatchdogHeartbeat IS MISSING`). U8b's alarm formula combines both to avoid false-positive pages on transient PutMetricData failures. The heartbeat is purely additive in U8a; no observable behavior change.

17. **U8a ships a structural forcing function for the U8b body-swap safety test.** Vitest assertion in `compliance-anchor.test.ts` imports the production handler and asserts `getWiredAnchorFn() === _anchor_fn_inert`. When U8b lands and replaces the wired fn with `_anchor_fn_live`, the assertion fails. The U8b PR's required fix is to **replace the assertion with a real body-swap safety test** (`expect(S3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))`), not to delete the test. The U8a-side comment names this expectation explicitly. Without this forcing function, the body-swap protection mechanism is self-attesting: U8b could ship without the safety test (oversight, time pressure) and the seam-swap regression class is undefended. The Vitest assertion is the structural forcing function that compensates for U8a deliberately not importing `@aws-sdk/client-s3`.

---

## Open Questions

### Resolved During Planning

- *RDS Proxy vs direct Aurora* — direct Aurora (no Proxy in repo today; U12 owns Proxy provisioning). Decision #4.
- *New `compliance_anchor` role vs reuse `compliance_drainer`* — reuse drainer; add `compliance_anchor` later if auditor feedback demands stricter separation. Decision #5.
- *Cadence ID format* — UUIDv7. Decision #2.
- *Merkle leaf encoding* — `sha256(tenant_id_bytes || latest_event_hash_bytes)`; proof path is array of `{hash, position}`. Decision #3.
- *Trust-policy `aws:SourceArn` strategy* — ARN string-construction (not Terraform resource reference). Decision #8.
- *Scheduler retry posture* — `maximum_retry_attempts = 0`. Decision #10.
- *Alarm posture during inert* — `treat_missing_data = "notBreaching"`, `alarm_actions = []`. Decision #9.
- *SNS / paging integration* — deferred. No SNS topic in repo; CloudWatch console + dispatch-pin smoke is the v1 evidence surface.
- *GraphQL codegen* — not needed; `tenant_anchor_state` is internal infra. U10 owns Compliance UI + GraphQL.
- *Two `build-lambdas.sh` entries* — anchor + watchdog. Default `ESBUILD_FLAGS` (externalize `@aws-sdk/*`); no AgentCore SDK dependency.

### Deferred to Implementation

- Exact UUIDv7 helper location — reuse existing if `packages/lambda/uuid7.ts` exists, otherwise inline a 20-line implementation. Implementer chooses at coding time.
- Whether the Merkle proof path uses `0`/`1` bits or `"left"`/`"right"` strings in the JSON — readability vs payload size. Implementer chooses at coding time; U9 verifier CLI must match.
- Final SQL of the `0073_compliance_tenant_anchor_state.sql` migration (column types, default expressions, exact index names) — implementer iterates against `to_regclass` checks during dev apply.
- Whether to ship a `pnpm db:migrate-manual` validation step in CI for U8a's migration — out of scope for U8a (drift gate is disabled at repo level per #905); operator-discipline is the v1 control.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                          AWS Scheduler rate(15 min)                    AWS Scheduler rate(5 min)
                                    │                                              │
                                    ▼                                              ▼
                  ┌─────────────────────────────────────┐         ┌──────────────────────────────┐
                  │   Lambda compliance-anchor          │         │  Lambda compliance-anchor-   │
                  │   (TypeScript, nodejs22.x,          │         │  watchdog                    │
                  │    reserved_concurrency = 1)        │         │  (TypeScript, nodejs22.x)    │
                  │                                     │         │                              │
                  │  module-load: getAnchorEnv()        │         │  module-load: getEnv()       │
                  │  cold-start: lazy _readerDb +       │         │  cold-start: nothing         │
                  │              _drainerDb +           │         │                              │
                  │              _cwClient              │         │  handler:                    │
                  │                                     │         │    return {                  │
                  │  handler:                           │         │      mode: "inert",          │
                  │   1. SELECT chain heads since       │         │      checked_at: ISO8601,    │
                  │      tenant_anchor_state.last_seq   │         │      oldest_unanchored_      │
                  │      AS compliance_reader           │         │        age_ms: null,         │
                  │   2. Compute Merkle tree            │         │    }                         │
                  │      leaves = sha256(tenant_id ||   │         │  // No S3 HeadObject.        │
                  │                       chain_head)   │         │  // No CW PutMetricData.     │
                  │      node  = sha256(left || right)  │         │                              │
                  │   3. cadenceId = uuidv7()           │         └──────────────────────────────┘
                  │   4. anchorFn(merkleRoot, slices)   │
                  │      ↳ U8a: _anchor_fn_inert        │              CW alarm
                  │         returns {dispatched: true,  │       ┌──────────────────────────────┐
                  │                  anchored: false}   │       │ thinkwork-${stage}-          │
                  │      ↳ U8b: _anchor_fn_live         │       │ compliance-anchor-gap        │
                  │         (S3 PutObject + retention)  │       │  metric: ComplianceAnchor    │
                  │   5. UPDATE tenant_anchor_state     │       │          Gap                 │
                  │      AS compliance_drainer          │       │  treat_missing_data:         │
                  │   6. return {dispatched: true,      │       │    notBreaching              │
                  │              anchored, ...}         │       │  alarm_actions: []           │
                  └─────────────────────────────────────┘       └──────────────────────────────┘

                  Aurora compliance.audit_events (read as compliance_reader)
                  Aurora compliance.tenant_anchor_state (write as compliance_drainer)

                  Seam contract (U8a → U8b stable):
                    {dispatched: true, anchored: boolean, merkle_root: string,
                     tenant_count: number, anchored_event_count: number,
                     cadence_id: string} + optional U8b fields (s3_key, retain_until_date)
```

---

## Implementation Units

- U1. **Migration 0071: `compliance.tenant_anchor_state` + Drizzle TS schema export**

**Goal:** Add the per-tenant high-water-mark table and grant INSERT/UPDATE/SELECT to `compliance_drainer`. Drizzle TS export added so the anchor Lambda can use typed read/write operations.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Create: `packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql`
- Modify: `packages/database-pg/src/schema/compliance.ts` (add `tenantAnchorState` Drizzle export mirroring the `auditEvents` shape)

**Approach:**
- Hand-rolled SQL with the canonical prologue (`\set ON_ERROR_STOP on`, `BEGIN`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'`, current_database guard from `0069_compliance_schema.sql`).
- Table: `tenant_id uuid PRIMARY KEY`, `last_anchored_seq bigint NOT NULL DEFAULT 0`, `last_anchored_at timestamptz`, `last_cadence_id uuid`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- Index: `idx_tenant_anchor_state_updated_at` on `updated_at` — for the watchdog's eventual "what's the oldest tenant we haven't anchored?" query.
- GRANTs: `USAGE` on schema (already granted to compliance_drainer in 0070, so this is a no-op restatement for clarity), `SELECT, INSERT, UPDATE` on `compliance.tenant_anchor_state` to `compliance_drainer`. **No DELETE grant** — this table is append-or-update-only.
- Markers: `-- creates: compliance.tenant_anchor_state`, `-- creates: compliance.idx_tenant_anchor_state_updated_at`.
- Drizzle TS export: `tenantAnchorState = pgTable("tenant_anchor_state", {...}, (t) => ({...}))` inside the existing `compliance` `pgSchema()` block.
- **Operator step**: apply to dev with `psql -f packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql` before merging the PR. The drift gate is currently disabled (`#905`), so missing apply is silent.

**Patterns to follow:**
- `packages/database-pg/drizzle/0069_compliance_schema.sql` (prologue, marker grammar)
- `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql` (GRANT idiom)
- `packages/database-pg/src/schema/compliance.ts` (Drizzle pgSchema export shape)

**Test scenarios:**
- *Edge case:* applying the migration twice in a row — second invocation is a no-op (`CREATE TABLE IF NOT EXISTS` + `GRANT IF NOT EXISTS` patterns from the 0069 prologue).
- *Edge case:* `compliance_reader` cannot INSERT/UPDATE — verify by attempting `INSERT` as `compliance_reader` and asserting `ERROR: permission denied`.
- *Happy path:* `compliance_drainer` can SELECT, INSERT, UPDATE the table.
- *Integration:* the Drizzle TS export compiles + a `db.select().from(tenantAnchorState).limit(1)` query parses and runs against dev.

**Verification:**
- `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql` succeeds in dev.
- `\d compliance.tenant_anchor_state` shows expected columns + PK + index.
- `\dp compliance.tenant_anchor_state` shows correct GRANTs.
- Drizzle TS export exposes `tenantAnchorState` symbol at `@thinkwork/database-pg`.

---

- U2. **`compliance-anchor.ts` Lambda: chain-head SELECT, Merkle compute, `_anchor_fn_inert` seam**

**Goal:** Ship the inert anchor Lambda body with the load-bearing pieces (env snapshot, lazy clients, chain-head SELECT, Merkle tree, seam function call, response shape). No S3 import.

**Requirements:** R1, R5, R6, R12, R13

**Dependencies:** U1 (`tenant_anchor_state` table must exist for the high-water-mark UPDATE)

**Files:**
- Create: `packages/lambda/compliance-anchor.ts`
- Modify: `packages/lambda/package.json` (add `@aws-sdk/client-cloudwatch` if not already present; **add `uuidv7` as a production dependency at the same version as `packages/api`'s** — required for cadenceId generation per Decision #2; do NOT defer this to "implementer chooses" since U2's test scenarios depend on real UUIDv7 collision-resistance, not v4)

**Approach:**
- Module-load constants: `getAnchorEnv()` returns a frozen `{ readerSecretArn, drainerSecretArn, anchorBucketName, retentionDays, stage, region }` snapshot. Called once at module top; stored in a `const ENV` constant.
- Lazy module-scope: `let _readerDb`, `let _drainerDb`, `let _cwClient`. Each lazy-built on first invocation, cached for warm reuse, invalidated on connection error (mirror the drainer's `_db.$client.on("error", () => { _readerDb = undefined; })` pattern).
- Secrets bootstrap: `resolveDb(secretArn) → Database` reads JSON `{username, password, host, port, dbname}` via `SecretsManagerClient`, URL-encodes user/pass, constructs `postgresql://...?sslmode=no-verify`, returns a `createDb(url)` instance.
- Handler body:
  1. Snapshot `ENV` (already module-scope), generate `cadenceId = uuidv7()`.
  2. Read chain heads: `SELECT tenant_id, MAX(seq), event_hash FROM compliance.audit_events ae INNER JOIN compliance.tenant_anchor_state tas ON ae.tenant_id = tas.tenant_id WHERE ae.seq > tas.last_anchored_seq GROUP BY tenant_id, event_hash` (or equivalent — implementer chooses join shape).
  3. Compute Merkle leaves + tree using `node:crypto.createHash("sha256")`. **Leaf hash:** `sha256(0x00 || tenant_id_bytes || latest_event_hash_bytes)`. **Internal node hash:** `sha256(0x01 || left || right)`. The 0x00/0x01 prefix bytes implement RFC 6962 domain separation — without them, leaf-vs-node hashes are interchangeable and the proof-path is forgeable. Tree algorithm: pair leaves left-to-right, hash each pair, repeat until one root remains. Odd-leaf-out: duplicate the unpaired leaf (Bitcoin-style) — document in the implementation. Endianness: `tenant_id_bytes` is RFC 4122 network-byte-order (Node `Buffer.from(uuid.replace(/-/g, ''), 'hex')`), `latest_event_hash_bytes` is the 32-byte raw digest.
  4. Build `tenantSlices: Array<{tenant_id, latest_event_hash, proof_path: Array<{hash, position}>}>`.
  5. Call `anchorFn(merkleRoot, tenantSlices)` where the production-wired `anchorFn = _anchor_fn_inert`. Inert function returns `{dispatched: true, anchored: false, merkle_root, tenant_count: tenantSlices.length, anchored_event_count, cadence_id}`.
  6. UPDATE `compliance.tenant_anchor_state` for each tenant with the new `last_anchored_seq` + `last_cadence_id` + `last_anchored_at = now()`. **In a single transaction. As `compliance_drainer`.** **Ordering invariant:** the reader-side SELECT (step 2) must complete and materialize rows in memory BEFORE the drainer-side `BEGIN`. Two PG sessions, two transactions; the reader's snapshot is what the Merkle tree was computed against, so the drainer's UPDATE must not start inside the reader's transaction. A future refactor that reorders these steps must preserve the SELECT-then-BEGIN sequence.
  7. Final `console.log({level: "info", msg: "compliance-anchor: cadence complete", ...result})` — smoke-pin surface.
  8. Return `result`.
- Export shape: `export async function handler(): Promise<AnchorResult>` (no event arg; scheduled Lambda). Also export `runAnchorPass({db, drainerDb, cw, anchorFn})` for tests, and `_anchor_fn_inert` so U8b's body-swap test can verify the production handler is no longer wired to it.

**Execution note:** Implement test-first for the seam. Write a test that calls `runAnchorPass(...)` with a stub `anchorFn` capturing inputs; assert the captured `(merkleRoot, tenantSlices)` shape before any production function body lands.

**Patterns to follow:**
- `packages/lambda/compliance-outbox-drainer.ts` (env snapshot, lazy `_db`, error invalidation, Secrets bootstrap, smoke-pin response, reserved-concurrency rationale)
- `packages/api/src/handlers/compliance.ts` from U6 (TypeScript Lambda + AWS SDK usage idioms)

**Test scenarios:**
- *Happy path:* Two-tenant fixture with chain heads at seq=5 and seq=3; `tenant_anchor_state` has `last_anchored_seq=0` for both. Result: `tenant_count: 2`, `anchored_event_count: 8`, `merkle_root` is deterministic across runs given the same input. `dispatched: true`, `anchored: false`. After the run, `tenant_anchor_state.last_anchored_seq = 5` and `3` respectively.
- *Edge case:* Empty event set (all tenants caught up): `tenant_count: 0`, `merkle_root: <sha256-of-empty-tree-sentinel>`, `anchored_event_count: 0`. Lambda still returns `dispatched: true` so the smoke gate passes.
- *Edge case:* Single-tenant (odd leaf): Merkle tree pairs the leaf with itself; root is `sha256(leaf || leaf)`.
- *Edge case:* Cadence ID determinism — calling `runAnchorPass` twice in the same millisecond produces two different cadence IDs (UUIDv7 collision-safe).
- *Error path:* `anchorFn` throws — handler logs the error and rethrows; Scheduler `retry_policy.maximum_retry_attempts = 0` ensures no replay; `tenant_anchor_state` UPDATE is rolled back (no partial state).
- *Error path:* `compliance_reader` connection drops — error handler nulls `_readerDb`; next invocation rebuilds.
- *Integration:* (skipIf no DATABASE_URL) — seed dev DB with TEST_TENANT events, run handler, assert `dispatched: true` + `tenant_anchor_state` updated.
- *Body-swap-safe:* `runAnchorPass` accepts an injected `anchorFn`; default-wired production handler uses `_anchor_fn_inert`. (U8b's safety test asserts production handler no longer uses inert when `anchorFn` is not injected.)

**Verification:**
- TS compiles with strict mode.
- Vitest unit tests pass (mocked Secrets + mocked PG).
- Integration test passes locally against dev DB.
- Bundle builds cleanly via `bash scripts/build-lambdas.sh compliance-anchor` once U5 lands.

---

- U3. **`compliance-anchor-watchdog.ts` Lambda: inert short-circuit**

**Goal:** Deploy the watchdog Lambda body returning `{mode: "inert", checked_at, oldest_unanchored_age_ms}`. No S3 HeadObject, no metric emit. Smoke-pin surface for the schedule wiring.

**Requirements:** R2, R12

**Dependencies:** None

**Files:**
- Create: `packages/lambda/compliance-anchor-watchdog.ts`

**Approach:**
- Module-load env snapshot: `getWatchdogEnv()` returns frozen `{ anchorBucketName, gapThresholdMs, stage }` (the threshold is unused in U8a; pre-plumbed for U8b).
- Module-level lazy `_cwClient` (CloudWatch SDK v3) — built on first invocation, cached for warm reuse, error-invalidated. Used in U8a only for the heartbeat metric (Decision #16); U8b adds the gap metric to the same client.
- Handler body: emit `ComplianceAnchorWatchdogHeartbeat = 1.0` to namespace `Thinkwork/Compliance` via `PutMetricData`, then return `{mode: "inert", checked_at: new Date().toISOString(), oldest_unanchored_age_ms: null}`. **No S3 HeadObject. No `ComplianceAnchorGap` emit.** The heartbeat exercises the IAM PutMetricData path during the soak window so a regression gets caught before U8b ships.
- Export shape: `export async function handler()`. **Shared type definition:** `export type WatchdogMode = "inert" | "live"`. The handler's response is typed `{ mode: WatchdogMode, checked_at: string, oldest_unanchored_age_ms: number | null }`. The smoke entrypoint (U7) imports this type and uses it for runtime assertions — defense against case-sensitivity foot-guns (`"Inert"` / `"INERT"` typos caught at compile time).
- The structure deliberately mirrors U2's anchor handler (env snapshot frozen, lazy CW client) so U8b's diff is body-only — adding the S3 HeadObject + computing `oldest_unanchored_age_ms` from `LastModified`.

**Patterns to follow:**
- `packages/lambda/compliance-anchor.ts` (the anchor Lambda from U2)
- `packages/lambda/compliance-outbox-drainer.ts` (smoke-pin response shape)

**Test scenarios:**
- *Happy path:* Handler returns `{mode: "inert", checked_at: <ISO>, oldest_unanchored_age_ms: null}`.
- *Edge case:* Handler is invoked twice in quick succession — each invocation returns a fresh `checked_at`; no state.
- *Body-swap-safe:* Production handler does not import `@aws-sdk/client-s3` (verifiable via TS imports + bundled artifact size).

**Verification:**
- TS compiles.
- Vitest tests pass.
- Bundle builds via `bash scripts/build-lambdas.sh compliance-anchor-watchdog` once U5 lands.
- No `@aws-sdk/client-s3` import in the source (grep gate).

---

- U4. **Terraform infrastructure: extend U7 IAM role + add 2 Lambda functions + 2 schedules + alarm + composite-root wiring**

**Goal:** Wire the new Lambdas into the lambda-api module, extend U7's anchor role with secrets/CloudWatch perms + `aws:SourceArn` pin, and thread `compliance_reader_secret_arn` + `region` through the composite root. CloudWatch alarm wired with `notBreaching`.

**Requirements:** R3, R5, R7, R8, R10 (env vars), R11 (env vars)

**Dependencies:** U2, U3 (Lambda source files referenced by the for_each set), U5 (build-lambdas.sh entries — but Terraform doesn't need them at plan time; `local.use_local_zips` gates the resource creation. Land U5 in the same PR.)

**Files:**
- Modify: `terraform/modules/data/compliance-audit-bucket/main.tf` — extend `aws_iam_role.anchor_lambda` trust policy with `aws:SourceArn` condition (string-construction, `StringEquals`); add three new `aws_iam_role_policy` resources (`anchor_secrets`, `anchor_cloudwatch_metrics`); leave existing `anchor_s3_allow` + `anchor_kms` untouched.
- Modify: `terraform/modules/data/compliance-audit-bucket/variables.tf` — add `region` variable (required, with `validation { condition = length(var.region) > 0, error_message = "region must be non-empty" }`).
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — **add `compliance-anchor` as a STANDALONE `aws_lambda_function` resource (not a for_each entry)**. The for_each handler set has 60+ keys all sharing `aws_iam_role.lambda.arn`; introducing per-key ternaries on the `role` argument is the highest-blast-radius single expression change in U4 (any expression error or wrong-key path silently downgrades every other handler to a different role). A standalone resource makes the role assignment explicit and isolates blast radius. **Watchdog can stay in the for_each set** — it uses the shared `aws_iam_role.lambda.arn` (its CloudWatch perms are deferred to U8b alongside the live metric-emit body; the inert watchdog needs only `AWSLambdaBasicExecutionRole`). Per-key ternaries on for_each apply only to timeout (30s) and memory (512MB) for the watchdog.
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — add `aws_scheduler_schedule.compliance_anchor` (`schedule_expression = "rate(15 minutes)"`) with the `target { ... retry_policy { maximum_retry_attempts = 0 } }` block — **`retry_policy` is nested inside `target`, not at the schedule top level**. Same shape for `aws_scheduler_schedule.compliance_anchor_watchdog` (`rate(5 minutes)`).
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — extend the existing shared `aws_iam_role.scheduler` trust policy at lines 1144-1155 with `Condition.StringEquals.aws:SourceAccount = var.account_id` (Decision #7).
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — add `aws_cloudwatch_metric_alarm.compliance_anchor_gap` with `treat_missing_data = "notBreaching"`, `alarm_actions = []`. Description field documents inert-state expectation.
- Modify: `terraform/modules/app/lambda-api/variables.tf` — **add three variables**: `compliance_reader_secret_arn` (`type = string, default = ""`); `compliance_anchor_object_lock_retention_days` (`type = number, default = 365`); `compliance_anchor_lambda_role_arn` already added in U7 — verify it's wired through. Each carries the `Default empty until U8a wires it` comment convention.
- Modify: `terraform/modules/thinkwork/main.tf` — pass `compliance_reader_secret_arn = module.database.compliance_reader_secret_arn` and `compliance_anchor_object_lock_retention_days = var.compliance_anchor_retention_days` to `module.api`; pass `region = var.region` to `module.compliance_anchors` (the U7 module call).

**Approach:**
- **Trust-policy `aws:SourceArn` pin:** in U7's `aws_iam_role.anchor_lambda`, add `Condition.StringEquals.aws:SourceArn = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-compliance-anchor"`. Use `StringEquals` (not `StringEqualsIfExists`) so a missing/empty value DENIES rather than no-ops. String-construction avoids the circular dependency between `aws_iam_role.assume_role_policy` and `aws_lambda_function.compliance_anchor.arn`.
- **`anchor_secrets` policy:** allow `secretsmanager:GetSecretValue` on `[var.compliance_reader_secret_arn, var.compliance_drainer_secret_arn]`. Both are passed in via new variables on the `data/compliance-audit-bucket` module. **Comment**: today the secrets use `aws/secretsmanager` (default key, implicit Lambda-role decrypt). If a future hardening pass migrates to a CMK, add a `kms:Decrypt` grant on that CMK to this role — the failure mode is a confusing `AccessDeniedException` from KMS, not Secrets Manager.
- **`anchor_cloudwatch_metrics` policy:** allow `cloudwatch:PutMetricData` with `Condition.StringEquals.cloudwatch:namespace = "Thinkwork/Compliance"` (least-privilege the namespace, not the action). Resource: `*` (PutMetricData has no resource-level scope). Used by the watchdog's heartbeat metric in U8a (Decision #16) and by the live `ComplianceAnchorGap` metric in U8b.
- **Anchor Lambda — STANDALONE `aws_lambda_function` resource.** Define `aws_lambda_function.compliance_anchor` separately from the `aws_lambda_function.handler` for_each set. `function_name = "thinkwork-${var.stage}-api-compliance-anchor"` (matches the for_each naming convention so the trust-policy ARN-construction works), `role = var.compliance_anchor_lambda_role_arn`, `reserved_concurrent_executions = 1`, `timeout = 60`, `memory_size = 1024`, env vars: `COMPLIANCE_READER_SECRET_ARN`, `COMPLIANCE_DRAINER_SECRET_ARN`, `COMPLIANCE_ANCHOR_BUCKET_NAME`, `COMPLIANCE_ANCHOR_RETENTION_DAYS`, `STAGE`. Pair with its own `aws_lambda_function_event_invoke_config` (DLQ + retry-0) — same shape as the drainer. **Rationale:** introducing a per-key `role` ternary on the 60-handler for_each set is the highest-blast-radius single expression in this PR; a standalone resource makes the role assignment explicit and isolates blast radius from unrelated handlers.
- **Watchdog Lambda — for_each entry, shared `aws_iam_role.lambda.arn`.** The inert watchdog has no permissions requirements beyond `AWSLambdaBasicExecutionRole` (which the shared role already grants). Per-key ternaries: `timeout = each.key == "compliance-anchor-watchdog" ? 30 : ...`, `memory_size = each.key == "compliance-anchor-watchdog" ? 512 : ...`. Env vars: `COMPLIANCE_ANCHOR_BUCKET_NAME` (pre-plumbed for U8b's S3 HeadObject; unread in U8a), `STAGE`. **Heartbeat-metric IAM:** in U8a, the watchdog emits `ComplianceAnchorWatchdogHeartbeat` to namespace `Thinkwork/Compliance` (Decision #16). Add a small inline policy `compliance_anchor_watchdog_metrics` directly on the shared `aws_iam_role.lambda` (or, to avoid widening the shared role, gate it via a separate `aws_iam_role_policy` resource scoped only to the watchdog's metric — narrower than the anchor role's grant since the watchdog has no S3/KMS/Secrets needs). Implementer chooses; both shapes preserve least-privilege.
- **Schedule resources:** mirror `aws_scheduler_schedule.compliance_outbox_drainer` from `handlers.tf:570-586`. **`retry_policy` is nested INSIDE the `target { ... }` block, not at the schedule top level** — `target { arn = ..., role_arn = ..., retry_policy { maximum_retry_attempts = 0 } }`. Verified against the AWS provider schema.
- **Scheduler-role hardening:** extend the existing `aws_iam_role.scheduler` trust policy (lines 1144-1155) with `Condition.StringEquals.aws:SourceAccount = var.account_id`. Confused-deputy guard for ALL handlers the scheduler invokes, not just compliance — defense-in-depth.
- **Alarm:** `aws_cloudwatch_metric_alarm.compliance_anchor_gap` with namespace `Thinkwork/Compliance`, metric_name `ComplianceAnchorGap`, statistic `Maximum`, period `300`, evaluation_periods `2`, threshold `1`, comparison_operator `GreaterThanOrEqualToThreshold`, treat_missing_data `notBreaching`, alarm_actions `[]`. Description field documents the inert-state expectation. (U8b flips `treat_missing_data` to `breaching` AND adds the heartbeat composite to distinguish "real anchor gap" from "watchdog metric path broken".)
- **Composite-root wiring:** thread `region` into the `data/compliance-audit-bucket` module instantiation; thread `compliance_reader_secret_arn` from the database module to the lambda-api module; thread `compliance_anchor_object_lock_retention_days` (default 365) so the env var is sourced from a single place.

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf:222-586` for the full Lambda + Scheduler + IAM + DLQ + invoke-config pattern
- `terraform/modules/data/compliance-audit-bucket/main.tf` for the IAM role idiom (extending in-place)
- `terraform/modules/app/lambda-api/handlers.tf:65` for the ARN string-construction trick (CHAT_AGENT_INVOKE_FN_ARN)

**Test scenarios:**
- *Happy path:* `terraform plan` from `terraform/examples/greenfield/` shows the new Lambdas + schedules + alarm + IAM additions; zero diff on existing resources.
- *Static review:* the new `aws_iam_role_policy.anchor_secrets` enumerates exactly the two compliance secrets (reader + drainer); no `*` resource overshoot.
- *Static review:* `anchor_cloudwatch_metrics` policy includes the namespace condition.
- *Static review:* alarm has `treat_missing_data = "notBreaching"` and `alarm_actions = []`.
- *Static review:* both schedules have `retry_policy.maximum_retry_attempts = 0`.
- *Static review:* anchor Lambda's env vars include `COMPLIANCE_ANCHOR_BUCKET_NAME` even though U8a doesn't read it.
- *Drift:* `terraform plan` after `terraform apply` shows zero diff.
- *Integration:* (post-deploy) `aws lambda get-function --function-name thinkwork-dev-api-compliance-anchor` returns the function with the U7 role attached.
- *Integration:* `aws iam get-role --role-name thinkwork-dev-compliance-anchor-lambda-role` shows the trust policy now contains `aws:SourceArn`.

**Verification:**
- `terraform validate` succeeds at the module + composite root.
- `terraform plan` produces the expected diff and zero re-creates on existing resources.
- After deploy, the alarm sits in `OK` or `INSUFFICIENT_DATA` state — never `ALARM`.
- `aws scheduler get-schedule --name thinkwork-dev-compliance-anchor` shows the rate expression and retry-0 policy.

---

- U5. **`scripts/build-lambdas.sh` entries for both Lambdas**

**Goal:** Add bundle entries so deploys can find the zip artifacts. Required by `feedback_lambda_zip_build_entry_required` — missing entries block deploy with `filebase64sha256` errors.

**Requirements:** R9

**Dependencies:** U2, U3 (the source files referenced by `build_handler`)

**Files:**
- Modify: `scripts/build-lambdas.sh`

**Approach:**
- Two new entries in the `case "$HANDLER_NAME" in ... esac` block (or wherever the existing `compliance-outbox-drainer` and `compliance-events` entries live):
  - `build_handler "compliance-anchor" "$REPO_ROOT/packages/lambda/compliance-anchor.ts"`
  - `build_handler "compliance-anchor-watchdog" "$REPO_ROOT/packages/lambda/compliance-anchor-watchdog.ts"`
- Default `ESBUILD_FLAGS` (externalize `@aws-sdk/*`); no `BUNDLED_AGENTCORE_ESBUILD_FLAGS` — neither handler imports Bedrock-AgentCore or newer-than-stock SDK clients.

**Patterns to follow:**
- Existing entries for `compliance-outbox-drainer` (line ~142) and `compliance-events` (line ~146-149) in `scripts/build-lambdas.sh`.

**Test scenarios:**
- *Happy path:* `bash scripts/build-lambdas.sh compliance-anchor` succeeds and produces `dist/lambdas/compliance-anchor/index.mjs`.
- *Happy path:* `bash scripts/build-lambdas.sh compliance-anchor-watchdog` succeeds and produces `dist/lambdas/compliance-anchor-watchdog/index.mjs`.
- *Edge case:* `bash scripts/build-lambdas.sh` (no arg) builds all handlers including the two new ones.
- *Static review:* neither TypeScript source file imports `@aws-sdk/client-s3`. **Grep the source files** (`grep -L '@aws-sdk/client-s3' packages/lambda/compliance-anchor*.ts`) — must return both files (no match in either source). Source-file grep is more robust than bundled-output grep, which is fragile under esbuild minification and bundler-flag changes.

**Verification:**
- Both bundle commands produce non-empty `index.mjs` files.
- `Test expectation: none — pure config; no behavior change beyond `ls dist/lambdas/`.

---

- U6. **Integration tests: `compliance-anchor.integration.test.ts`**

**Goal:** Real-DB integration tests against dev. Mirror the drainer test pattern. Skipped in CI (no DATABASE_URL); load-bearing locally before merge.

**Requirements:** R10

**Dependencies:** U1 (`tenant_anchor_state` table), U2 (anchor Lambda), U3 (watchdog Lambda)

**Files:**
- Create: `packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts`

**Approach:**
- `describe.skipIf(!DATABASE_URL)` gate.
- TEST_TENANT UUID convention: same `99999999-9999-9999-9999-999999999999` as the drainer integration test (rows accumulate in dev across runs without colliding with real tenants).
- Test setup: insert N audit_events for TEST_TENANT, set `tenant_anchor_state.last_anchored_seq = 0` for TEST_TENANT.
- Test body for each scenario calls `runAnchorPass({db, drainerDb, cw, anchorFn: stubFn})` directly (bypasses Secrets Manager bootstrap).
- Watchdog test: `import { handler } from "../../compliance-anchor-watchdog"` and assert response shape.
- **No mocks for PG or AWS in the integration tests** — real Aurora dev DB, real CloudWatch (the watchdog never emits anyway, so this is a no-op).

**Patterns to follow:**
- `packages/lambda/__tests__/integration/compliance-drainer.integration.test.ts`

**Test scenarios:**
- *Happy path:* Two TEST tenants with 5 + 3 events each → `tenant_count: 2`, `anchored_event_count: 8`, `merkle_root` is a 64-hex string. Stub `anchorFn` sees the correct args.
- *Edge case:* No un-anchored events → `tenant_count: 0`, `merkle_root` is the empty-tree sentinel.
- *Edge case:* Single tenant (odd-leaf duplication) — leaf = root.
- *Integration:* After `runAnchorPass`, `tenant_anchor_state.last_anchored_seq` is updated for both tenants in a single transaction.
- *Integration:* Calling `runAnchorPass` with `anchorFn` throwing — `tenant_anchor_state` is NOT updated (transaction rollback).
- *Integration:* Watchdog handler returns `{mode: "inert", checked_at: <ISO>, oldest_unanchored_age_ms: null}`.
- *Body-swap-safe:* Default-wired production handler (no `anchorFn` injection) uses `_anchor_fn_inert` — verified by spying on `_anchor_fn_inert`'s call count.
- *U8b-forcing-function (Decision #17):* Test asserts `getWiredAnchorFn() === _anchor_fn_inert`. **When U8b lands, this assertion fails** — and the U8b PR's required fix is to **replace it with a real body-swap safety test** (`expect(S3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))`), not to delete it. A code comment names this expectation explicitly. This is the structural defense against U8b shipping the live function without its safety test.
- *Leaf-encoding fixture (Decision #3):* Hardcoded `(tenant_id, event_hash) → expected_leaf_hex` test vector. Inputs: `tenant_id = "11111111-1111-7111-8111-111111111111"`, `event_hash = "aa".repeat(32)` (32-byte hex). Expected leaf: `sha256(0x00 || 0x11 0x11 0x11 0x11 0x11 0x11 0x71 0x11 0x81 0x11 0x11 0x11 0x11 0x11 0x11 0x11 || 0xaa × 32)` — implementer computes the expected hex and pins it in the test. **U9's verifier CLI imports the same fixture** to verify cross-implementation byte agreement.

**Verification:**
- `pnpm --filter @thinkwork/lambda test:integration -t compliance-anchor` passes locally against dev DB.
- Tests skip cleanly in CI (no DATABASE_URL).

---

- U7. **Deploy smoke gate: `compliance-anchor-smoke` GHA job**

**Goal:** After `terraform-apply` lands, invoke both Lambdas and assert dispatch-pin response shape. Pin `dispatched: true` on the anchor and `mode: "inert"` on the watchdog. Mirror the `flue-smoke-test` job exactly.

**Requirements:** R11

**Dependencies:** U4 (Lambdas exist post-deploy), U5 (Lambdas have build entries)

**Files:**
- Create: `packages/api/src/__smoke__/compliance-anchor-smoke.ts`
- Create: `scripts/post-deploy-smoke-compliance-anchor.sh`
- Modify: `.github/workflows/deploy.yml` (add `compliance-anchor-smoke` job after `terraform-apply`)

**Approach:**
- Smoke TS entrypoint mirrors `packages/api/src/__smoke__/flue-marco-smoke.ts`: `LambdaClient.send(InvokeCommand({FunctionName: "thinkwork-${stage}-api-compliance-anchor", Payload: "{}"}))`, parse JSON response, assert `dispatched === true`, `merkle_root` matches `/^[a-f0-9]{64}$/`, `tenant_count` is a number, `anchored === false`. Then invoke `thinkwork-${stage}-api-compliance-anchor-watchdog` with the same shape and assert `mode === "inert"`. `fail()` calls `process.exit(1)` on any miss.
- Shell wrapper: 30-line script that resolves stage + region from `--stage` and `--region` flags, runs `pnpm exec tsx packages/api/src/__smoke__/compliance-anchor-smoke.ts`. Mirrors `scripts/post-deploy-smoke-flue.sh`.
- GHA job: clones the structure of `flue-smoke-test` at `.github/workflows/deploy.yml:706-740` — `if: always() && needs.terraform-apply.result == 'success'`, `needs: [terraform-apply]`, AWS creds via OIDC, then `bash scripts/post-deploy-smoke-compliance-anchor.sh --stage ${{ env.STAGE }} --region us-east-1`. Avoid `env.X` in job-level `if:` per `feedback_gha_env_context_job_if`.

**Patterns to follow:**
- `packages/api/src/__smoke__/flue-marco-smoke.ts`
- `scripts/post-deploy-smoke-flue.sh`
- `.github/workflows/deploy.yml:706-740` (flue-smoke-test job)

**Test scenarios:**
- *Happy path:* (post-deploy) the smoke job invokes both Lambdas, both return the expected payloads, the GHA step passes.
- *Error path:* anchor Lambda is broken — response is missing `dispatched` field — `fail()` triggers `process.exit(1)` and the GHA job fails.
- *Error path:* watchdog Lambda returns `mode: "live"` (would mean U8b accidentally landed) — `fail()` triggers exit(1).
- *Edge case:* anchor returns `dispatched: false` — same failure path. (Possible if a future regression breaks the seam-call wrapping.)

**Verification:**
- Local `bash scripts/post-deploy-smoke-compliance-anchor.sh --stage dev --region us-east-1` works against dev (after merge).
- After PR merge + dev deploy, the new GHA job goes green.
- Manual `aws lambda invoke` against both function names returns the expected dispatch-pin shape.

---

## System-Wide Impact

- **Interaction graph:** New: AWS Scheduler → anchor/watchdog Lambdas → Aurora (`compliance_reader` SELECT, `compliance_drainer` UPDATE) → CloudWatch (`PutMetricData` from watchdog in U8b only). Existing: U7's IAM role gains 2 inline policies + a trust-policy condition; U7's `aws_s3_bucket.anchor` is unchanged. The drainer (U4) is unchanged; the two compliance Lambdas are independent processes.
- **Error propagation:** Anchor Lambda errors → Scheduler retry-0 → Lambda invocation fails → CloudWatch logs the error → no automatic retry. `tenant_anchor_state` is wrapped in a transaction so the high-water-mark only advances on successful Merkle compute + seam call. Watchdog inert path can't fail in any meaningful way.
- **State lifecycle risks:** `tenant_anchor_state` UPDATE inside a transaction — partial advance is impossible. If the seam function fails, the transaction rolls back, the next cadence sees the same un-anchored events. Idempotency in U8a is not load-bearing (the seam is inert); U8b will need to think about double-PutObject if a Scheduler retry slips through — defer to U8b.
- **API surface parity:** No GraphQL changes. No admin UI changes. No CLI changes. The Compliance UI (U10) will eventually surface anchor cadence + verification status; U8a doesn't touch it.
- **Integration coverage:** Verified by integration tests (U6) + post-deploy smoke (U7). Cross-layer — Scheduler → Lambda → Aurora — is covered by the smoke gate (Lambda invoke + response shape) plus the integration test (Lambda body + Aurora reads/writes).
- **Unchanged invariants:** U7's S3 bucket configuration (Object Lock, lifecycle, KMS, bucket policy) is unchanged. U7's `aws_iam_role_policy.anchor_s3_allow` is unchanged — including the explicit Deny on `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` (load-bearing for U8b). The U7 module's outputs are unchanged. U2 (audit_events) and U4 (drainer) are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Inert→live seam-swap drift between U8a and U8b — U8b accidentally renames or removes a payload field. | The seam contract (Decision #1, R13) names the load-bearing fields explicitly. U8b must add a body-swap safety integration test that asserts the payload field set is unchanged. The smoke gate's payload assertions also catch shape regressions. |
| Operator forgets to apply migration 0071 to dev before merging. | Drift gate is currently disabled (`#905`), so the failure is silent. The integration test's `tenant_anchor_state.last_anchored_seq` UPDATE will fail with `relation does not exist` against dev if the migration wasn't applied — flagged in the U6 unit's pre-merge checklist. |
| Reusing `compliance_drainer` for `tenant_anchor_state` writes blurs the auditor narrative. | Documented in Decision #5. The drainer is already a single-instance scheduled Lambda with reserved-concurrency = 1, writing to `compliance.audit_events`; granting it INSERT/UPDATE on `tenant_anchor_state` keeps the role count at 3. A separate `compliance_anchor` role is a future hardening unit if auditor feedback demands it. |
| The Scheduler `retry_policy.maximum_retry_attempts = 0` is set incorrectly on the wrong resource (e.g., on `aws_lambda_function_event_invoke_config`, which doesn't apply to sync Scheduler invokes). | Use the `aws_scheduler_schedule.X.retry_policy` block specifically. Static review confirms the resource type. |
| `aws:SourceArn` string-construction breaks if the Lambda function name pattern ever changes. | The pattern `thinkwork-${var.stage}-api-${each.key}` is well-established (lines 222-391, 65, 129 in `handlers.tf`). Document the dependency in the U7 module's `region` variable description. |
| CloudWatch alarm fires unexpectedly during the inert phase. | `treat_missing_data = "notBreaching"` is the explicit defense. The alarm description field documents the inert-state expectation. The dispatch-pin smoke gate is the actual evidence surface; the alarm is a U8b artifact that lands inert in U8a. |
| Watchdog accidentally imports `@aws-sdk/client-s3` and the inert claim is broken. | Add a build-time grep gate (or a Vitest test that asserts the bundled `index.mjs` doesn't contain `client-s3`) to enforce the inert constraint. Lightweight; flagged in U5. |
| Cold-start env shadowing (the `feedback_completion_callback_snapshot_pattern` class) — `process.env.X` reads at module load capturing `""` instead of the actual value. | Module-load `getAnchorEnv()` helper reads + freezes once; never re-read. Documented in Decision #12 and R12. |
| Two PG connections per Lambda invocation = two Secrets Manager fetches on cold start. | Acceptable cold-start cost (~50ms each, parallelizable). Lazy + module-scope-cached + error-invalidated. The Lambda is reserved-concurrency = 1 and runs every 15 minutes, so warm reuse is the common case. |
| The U7 anchor IAM role's `aws_iam_role_policy.anchor_secrets` resource accidentally widens scope by including `*`. | Static review pre-merge enumerates the exact two secret ARNs. Listed under U4's static-review test scenarios. |

---

## Documentation / Operational Notes

- **Manual operator step**: apply `0073_compliance_tenant_anchor_state.sql` to dev with `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0073_compliance_tenant_anchor_state.sql` before merging the PR. Drift gate disabled per `#905` so missing apply is silent.
- **PR description must include**: "U8a is the first true function-body seam-swap instance in compliance work. U7 used Terraform-variable-shape-reservation; U8a uses the inert-function-body pattern from `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`. Reviewers should check (a) does the seam contract payload shape match what U8b will swap into, (b) the body-swap safety test is correctly scoped to U8b, (c) the inert response is observably correct in dev via the smoke gate."
- **PR description must call out**: "CloudWatch alarm `thinkwork-${stage}-compliance-anchor-gap` will sit in OK / INSUFFICIENT_DATA state during the U8a soak window. This is intentional. Don't page on the absence of data points."
- **Soak window**: Per master plan U8 execution note, U8a soaks for at least one full deploy cycle (24h) before U8b ships. CloudWatch logs of the anchor Lambda should show ~96 invocations in the first 24h (4 per hour × 24); watchdog should show ~288 (12 per hour × 24). Operator-discovery of healthy operation is via CloudWatch console.
- **Future learning capture**: After U8a ships clean, capture the "wired alarm intentionally in INSUFFICIENT_DATA during inert phase" pattern as a `docs/solutions/` learning. No prior repo learning covers this.
- **No CloudWatch dashboards**: deferred to U10 / Compliance admin UI. Operator-discovery via `aws lambda invoke` + the smoke gate's response payload is the v1 evidence surface.

---

## Sources & References

- **Master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U8 entry lines 536-559; Decision #9 — inert→live seam swap; Decision #10 — `rate(15 minutes)` cadence).
- **U7 plan (immediate predecessor):** `docs/plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md` (the IAM role and bucket this PR builds on).
- **Brainstorm:** `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` (Phase 3 origin).
- **Memory (active):** `project_system_workflows_revert_compliance_reframe`, `feedback_ship_inert_pattern`, `feedback_smoke_pin_dispatch_status_in_response`, `feedback_completion_callback_snapshot_pattern`, `feedback_lambda_zip_build_entry_required`, `project_automations_eb_provisioning`, `project_async_retry_idempotency_lessons`, `feedback_gha_env_context_job_if`, `feedback_handrolled_migrations_apply_to_dev`, `feedback_vitest_env_capture_timing`.
- **Recently merged compliance work:** PR #890 (U3), #903 (U5), #911 (U6), #917 (U7).
- **Related code:**
  - `packages/lambda/compliance-outbox-drainer.ts` — closest analog (U4)
  - `packages/database-pg/drizzle/0069_compliance_schema.sql` and `0070_compliance_aurora_roles.sql` — migration shape
  - `packages/database-pg/src/schema/compliance.ts` — Drizzle TS schema
  - `terraform/modules/data/compliance-audit-bucket/main.tf:255-356` — U7's IAM role being extended
  - `terraform/modules/app/lambda-api/handlers.tf:222-586, 1144-1169` — Lambda + Scheduler + shared scheduler IAM role
  - `terraform/modules/data/aurora-postgres/outputs.tf:61-63` — `compliance_reader_secret_arn` output
  - `packages/api/src/__smoke__/flue-marco-smoke.ts` — smoke-gate pattern
  - `.github/workflows/deploy.yml:706-740` — `flue-smoke-test` GHA job shape
- **Institutional learnings:**
  - `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`
  - `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` (smoke-pin precedent — Flue auto-retain)
- **External docs:**
  - AWS EventBridge Scheduler retry policy — https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-retry-policy.html
  - AWS CloudWatch alarm states — https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation
