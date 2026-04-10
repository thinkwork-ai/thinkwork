---
name: agent-thread-management
description: >
  Create sub-threads, manage dependencies, update status, and query threads.
  Use when breaking work into subtasks, tracking progress, or managing task dependencies.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Agent Thread Management Skill

## Safety Rules

1. **Same tenant only** — you can only create/modify threads within your own tenant.
2. **No deleting threads** — you may update status but never delete threads.
3. **Max 10 sub-threads per turn** — avoid creating excessive sub-threads in a single invocation.
4. **Never expose secrets** — do not echo `$MANIFLOW_API_SECRET` in responses.

## Available Operations

All operations use the Thinkwork GraphQL API via `curl` against `$MANIFLOW_API_URL` with header `x-api-key: $MANIFLOW_API_SECRET`.

| Operation | Mutation/Query | Purpose |
|-----------|---------------|---------|
| Create Sub-Thread | `createThread` | Break work into subtasks (set `parentId`) |
| Add Dependency | `addThreadDependency` | Block a thread until another completes |
| Update Status | `updateThread` | Move thread through status workflow |
| Add Comment | `addThreadComment` | Document progress or decisions |
| List Sub-Threads | `threads(parentId)` | Check completion of child threads |
| Get Thread Details | `thread(id)` | Full thread with comments, dependencies |
| Escalate Thread | `escalateThread` | Hand off to supervisor agent |
| Delegate Thread | `delegateThread` | Reassign to a specialist agent |

See `references/graphql-mutations.md` for full curl examples of each operation.

## Status Transitions

- `BACKLOG` -> `TODO`, `IN_PROGRESS`, `CANCELLED`
- `TODO` -> `IN_PROGRESS`, `BACKLOG`, `CANCELLED`
- `IN_PROGRESS` -> `IN_REVIEW`, `BLOCKED`, `DONE`, `CANCELLED`
- `IN_REVIEW` -> `IN_PROGRESS`, `DONE`, `CANCELLED`
- `BLOCKED` -> `IN_PROGRESS`, `TODO`, `CANCELLED`
- `DONE` -> `IN_PROGRESS`
- `CANCELLED` -> `BACKLOG`, `TODO`

## When to Use This Skill

- Breaking down a complex task into sub-threads
- Adding dependencies between threads to enforce execution order
- Updating thread status as work progresses
- Adding comments to document progress or decisions
- Querying sub-threads to check completion status
- Escalating work to a supervisor when you're blocked or need approval
- Delegating work to a specialist agent

## Quick-Start Workflow

1. Receive a complex thread assignment
2. Analyze and decompose into sub-tasks
3. Create sub-threads with `createThread` (set `parentId` to current thread)
4. Add dependencies with `addThreadDependency` to order the sub-tasks
5. As each sub-task completes, update status to `DONE`
6. When all sub-tasks are done, mark the parent thread `DONE`
7. If blocked, use `escalateThread` to hand off to your supervisor
8. If another agent is better suited, use `delegateThread` to reassign

See `references/escalation-delegation.md` for escalation and delegation patterns.

## Reference Documents

- **[GraphQL Mutations](references/graphql-mutations.md)** — Full curl examples for all 8 operations (create, dependency, status, comment, list, get, escalate, delegate)
- **[Escalation & Delegation](references/escalation-delegation.md)** — Detailed patterns for escalating to supervisors and delegating to specialist agents
