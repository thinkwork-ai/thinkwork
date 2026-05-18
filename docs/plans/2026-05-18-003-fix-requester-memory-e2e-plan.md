---
title: "fix: Requester memory end-to-end write path"
type: fix
status: active
date: 2026-05-18
origin: user-reported production repro
related:
  - docs/brainstorms/2026-05-18-requester-idle-memory-learning-requirements.md
  - docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md
  - docs/plans/2026-05-18-002-feat-requester-memory-dreaming-plan.md
---

# fix: Requester Memory End-to-End Write Path

## Problem Frame

The deployed requester memory feature is not satisfying the most important product test: a new Thread should lead to requester memory markdown updates after the idle-learning window. The reported production Thread is `ffca33a9-538a-4e03-b480-ba59ec4a7044`; after creating that chat, the user saw no corresponding User memory files or memory-file content.

The goal is not another unit-only patch. The work must prove the deployed end-to-end path from Thread activity to user S3 memory files:

1. Thread activity records requester idle-learning state.
2. A one-time scheduled job exists and can fire.
3. `job-trigger` invokes `thread-idle-memory-learning`.
4. The learner writes requester-scoped markdown files.
5. Admin User context can show the changed files.

## Requirements Trace

- `R1-R4` from `docs/brainstorms/2026-05-18-requester-idle-memory-learning-requirements.md`: Thread activity restarts a one-time idle-learning timer and stale schedules no-op.
- `R5-R9`: learned user memory must land in requester-scoped markdown, not a Computer workspace.
- `R10-R14`: candidates, durable memory, reports, and generated reflections must remain separated.
- `R21-R24`: failures must be inspectable through run state and reports.
- The explicit user acceptance criterion for this fix: the linked Thread, or a new comparable Thread created during verification, produces visible user memory changes without hand-editing S3.

## Initial Suspicions To Verify

- The API may still be skipping activity recording for some Thread shapes because `computerId` or `requesterUserId` is missing.
- The idle-learning schedule may be created but never fired, due to `scheduled_jobs` / EventBridge sync or `job-trigger` dispatch shape.
- The worker may run but decide `no_change`, fail safety extraction, or write only hidden report/state paths.
- The Admin User context may be filtering out the files that were actually written.
- Feature flags are now default-on for `graphql-http`, but other invocation paths may still have explicit disabled config.

## Implementation Units

### U1 — Production Repro and Trace

**Goal:** Trace the linked Thread through live deployed state before changing code.

**Files likely touched:** none unless diagnostics require a reusable script.

**Inspection targets:**

- `threads` row for `ffca33a9-538a-4e03-b480-ba59ec4a7044`.
- related `messages`, `thread_idle_learning_state`, `thread_idle_learning_runs`, and `scheduled_jobs`.
- CloudWatch logs for `graphql-http`, `job-trigger`, `job-schedule-manager`, and `thread-idle-memory-learning`.
- S3 keys under `tenants/{tenantId}/users/{requesterUserId}/`.

**Verification:** produce a concrete failure classification before patching: missing state, missing schedule, failed schedule, failed worker, no-change extraction, hidden writes only, or Admin display gap.

### U2 — Fix the First Broken Link

**Goal:** Apply the smallest code fix that makes Thread activity reliably schedule and execute requester memory learning for the reported Thread shape.

**Likely files:**

- `packages/api/src/lib/thread-idle-learning/activity.ts`
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`
- `packages/api/src/lib/computers/runtime-api.ts`
- `packages/api/src/handlers/thread-attachments-finalize.ts`
- `packages/lambda/job-trigger.ts`
- `packages/api/src/handlers/thread-idle-memory-learning.ts`
- `packages/api/src/lib/requester-memory/learner.ts`
- `packages/api/src/lib/requester-memory/storage.ts`

**Tests:**

- Add or update focused tests in the same package as the changed code.
- Include a regression test for the concrete broken Thread shape discovered in U1.

### U3 — End-to-End Verification Harness

**Goal:** Add a repeatable dev-stage verification path so future claims can be proved without waiting blindly.

**Likely files:**

- `apps/cli/src/commands/scheduled-job.ts`
- `packages/api/src/graphql/resolvers/triggers/runScheduledJob.mutation.ts`
- `packages/api/src/graphql/resolvers/memory/threadIdleLearningRuns.query.ts`
- optional test helper under `packages/api/src/lib/thread-idle-learning/`.

**Tests:**

- A focused unit or integration test proving manual dispatch invokes the same worker path as EventBridge.
- CLI or API verification command output must expose enough identifiers to inspect the run and memory files.

### U4 — Deployed E2E Proof

**Goal:** After the fix merges and deploys, run a real dev-stage end-to-end test.

**Verification steps:**

- Create or reuse a Thread with a clear durable memory statement.
- Confirm idle-learning state and schedule are created.
- Trigger the scheduled job manually if waiting 15 minutes is not necessary for proving the worker path, or wait through the natural timer for the final proof.
- Confirm `thread_idle_learning_runs.status` is `changed` or an explainable `no_change`.
- Confirm S3 user memory files changed.
- Confirm Admin User context can display the changed files.

## Non-Goals

- Do not redesign requester memory extraction thresholds unless U1 proves extraction is the broken link.
- Do not manually edit production memory files as a substitute for proving the pipeline.
- Do not mutate or deploy outside the normal PR/merge/deploy pipeline, except for read-only inspection and supported manual job dispatch used as verification.

## Risk Notes

- The linked Thread is production/dev-stage user data; inspection should avoid dumping sensitive message content into PR text or chat.
- If the root cause is a data/configuration gap, prefer a code hardening fix plus an explicit repair path rather than one-off manual cleanup.
- If the learner returns `no_change`, distinguish "no eligible memory" from "pipeline did not run"; both need different fixes.
