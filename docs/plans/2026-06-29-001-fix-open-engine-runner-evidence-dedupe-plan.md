---
title: "fix: Deduplicate OpenEngine runner evidence comments"
date: 2026-06-29
type: fix
status: draft
linear: THINK-105
parent: THINK-85
---

# fix: Deduplicate OpenEngine runner evidence comments

## Problem

The OpenEngine scheduled runner now proves the important runtime path: it can verify `/mcp/open-engine`, load standing context, discover the queue, claim one Work Item, fetch task documents, write evidence, and transition the Work Item without Linear as the runtime queue.

The remaining trust gap is evidence duplication. A single runner/task execution can leave repeated agent narrative comments such as duplicate `AGENT STATUS` or `AGENT DONE` entries on the Work Item timeline. This does not appear to be duplicate pickup; the queue snapshot after the latest smoke showed no fresh eligible/claimed work. It is still a problem because the Work Item timeline is becoming the replacement for Linear issue comments, so repeated comments make it harder to understand what actually happened.

## Goals

- Make OpenEngine agent narrative evidence idempotent per Work Item, run, and evidence gate.
- Preserve the current distinction between narrative comments and compact activity events.
- Keep queue claim, state transition, receipt, status ledger, and document behavior intact.
- Prove a fresh scheduled runner execution leaves one clear comment per material gate and does not repeatedly pick up completed work.

## Non-Goals

- Do not redesign the OpenEngine receipt or status ledger model.
- Do not delete or rewrite historical duplicate comments already created on dev.
- Do not build a dashboard or broader automation control surface.
- Do not use Linear as the runtime queue or acceptance path.
- Do not change Work Item activity UI beyond preserving the current comment/activity rendering.

## Current State

Relevant code:

- `scripts/open-engine-one-task-runner.mjs`
- `scripts/__tests__/open-engine-one-task-runner.test.mjs`
- `packages/api/src/handlers/mcp-open-engine.ts`
- `packages/api/src/handlers/mcp-open-engine.test.ts`
- `packages/api/src/lib/work-items/work-item-service.ts`
- `packages/database-pg/src/schema/work-items.ts`
- `packages/database-pg/graphql/types/work-items.graphql`
- `apps/web/src/components/work-items/WorkItemDetailPage.tsx`
- `apps/web/src/lib/graphql-queries.ts`

Key observations:

- `open_engine_claim_next`, `open_engine_record_receipt`, and `open_engine_update_status_ledger` already have idempotency support.
- `open_engine_create_comment` currently creates a new comment every time it is called.
- `work_item_comments` has `metadata` JSONB but no dedicated `idempotency_key` column.
- `CreateWorkItemCommentInput` does not expose an `idempotencyKey`; it only accepts `metadata`.
- The runner writes a checking status ledger entry with an idempotency key, then generates an execution prompt. The generated prompt tells the agent to record durable evidence, but it does not define stable evidence-gate keys for comments.

## Proposed Shape

Implement comment idempotency first in the MCP/API layer, then make the runner prompt use it consistently.

The minimal model:

- Each OpenEngine narrative comment may include `idempotencyKey`.
- For MCP-created comments, store this key in `work_item_comments.metadata.openEngine.idempotencyKey`.
- Before creating a new comment, look for an active comment on the same tenant/work item/author/source with the same key.
- If found, return the existing comment instead of inserting another row or emitting another `comment_added` activity event.
- Generated runner prompts should use stable keys per Work Item, agent, and evidence gate, for example:
  - `open-engine-runner:<workItemId>:<agentId>:claimed`
  - `open-engine-runner:<workItemId>:<agentId>:status`
  - `open-engine-runner:<workItemId>:<agentId>:review`
  - `open-engine-runner:<workItemId>:<agentId>:done`

This should be API-enforced, not prompt-only. The prompt can reduce accidental duplicates, but the MCP endpoint must tolerate repeated calls from retries or restarted automation runs.

## Requirements

1. Repeated `open_engine_create_comment` calls with the same Work Item, author agent, source, and `idempotencyKey` must return the same comment and must not create duplicate timeline entries.
2. Repeated calls without an `idempotencyKey` should keep existing behavior, so ordinary human comments and intentionally distinct agent updates are not unexpectedly suppressed.
3. Runner-generated prompts must instruct Codex to use stable idempotency keys for claim/status/review/done narrative comments.
4. Receipt and status ledger idempotency must continue to work as-is.
5. The Work Item detail page must continue rendering comments as cards and property/resource/status changes as compact activity rows.
6. A fresh scheduled runner smoke must prove:
   - standing context fetch happens before work execution,
   - exactly one Work Item is claimed,
   - duplicate claim prevention still works while claimed,
   - final state prevents repeat pickup,
   - duplicate narrative comments are not created for the same gate.

## Implementation Units

### U1. Add comment idempotency contract tests

Add failing tests before changing behavior.

Files:

- `packages/api/src/handlers/mcp-open-engine.test.ts`
- `packages/api/src/lib/work-items/work-item-service.ts` test coverage if a service-level test exists or is straightforward to add

Cases:

- `open_engine_create_comment` passes `idempotencyKey` through metadata.
- A second call with the same `idempotencyKey` returns the existing comment.
- The duplicate path does not create a second `comment_added` event.
- A second call with a different key creates a distinct comment.
- Calls without a key continue to create separate comments.

Implementation note:

- Prefer testing the service-level behavior for real dedupe semantics.
- Keep the MCP handler test focused on argument plumbing and structured response shape.

### U2. Implement idempotent Work Item comments

Files:

- `packages/api/src/handlers/mcp-open-engine.ts`
- `packages/api/src/lib/work-items/work-item-service.ts`
- `packages/database-pg/graphql/types/work-items.graphql`
- `apps/web/src/lib/graphql-queries.ts` only if the GraphQL mutation needs the field

Approach:

1. Extend `open_engine_create_comment` tool schema with optional `idempotencyKey`.
2. Add `idempotencyKey` to `CreateWorkItemCommentInput` only if the general GraphQL mutation should support the same contract. If this stays MCP-only, keep GraphQL unchanged and store the key through MCP metadata.
3. In `createWorkItemComment`, normalize an optional idempotency key from either `input.idempotencyKey` or `input.metadata.openEngine.idempotencyKey`.
4. When a key is present, search active comments for the same tenant, work item, author user/agent, source, and metadata key before insert.
5. Return the existing row on duplicate instead of inserting a comment and event.
6. Store metadata in a predictable shape:

```json
{
  "sourceTool": "open_engine_create_comment",
  "openEngine": {
    "idempotencyKey": "...",
    "gate": "status"
  }
}
```

Risk and mitigation:

- JSONB lookup is acceptable for this focused slice because Work Item comment volume is currently low.
- If later load demands stricter guarantees, add a dedicated nullable `idempotency_key` column plus a partial unique index over active comments. Do not start there unless tests or query shape show the metadata approach is too weak.

### U3. Update runner prompt evidence gates

Files:

- `scripts/open-engine-one-task-runner.mjs`
- `scripts/__tests__/open-engine-one-task-runner.test.mjs`
- `docs/verification/open-engine-one-task-runner.md`

Approach:

1. Add an "Evidence gates" section to the generated prompt.
2. Tell Codex to write narrative evidence through `open_engine_create_comment` with stable idempotency keys.
3. Keep `open_engine_update_status_ledger` for machine-readable progress/state; do not use it as the primary human narrative surface.
4. Keep the existing runner `open_engine_update_status_ledger` call idempotent.
5. Clarify that final state transition should be called once with a stable idempotency key.

Test updates:

- Prompt contains `open_engine_create_comment`.
- Prompt contains the specific stable keys for `claimed`, `status`, `review`, and `done`.
- Existing standing context before claim ordering remains unchanged.
- Existing "no eligible work" behavior remains unchanged.

### U4. Preserve UI comment/activity behavior

Files:

- `apps/web/src/components/work-items/WorkItemDetailPage.tsx`
- `apps/web/src/lib/graphql-queries.test.ts`
- `apps/web/src/lib/graphql-queries.schema.test.ts`

Approach:

1. Avoid UI changes unless GraphQL fields require query updates.
2. If `idempotencyKey` is added to GraphQL comment input, update generated queries and schema tests.
3. Browser-check a Work Item with:
   - agent comments,
   - human comments,
   - status ledger document activity,
   - property/status update activity.
4. Confirm comments remain full cards and compact activity rows remain inline timeline items.

### U5. Fresh scheduled runner smoke

Use dev and the existing scheduled Codex OpenEngine automation after the code is merged/deployed.

Flow:

1. Create a fresh Codex-routed Work Item with a small safe docs task.
2. Attach a handoff document.
3. Confirm standing context/routing map/optional skill directory document IDs are valid UUIDs and configured.
4. Unpause the scheduled automation for one run.
5. Watch the Work Item detail UI on `http://localhost:5174`.
6. Verify:
   - one Work Item is claimed,
   - context and documents are fetched,
   - duplicate claim attempt is rejected while claimed,
   - exactly one `AGENT CLAIMED` comment exists,
   - exactly one latest `AGENT STATUS` comment exists for the gate,
   - exactly one final `AGENT DONE` or `AGENT REVIEW` comment exists,
   - status ledger and receipt evidence remain visible,
   - queue snapshot after completion shows no eligible/claimed work for the completed item.
7. Pause the automation again after the smoke unless the user explicitly wants it left running.

## Verification Commands

Run focused checks first:

```bash
pnpm --filter @thinkwork/api test -- src/handlers/mcp-open-engine.test.ts
node --test scripts/__tests__/open-engine-one-task-runner.test.mjs
pnpm --filter @thinkwork/api typecheck
```

If GraphQL schema or web query artifacts change:

```bash
pnpm schema:build
pnpm --filter @thinkwork/web codegen
pnpm --filter @thinkwork/api codegen
pnpm --filter @thinkwork/web test -- src/lib/graphql-queries.test.ts src/lib/graphql-queries.schema.test.ts
pnpm --filter @thinkwork/web typecheck
```

Browser verification:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
pnpm --filter @thinkwork/web dev -- --host 0.0.0.0 --port 5174
```

## Rollout

1. Implement behind the existing MCP/API surface; no feature flag is needed.
2. Merge to `main`.
3. Confirm dev deployment.
4. Run the scheduled automation smoke once.
5. Keep the scheduled automation paused unless the smoke is clean and the user confirms cutover.

## Risks

- **Metadata-only idempotency is not a hard database uniqueness guarantee.** This is acceptable for the immediate runner duplicate problem. If concurrent identical comment inserts become realistic, follow up with a dedicated idempotency column and unique index.
- **Prompt compliance alone is insufficient.** The API must no-op duplicates because scheduled automation retries and model restarts can repeat tool calls.
- **Over-deduping can hide legitimate progress.** Only dedupe when a stable idempotency key is provided; do not dedupe by body alone.
- **Existing duplicate comments remain.** This plan prevents new duplicates; it does not backfill or archive old ones.

## Definition of Done

- `open_engine_create_comment` supports idempotent evidence comments.
- Repeated runner/tool calls for the same evidence gate do not create duplicate Work Item comments.
- Runner prompts include stable evidence-gate keys.
- Existing receipt/status ledger/state behavior remains intact.
- Focused tests pass.
- A fresh scheduled runner E2E on dev proves one Work Item is processed once with clean comment evidence.
- Linear `THINK-105` is updated with the plan, PR, verification evidence, and any remaining blocker.
