---
title: "Computer applets reframe autopilot status"
type: status
status: active
date: 2026-05-09
plan: docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md
---

# Computer applets reframe autopilot status

This file records implementation progress, PRs, CI failures, blockers, and
conservative decisions while executing the Computer applets reframe in
autopilot mode.

## 2026-05-09

- **Started U1:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u1-contract` on branch
  `codex/computer-applets-u1-contract` from `origin/main`.
- **Decision:** Track both the applets reframe plan and its origin brainstorm
  in this branch because the referenced plan was present only as an untracked
  local document in the main checkout.
- **Decision:** The contract spec follows the implementation plan's S3 storage
  decision, not the origin brainstorm's earlier EFS framing.
- **Progress:** Added `docs/specs/computer-applet-contract-v1.md` and extended
  the plan 014 M1 contract-freeze gate with the applet-package shape.
- **Verification note:** `git diff --check` passed and a frontmatter sanity
  check passed for the new spec and status docs. `pnpm install
  --frozen-lockfile` succeeded, but `pnpm format:check` still cannot run
  because the root script references `prettier` and the repo does not expose a
  Prettier binary in `node_modules/.bin`.
- **Verification note:** `pnpm lint` passed locally.
- **Current PR:** #1047 (`docs(computer): lock applet contract`).
- **CI:** Pending on PR #1047.
- **Blockers:** None.
