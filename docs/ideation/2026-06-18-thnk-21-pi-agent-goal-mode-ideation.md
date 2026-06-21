---
date: 2026-06-18
topic: thnk-21-pi-agent-goal-mode
focus: Codex-like goal function for the Pi agent, with mid-run UI controls and bounded budgets
mode: repo-grounded
linear: THNK-21
---

# Ideation: THNK-21 Pi Agent Goal Mode

## Grounding Context

### Codebase Context

Thinkwork already has a workflow-oriented goal substrate:

- `packages/database-pg/src/schema/goals.ts` defines a `goals` table bound to tenant, space, and thread, with `outcome`, `mode`, `status`, completion/review policy, and goal folder metadata.
- `packages/database-pg/graphql/types/goals.graphql` exposes `ThreadGoal`, `threadGoal`, `threadGoalFiles`, `refreshThreadProgress`, and `reviewGoal`.
- `apps/web/src/components/workbench/TaskThreadView.tsx` already renders a Goal info panel with review actions and goal-file summaries.
- `packages/api/src/lib/task-status-tool.ts` can advance an active goal to `in_review` when required linked tasks are done.
- `packages/agentcore-pi/agent-container/src/server.ts` loads internal Pi extensions through `extensionFactories` and folds extension tool names into the Pi tool allowlist.

The current gap is that these goals are not Codex-like runtime goals. Existing goal statuses are `ACTIVE`, `IN_REVIEW`, `COMPLETED`, and `CANCELLED`; they do not model runtime control states like paused, budget-limited, continuation pending, iteration count, or token/cost usage.

### Past Learnings

- `docs/solutions/spikes/2026-05-29-pi-extension-loading-agentcore-spike.md` says programmatic `extensionFactories` are the right cloud mechanism for bundled Pi extensions, with path-discovery as fallback only.
- `docs/plans/2026-06-09-004-feat-cognee-centric-memory-pipeline-plan.md` repeats the important Pi extension gotcha: extension tool names must be folded into the `createAgentSession` allowlist and verified by actual tool calls, not registration logs.
- Prior budget work in `docs/brainstorms/2026-06-05-user-cost-attribution-and-budgets-requirements.md` argues that user-owned background work should count against the owning user's budget and pause when budget is exceeded.

### External Context

THNK-21 links to [`@narumitw/pi-goal`](https://pi.dev/packages/%40narumitw/pi-goal), published June 13, 2026. Its README says it adds session-scoped `/goal` commands, a `goal_complete` tool, token budgets like `/goal --tokens 100k`, active/paused/budget-limited/complete states, session-state storage, guarded continuation, and pause-on-error behavior. The source implements those ideas by registering `goal_complete`, injecting goal instructions during `before_agent_start`, checking token usage on `agent_end`, and sending continuation prompts when the goal is still active.

The package is intended to do most of the runtime heavy lifting. Thinkwork should import and leverage it, with a pinned/reviewed dependency path and a thin integration layer for the parts that are product-specific: platform budget enforcement, thread-visible UI state, cost attribution, durable continuation, and integration with the existing `ThreadGoal` review loop.

Sources:

- [`@narumitw/pi-goal` package page](https://pi.dev/packages/%40narumitw/pi-goal)
- [`narumiruna/pi-extensions` repository](https://github.com/narumiruna/pi-extensions)

## Ranked Ideas

### 1. Import `pi-goal` With A Thinkwork Integration Layer

**Description:** Import and load `@narumitw/pi-goal` as the core Pi goal-mode extension, then wrap or configure it through Thinkwork's runtime integration layer. The Thinkwork layer should handle dependency pinning/review, extension loading, API-visible state, Thread UI controls, platform budgets, and cloud-safe continuation semantics.

**Warrant:** `direct:` Thinkwork already loads Pi extensions through `extensionFactories` and folds extension tool names into the runtime allowlist; `external:` `@narumitw/pi-goal` already implements `/goal`, `goal_complete`, token budgets, status transitions, prompt injection, and guarded continuation.

**Rationale:** This gets the benefit of the existing extension while still making the feature feel native to Thinkwork. The work should focus on integration, state bridging, UX, and safety boundaries rather than rewriting goal-mode mechanics from scratch.

**Downsides:** Need to verify the extension's assumptions against the serverless AgentCore runtime and decide where to adapt upstream behavior versus wrap it.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 2. Dual-State Model: Workflow Goal vs Runtime Goal

**Description:** Keep existing `ThreadGoal` as the human/workflow ledger, and add a runtime goal state for active objective, version, pause state, budget usage, iteration, and continuation marker. Sync runtime completion into `ThreadGoal` review rather than overloading existing statuses.

**Warrant:** `direct:` `ThreadGoalStatus` currently has `ACTIVE`, `IN_REVIEW`, `COMPLETED`, and `CANCELLED`; `external:` the Pi goal package needs `active`, `paused`, `budget_limited`, and `complete`.

**Rationale:** Existing Thread goals mean "what workflow is this thread fulfilling?" Runtime goal state means "should the agent keep going right now?" Those are related, but not identical.

**Downsides:** More schema/API surface than stuffing everything into `goals.metadata`.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 3. Mid-Run Goal Drawer

**Description:** Add controls to the Thread detail surface for start, edit, pause, resume, clear, and budget adjustment while a turn is running. Show current objective, status, iteration, token/cost/time usage, and what will happen next.

**Warrant:** `direct:` `TaskThreadView.tsx` already renders a Goal panel and review actions; the user explicitly requested setting a goal while the agent is running.

**Rationale:** Goal mode should be understandable and correctable. If the user changes the objective mid-run, the UI should show whether the current turn is still running under the old version or whether the next continuation will pick up the new one.

**Downsides:** Needs careful disabled states, conflict messages, and optimistic update behavior.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 4. Budget Governor With Circuit-Breaker Semantics

**Description:** Support token budget for the first release, but shape the API to also hold max turns, wall-clock/runtime, and cost budget. When exhausted, mark the runtime goal `budget_limited`, stop continuation, and ask the user to increase budget, resume, or clear.

**Warrant:** `external:` `@narumitw/pi-goal` already stops at token budget; `direct:` `agent-profile-delegation.ts` already models max tokens, runtime, and cost budgets for child loops.

**Rationale:** The budget is the safety contract that makes autonomous continuation acceptable. "Budget-limited" should not be treated as failure or completion; it is a paused state that needs user choice.

**Downsides:** Exact token/cost attribution may need calibration against current `thread_turns` and cost-event telemetry.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 5. Cloud-Safe Continuation Bridge

**Description:** Leverage pi-goal's continuation behavior, but bridge it into Thinkwork's durable turn/wakeup pipeline where the local `sendUserMessage` semantics do not map cleanly to AgentCore cloud execution. The extension can drive the goal loop; Thinkwork should still decide whether to enqueue the next turn after checking budget, queue state, user edits, and thread lifecycle.

**Warrant:** `direct:` `server.ts` runs in a serverless AgentCore container with S3-backed sessions; `external:` pi-goal auto-continues after `agent_end`.

**Rationale:** Local auto-loop logic is attractive, but cloud-hosted product behavior needs durable, auditable scheduling. Continuations should go through the same budget, cost, queue, and lifecycle gates as other agent wakeups.

**Downsides:** Requires planning against the current wakeup/turn creation path before implementation.

**Confidence:** 78%

**Complexity:** High

**Status:** Unexplored

### 6. Review-Gated `goal_complete`

**Description:** Register a `goal_complete` tool that requires summary and evidence. If review policy requires human review, calling it moves the `ThreadGoal` to `IN_REVIEW` and surfaces completion evidence in the UI; it does not silently close the thread.

**Warrant:** `direct:` `reviewGoal` already handles `CONFIRM_COMPLETION` and `REQUEST_CHANGES`; `external:` pi-goal uses `goal_complete` as the explicit completion primitive.

**Rationale:** The agent gets a clear finish line, while Thinkwork preserves enterprise review control. This also makes completion evidence inspectable in the Thread UI.

**Downsides:** Needs validation rules for evidence without becoming brittle.

**Confidence:** 85%

**Complexity:** Medium

**Status:** Unexplored

### 7. Autonomy Ladder

**Description:** Make goal mode configurable in tiers: current-turn-only persistence, auto-continue within budget, and later background wakeups. Default new goals to explicit budgeted autonomy rather than unbounded continuation.

**Warrant:** `reasoned:` The same user-facing phrase, "goal mode," can mean "do not stop at a plan" or "keep working while I walk away." Those have different consent and observability requirements, so the product should expose distinct autonomy levels instead of one overloaded switch.

**Rationale:** A ladder gives THNK-21 a safer first release while preserving the path to more autonomous background work later.

**Downsides:** More product language and state transitions to design.

**Confidence:** 80%

**Complexity:** Low-Medium

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                        | Reason Rejected                                                                                                          |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Rewrite goal mode from scratch              | Duplicates the linked extension, which is expected to do most of the heavy lifting.                                      |
| 2   | UI-only goal field                          | Not enough; without runtime continuation state, it is just metadata.                                                     |
| 3   | Unlimited auto-continue by default          | Fails the explicit budget concern and enterprise safety expectations.                                                    |
| 4   | Make every thread automatically a goal      | Too broad; replaces normal chat semantics and would surprise users.                                                      |
| 5   | Store goals globally per agent or workspace | External prior art explicitly moved away from global per-directory state; Thinkwork goals should be thread-owned.        |
| 6   | Agent directly closes Thread on completion  | Bypasses existing `ThreadGoal` review workflow and weakens trust.                                                        |
| 7   | Build background wakeups first              | Useful, but high complexity; the visible, budgeted active-thread MVP should come first unless planning proves otherwise. |

## Suggested Issue Description Shape

THNK-21 should be framed as an imported Pi extension plus a Thinkwork integration/control-plane layer:

1. Import and pin `@narumitw/pi-goal`; verify it loads correctly in the AgentCore Pi runtime through `extensionFactories`.
2. Add platform state/API for runtime goal objective, status, version, budget, usage, and continuation metadata where the extension's session state needs to be reflected to web/mobile.
3. Add Thread UI controls to set/edit/pause/resume/clear the active runtime goal while a turn is running.
4. Enforce token budget in v1, with API shape ready for max turns, wall-clock/runtime, and cost budget.
5. Route completion through `goal_complete` into existing ThreadGoal review semantics.
6. Bridge pi-goal continuation into durable platform continuation/wakeup mechanics where needed instead of relying only on in-container local auto-loop behavior.
