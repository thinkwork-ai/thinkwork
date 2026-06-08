# Agent Profile Pi Goal Compatibility

Date: 2026-06-08

## Decision

Do not install `@ramarivera/pi-goal` directly into ThinkWork's in-turn Agent
Profile closed-loop runtime yet. Use it as design input and keep the immediate
closed-loop state ThinkWork-owned.

The closed-loop Agent Profile path now needs deterministic, tenant-scoped,
single-turn orchestration: parent Agent delegates, specialist profiles run,
Reviewer may run after candidate output exists, and the parent Agent owns the
final answer. `pi-goal` is a useful model for persisted goals, but its current
runtime behavior targets multi-turn continuation inside a Pi session, not a
managed ThinkWork turn.

## Package Findings

The inspected package was `@ramarivera/pi-goal@0.1.11`.

Useful concepts:

- Goal state includes objective, lifecycle status, token budget, elapsed time,
  usage, and usage by model.
- It exposes `get_goal`, `create_goal`, and `update_goal` model tools.
- It records usage at turn end and supports model breakdown when model switches
  happen during a goal.
- It includes a goal skill that guides users toward budgeted completion audits.

Constraints for ThinkWork v1 closed loops:

- It persists state as Pi custom session entries with `customType:
"pi-goal-state"` rather than ThinkWork tenant storage.
- It schedules hidden follow-up messages with `customType:
"pi-goal-continuation"`, `triggerTurn: true`, and `deliverAs: "followUp"`.
  That continuation pressure must not bypass ThinkWork budgets, finalization,
  reviewer gates, or user-visible turn ownership.
- It defaults structured Pino logs to `~/.pi/logs/pi-goal.log`, which is not a
  tenant-scoped ThinkWork log destination.
- It includes a local fallback model-pricing table. ThinkWork must use the model
  catalog, runtime usage evidence, and cost-event pipeline instead.
- Creating a goal can auto-submit the objective as user input. ThinkWork Agent
  Profile orchestration already owns the user request and child task payloads.

## Compatibility Map

For immediate closed loops, ThinkWork maps the useful goal concepts into
`AgentProfileLoopGoalState` in
`packages/agentcore-pi/agent-container/src/agent-profile-adapter.ts`.

- `objective` -> delegated profile task.
- `status` -> active, passed, revision requested, failed, or budget limited.
- `budget` -> `AgentLoopPolicy` values such as max iterations, review loops,
  runtime, token, and cost budgets.
- `usage` -> profile run usage and cost evidence.
- `usageByModel` -> model-keyed profile run usage for model-stacking reports.
- `completion` -> review verdict and feedback.
- `continuation` -> explicitly `thinkwork_managed` with hidden continuation
  disabled.

This gives the future loop implementation a goal-shaped contract without
introducing package-level continuation or storage side effects.

## Future Adoption Conditions

Direct `pi-goal` adoption is reasonable for future open-loop or long-running
AgentCore job work only after these constraints are met:

- Goal state is persisted through ThinkWork tenant-scoped storage, not local Pi
  session entries.
- Hidden continuation is disabled, replaced, or routed through ThinkWork's
  budget and finalization controller.
- Logs are sanitized and emitted to ThinkWork-managed destinations.
- Model and cost accounting uses the ThinkWork model catalog and cost-event
  evidence.
- `/goal` commands and goal tools are exposed only when an operator-enabled
  workflow intentionally allows persistent goal control.
- Automated tests prove tenant scoping, budget enforcement, no unauthorized
  continuation, sanitized logs, and correct Activity/Trace accounting.

## Follow-Up

The Agent Profile closed-loop implementation can proceed with ThinkWork-owned
goal state for U3-U7. Revisit this note when designing open loops or heavier
long-running delegated AgentCore jobs.
