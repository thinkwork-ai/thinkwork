---
title: "Fast TSX artifact preview autopilot status"
date: 2026-05-13
plan: docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md
target_branch: main
status: active
---

# Fast TSX Artifact Preview Autopilot Status

## Current Unit

- Unit: U2 - Add draft app preview payload contract
- Branch: `codex/fast-tsx-u2-draft-payload`
- Worktree: `.Codex/worktrees/fast-tsx-u2-draft-payload`
- Started: 2026-05-13
- State: in progress

## Progress Log

- 2026-05-13: Read `AGENTS.md`, read the fast TSX artifact preview plan, fetched `origin/main`, and created the isolated U1 worktree from `origin/main`.
- 2026-05-13: Preserved the existing shared `docs/plans/autopilot-status.md` runbook autopilot archive and moved this run's log into this feature-specific status document.
- 2026-05-13: Implemented a shared generated-app source policy, JSON registry/policy artifacts, API-side import/source quality validation, and Computer import-shim enforcement for ShadCN/Tailwind/React-only TSX artifact code.
- 2026-05-13: Local focused verification passed: API applet validation/source-policy tests, Computer import transform tests, API/Computer/UI typechecks, API build, Computer build, and `git diff --check`. Computer build emitted existing sourcemap/chunk-size warnings only.
- 2026-05-13: Opened U1 PR #1184 from `codex/fast-tsx-u1-source-policy`.
- 2026-05-13: U1 PR #1184 passed required checks and was squash-merged to `main` at `3631d1aa`.
- 2026-05-13: Removed the completed U1 worktree, fetched `origin/main`, and started U2 in `.Codex/worktrees/fast-tsx-u2-draft-payload` on branch `codex/fast-tsx-u2-draft-payload`.
- 2026-05-13: Began U2 by adding the unsaved `preview_app` tool payload contract, service-minted draft proof helpers, and typed `tool-preview_app` durable message part extraction.
- 2026-05-13: U2 focused verification passed: API runtime/thread-cutover tests, Computer AppSync transport test, Python applet tool/UI message publisher tests, API build, API/Computer typechecks, Python applet-tool lint, Python runtime-error lint for the touched server integration, and `git diff --check`.

## Pull Requests

- U1: #1184 - <https://github.com/thinkwork-ai/thinkwork/pull/1184>

## CI Failures

None yet.

## Blockers

None.
