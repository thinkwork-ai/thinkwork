---
title: "feat: Requester memory dreaming"
type: feat
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-05-18-requester-idle-memory-learning-requirements.md
related:
  - docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md
  - docs/brainstorms/2026-05-09-computer-dreaming-memory-maintenance-requirements.md
external-references:
  - https://github.com/openclaw/openclaw/tree/main
  - https://github.com/openclaw/openclaw/blob/main/docs/concepts/dreaming.md
  - https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md
  - https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/dreaming.ts
  - https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/dreaming-phases.ts
  - https://github.com/openclaw/openclaw/blob/main/extensions/memory-core/src/short-term-promotion.ts
---

# feat: Requester Memory Dreaming

## Problem Frame

The requester idle learner already gives Thinkwork a markdown-first memory path after a Computer Thread is idle for 15 minutes. It is intentionally narrow: one Thread, deterministic extraction, and direct promotion/staging into requester memory files.

This plan adds the broader OpenClaw-style layer the current v1 does not cover:

1. A recurring user-level dreaming sweep.
2. Broad compaction over all requester memory markdown files.
3. Light, REM, and deep phases with an LLM-backed reflective phase.
4. Cross-thread learning that does not require the Thread to be scoped to a shared Computer.
5. Human-readable Dream Diary output and internal machine state kept separate from durable `MEMORY.md`.

The source of truth remains requester S3 markdown under `tenants/{tenantId}/users/{userId}/memory/...`. Hindsight remains a downstream index over curated markdown, not the primary editing surface.

## Requirements Trace

From `docs/brainstorms/2026-05-18-requester-idle-memory-learning-requirements.md`:

- **R5-R9.** Requester markdown remains source of truth and writes stay allowlisted — U1, U2.
- **R10-R14.** OpenClaw-style working notes, machine state, reports, staged candidates, durable promotion, rehydration, and anti-contamination — U1, U2.
- **R18-R20.** Hindsight indexes stable markdown-derived documents, not raw transcript firehose memory — U3.
- **R21-R25.** Reports, rollback-compatible snapshots, rejection of unsafe candidates, status, and bounded budgets — U1, U2, U4.

From the user request:

- OpenClaw-style recurring/nightly dreaming — U3, U4.
- Broad user-level compaction after inactivity — U2, U3.
- LLM-based reflective dreaming phases — U2.
- Sweep across all user memory files — U1, U2.
- Learning from every arbitrary Thread shape — U1.

## Scope

In scope:

- Requester-level dreaming for active tenant users.
- Sweep reads all requester memory markdown under `memory/`.
- Sweep reads recent user-authored messages across all Thread shapes where the user is the sender or owning Thread user.
- Light phase stages and dedupes evidence.
- REM phase writes LLM-backed reflective diary output for human review.
- Deep phase promotes qualified grounded candidates to `memory/MEMORY.md`.
- Compaction dedupes durable memory sections and bounds append-only growth.
- Nightly recurring schedule and manual Lambda event path.

Out of scope:

- End-user settings UI for every threshold.
- Passive Slack/channel learning outside persisted Threads.
- Rewriting `USER.md`, skills, tools, identities, guardrails, or shared Computer workspace files.
- Making Dream Diary or reports future promotion sources.
- Replacing Hindsight, AgentCore Memory, or Company Brain.

## Existing Patterns

- `packages/api/src/lib/requester-memory/learner.ts` extracts thread-local candidates and writes `memory/MEMORY.md`, `memory/candidates/YYYY-MM-DD.md`, and reports.
- `packages/api/src/lib/requester-memory/storage.ts` already enforces requester S3 path safety, snapshots, and bounded writes.
- `packages/api/src/lib/requester-memory/hindsight-sync.ts` already uses stable requester-memory document IDs.
- `packages/api/src/handlers/thread-idle-memory-learning.ts` is the current worker wrapper.
- `packages/lambda/job-trigger.ts` already invokes thread idle memory learning through `RequestResponse`.
- `terraform/modules/app/lambda-api/handlers.tf` already defines scheduled Lambda jobs with EventBridge Scheduler.
- `packages/api/src/lib/wiki/bedrock.ts` provides a Bedrock Converse wrapper and JSON parser suitable for an LLM-backed REM phase.

## OpenClaw Takeaways

OpenClaw's current memory-core does not make reports promotion sources. It separates:

- `MEMORY.md` for durable compact memory.
- `memory/YYYY-MM-DD.md` for short-term/daily memory.
- `memory/.dreams/` for machine state, locks, phase signals, and recall stores.
- `DREAMS.md` for human-readable Dream Diary output.
- Light phase for staging, REM for reflection, and deep phase for promotion.

Thinkwork adapts that layout to requester S3 by using:

- `memory/MEMORY.md`
- `memory/candidates/YYYY-MM-DD.md`
- `memory/working/YYYY-MM-DD.md`
- `memory/.dreams/...`
- `memory/DREAMS.md`
- `memory/dreaming/{light|rem|deep}/YYYY-MM-DD.md`

Keeping Dream Diary under `memory/` makes it visible in the new Admin User context tab.

## Key Decisions

1. **One scheduled sweep, not per-user cron jobs.** Add one `requester-memory-dreaming` Lambda schedule. The handler enumerates active tenant users and runs bounded per-user sweeps.
2. **Inactivity gate per user.** A user is eligible when no user-authored Thread message has occurred in the last 15 minutes unless the event explicitly targets a user for manual/dry-run execution.
3. **No new DB schema for v1.** Store dream cursors, locks, phase state, and reports in user S3 under `memory/.dreams/`. Existing `thread_idle_learning_runs` remain the thread-idle status surface.
4. **LLM REM phase with deterministic fallback.** Use Bedrock Converse for reflective diary output when enabled/configured; fall back to deterministic summaries on model failure so the sweep still writes a report.
5. **Reports are review artifacts.** Dream Diary and phase reports are never read as candidate sources in later sweeps.
6. **Deep promotion stays grounded.** A candidate must be rehydrated from source message text or memory file text before promotion.
7. **Feature-flagged but enabled in dev.** Terraform should wire `REQUESTER_IDLE_MEMORY_LEARNING_ENABLED=true` and `REQUESTER_MEMORY_DREAMING_ENABLED=true` for the deployed dev stack through module variables, not hard-coded behavior.

## Implementation Units

### U1 — Dreaming Storage and Source Gathering

**Goal:** Extend requester-memory storage with safe list/read/write helpers for dreaming and gather broad user-level sources.

**Files:**

- `packages/api/src/lib/requester-memory/storage.ts`
- `packages/api/src/lib/requester-memory/dreaming.ts`
- `packages/api/src/lib/requester-memory/dreaming.test.ts`

**Approach:**

- Add safe list support under `tenants/{tenantId}/users/{userId}/memory/`.
- Add internal path support for `memory/.dreams/...`, `memory/dreaming/...`, and `memory/DREAMS.md`.
- Gather all public requester memory markdown except reports, snapshots, and `.dreams`.
- Gather recent user-authored messages across all Threads, not only Computer Threads.
- Exclude dream reports and generated reflective prose from candidate evidence.

**Tests:**

- Listing rejects traversal and only returns normalized memory paths.
- Public read set includes `memory/MEMORY.md`, `memory/candidates/*.md`, `memory/working/*.md`, and topic files when present.
- Source gathering includes a non-Computer Thread owned by the requester.
- Source gathering excludes `memory/reports`, `memory/.dreams`, and `memory/dreaming` as promotion sources.

### U2 — Light, REM, Deep, and Compaction Phases

**Goal:** Implement the user-level dreaming engine.

**Files:**

- `packages/api/src/lib/requester-memory/dreaming.ts`
- `packages/api/src/lib/requester-memory/markdown.ts`
- `packages/api/src/lib/requester-memory/safety.ts`
- `packages/api/src/lib/requester-memory/hindsight-sync.ts`
- `packages/api/src/lib/requester-memory/dreaming.test.ts`

**Approach:**

- Light phase: dedupe staged candidates from thread messages and memory files, write `memory/.dreams/light-{date}.json`, and optionally a phase report.
- REM phase: call Bedrock Converse through `invokeClaude` to produce a concise human-readable reflection written to `memory/DREAMS.md` and `memory/dreaming/rem/YYYY-MM-DD.md`; deterministic fallback records model failure.
- Deep phase: score grounded candidates by explicitness, frequency, recurrence across days/threads, recency, and safety; promote only qualifying candidates to `memory/MEMORY.md`.
- Compaction: rewrite `memory/MEMORY.md` by removing duplicate auto-learned bullets and keeping a bounded compact durable section. Preserve user-authored headings and explicit remembered facts.
- Each changed file uses snapshots and rollback-compatible metadata.

**Tests:**

- REM phase uses a mocked LLM result when available and falls back cleanly on failure.
- Deep phase promotes repeated cross-thread facts and stages weak one-offs.
- Compaction removes duplicate learned bullets without deleting unique durable facts.
- Unsafe prompt-control/tool/secret candidates are rejected and appear only in report metadata.
- Dream reports are not reused as future promotion evidence.

### U3 — Handler, Scheduling, and Feature Flags

**Goal:** Make dreaming runnable manually and automatically in deployed environments.

**Files:**

- `packages/api/src/handlers/requester-memory-dreaming.ts`
- `packages/api/src/handlers/requester-memory-dreaming.test.ts`
- `scripts/build-lambdas.sh`
- `terraform/modules/app/lambda-api/handlers.tf`
- `terraform/modules/app/lambda-api/variables.tf`
- `terraform/modules/thinkwork/main.tf`
- `terraform/modules/thinkwork/variables.tf`
- `terraform/modules/app/agentcore-runtime/main.tf`
- `terraform/modules/app/agentcore-flue/main.tf`
- `terraform/examples/greenfield/main.tf`

**Approach:**

- Add a handler accepting `{ tenantId?, userId?, dryRun?, limitUsers? }`.
- Enumerate active tenant users from `tenant_members`.
- Skip users active in the last 15 minutes unless manually targeted.
- Add nightly schedule, initially `cron(30 4 * * ? *)`.
- Wire `REQUESTER_IDLE_MEMORY_LEARNING_ENABLED`, `REQUESTER_MEMORY_DREAMING_ENABLED`, `REQUESTER_MEMORY_DREAMING_MODEL_ID`, and `REQUESTER_MEMORY_DREAMING_CRON` through Terraform variables.
- Enable requester idle learning and requester memory dreaming in the dev greenfield stack.
- Pass idle-learning flag to AgentCore/Flue runtimes so raw full-thread retain remains suppressed when requester memory owns the durable path.

**Tests:**

- Handler no-ops when disabled.
- Handler targets one user when `tenantId` + `userId` are provided.
- Handler skips recently active users during scheduled sweeps.
- Terraform validates after adding variables and schedule.
- `bash scripts/build-lambdas.sh requester-memory-dreaming` succeeds with Bedrock Runtime SDK bundled.

### U4 — Operator Visibility and Manual Verification

**Goal:** Make the new dreaming output inspectable through existing surfaces without building a large settings UI.

**Files:**

- `apps/admin/src/routes/_authed/_tenant/knowledge/user.tsx`
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- `packages/api/workspace-files.ts`
- `packages/api/src/__tests__/workspace-files-handler.test.ts`
- `apps/admin/src/routes/_authed/_tenant/knowledge/-user-context-tab.test.ts`

**Approach:**

- Ensure the User context tab lists `memory/DREAMS.md`, `memory/dreaming/...`, and public memory files.
- Keep hidden `.dreams`, `.snapshots`, and reports hidden from the normal tree unless the existing internal report surface links to them.
- The Memory tab remains Hindsight/run status; the User tab remains the markdown inspection/editor surface.

**Tests:**

- User context list includes Dream Diary and phase reports that are meant for review.
- Hidden machine state is not listed in the public file tree.
- Existing user `USER.md` behavior remains unchanged.

## Verification Plan

- `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/dreaming.test.ts src/handlers/requester-memory-dreaming.test.ts src/lib/requester-memory/storage.test.ts src/lib/requester-memory/learner.test.ts src/lib/requester-memory/hindsight-sync.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/knowledge/-user-context-tab.test.ts`
- `pnpm --filter @thinkwork/admin build`
- `bash scripts/build-lambdas.sh requester-memory-dreaming thread-idle-memory-learning`
- `terraform -chdir=terraform/examples/greenfield validate`
- After merge/deploy: invoke `requester-memory-dreaming` manually in dev for Eric with `dryRun=true`, then without dry run, and inspect `Memory > User`.

## Risks

- **LLM output drift:** Keep REM output as review-only and parse no authority from diary text.
- **Over-promotion:** Deep phase requires grounded evidence and recurrence/explicitness thresholds.
- **Prompt injection:** Reuse and extend existing safety classifiers; reports record rejection counts.
- **Cost:** Sweep has per-user and per-run limits plus deterministic fallback.
- **Env size:** Common Lambda env is already large. Add only short flag/model/cron values and avoid extra URLs.

