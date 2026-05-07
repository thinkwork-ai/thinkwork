---
title: "fix: Computer runtime accepts connector work handoff tasks"
status: active
created: 2026-05-07
---

# fix: Computer runtime accepts connector work handoff tasks

## Problem

The Linear connector checkpoint now creates the right ownership chain: a `symphony`-labeled Linear issue produces a terminal connector execution, a `connector_work` Computer task/event, and a Computer-owned connector thread. The deployed Computer runtime then claims that task and marks it failed with `Unsupported Computer task type: connector_work`.

That failure makes a successful connector handoff look broken to operators and blocks follow-on work that expects Computer-owned connector tasks to be stable.

## Scope

Ship the smallest runtime fix: `connector_work` is accepted as a handoff/audit task and completed with a structured output. This PR does not implement full connector execution, provider-specific action handling, automatic delegation to managed Agents, or any new UI.

## Requirements

- R1. `packages/computer-runtime/src/task-loop.ts` must recognize `connector_work`.
- R2. `connector_work` must complete successfully with an output shaped like `{ ok: true, taskType: "connector_work", accepted: true, mode: "handoff_only" }`.
- R3. The runtime must not write Linear issue bodies to files or logs as part of this handoff-only completion.
- R4. Existing unsupported task behavior must remain unchanged for truly unknown task types.
- R5. Tests must prove the task loop completes `connector_work` instead of failing it.

## Implementation

### U1. Runtime Task Handler

**Files:**

- `packages/computer-runtime/src/task-loop.ts`
- `packages/computer-runtime/test/task-loop.test.ts`

**Approach:**

- Add a `connector_work` branch near the simple non-workspace handlers in `handleTask`.
- Return a small structured output that records the task as accepted and handoff-only.
- Avoid inspecting or echoing task input; the connector runtime already created the visible Computer-owned thread/message.

**Tests:**

- `handleTask` returns the handoff-only output for a `connector_work` task.
- `runTaskLoopOnce` calls `completeTask` for `connector_work` and does not call `failTask` or `appendTaskEvent`.
- Existing unsupported-task test still proves unknown task input is not leaked.

## Verification

- `pnpm --filter @thinkwork/computer-runtime test`
- `pnpm --filter @thinkwork/computer-runtime typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm dlx prettier@3.8.2 --check` on changed files if root `pnpm format:check` is blocked by the known missing root Prettier binary.

## Rollout Check

After merge and deploy, rerun the Linear checkpoint with a fresh `symphony` Linear issue and verify:

- one terminal connector execution
- one completed `connector_work` Computer task
- one `connector_work_received` event
- one Computer-owned connector thread
