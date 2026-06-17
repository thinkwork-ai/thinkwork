---
issue: THNK-38
title: "fix: repair LastMile plugin skill install on legacy workspaces"
updated: 2026-06-17
dispatcher: dispatcher:THNK-38:ReadyToWork:Codex
project_context: ThinkWork / Enterprise Agent OS
---

# THNK-38 Autopilot Status

## Implementation

- Started from fresh `origin/main` at
  `4fafd471df5b4b022edd56a8c67776f0037e71e4` in branch
  `codex/thnk-38-lastmile-defaults`.
- Rebasing before PR moved the branch onto fresh `origin/main` at
  `222d991d689c861c43ae548a9508617fbf2387cb`.
- Rebasing before merge moved the branch onto fresh `origin/main` at
  `ab82681b3786a5884ae842e085adcbce64c2b05f`.
- Read THNK-38 issue context, comments, screenshot, labels/statuses, related
  issues, the Linear debug document, and the merged repo debug artifact before
  implementation.
- Moved Linear THNK-38 from `Ready to Work` to `In Progress` when
  implementation began, preserving the `Codex` routing label.
- Added a plugin skills provisioning repair step before catalog skill install:
  resolve the tenant platform agent, then call
  `bootstrapAgentWorkspace(agent.id, { mode: "preserve-existing" })`.
- The repair path fills missing current workspace defaults such as root
  `CONTEXT.md` for legacy platform agents while preserving existing tenant or
  operator-authored files.
- No production mutation was performed. TEI still needs a post-deploy retry of
  the failed LastMile `skills` component during Verification.

## Verification

- `pnpm --dir packages/api exec vitest run src/lib/plugins/handlers/skills.test.ts`
  passed: 13 tests.
- `pnpm --filter @thinkwork/api typecheck` passed.
- Focused Prettier write passed with no changes on the two touched API files
  and this status artifact.
- `git diff --check` passed.
- `packages/api` has no package-local lint script. Initial focused vitest run
  failed before tests because the fresh worktree had no `node_modules`; after
  `pnpm install`, package-local test/typecheck bins were available. The install
  logged a Node 25 `canvas` native fallback failure due missing `pkg-config`,
  but completed with workspace links sufficient for the API checks above.
