---
date: 2026-06-26
linear_issue: THNK-78
status: e2e-closeout-verified
target_branch: main
---

# THNK-78 Autopilot Status

## Issue

- Linear: THNK-78, "Emit complete json-render UI parts from Thread agents"
- URL: https://linear.app/thinkworkai/issue/THNK-78/emit-complete-json-render-ui-parts-from-thread-agents
- Parent status at discovery: Plan Review
- Child issues at discovery: none
- Primary plan: `docs/plans/2026-06-26-002-feat-thread-json-render-ui-emission-plan.md`
- Linear documents:
  - `Plan: Thread json-render UI runtime emission`
  - `Brainstorm: thread-json-render-ui runtime emission`

## Context Read

- `AGENTS.md`
- Autopilot attachment:
  `/Users/ericodom/.codex/attachments/fe12ce23-b216-4951-92d4-0c2698ab19e0/pasted-text.txt`
- Linear issue THNK-78, comments, labels, project, assignee, status history,
  related/blocking issue context, and attached Linear documents.
- Linear comments, including the correction that the repo-local plan is source
  of truth for U6 workspace-defaults paths.
- Repo-local plan copied into this branch from
  `/Users/ericodom/.codex/worktrees/e22b/thinkwork/docs/plans/2026-06-26-002-feat-thread-json-render-ui-emission-plan.md`.
- Related THNK-77 completion status and merged post-cutover code on
  `origin/main`.
- json-render docs:
  - `https://json-render.dev/docs/specs`
  - `https://json-render.dev/docs/catalog`
  - `https://json-render.dev/docs/api/core`
  - `https://json-render.dev/docs/generation-modes`
  - `https://json-render.dev/docs/skills`
- Relevant repo docs:
  - `docs/specs/thread-json-render-contract-v1.md`
  - `docs/specs/computer-ai-elements-contract-v1.md`
  - `docs/specs/analytics-display-contract-v1.md`
  - `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`
  - `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md`
  - `docs/solutions/architecture-patterns/wakeup-processor-payload-parity-with-chat-agent-invoke-2026-06-12.md`
  - `docs/solutions/architecture-patterns/runtime-swap-tool-parity-and-record-contract.md`
  - `docs/solutions/architecture-patterns/mobile-pi-compatible-host-contract-2026-05-30.md`

## Implementation Units

1. U1 contract + validator
   - Create the shared React-free `@thinkwork/thread-json-render` package and
     move canonical typed part validation/hash helpers there.
2. U2+U3 runtime emission + API finalize boundary
   - Add the injected `thread-json-render-ui` / `emit_json_render_ui`
     capability and revalidate final parts before persistence.
3. U4+U5 client consumption
   - Reuse the shared validator in web/mobile and keep legacy/fenced payloads
     untrusted.
4. U6 prompt assembly
   - Add catalog-aware runtime guidance only when the tool is registered and
     keep upstream json-render skills out of runtime defaults.
5. U7 action governance
   - Route json-render actions through ThinkWork-owned, schema-validated
     workflow boundaries.
6. U8 docs, fixtures, regression coverage
   - Finalize fixtures/docs and complete the Linear/status closeout.
7. End-to-end UI verification
   - Before closing THNK-78, run the web Thread UI against emitted
     `data-json-render` parts that exercise several upstream shadcn primitive
     components and ThinkWork domain catalog components.

## Progress Log

### 2026-06-26

- Context discovery completed through Linear issue, comments, Linear documents,
  repo-local plan, THNK-77 completion evidence, json-render docs, and relevant
  repo solution docs.
- Confirmed THNK-77 is merged to `origin/main` and removed the stale THNK-77
  Linear blocker from THNK-78.
- Linear state change: moved THNK-78 from Plan Review to In Progress when U1
  implementation started.
- U1 worktree created from `origin/main` at
  `057c88bebfe9c702f2ab9cf29d04f2816a74bc2b`.
- Goal expanded to require full end-to-end UI verification after landing:
  primitives plus custom components from the two-layer catalog must be exercised
  in the Thread UI before Linear is closed.
- U1 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2980
  at `57c92c75b2ed1666131f00ab8a66f5df3dfd22f2`.
- U1 branch and worktree were cleaned up after merge.
- U2+U3 worktree created from updated `origin/main` at
  `57c92c75b2ed1666131f00ab8a66f5df3dfd22f2`.
- U2+U3 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2981
  at `7aa42ded6ed2da25d11f392ed64c5d4ddbff4fb3`.
- U2+U3 branch and worktree were cleaned up after merge.
- U4+U5 worktree created from updated `origin/main` at
  `7aa42ded6ed2da25d11f392ed64c5d4ddbff4fb3`.
- U4+U5 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2982
  at `81e31aeb460e9bee395c7d33907a19d4bf5b7624`.
- U4+U5 branch and worktree were cleaned up after merge.
- U6 worktree created from updated `origin/main` at
  `81e31aeb460e9bee395c7d33907a19d4bf5b7624`.
- U6 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2983
  at `9de726ac663adbcd35551bc27c7748ff0cccac59`.
- U6 branch and worktree were cleaned up after merge.
- U7 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2984
  at `b84da5705ab63424e97f21aa25bc757d8bf905f4`.
- U7 branch and worktree were cleaned up after merge.
- U8 worktree created from updated `origin/main` at
  `b84da5705ab63424e97f21aa25bc757d8bf905f4`.
- U8 PR merged to `main`: https://github.com/thinkwork-ai/thinkwork/pull/2985
  at `3f9ef6e262a4dafd27ae7fe608939d1bd635c9ae`.
- U8 branch and worktree were cleaned up after merge.
- E2E closeout worktree created from updated `origin/main` at
  `3f9ef6e262a4dafd27ae7fe608939d1bd635c9ae`.
- Browser E2E verification completed against a temporary local Vite harness
  that mounted the production `ThreadJsonRenderRenderer` with primitive and
  ThinkWork domain catalog fixtures.
- Live localhost Thread E2E attempted at `http://localhost:5174` using the
  authenticated in-app browser session. The Thread UI loaded and accepted the
  prompt, but the backing agent reported that `emit_json_render_ui` was not
  registered in its available tool list, so no live `data-json-render` part was
  emitted.
- Enabled the `thread-json-render-ui` capability for the active ThinkWork dev
  agent through the deployed REST capability API. A retry still showed the tool
  missing because deployed runtime artifacts were stale.
- Deployed updated dev runtime artifacts needed for live THNK-78 verification:
  - `thinkwork-dev-api-chat-agent-invoke` updated at
    `2026-06-26T16:20:43Z`.
  - `thinkwork-dev-agentcore-pi` updated to ECR tag
    `thnk-78-json-render-lambda-20260626162731` at
    `2026-06-26T16:29:24Z`.
  - `thinkwork-dev-agentcore-pi` updated again to ECR tag
    `thnk-78-json-render-normalize-20260626163827` at
    `2026-06-26T16:41:23Z` after the runtime normalizer fix.
  - `thinkwork-dev-api-chat-agent-finalize` updated at
    `2026-06-26T16:44:23Z` so final `ui_message_parts` persist into
    `messages.parts`.
- Fixed two deployability gaps found during live verification:
  - `scripts/build-lambdas.sh` now builds `@thinkwork/thread-json-render`
    before API Lambdas that import it.
  - `packages/agentcore-pi/agent-container/Dockerfile` now includes and builds
    the `@thinkwork/analytics-display` and `@thinkwork/genui` workspace
    packages required by `@thinkwork/pi-extensions`.
- Fixed a runtime generation gap found during live verification:
  `emit_json_render_ui` now canonicalizes missing required-nullable upstream
  shadcn props to `null` before validation. This preserves the upstream catalog
  while allowing model-generated specs that omit nullable keys such as
  `Card.maxWidth`, `Card.className`, `Stack.align`, `Stack.justify`,
  `Stack.className`, and `Button.disabled`.
- Live deployed Thread smoke passed after all runtime artifacts were current:
  assistant message `25ad91c9-4d73-4918-85eb-6eac7904ce65` persisted a
  `data-json-render` part `json-render:83af9e43` containing primitive
  components `Card`, `Stack`, `Heading`, `Text`, and `Button`.
- Live deployed full catalog smoke passed:
  assistant message `2e25322f-d548-4b97-aa35-fc55c8a70a6a` persisted
  `data-json-render` part `json-render:0afb9d96` with spec hash
  `json-render-fnv1a:0afb9d96`, containing primitive components `Card`,
  `Stack`, `Heading`, `Text`, `Button` and ThinkWork domain components
  `task.review`, `workflow.status`, `keyValue.list`, `form.action`, and
  `analytics.display`.
- Browser UI verification against `http://localhost:5174/threads/833b1da6-fa47-462d-9c85-c19b0ffeee21`
  passed with a seeded dev Cognito session. DOM evidence:
  `jsonRenderParts=3`, `genui-task-review=2`, `genui-workflow-status=2`,
  `genui-action-form=2`, `json-render-analytics-display=2`,
  `json-render-fallback=0`, `json-render-legacy-fallback=0`. The rendered text
  included `THNK-78 Full Catalog`, `Thread json-render full catalog`,
  `Primitive button verified`, `Verification facts`,
  `thread-json-render-ui`, `Support volume`, `Approval note`,
  `Catalog verification workflow`, and `Review onboarding task`.

## Unit Log

### U1 contract + validator

- Objective: finalize the post-THNK-77 shared `data-json-render` contract in a
  React-free package usable by runtime, API, web, and mobile.
- Branch: `codex/thnk-78-u1-contract`
- Worktree: `/Users/ericodom/.codex/worktrees/thnk-78-u1-contract`
- Base: `origin/main` at `057c88bebfe9c702f2ab9cf29d04f2816a74bc2b`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2980
- Added shared package files, fixtures, and contract tests.
- Verification:
  - `pnpm --filter @thinkwork/thread-json-render test` passed.
  - `pnpm --filter @thinkwork/thread-json-render typecheck` passed.
  - `pnpm --filter @thinkwork/thread-json-render build` passed.
  - `git diff --check` passed.
  - Full `pnpm install` completed but existing optional `canvas` native install
    attempted a Node 25 source build and reported missing `pkg-config`; package
    linking was refreshed with `pnpm install --ignore-scripts`.
- Status: merged.

### U2+U3 runtime emission + API finalize boundary

- Objective: add the platform-owned `emit_json_render_ui` runtime tool behind
  the `thread-json-render-ui` capability, then persist only final validated
  `data-json-render` parts at the API boundary.
- Branch: `codex/thnk-78-u2-u3-runtime-api`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-78-u2-u3-runtime-api`
- Base: `origin/main` at `57c92c75b2ed1666131f00ab8a66f5df3dfd22f2`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2981
- Replaced the Pi runtime's legacy GenUI extraction with an explicit
  `emit_json_render_ui` tool that validates complete upstream json-render specs,
  computes host-owned ids/spec hashes, emits typed live UI chunks, and appends
  only trusted parts to final runtime output.
- Added API capability gating for chat and wakeup dispatch so the Pi container
  only registers the tool when the agent capability is enabled and not blocked.
- Moved finalization/persistence to the shared `@thinkwork/thread-json-render`
  validator and stopped lifting UI parts from arbitrary legacy tool metadata.
- Updated Pi container Docker build context and tests to use
  `@thinkwork/thread-json-render` instead of `@thinkwork/genui`.
- Verification:
  - `pnpm --filter @thinkwork/thread-json-render test` passed.
  - `pnpm --filter @thinkwork/thread-json-render typecheck` passed.
  - `pnpm --filter @thinkwork/pi-runtime-core test -- json-render-runtime agent-loop finalize-client activity-client json-render-contract` passed.
  - `pnpm --filter @thinkwork/pi-runtime-core typecheck` passed.
  - `pnpm --filter @thinkwork/agentcore-pi test -- server json-render-contract` passed.
  - `pnpm --filter @thinkwork/agentcore-pi typecheck` passed.
  - `pnpm --filter @thinkwork/api test -- json-render-contract process-finalize chat-agent-activity chat-agent-invoke.runtime-routing resolve-agent-runtime-config` passed.
  - `pnpm --filter @thinkwork/api test -- wakeup-processor.dispatch-parity wakeup-processor` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `git diff --check` passed.
  - GitHub PR checks passed: CLA Assistant, Lint, Verify, Typecheck, and Test.
- Status: merged.

### U4+U5 client consumption

- Objective: route web and mobile client parsing through the shared
  `@thinkwork/thread-json-render` contract so emitted UI parts use the same
  validator on every boundary, while keeping non-`data-json-render` payloads
  untrusted.
- Branch: `codex/thnk-78-u4-u5-clients`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-78-u4-u5-clients`
- Base: `origin/main` at `7aa42ded6ed2da25d11f392ed64c5d4ddbff4fb3`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2982
- Replaced the web client duplicate validator with a thin re-export of the
  shared package.
- Updated mobile fallback parsing to validate typed parts with the shared
  package, expose the canonical `parseThreadJsonRenderFallbacks` helper, and
  keep the old helper name as a compatibility alias for existing callers.
- Added web and mobile workspace dependencies on
  `@thinkwork/thread-json-render`.
- Verification:
  - `pnpm --filter @thinkwork/web test -- validation ThreadJsonRenderRenderer render-typed-part ThreadConversation` passed.
  - `pnpm --filter @thinkwork/mobile test -- genui-registry genui-contract` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/mobile typecheck` is not available in the mobile
    package.
  - Direct `pnpm --filter @thinkwork/mobile exec tsc --noEmit` still reports
    pre-existing app-wide errors; a touched-file filtered compiler scan showed
    no THNK-78 client errors.
  - `git diff --check` passed.
  - GitHub PR checks passed: CLA Assistant, Lint, Verify, Typecheck, and Test.
- Status: merged.

### U6 prompt assembly

- Objective: give runtime models catalog-aware guidance for
  `emit_json_render_ui` only when that tool is registered for the turn, while
  keeping upstream json-render developer skills out of workspace defaults.
- Branch: `codex/thnk-78-u6-prompt`
- Worktree: `/Users/ericodom/.codex/worktrees/thnk-78-u6-prompt`
- Base: `origin/main` at `81e31aeb460e9bee395c7d33907a19d4bf5b7624`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2983
- Added a dynamic `Generated Thread UI` runtime prompt block that appears only
  when `emit_json_render_ui` is in the available tool list.
- The prompt block uses shared `@thinkwork/thread-json-render` catalog
  vocabulary for ThinkWork domain components and upstream shadcn primitives.
- Updated default `AGENTS.md` with a static guardrail that upstream json-render
  developer skills are not runtime workspace skills, and bumped
  `DEFAULTS_VERSION` to 27.
- Added tests proving the prompt block is gated by tool availability and
  workspace defaults do not materialize upstream json-render runtime skills.
- Verification:
  - `pnpm --filter @thinkwork/pi-extensions test -- system-prompt` passed.
  - `pnpm --filter @thinkwork/workspace-defaults test` passed.
  - `pnpm --filter @thinkwork/pi-extensions typecheck` passed.
  - `pnpm --filter @thinkwork/workspace-defaults typecheck` passed.
  - `pnpm --filter @thinkwork/agentcore-pi test -- system-prompt` passed.
  - `git diff --check` passed.
  - GitHub PR checks passed: CLA Assistant, Lint, Verify, Typecheck, and Test.
- Status: merged.

### U7 action governance

- Objective: route json-render durable actions through a ThinkWork-owned,
  schema-validated mutation instead of the legacy GenUI action name.
- Branch: `codex/thnk-78-u7-actions`
- Worktree: `/Users/ericodom/.codex/worktrees/thnk-78-u7-actions`
- Base: `origin/main` at `9de726ac663adbcd35551bc27c7748ff0cccac59`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2984
- Added shared `@thinkwork/thread-json-render` action helpers for source
  readiness, idempotency keys, and primitive param normalization.
- Renamed the GraphQL action mutation from `handleGenUIAction` /
  `HandleGenUIActionInput` to `handleJsonRenderAction` /
  `HandleJsonRenderActionInput`.
- Reused the existing API validation boundary for tenant/thread visibility,
  source message/part ownership, persisted spec hash, action id, params,
  duplicate idempotency, and per-user rate limiting.
- Updated the web action hook to call `HandleJsonRenderActionMutation`.
- Regenerated GraphQL client types for web, mobile, and CLI, trimming
  generator formatting churn to the actual schema rename.
- Verification:
  - `pnpm schema:build` passed; the AppSync subscription schema had no content
    change for this mutation rename.
  - `pnpm --filter @thinkwork/web codegen` passed.
  - `pnpm --filter @thinkwork/mobile codegen` passed.
  - `pnpm --filter thinkwork-cli codegen` passed.
  - `pnpm --filter @thinkwork/thread-json-render test -- actions validation` passed.
  - `pnpm --filter @thinkwork/api test -- handleJsonRenderAction` passed.
  - `pnpm --filter @thinkwork/api test -- graphql-contract` passed.
  - `pnpm --filter @thinkwork/web test -- ThreadJsonRenderRenderer actions` passed.
  - `pnpm --filter @thinkwork/thread-json-render typecheck` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `git diff --check` passed.
- Status: merged.

### U8 docs, fixtures, and evaluation coverage

- Objective: make the runtime contract easy to review and prevent regressions
  back to markdown parsing or legacy payload trust.
- Branch: `codex/thnk-78-u8-fixtures`
- Worktree: `/Users/ericodom/.codex/worktrees/thnk-78-u8-fixtures`
- Base: `origin/main` at `b84da5705ab63424e97f21aa25bc757d8bf905f4`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2985
- Added checked-in valid and invalid Thread json-render fixtures under
  `docs/fixtures/thread-json-render/`.
- Updated web, mobile, and contract docs to point at the fixtures and clarify
  that markdown fences and legacy `{ component, props }` payloads are never
  trusted UI.
- Added runtime, web Thread, and mobile fallback regression tests that consume
  the checked-in fixtures.
- Verification:
  - `pnpm --filter @thinkwork/pi-runtime-core test -- json-render-runtime`
    passed.
  - `pnpm --filter @thinkwork/web test -- ThreadConversation` passed.
  - `pnpm --filter @thinkwork/mobile test -- genui-registry` passed.
  - `pnpm --filter @thinkwork/thread-json-render test` passed.
  - `pnpm --filter @thinkwork/pi-runtime-core typecheck` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/thread-json-render typecheck` passed.
  - `git diff --check` passed.
  - `pnpm dlx prettier@3.6.2 --check <changed U8 files>` passed; root
    `pnpm format:check` is currently unavailable because `prettier` is not
    declared in the workspace dev dependencies.
- GitHub PR checks passed: CLA Assistant, Lint, Verify, Typecheck, and Test.
- Status: merged.

### End-to-end UI verification

- Objective: verify the web Thread UI renders `data-json-render` parts for
  several upstream shadcn primitives and all current ThinkWork domain catalog
  components before closing THNK-78.
- Branch: `codex/thnk-78-e2e-closeout`
- Worktree: `/Users/ericodom/.codex/worktrees/thnk-78-e2e-closeout`
- Base: `origin/main` at `3f9ef6e262a4dafd27ae7fe608939d1bd635c9ae`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2986
- Verification setup:
  - Copied `apps/web/.env` from the main checkout per worktree guidance.
  - Linked dependencies with `pnpm install --ignore-scripts`.
  - Started `pnpm --filter @thinkwork/web dev`; Vite served the temporary
    browser harness at `http://localhost:5174/index-json-render-e2e.html`.
  - The temporary harness was removed after browser verification and is not part
    of the closeout branch.
- Browser matrix:
  - Primitive shadcn composition: `Card`, `Stack`, `Heading`, `Text`, and
    `Button` rendered visible `Pipeline health`, `All checks are ready.`, and
    `Approve`.
  - `task.review` rendered one `genui-task-review` card with task review copy.
  - `workflow.status` rendered one `genui-workflow-status` card with
    `Onboarding workflow`, `Contract packet`, and `Kickoff scheduling`.
  - `keyValue.list` rendered one `genui-key-value-list` card with key facts.
  - `form.action` rendered one `genui-action-form` card with `Request approval`,
    `Approval note`, `Priority`, and disabled `Submit approval`.
  - `analytics.display` rendered one `json-render-analytics-display` adapter
    with `Support volume` and the ThinkWork analytics adapter copy.
- Browser assertions:
  - Desktop/default viewport: all six catalog cases rendered, `json-render-fallback`
    count was `0`, `json-render-legacy-fallback` count was `0`, and browser
    console error count was `0`.
  - Mobile-width viewport `390x900`: all six catalog cases rendered, no
    horizontal overflow (`scrollWidth === clientWidth === 390`), fallback count
    was `0`, and browser console error count was `0`.
  - Desktop and mobile-width screenshots were captured in the Codex thread.
- Additional web smoke:
  - `pnpm --filter @thinkwork/web verify:json-render-smoke` passed.
  - Smoke bundle evidence: baseline `194039` raw / `60591` gzip; renderer
    `604649` raw / `181943` gzip; delta `410610` raw / `121352` gzip.
- Live localhost Thread attempt:
  - URL: `http://localhost:5174/threads/833b1da6-fa47-462d-9c85-c19b0ffeee21`
  - First prompt requested a compact generated UI covering primitive and
    ThinkWork catalog components; the turn failed after 25 seconds with the
    generic assistant error.
  - Retry requested a minimal `Card` / `Heading` / `Text` / `Button`
    `emit_json_render_ui` call; the assistant completed as text and reported
    that `emit_json_render_ui` was not registered in the current environment.
  - DOM marker counts in the live Thread were all `0` for `data-json-render`,
    `genui-task-review`, `genui-workflow-status`, `genui-key-value-list`,
    `genui-action-form`, `json-render-analytics-display`, and
    `json-render-fallback`.
  - Browser console only showed a stale Vite HMR reload error for the removed
    temporary harness file; no live Thread renderer exception was observed.
  - Result: live agent-tool E2E is blocked until the dev/default backing agent
    has the `thread-json-render-ui` capability enabled or the test targets an
    agent that already has that capability.
- Status: renderer verification passed; live agent-tool verification blocked by
  current backing-agent capability configuration.
