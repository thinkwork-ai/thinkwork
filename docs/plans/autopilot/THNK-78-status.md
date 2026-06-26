---
date: 2026-06-26
linear_issue: THNK-78
status: u1-contract-in-progress
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
- Status: in progress.
