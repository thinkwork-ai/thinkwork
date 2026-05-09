---
title: "Computer Artifact Builder CRM recipe autopilot status"
type: status
status: active
date: 2026-05-09
plan: docs/plans/2026-05-09-007-feat-computer-artifact-builder-crm-recipe-plan.md
---

# Computer Artifact Builder CRM recipe autopilot status

This file records implementation progress, PRs, CI failures, blockers, and
conservative decisions while executing the Artifact Builder CRM dashboard
recipe plan in autopilot mode.

## 2026-05-09

- **Started U1/U2:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-crm-recipe-u1-u2` on branch
  `codex/artifact-builder-crm-recipe-u1-u2` from fresh `origin/main` at
  `947683bf` after PR #1076 merged.
- **Scope decision:** Grouped U1 and U2 in one PR because the plan explicitly
  allows grouping when the diff remains small and the recipe is not useful
  unless it reaches existing Computer backing-agent workspaces.
- **Progress:** Added `references/crm-dashboard.md` under the Artifact Builder
  skill, routed CRM dashboard prompts from `SKILL.md` to that recipe, bumped
  workspace defaults to version 9, and added parity/text-contract tests for
  the canonical CRM dashboard data shape and `save_app`/`refresh()` contract.
- **Progress:** Added an API helper that writes missing Artifact Builder files
  into the backing agent's S3 workspace prefix before Computer thread-turn
  dispatch. It creates absent files, updates only the exact known old platform
  `SKILL.md` by SHA-256, and skips custom `skills/artifact-builder/SKILL.md`
  content so user edits are preserved.
- **Verification note:** Focused workspace-defaults and API helper/routing
  tests passed. Broader `pnpm lint`, `pnpm -r --if-present typecheck`,
  `pnpm -r --if-present test`, touched-file Prettier check, and `git diff
--check` passed locally before opening the U1/U2 PR.
- **Current PR:** #1077 (`feat(computer): add Artifact Builder CRM recipe`).
