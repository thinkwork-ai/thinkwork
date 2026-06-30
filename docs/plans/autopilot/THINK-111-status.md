---
linear: THINK-111
title: Devin Automation
status: reviewed
started_at: 2026-06-30
target_branch: main
active_branch: codex/think-111-devin-style-automation-builder
primary_plan: docs/plans/2026-06-30-001-feat-devin-style-automation-builder-plan.md
---

# THINK-111 Autopilot Status

## Context

- Linear issue: `THINK-111` / "Devin Automation"
- Linear URL: https://linear.app/thinkworkai/issue/THINK-111/devin-automation
- Current Linear state at discovery: `Plan Review`
- Current Linear state: `In Progress`
- Project: `Enterprise Agent OS`
- Team: `ThinkWork`
- Assignee: Eric Odom
- Priority: Medium
- Parent/child issues: none found
- Blockers/relations/releases/customer needs: none found
- Attached Linear document: `Plan: Add Devin-style Automation Builder`
- Repo plan: `docs/plans/2026-06-30-001-feat-devin-style-automation-builder-plan.md`
- Requirements: `docs/brainstorms/2026-06-30-think-111-devin-style-automation-builder-requirements.md`

## Source Material Read

- `AGENTS.md`
- Autopilot attachment: `/Users/ericodom/.codex/attachments/c90a343d-46c2-4ebf-a5fa-56700c4413c4/pasted-text.txt`
- Linear issue description, comments, documents, relations, and screenshot attachments
- Linear document `4afe99d9-6a9e-4a54-81a7-38c73b92d63a`
- Repo brainstorm requirements for THINK-111
- Repo primary plan for THINK-111
- Prior prompt-first plan sections in `docs/plans/2026-06-23-001-feat-prompt-first-automations-plan.md`
- `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md`
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
- `docs/solutions/architecture-patterns/agent-loop-foundation-2026-06-22.md`

## Product Decisions

- Replace New Automation mode tabs with a single Devin-style page.
- Keep the page order: name, triggers, instructions, MCPs/connectors, Advanced, Create automation.
- Treat routine operators and power users as equal first-class actors on the same default page.
- Move Advanced from a side panel to an in-page accordion.
- Keep chat assistance optional; normal creation must not require starting a builder thread.
- Preserve the existing AgentLoop / `SaveAgentLoopInput` runtime path.
- Support only runtime-backed trigger choices in this pass: manual and schedule.
- Render MCPs/connectors visibly with a non-blocking empty state unless a current data source is verified.

## Implementation Strategy

- Group U1-U5 into one implementation branch and PR because the draft contract, form skeleton, trigger/instruction blocks, advanced accordion, docs, and tests all share the same `AgentLoopForm` and `AgentLoopForm.test.tsx` surface. Splitting them would create stacked UI PRs against the same files without producing a coherent user-facing builder until the final unit.
- Base the branch on the latest `origin/main` before implementation.
- Carry forward the repo-local brainstorm, plan, and this status doc on the implementation branch.
- Do not change GraphQL schema or codegen unless implementation proves the existing save payload cannot preserve behavior.

## Implementation Units

- U1. Normalize the builder draft contract.
- U2. Replace mode tabs with the Devin-style page skeleton.
- U3. Implement trigger and instruction blocks.
- U4. Move advanced, templates, MCPs, and chat assistance into the page.
- U5. Update integration coverage, docs, and visual verification.

## Progress Log

- 2026-06-30: Brainstorm requirements captured and summarized on Linear.
- 2026-06-30: Primary plan created locally and attached to Linear.
- 2026-06-30: Linear moved from `Brainstorming` to `Plan Review` during planning.
- 2026-06-30: Autopilot request received with primary plan `docs/plans/2026-06-30-001-feat-devin-style-automation-builder-plan.md`.
- 2026-06-30: Read `AGENTS.md`, the autopilot attachment, Linear issue, Linear comments, Linear document, screenshots, repo-local plan, repo-local requirements, prior prompt-first plan sections, and relevant solution docs.
- 2026-06-30: Confirmed no Linear child issues, blockers, related issues, releases, customer needs, or non-image attachments.
- 2026-06-30: Fetched latest `origin/main`.
- 2026-06-30: Created branch `codex/think-111-devin-style-automation-builder` from `origin/main`.
- 2026-06-30: Moved Linear from `Plan Review` to `In Progress`.
- 2026-06-30: Implemented the single-page builder:
  - `builder` is the default prompt-first creation mode.
  - Create mode no longer renders Chat / Manual / Advanced tabs.
  - Name, Triggers, Instructions, MCPs, Advanced, and create action render in the Devin-style order.
  - Add trigger exposes manual and schedule choices only.
  - Instruction is represented as the supported Start session action.
  - MCPs render as a visible non-blocking empty state.
  - Advanced fields moved into an in-page accordion.
  - Optional chat help can still prefill the same builder and link setup history.
- 2026-06-30: Updated automation docs and added a supersession note to the 2026-06-23 prompt-first plan.
- 2026-06-30: Browser-verified the actual `AgentLoopForm` through a temporary local preview route at desktop and mobile widths, then removed the preview route before commit. Real `/settings/automations` browser access redirects to sign-in in a fresh headless profile because the app shell requires `AuthContext`.
- 2026-06-30: Verification passed:
  - `corepack pnpm --filter @thinkwork/web exec vitest run src/components/agent-loops/agent-loop-utils.test.ts src/components/agent-loops/AgentLoopForm.test.tsx`
  - `corepack pnpm --filter @thinkwork/api exec vitest run src/lib/agent-loops/automation-draft.test.ts`
  - `corepack pnpm --filter @thinkwork/web typecheck`
  - `corepack pnpm --filter @thinkwork/api typecheck`
  - `corepack pnpm dlx prettier --write <touched files>`
- 2026-06-30: Inline `ce-code-review` autofix pass completed. One P2 touch/keyboard menu issue was fixed by replacing CSS hover/focus trigger and instruction menus with existing `DropdownMenu` primitives. Residual actionable work: none identified.
- 2026-06-30: `ce-test-browser` pipeline-style pass completed with `agent-browser` against a temporary unauthed preview route mounting the real `AgentLoopForm`; the route was removed before commit. Browser testing found and fixed:
  - one-time schedule blank datetime crash (`Invalid time value`) in `SchedulePicker`;
  - unreliable Advanced accordion toggling from an `undefined` controlled closed value.
- 2026-06-30: Final focused verification passed:
  - `corepack pnpm --filter @thinkwork/web exec vitest run src/components/schedule-picker/SchedulePicker.test.ts src/components/agent-loops/agent-loop-utils.test.ts src/components/agent-loops/AgentLoopForm.test.tsx`
  - `corepack pnpm --filter @thinkwork/api exec vitest run src/lib/agent-loops/automation-draft.test.ts`
  - `corepack pnpm --filter @thinkwork/web typecheck`
  - `corepack pnpm --filter @thinkwork/api typecheck`

## Verification Plan

- Update utility and component tests for the new builder default.
- Run focused web tests for `agent-loop-utils`, `AgentLoopForm`, and `AgentLoopInventory` as applicable.
- Run focused API normalization tests if `creationMode` or `createdFrom` changes require server normalization updates.
- Run `pnpm --filter @thinkwork/web typecheck`.
- Run browser verification for the New Automation page at desktop and mobile widths after copying the worktree web `.env`.
- Run broader checks before PR where practical.

## Linear State Changes

- 2026-06-30: `Todo` -> `Brainstorming` during brainstorm.
- 2026-06-30: `Brainstorming` -> `Plan Review` after plan publication.
- 2026-06-30: `Plan Review` -> `In Progress` when implementation started.

## Branches and PRs

- Active branch: `codex/think-111-devin-style-automation-builder`.
- PR: pending.

## Blockers

- None currently.
