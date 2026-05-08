---
title: Substrate-first inert→live seam-swap pattern for multi-PR feature arcs
date: 2026-05-08
category: architecture-patterns
module: "packages/api, packages/lambda, packages/database-pg, terraform/modules/data, terraform/modules/app, apps/admin"
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - "A feature spans substrate (DB schema, IAM roles, Terraform modules, Lambda functions) and consumer (live runners, admin UI, GraphQL resolvers) layers and is too large to ship as one PR"
  - "There is a deployment ordering constraint — the consumer references a resource that must exist at apply time (queue URL, IAM role ARN, bucket name, secret ARN)"
  - "The substrate has independent value and can be verified in isolation (Terraform plan, schema migration applied, env var populated, alarm visible) without the consumer being present"
  - "Partial states must not surface as silent no-ops to operators during a multi-PR rollout"
  - "An arc with 3+ PRs over 1+ days needs each PR to be independently safe to merge and revert"
related_components:
  - background_job
  - database
  - tooling
tags:
  - inert-first
  - seam-swap
  - multi-pr
  - deployment-pattern
  - lambda
  - terraform
  - stub
  - dlq
  - body-swap-forcing-function
---

# Substrate-first inert→live seam-swap pattern for multi-PR feature arcs

## Context

Large cross-cutting features — ones that introduce new Aurora schema, Terraform modules, IAM roles, Lambda functions, and GraphQL contracts simultaneously — break down poorly into monolithic PRs. A single multi-thousand-line PR covering all layers is slow to review, impossible to roll back surgically, and introduces hidden coupling: if the Terraform apply fails, the Lambda code referencing the new queue URL is also broken; if the Lambda code is wrong, the schema migration is already live.

This document extends the prior-art [`inert-to-live-seam-swap-pattern-2026-04-25.md`](./inert-to-live-seam-swap-pattern-2026-04-25.md) with two additional dimensions surfaced during the master compliance arc (~17 PRs over 2 days, 2026-05-07 → 2026-05-08; master plan at [`docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`](../../plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md)):

1. **Substrate-first ordering across infrastructure layers** — DB migrations → Terraform/IAM → Lambda shell → consumer code. The 2026-04-25 pattern doc was Python-module scoped (factory closures, `seam_fn` defaults); this doc generalizes to multi-layer arcs.
2. **Throw-don't-no-op rule for stubs** — the inert state must be operator-visible (DLQ depth alarm, smoke-test failure, alarm fire). Silent no-op stubs that ack messages without doing work were rejected explicitly in the U11.U2 plan.

The failure modes this pattern defends against — calibrated against real prior incidents (session history):

- **All-or-nothing rollback.** A monolithic PR means reverting the UI also reverts the Terraform. Independent PRs allow each layer to revert without disturbing the others.
- **Hidden deployment ordering constraints.** If the SQS queue doesn't exist when the Lambda code referencing `COMPLIANCE_EXPORTS_QUEUE_URL` deploys, the mutation throws deterministically — but only if the env var resolution path is loud. Substrate-first makes the constraint explicit.
- **Silent multi-week dark periods.** (session history) Between 2026-04-17 and 2026-04-23 ~13 PRs building the sandbox substrate merged green in CI, but none exercised on dev — the AgentCore runtime was pinned to a stale arm64 image while CI built amd64. The gap surfaced only when a human ran the first real end-to-end invocation. Substrate-first with operator-visible inert states catches this class of bug at deploy time, not weeks later.
- **Stub-and-replace anti-pattern.** (session history) Earlier arcs tried shipping a stub that got *replaced wholesale* in PR-2. This invalidated the stub's tests on swap day and forced re-review of the same surface area. The fix: the seam contract stays stable across both PRs; only the body is swapped.
- **Review fatigue on mega-PRs.** Each layer has different reviewers, different blast-radius reasoning, different test strategies.

---

## Guidance

### 1. Substrate ships inert: deployable, configurable, unconsumed

The substrate PR creates the AWS resource and all plumbing required for a consumer to use it, but no consumer calls it in production. Examples from the compliance arc:

- **U7 ([#917](https://github.com/thinkwork-ai/thinkwork/pull/917)):** [`terraform/modules/data/compliance-audit-bucket/`](../../../terraform/modules/data/compliance-audit-bucket/) — WORM S3 bucket, IAM role, Object Lock configuration. The IAM role exists and is correctly scoped; no Lambda assumes it until U8a.
- **U11.U2 ([#948](https://github.com/thinkwork-ai/thinkwork/pull/948)):** [`terraform/modules/data/compliance-exports-bucket/`](../../../terraform/modules/data/compliance-exports-bucket/) — exports S3 bucket, SQS queue, DLQ, CloudWatch alarm, standalone runner Lambda function, event source mapping. The mutation succeeds end-to-end (queued message visible in SQS) but the runner has no live body.

After the substrate PR merges and Terraform applies, the new resources are visible in the AWS console, env vars are populated on dependent Lambdas, and the IAM boundary is correct. The consumer PR can be tested and merged independently.

### 2. Stubs THROW rather than silently no-op

This is the most operationally critical invariant. A no-op stub (returning `{ok: true}` without acting) lets the inert state go unnoticed: messages are acked, jobs stay in `QUEUED` forever, no alarm fires. The system appears healthy.

From [`docs/plans/2026-05-08-005-feat-compliance-u11-u2-terraform-plan.md`](../../plans/2026-05-08-005-feat-compliance-u11-u2-terraform-plan.md), Key Technical Decisions:

> "Stub runner Lambda body throws, doesn't no-op. A no-op stub would silently mark messages as processed and let queued jobs stay in QUEUED forever with no DLQ signal. A throw + DLQ + alarm makes the inert phase visible."

The U11.U2 runner stub at [`packages/lambda/compliance-export-runner.ts`](../../../packages/lambda/compliance-export-runner.ts) (in its inert form) threw `Error("compliance-export-runner: not implemented yet — U11.U3 ships the live body")`. SQS re-enqueues the message after each throw; after `maxReceiveCount=3` it lands in the DLQ; the DLQ-depth CloudWatch alarm fires. Operators see the inert state immediately.

The U8a anchor Lambda at [`packages/lambda/compliance-anchor.ts`](../../../packages/lambda/compliance-anchor.ts) takes the alternative path — it exposes `_anchor_fn_inert` which returns `{dispatched: true, anchored: false, merkle_root, ...}`. Not a throw, because the entire anchor pass runs correctly (chain reads, Merkle computation, high-water-mark update); only the S3 write is inert. The dispatch-pin field (`dispatched: true`) is what the smoke gate asserts (per [`feedback_smoke_pin_dispatch_status_in_response`](../../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_smoke_pin_dispatch_status_in_response.md) — auto memory).

**The rule:** if the inert stub would mask a failure mode (messages silently acked, jobs silently left in limbo), it must throw. If the inert stub performs real upstream work and the gap is only the downstream write, a return-with-flag (`anchored: false`) is sufficient — provided a smoke gate pins the flag.

### 3. Body-swap forcing functions in integration tests

The U8a plan establishes the pattern and explicitly names it a forcing function:

> "The seam contract `_anchor_fn_inert/_live` is the body-swap point; U8b is the first PR allowed to call S3 from the anchor Lambda. U8a's `getWiredAnchorFn() === _anchor_fn_inert` Vitest assertion is replaced (not deleted) with `expect(S3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))` — the structural body-swap safety the U8a comment promised."

In [`packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts`](../../../packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts), the assertion that `getWiredAnchorFn() === _anchor_fn_inert` fails the moment `_anchor_fn_live` is wired in U8b. This failure is not a regression — it is the test doing its job. It forces the engineer who ships the live body to also update the test to verify live behavior (S3 `PutObjectCommand` actually called). Without the forcing function, it is possible to ship the live-body swap and forget to add the structural assertion; the test passes vacuously.

The body-swap safety test must use **call-count assertions**, not just return-value shape — a future PR adding a sibling `_seam_fn_real()` instead of editing the seam body would silently keep production on inert (session history: the Plan §008 U9 spawn-live test asserts `model_calls >= 1` AND `agent_calls >= 1` via counters on stubs).

**Pattern:** the inert-phase integration test contains exactly one assertion that will fail when the live body lands. That assertion is replaced (not deleted) by a stronger assertion on the live behavior. The test file is the handoff note between the two PRs.

### 4. Stable-seam invariant — body swaps, contracts don't

(session history — the load-bearing rule from the 2026-04-25 prior-art doc) The seam contract — the function signature, the response payload shape, the error semantics — does not change between PR-1 and PR-2. Stub-and-replace was rejected because replacing the entire function changes the contract surface; reviewers re-litigate the structural decision they already approved.

The inert body stays in place; only its implementation is swapped. The U8a `_anchor_fn_inert` returns the same payload shape as U8b's `_anchor_fn_live` would; only the `anchored: true` flag flips and the side effects (S3 PutObject) appear. The U11.U2 stub throws with a contract that the live U11.U3 body satisfies (an SQS `BatchResponse`).

### 5. CloudWatch alarm posture mirrors the inert/live state

U8a wires `treat_missing_data = "notBreaching"` on the `ComplianceAnchorGap` alarm during the inert soak window (the watchdog short-circuits and never emits the metric; `notBreaching` keeps the alarm in `OK / INSUFFICIENT_DATA` rather than firing). U8b flips it to `"breaching"` once the metric emission is load-bearing. The alarm's `description` field documents the inert-phase expectation so on-call doesn't page on `INSUFFICIENT_DATA`. One-line Terraform change in the live PR; no new resource is created.

### 6. Each PR is independently mergeable and revertible

Merging the substrate PR alone leaves the system in a valid, observable state. Merging the live PR before the substrate fails fast and explicitly (env var unset → mutation throws `INTERNAL_SERVER_ERROR`; IAM role missing → `AccessDenied`; queue URL undefined → SDK throws at construction). Neither silent failure nor silent success.

This means:

- A blocked live PR (e.g., reviewer feedback, failing CI) does not hold up the substrate from shipping.
- Reverting the live PR (e.g., production issue with the runner body) leaves the substrate intact; the system reverts to the known-good inert state without losing schema or Terraform resources.
- Each PR goes through CI independently. The substrate PR's CI does not require the live body to exist.

### 7. The pattern composes recursively

U10 has a substrate (GraphQL read API + Aurora reader role, [#937](https://github.com/thinkwork-ai/thinkwork/pull/937)) and a consumer (admin SPA, [#941](https://github.com/thinkwork-ai/thinkwork/pull/941)), with two substrate-extension PRs in between ([#939](https://github.com/thinkwork-ai/thinkwork/pull/939) — `complianceOperatorCheck` + `complianceTenants` + format guard).

U11 has four layers: U11.U1 backend mutation ([#944](https://github.com/thinkwork-ai/thinkwork/pull/944)) → U11.U2 Terraform substrate + stub ([#948](https://github.com/thinkwork-ai/thinkwork/pull/948)) → U11.U3 live runner body ([#950](https://github.com/thinkwork-ai/thinkwork/pull/950)) → U11.U4 admin Exports page ([#951](https://github.com/thinkwork-ai/thinkwork/pull/951)). Each PR depends only on its immediate predecessor being merged and deployed, not on the entire chain being complete.

---

## Why This Matters

**Orphaned partial states are eliminated.** Every merged PR leaves the system in a named, documented, monitorable state. "Inert" is not a bug — it's a state with a defined operator expectation (DLQ depth alarm, smoke-pin asserting `dispatched: true, anchored: false`).

**Stop-the-line at any point.** If work stops after U11.U2 merges, the SQS queue exists, the DLQ alarm fires on every queued message (signaling the inert gap), and the existing admin UI works. Nothing is half-broken; the system is in a known degraded-but-observable state. Resume work by merging U11.U3.

**Review tractability.** A Terraform-only PR can be reviewed by someone who knows Terraform but not the TypeScript runner. A runner-body PR can be reviewed by someone who knows TypeScript streaming but not Terraform. The compliance arc moved 17 PRs in 2 days partly because no single reviewer needed to hold the whole arc in their head.

**DLQ-visible inert state vs. silent no-op** is the operational difference between a paging alert and a customer report. (session history) A no-op stub that silently acks SQS messages gives operators nothing to find until a downstream assertion fails — which may be weeks later (e.g., an auditor asks "show me an exported compliance CSV" and the job table is full of `QUEUED` rows).

**Body-swap forcing functions prevent the live swap from landing without test coverage.** Without the forcing function, the live-body PR can pass all tests while the new structural assertion (S3 `PutObjectCommand` actually called) is never written. The forcing function makes the test failure the handoff gate.

---

## When to Apply

Apply this pattern when **all three** of the following are true:

1. The feature spans at least one substrate layer (Aurora schema, Terraform module, IAM role, Lambda function) and at least one consumer layer (UI, resolver, live handler body) that cannot be shipped in a single PR without review fatigue.
2. There is a deployment ordering constraint: the consumer references a resource that must exist at apply time (queue URL as env var, IAM role ARN, bucket name, secret ARN).
3. The substrate has independent value — it can be verified in isolation (Terraform plan, schema migration applied, env var populated, alarm visible) without the consumer being present.

**Do not apply** for 1–2-PR features where substrate and consumer are small enough to be reviewed together. The pattern's overhead (smoke-gate updates, forcing-function tests, two deploy cycles) is not justified for a single GraphQL field + resolver pair.

---

## Examples

### Case 1: U7 → U8a → U8b — WORM anchor bucket + inert Lambda body + live S3 write

- **[#917](https://github.com/thinkwork-ai/thinkwork/pull/917)** — [`terraform/modules/data/compliance-audit-bucket/`](../../../terraform/modules/data/compliance-audit-bucket/) ships: S3 bucket with Object Lock GOVERNANCE 365-day retention, SSE-KMS, IAM role with path-scoped Allow + explicit Deny on `s3:BypassGovernanceRetention`. No Lambda assumes the role. Plan: [`docs/plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md`](../../plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md).
- **[#921](https://github.com/thinkwork-ai/thinkwork/pull/921)** — [`packages/lambda/compliance-anchor.ts`](../../../packages/lambda/compliance-anchor.ts) ships with `_anchor_fn_inert` returning `{dispatched: true, anchored: false, merkle_root, tenant_count, anchored_event_count, cadence_id}`. Watchdog Lambda returns `{mode: "inert"}`. CloudWatch alarm wired with `treat_missing_data = "notBreaching"`. Smoke gate at [`packages/api/src/__smoke__/compliance-anchor-smoke.ts`](../../../packages/api/src/__smoke__/compliance-anchor-smoke.ts) asserts `dispatched: true, anchored: false`. Integration test at [`packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts`](../../../packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts) asserts `getWiredAnchorFn() === _anchor_fn_inert` — the forcing function. Plan: [`docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md`](../../plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md).
- **[#927](https://github.com/thinkwork-ai/thinkwork/pull/927)** — `_anchor_fn_inert` replaced with `_anchor_fn_live`: real `PutObjectCommand` with `ObjectLockMode`, `ObjectLockRetainUntilDate`, `ServerSideEncryption: "aws:kms"`, `ChecksumAlgorithm: "SHA256"`. Watchdog flips to `mode: "live"`. Alarm `treat_missing_data` flips to `"breaching"`. The forcing-function assertion is replaced with `expect(S3Client.send).toHaveBeenCalledWith(expect.any(PutObjectCommand))`. Smoke gate updated to assert `anchored: true`. Plan: [`docs/plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md`](../../plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md).

### Case 2: U10 three-PR sequence — backend → extensions → UI

- **[#937](https://github.com/thinkwork-ai/thinkwork/pull/937)** — GraphQL `complianceEvents` / `complianceEvent` queries + resolver wiring + `compliance_reader` Aurora role plumbed into graphql-http Lambda. Read API is fully functional from a GraphQL client. Admin SPA does not yet consume it.
- **[#939](https://github.com/thinkwork-ai/thinkwork/pull/939)** — `complianceOperatorCheck` + `complianceTenants` fields + 64-hex format guard added. Fields the UI needs but the UI doesn't exist yet.
- **[#941](https://github.com/thinkwork-ai/thinkwork/pull/941)** — [`apps/admin/src/routes/_authed/_tenant/compliance/`](../../../apps/admin/src/routes/_authed/_tenant/compliance/) ships: sidebar entry, events list page with filter URL round-trip, event detail page with chain-position and anchor-status panels. Consumes all of the above. Plan: [`docs/plans/2026-05-08-003-feat-compliance-u10-admin-ui-plan.md`](../../plans/2026-05-08-003-feat-compliance-u10-admin-ui-plan.md).

### Case 3: U11 four-PR sequence — mutation → Terraform + stub → live runner → admin UI

- **[#944](https://github.com/thinkwork-ai/thinkwork/pull/944)** — `Mutation.createComplianceExport` + `complianceExports` query shipped. Mutation throws `INTERNAL_SERVER_ERROR` deterministically because `COMPLIANCE_EXPORTS_QUEUE_URL` env var is unset (SQS queue does not yet exist). The failure is explicit and immediate; no silent state.
- **[#948](https://github.com/thinkwork-ai/thinkwork/pull/948)** — [`terraform/modules/data/compliance-exports-bucket/`](../../../terraform/modules/data/compliance-exports-bucket/), SQS queue + DLQ, CloudWatch alarm on DLQ depth > 0, standalone `aws_lambda_function.compliance_export_runner` resource, event source mapping. Stub runner body at [`packages/lambda/compliance-export-runner.ts`](../../../packages/lambda/compliance-export-runner.ts) (in its inert form) threw `Error("compliance-export-runner: not implemented yet — U11.U3 ships the live body")`. After this PR merges and Terraform applies: the mutation succeeds end-to-end (queued message lands in SQS); the runner throws on each SQS delivery; after `maxReceiveCount=3` the message lands in DLQ; DLQ-depth alarm fires. Operator observes the inert gap via the alarm. Plan: [`docs/plans/2026-05-08-005-feat-compliance-u11-u2-terraform-plan.md`](../../plans/2026-05-08-005-feat-compliance-u11-u2-terraform-plan.md).
- **[#950](https://github.com/thinkwork-ai/thinkwork/pull/950)** — live runner body: `pg.Cursor` stream + RFC 4180 CSV + NDJSON multipart write + presigned URL + job status updates. Plan: [`docs/plans/2026-05-08-006-feat-compliance-u11-u3-runner-plan.md`](../../plans/2026-05-08-006-feat-compliance-u11-u3-runner-plan.md).
- **[#951](https://github.com/thinkwork-ai/thinkwork/pull/951)** — [`apps/admin/src/routes/_authed/_tenant/compliance/exports/`](../../../apps/admin/src/routes/_authed/_tenant/compliance/exports/) ships: export request dialog, jobs table with status polling at 3s when QUEUED/RUNNING, presigned download link. Plan: [`docs/plans/2026-05-08-007-feat-compliance-u11-u4-admin-exports-plan.md`](../../plans/2026-05-08-007-feat-compliance-u11-u4-admin-exports-plan.md).

---

## Related

- [`inert-to-live-seam-swap-pattern-2026-04-25.md`](./inert-to-live-seam-swap-pattern-2026-04-25.md) — prior art: factory-closure seam pattern at the Python-module scope (delegate_to_workspace_tool, skill_resolver). This doc extends it to multi-layer infrastructure arcs and adds the throw-don't-no-op rule.
- Memory: `feedback_ship_inert_pattern` — compressed rule ("modules land with tests but no live wiring; integration waits for the plan's own dependency gate").
- Memory: `feedback_smoke_pin_dispatch_status_in_response` — complementary deploy-gate discipline; surface dispatch status in the response payload.
- Memory: `project_async_retry_idempotency_lessons` — DLQ + CAS + `MaximumRetryAttempts=0` for non-idempotent SQS loops; the throw-don't-no-op rule depends on DLQ visibility.
- [`docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`](../workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md) — destructive-migration guard that applies at the substrate layer's teardown tail (after the live seam is confirmed).
- [`docs/compliance/`](../../compliance/) — module documentation for the compliance arc this pattern produced.
