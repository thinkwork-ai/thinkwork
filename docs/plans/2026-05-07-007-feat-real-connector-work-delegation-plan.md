---
title: "feat: real connector_work delegation"
type: feat
status: active
date: 2026-05-07
origin: user request
---

# feat: real connector_work delegation

## Overview

Turn the current `connector_work` Computer runtime behavior from a handoff-only audit completion into a real delegated Managed Agent run. The Linear checkpoint already proves ingestion and Computer ownership:

Linear issue with the `symphony` label -> terminal connector execution -> `connector_work` Computer task/event -> Computer-owned thread/message.

This slice keeps that visible Computer-owned artifact intact, then has the Computer runtime ask the trusted runtime API to delegate the task through the existing chat-agent/Flue path. The goal is the smallest deployable PR that creates one linked delegated run for one connector task.

## Problem Frame

`connector_work` is no longer failing, but it completes with:

```json
{ "accepted": true, "mode": "handoff_only" }
```

That proves the Computer runtime accepts the task, but it does not yet cause any Managed Agent/Flue work to happen. The platform needs the next checkpoint to prove that connector-originated work can travel from Linear into a Computer-owned thread and then into the existing Flue-backed delegated execution path.

## Requirements Trace

- R1. Preserve the Computer-owned connector thread/message created by the connector runtime.
- R2. When the Computer runtime claims `connector_work`, delegate it to a Managed Agent through the existing Flue/chat-agent path.
- R3. Link the delegated run back to connector execution, Computer task, and thread.
- R4. Keep connector poll idempotency: duplicate Linear polling must not create duplicate executions, tasks, threads, or delegated runs.
- R5. Keep runtime task completion honest: complete `connector_work` only after delegation is accepted/enqueued.
- R6. Do not implement full bidirectional connector execution, connector completion mirrors, or new connector types.
- R7. Add tests proving successful delegation and duplicate/idempotent behavior.

## Scope Boundaries

- No new connector types.
- No Slack, GitHub, Google Workspace, or channel-ingress work.
- No Linear completion/status mirror back to Linear.
- No new GraphQL admin UI in this PR.
- No new dispatch target model beyond the already-merged Computer target.
- No attempt to make the Computer runtime execute the Linear task itself.

## Context & Research

### Relevant Code and Patterns

- `packages/computer-runtime/src/task-loop.ts` currently handles `connector_work` with `handoff_only` output.
- `packages/computer-runtime/src/api-client.ts` is the ECS runtime's service-auth client for Computer runtime API calls.
- `packages/api/src/handlers/computer-runtime.ts` owns service-auth routes for runtime config, heartbeat, task claim, task completion, task events, and Google Workspace token resolution.
- `packages/api/src/lib/computers/runtime-api.ts` owns tenant/computer/task-scoped service operations.
- `packages/api/src/lib/computers/tasks.ts` normalizes `connector_work` input and enforces idempotency on task enqueue.
- `packages/api/src/lib/connectors/runtime.ts` already creates the Computer-owned connector thread/message and `connector_work_received` event, with task idempotency keyed by connector id + external ref.
- `packages/database-pg/src/schema/computers.ts` already has `computer_delegations`, including `computer_id`, `agent_id`, `task_id`, `status`, `input_artifacts`, `result`, `error`, and timestamps.
- `packages/api/src/graphql/utils.ts` exposes `invokeChatAgent`, which fires `chat-agent-invoke` and ultimately uses the selected agent runtime, including Flue.
- `packages/api/src/handlers/chat-agent-invoke.ts` creates `thread_turns` and invokes the selected Agent runtime. It resolves connector-origin user context only when `created_by_type='connector'`; this PR will need a comparable safe identity path for Computer-owned connector threads or should use the Computer owner's paired agent as the delegated actor.
- `docs/plans/2026-05-07-003-feat-computer-first-connector-routing-plan.md` explicitly deferred true Computer runtime handling/delegation of `connector_work`; this PR is that follow-up.

### Institutional Learnings

- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` supports using the existing `computer_delegations`, `thread_turns`, and chat-agent path rather than inventing a separate connector-run subsystem.
- `docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md` documents that the deploy smoke already validates the Flue Lambda path, so this PR can integrate with existing invocation machinery instead of creating a bespoke Flue caller.
- `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md` applies to the checkpoint language: this PR proves real delegation, not full connector product completion.

### External Research

No external research is needed. The work is internal orchestration across existing tables, runtime API routes, and the already-deployed Flue/chat-agent path.

## Key Technical Decisions

- **Add a runtime API operation for connector delegation.** The ECS Computer runtime should not hold AWS Lambda invocation details or direct DB credentials. It should call a service-auth endpoint on `computer-runtime`, just as it does for task completion and Google token resolution.
- **Use `computer_delegations` for durable linkage.** Insert or reuse a row keyed by task/thread/agent semantics in code, then store connector execution/task/thread provenance in `input_artifacts`.
- **Delegate to the Computer's migrated/paired Managed Agent for v0.** Prefer `computers.migrated_from_agent_id` as the delegated Agent. If absent, fail the task with a clear configuration error rather than guessing. This keeps the PR small and matches the current Computer migration model.
- **Use the existing `invokeChatAgent` path.** This gives us the current Flue/Managed Agent behavior, `thread_turns`, assistant message creation, cost recording, and deploy smoke coverage.
- **Preserve Computer thread ownership.** Do not reassign the thread to the delegated Agent. The Managed Agent run should be linked to the Computer task/delegation, while the user-visible artifact remains Computer-owned.
- **Keep idempotency at both layers.** Connector runtime already prevents duplicate executions/tasks/threads. Runtime delegation should also reuse an existing `computer_delegations` row for a repeated task handling attempt and avoid firing another agent invoke if a delegation for the task is already running or completed.

## Implementation Units

### U1. Add Computer Runtime Delegation Service Operation

**Goal:** Provide a service-auth API endpoint the Computer runtime can call after claiming `connector_work`.

**Requirements:** R2, R3, R5.

**Files:**

- Modify: `packages/api/src/lib/computers/runtime-api.ts`
- Modify: `packages/api/src/handlers/computer-runtime.ts`
- Test: `packages/api/src/handlers/computer-runtime.test.ts`
- Test: `packages/api/src/lib/computers/runtime-api.test.ts`

**Approach:**

- Add a function such as `delegateConnectorWorkTask({ tenantId, computerId, taskId })`.
- Load the task scoped by tenant/computer/id and require `task_type='connector_work'`.
- Parse required `connectorExecutionId`, `externalRef`, `title`, `body`, and metadata from task input.
- Resolve the Computer and its delegated Agent using `computers.migrated_from_agent_id`.
- Resolve the connector-created thread from metadata or connector execution outcome payload.
- Insert or reuse a `computer_delegations` row for this task.
- Invoke `invokeChatAgent({ tenantId, threadId, agentId, userMessage, messageId })` using the existing connector message id when available.
- Return `{ delegated: true, mode: "managed_agent", delegationId, agentId, threadId }` when a new invoke was enqueued.
- Return an idempotent result without invoking again when the delegation is already `running` or `completed`.

**Test scenarios:**

- Happy path: valid `connector_work` task creates a delegation row, calls `invokeChatAgent`, and returns delegated output ids.
- Idempotent path: an existing running/completed delegation for the task returns the existing delegation and does not call `invokeChatAgent` again.
- Error path: non-`connector_work` task is rejected.
- Error path: Computer has no `migrated_from_agent_id` and the service returns a configuration error.
- Error path: task input missing thread/message linkage returns a clear task input error.

### U2. Call Delegation From the Computer Runtime Task Loop

**Goal:** Replace `handoff_only` completion with a real service-backed delegation call.

**Requirements:** R1, R2, R5.

**Files:**

- Modify: `packages/computer-runtime/src/api-client.ts`
- Modify: `packages/computer-runtime/src/task-loop.ts`
- Test: `packages/computer-runtime/test/task-loop.test.ts`

**Approach:**

- Add `delegateConnectorWork(taskId)` to `ComputerRuntimeApi`.
- Include the method in `TaskLoopOptions.api`.
- In `handleTask`, require the API for `connector_work`, call `delegateConnectorWork(task.id)`, and return an output shape such as:

```json
{
  "ok": true,
  "taskType": "connector_work",
  "accepted": true,
  "mode": "managed_agent",
  "delegationId": "...",
  "agentId": "...",
  "threadId": "..."
}
```

- Keep failure behavior unchanged: thrown delegation errors produce `task_error` and `failed` task status.

**Test scenarios:**

- `handleTask` delegates `connector_work` through the API and returns the service output.
- `runTaskLoopOnce` completes a connector task after delegation succeeds.
- Delegation failure appends `task_error` and fails the task.
- Existing non-connector task behavior remains unchanged.

### U3. Preserve Connector Runtime Idempotency Tests

**Goal:** Ensure this PR does not regress the already-proven Linear polling idempotency.

**Requirements:** R4, R7.

**Files:**

- Modify if needed: `packages/api/src/lib/connectors/runtime.test.ts`
- Modify if needed: `packages/api/src/lib/connectors/runtime.ts`

**Approach:**

- Keep existing duplicate execution behavior unchanged.
- If delegation requires additional metadata in task input/outcome payload, add it in the Computer handoff transaction without creating new duplicate surfaces.

**Test scenarios:**

- Duplicate connector external ref still creates no new Computer task or thread.
- Computer handoff output still includes connector execution, task, thread, and message ids.

## Verification

- `pnpm --filter @thinkwork/computer-runtime test`
- `pnpm --filter @thinkwork/computer-runtime typecheck`
- `pnpm --filter @thinkwork/api test`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format:check` or changed-file Prettier check if the root Prettier binary remains unavailable.

## Post-Merge Checkpoint

After merge and deploy:

1. Create a fresh Linear issue with only the `symphony` label.
2. Verify exactly one terminal connector execution.
3. Verify exactly one completed `connector_work` task.
4. Verify exactly one `connector_work_received` event.
5. Verify exactly one Computer-owned thread.
6. Verify exactly one `computer_delegations` row linked to the task/thread/agent.
7. Verify one delegated Flue/Managed Agent run is visible through `thread_turns` on that thread.
