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
| U3 | `codex/thnk-81-json-render-actions-u3` | [#2998](https://github.com/thinkwork-ai/thinkwork/pull/2998) | Merged |
| U4 | `codex/thnk-81-json-render-actions-u4` | [#2999](https://github.com/thinkwork-ai/thinkwork/pull/2999) | Merged |
| U5 | `codex/thnk-81-u5-hitl-model` | [#3000](https://github.com/thinkwork-ai/thinkwork/pull/3000) | Merged |
| Final evidence | `codex/thnk-81-final-evidence` | Pending | In progress |

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
- 2026-06-26 U3 CI passed after repair: CLA, lint, verify, typecheck, and
  test.
- 2026-06-26 U3 merged via squash commit
  `3bb3417d6a31b84ab9b289f9896114eb12883312`; remote branch was already
  removed by GitHub and local worktree/branch cleanup completed.

## U4 Objective

Refresh Work Item-backed web state after a successful generated UI action
returns an audit message whose metadata confirms
`jsonRenderAction.mutation.target === "work_item_status"`. Keep the refresh
scoped to thread and Work Item data because the backend action uses
`agentRequested: false`.

## U4 Verification

- 2026-06-26 install note: fresh U4 worktree needed `pnpm install`; install
  completed with the same optional `canvas` native build warning (`pkg-config`
  unavailable under local Node 25). Focused tests and typecheck were unaffected.
- 2026-06-26 focused tests passed:
  `pnpm --filter @thinkwork/web test -- json-render/ThreadJsonRenderRenderer SpacesThreadDetailRoute render-typed-part`
  (61 tests).
- 2026-06-26 typecheck passed: `pnpm --filter @thinkwork/web typecheck`.
- 2026-06-26 U4 CI passed: CLA, lint, verify, typecheck, and test.
- 2026-06-26 U4 merged via squash commit
  `122c297545afb9b3db23d4c7be754bdbcada9913`; remote branch was already
  removed by GitHub and local worktree/branch cleanup completed.

## U5 Objective

Collect deployed evidence for both supported approval paths. During the HITL
path, preserve the selected model across `question_answer` resume wakeups so an
answered `ask_user_question` card resumes the same approved model instead of
falling back to the agent default.

## U5 Evidence and Verification

- 2026-06-26 dev thread created for evidence:
  `63dd4024-7d2c-43da-bd94-3b18034496af` (`TICK-1173`) in the `general` space.
- 2026-06-26 HITL path partially verified before the U5 fix:
  `ask_user_question` parked the thread in `AWAITING_USER`; question
  `e952a54d-fd6a-46e5-b463-af5c10b7fdde` was answered via CARD at
  `2026-06-26T23:06:56.108Z`.
- 2026-06-26 HITL resume blocker found: the resumed turn
  `3b555e86-ca76-4e29-9362-d3948e56207a` failed because the
  `question_answer` wakeup fell back to unsupported tenant default
  `anthropic.claude-fable-5` instead of preserving the selected
  `openai.gpt-oss-120b-1:0` model from the asking user message.
- 2026-06-26 generated UI approve path verified against the deployed GraphQL
  mutation using a persisted json-render source message:
  Work Item `11cafc99-09af-4a71-961b-79b56e0de9b3` moved TODO to DONE, audit
  message `8ac5447f-fb25-4455-8c09-4f440cfd5c49`, Work Item event
  `80444932-ebbf-4c8d-9b84-9d2cf6f9de50`.
- 2026-06-26 generated UI reject path verified against the deployed GraphQL
  mutation using a persisted json-render source message:
  Work Item `4e9d108f-26e3-46ef-8506-d8f23b95a6ed` moved TODO to SKIPPED,
  audit message `e65ac91a-cbeb-4de9-8618-2119feb8150f`, Work Item event
  `fd7c4b86-0565-4652-bcb0-1ccb422a2370`.
- 2026-06-26 U5 local fix verification passed:
  `pnpm --filter @thinkwork/api test -- answerUserQuestion wakeup-processor.dispatch-parity`
  (38 tests).
- 2026-06-26 U5 typecheck passed: `pnpm --filter @thinkwork/api typecheck`.
- 2026-06-26 U5 whitespace check passed: `git diff --check`.
- 2026-06-26 U5 lint note:
  `pnpm --filter @thinkwork/api lint` reported no lint script for the selected
  package.
- 2026-06-26 U5 PR opened:
  <https://github.com/thinkwork-ai/thinkwork/pull/3000>.
- 2026-06-26 U5 CI passed: CLA, lint, verify, typecheck, and test.
- 2026-06-26 U5 merged via squash commit
  `8b1d4d90dfdc628d47ef96e714b7c060ba7f77b7`; remote branch was removed by
  GitHub and local worktree/branch cleanup completed.
- 2026-06-26 dev deploy evidence:
  main deploy run `28270987842` built Lambdas and completed Terraform Apply for
  commit `8b1d4d90dfdc628d47ef96e714b7c060ba7f77b7`.
- 2026-06-26 deployed HITL path verified:
  thread `1674ea76-913d-4e87-85d6-2ca45c5573f2` (`CHAT-1174`) used selected
  model `openai.gpt-oss-120b-1:0`, parked on question
  `3db4e115-2fee-45a8-a844-0ee31cb0d2df`, accepted the card answer at
  `2026-06-26T23:39:37.516Z`, resumed, and completed at
  `2026-06-26T23:39:51.978Z`.
- 2026-06-26 deployed HITL Work Item result:
  Work Item `f17d4261-6f84-4eeb-a001-e0b6c5b3c378` moved TODO to DONE at
  `2026-06-26T23:39:50.230Z`; event
  `5bbe7cf9-873d-4dfe-a2b3-bf48501338bb` was created by
  `set_work_item_status` with `threadTurnId`
  `03a18cf0-aeba-4ec1-812c-dd2a5048c03d` and tool call
  `tooluse_xPiClN6YNk8lacPBJDEpOG`.

## Blockers

- None currently.
