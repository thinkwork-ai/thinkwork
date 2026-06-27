---
date: 2026-06-26
linear_issue: THNK-82
status: u4-verified
target_branch: main
---

# THNK-82 Autopilot Status

## Issue

- Linear: THNK-82, "Prefer json-render UI for structured Thread result sets"
- URL: https://linear.app/thinkworkai/issue/THNK-82/prefer-json-render-ui-for-structured-thread-result-sets
- Parent status at discovery: Plan Review
- Child issues at discovery: none
- Primary plan:
  `docs/plans/2026-06-26-004-feat-structured-result-json-render-plan.md`
- Linear document:
  [Plan: Structured result json-render presentation](https://linear.app/thinkworkai/document/plan-structured-result-json-render-presentation-5497f69b708c)

## Context Read

- `AGENTS.md`
- Autopilot attachment:
  `/Users/ericodom/.codex/attachments/d0fa5a1c-6af3-4069-8e69-af69b1ff06e7/pasted-text.txt`
- Linear issue THNK-82 with description, labels, project, assignee, status
  history, comments, attached Linear document, and related issue context.
- THNK-82 repo-local requirements:
  `docs/brainstorms/2026-06-26-thnk-82-structured-result-json-render-requirements.md`
- THNK-82 repo-local plan:
  `docs/plans/2026-06-26-004-feat-structured-result-json-render-plan.md`
- Related Linear issues:
  - THNK-77: json-render/shadcn foundation
  - THNK-78: `emit_json_render_ui` runtime emission
  - THNK-81: durable json-render Work Item status actions
- Related Linear documents for THNK-81:
  - `Plan: Route json-render actions to Work Item status updates`
  - `Brainstorm Summary: json-render Work Item status actions`
- Repo-local references:
  - `docs/plans/2026-06-26-001-refactor-json-render-shadcn-cutover-plan.md`
  - `docs/plans/2026-06-26-002-feat-thread-json-render-ui-emission-plan.md`
  - `docs/plans/autopilot/THNK-78-status.md`
- Relevant solution docs:
  - `docs/solutions/architecture-patterns/analytics-display-portable-contract-cross-surface-2026-06-20.md`
  - `docs/solutions/architecture-patterns/wakeup-processor-payload-parity-with-chat-agent-invoke-2026-06-12.md`
  - `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`
  - `docs/solutions/design-patterns/replay-recorded-agent-conversations-write-safe.md`
  - `docs/solutions/architecture-patterns/mobile-pi-compatible-host-contract-2026-05-30.md`
  - `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`

## Dependency Notes

- THNK-78 is completed in Linear and merged into main.
- THNK-81 generated UI action implementation PRs through U5 are merged into
  main, including Work Item status action handling and deployed action/HITL
  evidence.
- THNK-81 final evidence PR #3001 is open and doc-only
  (`docs/plans/autopilot/THNK-81-status.md`). It is not a code blocker for
  THNK-82, but its status should be considered during final evidence closeout.
- Current orchestration checkout is detached and behind `origin/main`; unit
  work must happen in isolated worktrees from fresh `origin/main`.

## Implementation Units

1. U1 result-list catalog contract
   - Add bounded shared `result.list` contract, fixtures, strict nested
     validation, action-reference cross-checks, and shared/web catalog parity.
2. U2 web result-list renderer
   - Add host-owned `ResultListView` / adapter for Work Item, question,
     review, generic-summary rows, including action and accessibility states.
3. U3 runtime presentation guidance
   - Update dynamic generated Thread UI prompt/tool guidance and runtime tests
     for structured-result selection, prose fallback, redaction, and
     `ask_user_question` separation.
4. U4 workspace-default guidance
   - Align static workspace defaults with turn-scoped runtime policy, mirror
     inline constants, and bump defaults version if seeded content changes.
5. U5 cross-layer regression and evidence
   - Add mobile fallback, API/finalize/action safety tests, and behavior-level
     evidence for Work Item result UI vs prose fallback.

## Progress Log

### 2026-06-26

- Context discovery completed through Linear issue, comments, attached Linear
  plan document, related THNK-77/78/81 issues, THNK-81 documents/comments, and
  repo-local planning/solution docs.
- Child issues checked: none.
- Linear state changes so far: none during discovery.
- Implementation order selected from the THNK-82 plan's U1-U5 dependency
  sequence.
- Linear issue moved to In Progress before implementation.
- U1 worktree created at
  `/Users/ericodom/.codex/worktrees/thnk-82-u1-result-list-contract` on branch
  `codex/thnk-82-u1-result-list-contract` from `origin/main`
  (`8b1d4d90d`).
- U1 implemented and locally verified. The web renderer map needed a minimal
  `result.list` renderer entry after the catalog addition so TypeScript can
  prove the catalog has a renderer for every typed domain component; fuller
  result-list UI polish remains assigned to U2.
- U1 PR #3002 merged after green rebase CI. Merge commit:
  `0198d01316f65238b37210eaf749eccccd5a0a95`.
- U1 local worktree and branch cleaned up after merge.
- U2 worktree created at
  `/Users/ericodom/.codex/worktrees/thnk-82-u2-result-list-renderer` on branch
  `codex/thnk-82-u2-result-list-renderer` from `origin/main`
  (`0198d0131`).
- U2 implemented and locally verified.
- U2 PR #3004 merged after green CI. Merge commit:
  `e0046c2847c68111c43118576b64b8d98fde5db9`.
- U2 local worktree and branch cleaned up after merge.
- U3 worktree created at
  `/Users/ericodom/.codex/worktrees/thnk-82-u3-runtime-result-guidance` on
  branch `codex/thnk-82-u3-runtime-result-guidance` from `origin/main`
  (`e0046c284`).
- U3 implemented and locally verified.
- U3 PR #3005 merged after green CI. Merge commit:
  `36b9526a62ddc4285ac425dbab3481b9eb8ff214`.
- U3 local worktree and branch cleaned up after merge.
- U4 worktree created at
  `/Users/ericodom/.codex/worktrees/thnk-82-u4-workspace-default-guidance` on
  branch `codex/thnk-82-u4-workspace-default-guidance` from `origin/main`
  (`36b9526a6`).
- U4 implemented and locally verified.

## Unit Log

### U1 result-list catalog contract

- Objective: add the shared React-free `result.list` catalog contract and
  validation fixtures needed by all later THNK-82 units.
- Status: merged.
- Branch: `codex/thnk-82-u1-result-list-contract`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-82-u1-result-list-contract`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3002
- Merge commit: `0198d01316f65238b37210eaf749eccccd5a0a95`
- Changes:
  - Added a strict, bounded shared `result.list` catalog component for
    `workItem`, `question`, `review`, and `genericSummary` rows.
  - Mirrored the catalog shape in the web json-render domain catalog.
  - Added canonical shared/web fixtures for result lists with Work Item and
    user-question durable actions.
  - Extended validation to recurse through array-contained props and reject
    generated callback/import/secret/token/route-like prop keys.
  - Added result-list action-reference validation for missing, disabled, and
    duplicated durable action IDs.
  - Added a minimal typed web `result.list` renderer entry required by the
    catalog/component registry contract.
- Verification:
  - `pnpm --filter @thinkwork/thread-json-render test -- validation.test.ts`
  - `pnpm --filter @thinkwork/web test -- src/components/workbench/json-render/catalog.test.ts src/components/workbench/json-render/validation.test.ts`
  - `pnpm --filter @thinkwork/thread-json-render typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
- Notes:
  - Fresh worktree setup required `pnpm install`. The install completed, while
    optional `canvas@2.11.2` native build output reported a missing
    `pkg-config` fallback on Node 25. This did not block the focused U1 tests or
    typechecks.

### U2 web result-list renderer

- Objective: replace the minimal typed `result.list` registry entry with a
  host-owned result-list renderer for Work Item rows, user-question rows,
  review rows, generic summaries, and item-scoped durable action states.
- Status: merged.
- Branch: `codex/thnk-82-u2-result-list-renderer`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-82-u2-result-list-renderer`
- Base: `origin/main` at `0198d0131`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3004
- Merge commit: `e0046c2847c68111c43118576b64b8d98fde5db9`
- Changes:
  - Added `ResultListView` under the existing generated-UI component family.
  - Rendered grouped result-list sections, row variant badges/icons, statuses,
    metadata, variant-specific details, evidence snippets, and empty states.
  - Routed item-level primary/secondary action IDs through `DecisionPanel` so
    action icons, submitted/submitting/error states, disabled/read-only state,
    and host mutation wiring stay consistent with existing generated UI
    actions.
  - Simplified `ThreadJsonRenderRenderer` to register the host-owned
    `ResultListView` adapter for `result.list`.
  - Added renderer tests for result-list row rendering, live/read-only disabled
    state, and durable action submission.
- Verification:
  - `pnpm --filter @thinkwork/web test -- src/components/workbench/json-render/ThreadJsonRenderRenderer.test.tsx src/components/workbench/json-render/validation.test.ts src/components/workbench/json-render/catalog.test.ts`
  - `pnpm --filter @thinkwork/web typecheck`
- Notes:
  - Fresh worktree setup required `pnpm install`. The install completed with
    the same optional `canvas@2.11.2` native build output about missing
    `pkg-config` on Node 25. This did not block focused U2 tests or typecheck.

### U3 runtime presentation guidance

- Objective: update dynamic generated Thread UI guidance and runtime tool
  descriptions so agents prefer `result.list` for structured result sets,
  preserve prose fallback, keep sensitive/raw connector data out of generated
  UI, and avoid replacing blocking `ask_user_question`.
- Status: merged.
- Branch: `codex/thnk-82-u3-runtime-result-guidance`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-82-u3-runtime-result-guidance`
- Base: `origin/main` at `e0046c284`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3005
- Merge commit: `36b9526a62ddc4285ac425dbab3481b9eb8ff214`
- Changes:
  - Extended runtime tool policy with a structured-result presentation pass.
  - Added explicit `result.list` guidance for Work Items/Linear-like issues,
    agent-authored question collections, approval/review queues, and related
    scan-friendly result sets.
  - Reinforced prose fallback for tiny, narrative, unsupported, open-ended, or
    clearer-as-text responses.
  - Preserved `ask_user_question` for true blocking clarifications and warned
    agents not to mimic HITL cards with generated UI.
  - Added redaction/safety language for secrets, OAuth tokens, API keys, raw
    connector payloads, unnecessary PII, arbitrary URLs, scripts, callbacks,
    imports, and route instructions.
  - Mirrored the same boundaries in the `emit_json_render_ui` tool
    description and durable action parameter description.
- Verification:
  - `pnpm --filter @thinkwork/pi-extensions test -- system-prompt.test.ts`
  - `pnpm --filter @thinkwork/pi-runtime-core test -- json-render-runtime.test.ts`
  - `pnpm --filter @thinkwork/pi-extensions typecheck`
  - `pnpm --filter @thinkwork/pi-runtime-core typecheck`
- Notes:
  - Fresh worktree setup required `pnpm install`. The install completed with
    the same optional `canvas@2.11.2` native build output about missing
    `pkg-config` on Node 25. This did not block focused U3 tests or typechecks.

### U4 workspace-default guidance

- Objective: align static workspace defaults with the turn-scoped runtime
  generated-UI policy and keep the inline defaults mirror/parity tests green.
- Status: verified locally; ready for PR.
- Branch: `codex/thnk-82-u4-workspace-default-guidance`
- Worktree:
  `/Users/ericodom/.codex/worktrees/thnk-82-u4-workspace-default-guidance`
- Base: `origin/main` at `36b9526a6`
- Changes:
  - Reworded default `AGENTS.md` Tool Response Handling so it no longer claims
    structured tool data is always automatically rendered as rich UI.
  - Added static guidance that generated UI is turn-scoped and should follow
    dynamic runtime policy only when a platform-owned generated-UI tool such as
    `emit_json_render_ui` is available.
  - Preserved the boundary that upstream json-render developer skills are not
    runtime workspace skills.
  - Mirrored `files/AGENTS.md` into the inline `AGENTS_MD` constant.
  - Bumped `DEFAULTS_VERSION` from 27 to 28 and updated the parity test to
    allow the runtime tool mention without materializing json-render skills.
- Verification:
  - `pnpm --filter @thinkwork/workspace-defaults test -- parity.test.ts`
  - `pnpm --filter @thinkwork/workspace-defaults typecheck`
