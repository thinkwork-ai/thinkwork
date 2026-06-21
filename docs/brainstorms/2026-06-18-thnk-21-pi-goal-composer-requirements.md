---
date: 2026-06-18
topic: thnk-21-pi-goal-composer
linear: THNK-21
---

# THNK-21 Pi Goal Composer Mode

## Problem Frame

Thinkwork should let a user ask the Pi agent to keep working on a specific
composer-submitted objective until it is complete or the tenant-configured
goal-run budget is exhausted. The linked `@narumitw/pi-goal` extension is
expected to provide the core runtime goal behavior; Thinkwork's job is to expose
that behavior as a clear composer mode, resolve the budget contract from
Settings -> Agent configuration, and render completion or budget-paused outcomes
in the conversation.

**2026-06-21 product correction:** Goal mode must not make the user configure
token/cost budgets while writing the prompt. The composer should be dead simple:
click a Goal icon/toggle or use `/goal ...` shorthand. Admins/operators configure
the tenant default budget in Settings -> Agent configuration.

This is not the same product concept as existing long-running Thread Goals.
Thread Goals are durable workflow/accountability objects surfaced in the Thread
detail experience. Pi goal composer mode is a per-turn runtime mode: it starts
from the composer, applies to the next Pi agent turn and its continuations, and
does not create or update a `ThreadGoal` record in v1.

---

## Actors

- A1. End user: writes a composer message and decides whether this turn should
  run in goal mode.
- A2. Pi agent: runs the imported `pi-goal` loop, continues work within budget,
  and calls the goal completion primitive when done.
- A3. Thinkwork runtime: loads the goal extension, resolves tenant goal budget
  settings into the Pi invocation, records turn output, and enforces product
  boundaries.
- A4. Thinkwork web client: exposes goal mode in the composer and renders
  goal-run status, completion, and budget-paused outcomes in the thread.

---

## Key Flows

- F1. Start a goal-run from the composer
  - **Trigger:** A user enables Goal mode before sending a composer message.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The composer shows Goal mode as active without asking for a
    budget. The user sends the message. Thinkwork loads the tenant default
    goal-run budget from Settings -> Agent configuration, then invokes Pi with
    the imported `pi-goal` extension and the resolved budget. The agent keeps
    working on the submitted objective until completion, interruption, error, or
    budget exhaustion.
  - **Outcome:** The thread has a normal user message plus visible evidence
    that the following assistant work ran as a bounded goal-run.
  - **Covered by:** R1, R2, R3, R4, R5, R7

- F2. Complete a goal-run
  - **Trigger:** The Pi goal loop determines that the submitted objective is
    complete.
  - **Actors:** A2, A3, A4
  - **Steps:** The agent uses the goal completion primitive exposed by
    `pi-goal`. Thinkwork preserves the final assistant answer and renders a
    compact completion card with the goal summary, verification notes when
    available, and budget usage.
  - **Outcome:** The user can tell why the loop stopped and what was verified,
    without confusing the result with long-running Thread Goal review.
  - **Covered by:** R8, R9, R10, R11, R12

- F3. Pause after budget exhaustion and resume with more budget
  - **Trigger:** A goal-run consumes its token budget before completion.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Thinkwork stops further continuation, renders a budget-reached
    state in the thread, and offers the user a way to resume the same runtime
    goal state after budget policy is increased or refreshed through Settings.
    The current in-flight turn is not interrupted by later user changes; edits
    or pause requests apply before the next continuation.
  - **Outcome:** The user gets bounded autonomy without losing continuity.
  - **Covered by:** R4, R6, R13, R14, R15

---

## Requirements

**Composer goal mode**

- R1. The composer must expose Goal mode as a visible control for the next
  agent turn, not as a Thread Detail or Thread Goal control.
- R2. Enabling Goal mode must not require prompt-time budget configuration; the
  runtime budget comes from tenant Settings -> Agent configuration.
- R3. Settings -> Agent configuration must provide a tenant default goal-run
  budget policy with a safe built-in fallback for tenants that have not
  customized it yet.
- R4. The submitted message must carry enough goal-mode metadata for the
  runtime and UI to distinguish a normal agent turn from a goal-run.
- R5. The v1 user experience should support a one-step Goal icon/toggle and may
  support `/goal ...` shorthand; neither path should expose a budget field in
  the composer.

**Runtime behavior**

- R6. Thinkwork must import, pin, and load `@narumitw/pi-goal` as the core goal
  behavior rather than rewriting the goal loop from scratch.
- R7. The Pi invocation must receive the composer objective and server-resolved
  budget in the shape needed for `pi-goal` to run the goal loop.
- R8. Goal mode must apply to the submitted composer objective and its
  continuations only; it must not make the whole thread a durable autonomous
  workflow.
- R9. Goal edits, pause requests, or budget changes made while a turn is
  already in flight must apply before the next continuation, not interrupt the
  current turn.
- R10. A goal-run must stop when the imported extension reports completion,
  budget exhaustion, user cancellation, or runtime failure.

**Thread rendering and user feedback**

- R11. When a goal-run completes, the thread must show the assistant's final
  answer plus a compact completion card.
- R12. The completion card must include at least the goal summary, budget used,
  and available verification notes or completion evidence.
- R13. When a goal-run hits its token budget before completion, the thread must
  show a budget-reached paused state rather than treating the run as completed
  or failed.
- R14. From the budget-reached state, the user must be able to resume from the
  same goal-run state after the tenant budget policy allows additional work.
- R15. Goal-run status must be understandable without opening Thread Detail or
  inspecting runtime logs.

**Boundary from existing Thread Goals**

- R16. Pi goal composer mode must not create, update, or require an existing
  `ThreadGoal` record in v1.
- R17. Pi goal composer mode must not use the existing Thread Goal review
  workflow (`CONFIRM_COMPLETION` / `REQUEST_CHANGES`) in v1.
- R18. Existing Thread Goal UI and file-summary behavior must remain about
  long-running workflow goals, not per-turn Pi goal mode.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R5.** Given a user is composing a message,
  when they enable Goal mode with the Goal icon or type `/goal reconcile tests`,
  then sending the message persists goal-mode intent metadata without showing a
  composer budget field or requiring budget text in the prompt.
- AE2. **Covers R6, R7, R8, R10.** Given a user sends "update the docs and
  verify tests" with Goal mode enabled, when the Pi runtime starts, then
  `@narumitw/pi-goal` receives the objective and budget and drives continuation
  only for that submitted objective.
- AE3. **Covers R11, R12, R15.** Given the goal-run completes, when the user
  views the thread, then they see the assistant answer and a completion card
  explaining that the goal completed, what was verified, and how much budget was
  used.
- AE4. **Covers R13, R14.** Given a goal-run reaches its token budget before
  completion, when the user views the thread, then the state is visibly paused
  for budget, and the user can resume the same goal-run once the Settings
  budget policy permits additional work.
- AE5. **Covers R16, R17, R18.** Given a thread already has a long-running
  workflow `ThreadGoal`, when the user sends a separate composer Goal-mode
  message, then the per-turn goal-run does not modify the workflow goal or its
  review state.

---

## Success Criteria

- Users can deliberately ask Pi to keep working on one composer objective
  without learning slash-command syntax.
- Every goal-run has a resolved, visible token budget before Pi starts, without
  requiring the user to configure it in the composer.
- Completion and budget-paused states are visible in the conversation itself.
- Existing long-running Thread Goals remain conceptually separate from per-turn
  Pi goal mode.
- A downstream planner can proceed without re-deciding whether THNK-21 belongs
  in Thread Detail, whether v1 uses `ThreadGoal`, or whether `pi-goal` should be
  imported versus rewritten.

---

## Scope Boundaries

- Do not build Thread Detail controls for this feature in v1.
- Do not create or update `ThreadGoal` records from composer goal mode in v1.
- Do not route composer goal completion through Thread Goal review in v1.
- Do not allow unbounded goal-runs without a server-resolved token budget.
- Do not add composer token/cost budget fields in v1.
- Do not require slash-command usage for the main v1 web experience.
- Do not build tenant-wide active-goal dashboards or admin controls in v1.
- Do not solve durable background wakeups unless planning finds they are
  required for `pi-goal` to function correctly in AgentCore.

---

## Key Decisions

- Composer, not Thread Detail: Goal mode starts from the message composer
  because it is a per-turn runtime behavior, not a long-running workflow goal.
- Import, do not rewrite: `@narumitw/pi-goal` is expected to provide the core
  loop behavior; Thinkwork should integrate around it.
- Tenant-configured default budget: Goal mode always starts with a
  server-resolved budget from Settings -> Agent configuration, because
  autonomous continuation without a budget is unsafe and prompt-time budget
  forms make the composer too heavy.
- Apply changes on next continuation: Mutations during an in-flight turn should
  not interrupt that turn; they affect the next continuation.
- Completion card, not ThreadGoal review: The conversation shows completion
  evidence directly without involving existing workflow-goal review semantics.

---

## Dependencies / Assumptions

- `@narumitw/pi-goal` can be imported and loaded in the AgentCore Pi runtime via
  the existing Pi extension loading mechanism.
- The imported extension's continuation model can either run as-is in the
  serverless runtime or be bridged with a thin Thinkwork adapter during
  planning.
- Existing composer surfaces in `apps/web/src/components/workbench` can carry
  extra per-message options without creating a separate Thread Detail workflow.
- Existing Thread Goal files and review flows are intentionally separate and
  should not be repurposed for per-turn runtime goals.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6, R7][Needs research] What is the exact package import path and
  bundling shape for `@narumitw/pi-goal` in the current pnpm workspace?
- [Affects R7, R10][Technical] Does `pi-goal`'s local continuation behavior work
  unchanged inside the AgentCore Pi runtime, or does Thinkwork need a small
  adapter to bridge continuations?
- [Affects R11, R12, R13][Technical] Which existing message-part or event shape
  should render goal completion and budget-paused cards in the thread?
- [Affects R3, R4][Technical] Which tenant settings fields should represent the
  v1 goal-run budget: token-only enforcement, token plus display-only cost
  budget, or token plus enforceable cost budget if the cost-event pipeline can
  stop continuations deterministically?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
