---
module: agentcore-pi
problem_type: integration-risk
tags:
  - thnk-21
  - pi-goal
  - source-review
---

# THNK-21 pi-goal Source Review

Date: 2026-06-21

## Reviewed Package

- Package: `@narumitw/pi-goal`
- Version: `0.4.2`
- Tarball: `https://registry.npmjs.org/@narumitw/pi-goal/-/pi-goal-0.4.2.tgz`
- Files reviewed: `package.json`, `README.md`, `src/goal.ts`

## Findings

- The package exports a native Pi extension at `src/goal.ts` and registers one model tool, `goal_complete`.
- The published package ships TypeScript source, not compiled JavaScript. AgentCore Pi's container runs the normal `tsc` build and then `node dist/...`, so U1 vendors a reviewed snapshot of `src/goal.ts` from version `0.4.2` under `agent-container/src/runtime/vendor/` instead of requiring a runtime TS loader.
- Goal state is primarily persisted through Pi session custom entries with custom type `goal-state`.
- The package registers `/goal` commands for local command usage. ThinkWork v1 should not require users to type these commands, but later runtime translation can use the same package behavior behind composer metadata.
- The package auto-continues active goals by calling `pi.sendUserMessage(...)`, using `deliverAs: "followUp"` when the session is not idle.
- No network clients, shell execution, credential reads, or external service calls were found in the package source.
- The package has a legacy cleanup path for old global state. `/goal clear` can write `pi-goal-state.json` under `PI_CODING_AGENT_DIR` or, if unset, under `HOME/.pi/agent`. The ThinkWork adapter sets `PI_CODING_AGENT_DIR` before loading the extension so any legacy cleanup write stays under the invocation agent directory instead of a global home path.
- The vendored snapshot changes four integration details: legacy state file
  resolution captures the adapter's per-invocation `PI_CODING_AGENT_DIR` at
  extension registration; the async `agent_end` handler has an
  explicit final `return` to satisfy the repository's strict TypeScript checks;
  `/goal resume --tokens <budget>` updates the active goal budget before
  resuming; and hidden auto-continuation can be disabled with
  `THINKWORK_PI_GOAL_DISABLE_HIDDEN_CONTINUATION=true`, in which case active
  goals pause for ThinkWork-managed continuation instead of queueing a hidden
  Pi follow-up.

## Integration Decision

Proceed with a thin ThinkWork adapter for U1. The adapter only loads the pinned `0.4.2` behavior for goal-mode payloads, exposes `goal_complete` through `extensionToolNames`, and constrains the package's legacy state path by setting `PI_CODING_AGENT_DIR` before registering the extension.

U4 keeps continuation cloud-safe by disabling the package's hidden
`sendUserMessage(..., { deliverAs: "followUp" })` path through the ThinkWork
adapter. The Pi session still stores the goal state, but every additional turn
must re-enter through ThinkWork dispatch/finalize so thread turns, costs, and
status evidence remain centralized.
