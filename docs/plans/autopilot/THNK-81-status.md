---
title: "THNK-81 Autopilot Status"
linear_issue: THNK-81
status: active
started_at: 2026-06-26
target_branch: main
---

# THNK-81 Autopilot Status

## Objective

Implement THNK-81 end to end: keep `ask_user_question` as the blocking HITL
approval path, add a bounded `data-json-render` durable action adapter for Work
Item status updates, refresh Work Item-backed web state after generated UI
actions, and record evidence for both approval paths.

## Context Sources Read

- `AGENTS.md`
- Linear issue `THNK-81`
- Linear comments on `THNK-81`
- Linear document: `Brainstorm Summary: json-render Work Item status actions`
- Linear document: `Plan: Route json-render actions to Work Item status updates`
- `docs/brainstorms/2026-06-26-thnk-81-json-render-work-item-actions-requirements.md`
- `docs/plans/2026-06-26-004-feat-json-render-work-item-actions-plan.md`
- `docs/brainstorms/2026-06-09-ask-user-question-requirements.md`
- `docs/brainstorms/2026-06-25-thread-work-items-requirements.md`
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
- `docs/solutions/runtime-errors/ask-user-question-tool-missing-during-deploy-roll-2026-06-11.md`
- `docs/solutions/architecture-patterns/wakeup-processor-payload-parity-with-chat-agent-invoke-2026-06-12.md`
- `docs/solutions/architecture-patterns/external-workflow-agent-step-bridges-need-resumable-ledgers-2026-06-21.md`

## Linear State Log

- 2026-06-26: Discovered `THNK-81` already in `In Progress` during autopilot
  startup. No additional state change was needed before the first implementation
  unit.

## Implementation Units

The Linear-attached plan defines five units. Autopilot will group U1 and U2
because they share the same resolver, tests, idempotency semantics, and audit
message contract.

1. U1/U2: Backend Work Item status adapter, idempotency guard, and audit
   metadata without implicit agent execution.
2. U3: Generated UI contract fixtures and runtime guidance.
3. U4: Web refresh wiring after generated UI Work Item actions.
4. U5: End-to-end evidence for HITL question and generated UI action paths.

## Branches and PRs

| Unit | Branch | PR | State |
| --- | --- | --- | --- |
| U1/U2 | `codex/thnk-81-json-render-actions-u1-u2` | [#2997](https://github.com/thinkwork-ai/thinkwork/pull/2997) | Merged |
| U3 | `codex/thnk-81-json-render-actions-u3` | [#2998](https://github.com/thinkwork-ai/thinkwork/pull/2998) | Review/CI |

## U1/U2 Objective

Parse `target: "work_item_status"` durable action params in
`handleJsonRenderAction`, route valid actions through `setWorkItemStatus`,
store generated UI idempotency provenance on Work Item events, avoid duplicate
mutation on retry, write bounded `jsonRenderAction.mutation` audit metadata,
and ensure recognized Work Item actions do not request arbitrary agent
continuation.

## Verification Log

- 2026-06-26 U1/U2 focused test:
  `pnpm --filter @thinkwork/api test -- handleJsonRenderAction` passed
  (10 tests).
- 2026-06-26 U1/U2 typecheck:
  `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-06-26 U1/U2 review fix: moved Work Item event idempotency repair ahead
  of the rate-limit check so retry-after-partial-failure can repair a missing
  Thread audit message without being blocked by fresh-action rate limiting.
  Re-ran the focused test and API typecheck successfully.
- 2026-06-26 U1/U2 PR opened:
  <https://github.com/thinkwork-ai/thinkwork/pull/2997>. Post-rebase focused
  test `pnpm --filter @thinkwork/api test -- handleJsonRenderAction` passed.
- 2026-06-26 U1/U2 CI passed after rebase: CLA, lint, verify, typecheck, and
  test.
- 2026-06-26 U1/U2 merged via squash commit
  `43a994717e624667d714ea10fb4cd6df532a63cd`; remote branch was already
  removed by GitHub and local worktree/branch cleanup completed.

## U3 Objective

Update generated UI fixtures, runtime tool description, and system prompt
guidance so actionable Work Item approval UI includes both component action
references and matching `durableActions` descriptors. Keep shared
json-render validation target-agnostic and preserve display-only generated UI.

## U3 Verification

- 2026-06-26 focused tests passed:
  `pnpm --filter @thinkwork/thread-json-render test -- actions validation`
  (14 tests).
- 2026-06-26 focused tests passed:
  `pnpm --filter @thinkwork/pi-runtime-core test -- json-render-runtime`
  (8 tests).
- 2026-06-26 focused tests passed:
  `pnpm --filter @thinkwork/pi-extensions test -- system-prompt` (13 tests).
- 2026-06-26 focused tests passed:
  `pnpm --filter @thinkwork/web test -- json-render/validation` (7 tests).
- 2026-06-26 typechecks passed for `@thinkwork/thread-json-render`,
  `@thinkwork/pi-runtime-core`, `@thinkwork/pi-extensions`, and
  `@thinkwork/web`.
- 2026-06-26 install note: `pnpm install` completed, with the same optional
  `canvas` native build warning seen in U1/U2 (`pkg-config` unavailable under
  local Node 25); focused tests and typechecks were unaffected.
- 2026-06-26 U3 PR opened:
  <https://github.com/thinkwork-ai/thinkwork/pull/2998>.
- 2026-06-26 U3 CI test failed because two web tests still expected the old
  fixture params `{ taskId: "task-123" }`; updated
  `json-render/actions.test.ts` and `ThreadJsonRenderRenderer.test.tsx` to
  assert the new Work Item status action params.
- 2026-06-26 U3 CI repair verification passed:
  `pnpm --filter @thinkwork/web test -- json-render/actions json-render/ThreadJsonRenderRenderer`
  (9 tests) and `pnpm --filter @thinkwork/web typecheck`.
- 2026-06-26 formatting attempt:
  `pnpm exec prettier --write ...` failed because `prettier` is not installed
  in this workspace (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prettier" not
  found`). Root `package.json` references Prettier scripts, but
  `pnpm list prettier --depth 4` returned no installed package.

## Blockers

- None currently.
