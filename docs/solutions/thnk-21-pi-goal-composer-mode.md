---
module: agentcore-pi
problem_type: integration-pattern
tags:
  - thnk-21
  - pi-goal
  - goal-mode
  - composer
---

# THNK-21 Pi Goal Composer Mode

Date: 2026-06-21

## Decision

ThinkWork supports composer-launched Pi goal runs as a per-turn runtime mode,
not as a durable `ThreadGoal` workflow. Users start the mode with the Goal
composer affordance or `/goal ...` shorthand; the API resolves the tenant goal
token budget from Settings -> Agents before dispatch.

The runtime imports the reviewed `@narumitw/pi-goal@0.4.2` behavior through a
thin AgentCore Pi adapter. ThinkWork owns the cloud boundary: hidden
continuation is disabled, `goal_complete` is allowlisted only for goal-mode
turns, and every continuation/resume must re-enter the normal
thread-turn/finalize/cost path.

## Implementation Record

The autopilot rollout landed in seven isolated units:

- U1 extension import/load:
  [#2816](https://github.com/thinkwork-ai/thinkwork/pull/2816)
- U7 tenant goal budget settings:
  [#2817](https://github.com/thinkwork-ai/thinkwork/pull/2817)
- U2 metadata contract:
  [#2818](https://github.com/thinkwork-ai/thinkwork/pull/2818)
- U3 composer controls:
  [#2820](https://github.com/thinkwork-ai/thinkwork/pull/2820)
- U4 runtime translation:
  [#2821](https://github.com/thinkwork-ai/thinkwork/pull/2821)
- U5 goal-run status rendering:
  [#2822](https://github.com/thinkwork-ai/thinkwork/pull/2822)
- U6 smoke/docs/codegen:
  [#2823](https://github.com/thinkwork-ai/thinkwork/pull/2823)

## Runtime Contract

- User messages carry `metadata.goalMode` with `enabled`, `action`,
  `objective`, and optional `goalRunId`.
- The API validates the envelope and resolves `resolvedBudget.tokenBudget` from
  tenant Agent configuration. Composer UI never asks normal users to configure a
  token or cost budget in the prompt.
- `chat-agent-invoke` forwards the normalized runtime envelope as `goal_mode`.
- AgentCore Pi translates a start action into the extension's `/goal --tokens`
  command, loads the pinned goal adapter, and exposes `goal_complete`.
- Finalize persists bounded goal evidence on both
  `thread_turns.usage_json.goal_run` and `thread_turns.result_json.goal_run`.

## Evidence Contract

Assistant prose is not sufficient evidence that a goal run actually executed.
Operators should inspect the persisted turn JSON:

- `source: "pi_goal"`
- `status: "complete"` or `"completed"` with a `goal_complete` invocation or
  `completion_summary`
- or `status: "budget_limited"` with `budget_limited_reason` / token-budget
  fields
- `continuation_policy: "thinkwork_managed"` when the runtime emits it

The thread UI renders this evidence through the shared goal-run card. A malformed
payload degrades to a bounded operator debug row rather than breaking the
transcript.

## Product Boundary

Composer goal mode intentionally does not create, update, or require the
existing durable `ThreadGoal` records. It must not route completion through
`reviewGoal`, `CONFIRM_COMPLETION`, or `REQUEST_CHANGES`. Future work may build
admin dashboards or human review policy for autonomous goals, but that should be
a separate product design because it overlaps with the older Thread Goal review
workflow.

## Rollout Checks

- Confirm the deployed AgentCore Pi image contains the pinned
  `@narumitw/pi-goal@0.4.2` reviewed snapshot.
- Run the normal Pi capability smoke to prove baseline runtime routing still
  works.
- Run the explicit goal smoke:

  ```bash
  pnpm --filter @thinkwork/api pi:capability-smoke -- \
    --tenant-id <tenant-id> \
    --agent-id <agent-id> \
    --sender-id <human-user-id> \
    --capability goal \
    --timeout 120000
  ```

- Treat `no_goal_run_evidence_in_thread_turn_usage_json_or_result_json` as a
  wiring failure even if the assistant says the goal completed.
- If the goal tool is missing, inspect `metadata.goalMode`, API budget
  resolution, AgentCore `goal_mode`, `buildInvocationResources`
  `extensionToolNames`, and the `goal_complete` allowlist together.

## Security Notes

The companion source review is
`docs/solutions/thnk-21-pi-goal-source-review-2026-06-21.md`.

For the pinned version, review found no unexpected network clients, shell
execution, credential reads, or external service calls. The adapter constrains
legacy state path behavior with `PI_CODING_AGENT_DIR` and disables package
hidden continuation with `THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION=true`.
