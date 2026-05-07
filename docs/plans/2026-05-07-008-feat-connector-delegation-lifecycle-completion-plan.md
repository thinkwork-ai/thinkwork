---
title: "feat: connector delegation lifecycle completion"
type: feat
status: active
date: 2026-05-07
origin: user request
---

# feat: connector delegation lifecycle completion

## Overview

The Linear checkpoint now proves connector work reaches a real Managed Agent run:

Linear issue with `symphony` label -> terminal connector execution -> completed `connector_work` Computer task -> Computer-owned thread -> delegated `thread_turn` succeeds.

The remaining lifecycle gap is that `computer_delegations.status` stays `running` after the delegated `thread_turn` reaches a terminal status. This PR closes that gap without changing connector polling, task enqueueing, thread ownership, or delegation dispatch.

## Requirements Trace

- R1. When a delegated Managed Agent `thread_turn` succeeds, mark the matching `computer_delegations` row `completed`.
- R2. When a delegated Managed Agent `thread_turn` fails, mark the matching `computer_delegations` row `failed`.
- R3. Store useful result/error metadata on the delegation row, including the `threadTurnId`, terminal status, and a bounded response/error preview.
- R4. Preserve idempotency: duplicate Linear polling must not create duplicate executions, tasks, threads, delegations, or turns.
- R5. Keep the existing Computer-owned connector thread/message as the visible artifact.
- R6. Do not implement connector completion mirrors back to Linear, bidirectional sync, or new connector types.

## Scope Boundaries

- No schema change. `computer_delegations` already has `status`, `result`, `error`, `output_artifacts`, and `completed_at`.
- No GraphQL/UI changes in this PR.
- No changes to connector poller idempotency or `connector_work` task enqueueing.
- No attempt to make `computer_delegations` a full run table. `thread_turns` remains the actual Managed Agent run record.

## Context And Patterns

- `packages/api/src/lib/computers/runtime-api.ts` creates or reuses `computer_delegations`, stores `threadId` and `messageId` in `input_artifacts`, and marks the delegation `running` after `invokeChatAgent` accepts the async handoff.
- `packages/api/src/handlers/chat-agent-invoke.ts` creates the delegated `thread_turn`, then writes terminal `thread_turns.status` in the success path and multiple failure paths.
- `packages/database-pg/src/schema/computers.ts` allows `computer_delegations.status` values `pending`, `running`, `completed`, `failed`, and `cancelled`.
- The terminal update should be best-effort and must not turn a successful agent response into a failed chat invocation.

## Technical Decisions

- **Update from `chat-agent-invoke` terminal paths.** This is the smallest reliable place because it is where `thread_turns` becomes `succeeded` or `failed`.
- **Use a helper module for lifecycle updates.** A small helper under `packages/api/src/lib/computers/` keeps SQL matching and metadata shaping testable without building a full `chat-agent-invoke` integration harness.
- **Match narrowly.** Update only `running` delegations for the same tenant, agent, thread id, and connector message id. If the terminal invoke lacks a `messageId`, leave delegation status unchanged rather than risking a thread+agent-only match.
- **Keep lifecycle updates idempotent.** Terminal updates only target `status='running'`, so repeated failure/success cleanup calls do not rewrite a completed/failed delegation.
- **Store bounded metadata.** Store `threadTurnId`, `threadId`, `agentId`, `messageId`, terminal status, and bounded result/error previews. Keep full agent output in `messages` and `thread_turns.result_json`.

## Implementation Units

### U1. Add Delegation Lifecycle Helper

**Goal:** Provide a tested helper that completes or fails a matching running Computer delegation from a terminal `thread_turn`.

**Requirements:** R1, R2, R3, R4.

**Files:**

- Add: `packages/api/src/lib/computers/delegation-lifecycle.ts`
- Add: `packages/api/src/lib/computers/delegation-lifecycle.test.ts`

**Approach:**

- Export `markConnectorDelegationTurnCompleted` and `markConnectorDelegationTurnFailed`, or one typed terminal-update function.
- Filter by `tenant_id`, `agent_id`, `status='running'`, `input_artifacts->>'threadId'`, and `input_artifacts->>'messageId'`.
- On success, set `status='completed'`, `completed_at`, `result`, `error=null`, and `output_artifacts`.
- On failure, set `status='failed'`, `completed_at`, `error`, and `output_artifacts`.
- Return the number or identifiers of updated rows for logging.

**Test Scenarios:**

- Success update writes `completed`, `completed_at`, result metadata, and output artifacts.
- Failure update writes `failed`, `completed_at`, error metadata, and output artifacts.
- Matching includes thread/message/agent/tenant and `status='running'`.
- Missing `messageId` is a no-op; connector delegation dispatch always records the connector message id.

### U2. Wire Helper Into Chat Agent Terminal Paths

**Goal:** Close the delegation row when the delegated `thread_turn` reaches a terminal status.

**Requirements:** R1, R2, R3, R5.

**Files:**

- Modify: `packages/api/src/handlers/chat-agent-invoke.ts`

**Approach:**

- Import the lifecycle helper.
- After the success `thread_turns` update succeeds, call the helper with `status='completed'`, `turnId`, `threadId`, `agentId`, `messageId`, `responseText`, and usage metadata.
- In each existing failure path that updates the `thread_turn` to `failed`, call the helper with `status='failed'`, `turnId`, `threadId`, `agentId`, `messageId`, and the error text.
- Treat helper failures as best-effort logging only; do not change existing chat-agent behavior.

**Test Scenarios:**

- Existing chat-agent behavior remains unchanged when no matching delegation exists.
- Failure branches preserve existing assistant error message behavior.
- Lifecycle helper tests cover the update contract; full handler integration remains live-checked by the Linear checkpoint.

## Verification

- `pnpm --filter @thinkwork/api test -- src/lib/computers/delegation-lifecycle.test.ts src/lib/computers/runtime-api.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- Changed-file Prettier check if root `pnpm format:check` remains unavailable.

## Post-Merge Checkpoint

After merge and deploy:

1. Create a fresh Linear issue with only the `symphony` label.
2. Force or wait for connector polling.
3. Verify exactly one terminal connector execution.
4. Verify exactly one completed `connector_work` Computer task.
5. Verify exactly one `connector_work_received` event.
6. Verify exactly one Computer-owned thread.
7. Verify exactly one delegated `thread_turn`, status `succeeded`.
8. Verify exactly one `computer_delegations` row, status `completed`, with result metadata linking the thread turn.
9. Force a duplicate poll and verify counts remain one for execution, task, thread, delegation, and turn.
