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
  `pnpm -r --if-present test`, touched-file Prettier check, and
  `git diff --check` passed locally before opening the U1/U2 PR.
- **Merged U1/U2:** PR #1077
  (`feat(computer): add Artifact Builder CRM recipe`) was squash-merged to
  `main` at
  `16332758b386db475e544803d39fa58886a5c06d`; CI passed: CLA, lint, test,
  typecheck, verify. The remote branch was deleted by GitHub; the local
  worktree and branch were removed manually because `gh pr merge` could not
  check out local `main` while another worktree owned it.
- **Started U3:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-save-invariant-u3` on branch
  `codex/artifact-builder-save-invariant-u3` from fresh `origin/main` at
  `40d498bc` after PR #1078 merged.
- **Progress:** Implemented the direct `save_app` invariant for Computer
  build-style prompts. The Strands runtime now preserves successful
  `save_app` result fields in tool invocation usage metadata; the API now
  links orphan applet artifacts with returned IDs, records linked artifact
  counts/IDs, and replaces unverified build-success claims with the safe
  Artifact-save-missing response when no direct successful `save_app` evidence
  and no linked applet exist.
- **Verification note:** Focused API runtime tests, API typecheck, and
  Strands streaming tests passed. Broader `pnpm lint`,
  `pnpm -r --if-present typecheck`, and `pnpm -r --if-present test` passed
  locally. Touched-file Prettier check and `git diff --check` passed. A raw
  `uv run ruff check` over the whole Strands `server.py` still reports
  pre-existing import-order/E402/UTC findings, so the U3 Python sanity pass
  used `uv run ruff check --ignore E402,I001,UP017` plus
  `uv run ruff format --check` on the touched Python files.
- **Merged U3:** PR #1079
  (`fix(computer): require saved applet evidence for build turns`) was
  squash-merged to `main` at
  `2bbfe879f48b30b73f611a5ef07b44a2b8b36b4e`; CI passed: CLA, lint, test,
  typecheck, verify. The remote branch was deleted by GitHub; the local
  worktree and branch were removed manually because `gh pr merge` could not
  check out local `main` while another worktree owned it.
- **Started U4:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-crm-smoke-u4` on branch
  `codex/artifact-builder-crm-smoke-u4` from fresh `origin/main` at
  `2bbfe879`.
- **Progress:** Added `scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`
  for the optional deployed CRM dashboard prompt acceptance path. The script
  dry-runs by default, requires `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1` for live
  AgentCore/model execution, creates a fresh Computer thread in live mode,
  sends the CRM dashboard prompt, waits for the task, asserts a linked applet
  artifact exists, validates applet source shape, opens `/artifacts/{appId}`,
  and prints thread/task/applet diagnostics on failure. Wired it into
  `scripts/smoke-computer.sh` and documented the flag/prompt override in
  `apps/computer/README.md`.
- **Verification note:** `node --check
scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`,
  `COMPUTER_ENV_FILE=none node
scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`, `bash -n
scripts/smoke-computer.sh`, touched-file Prettier check, `pnpm lint`,
  `pnpm -r --if-present typecheck`, and `pnpm -r --if-present test` passed
  locally. `git diff --check` passed.
- **Current PR:** #1080
  (`test(computer): add CRM dashboard prompt smoke`).
