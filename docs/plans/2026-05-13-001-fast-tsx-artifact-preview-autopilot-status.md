---
title: "Fast TSX artifact preview autopilot status"
date: 2026-05-13
plan: docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md
target_branch: main
status: completed
---

# Fast TSX Artifact Preview Autopilot Status

## Current Unit

- Unit: all implementation units complete
- Branch: `main`
- Worktree: n/a
- Started: 2026-05-13
- State: completed

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
- 2026-05-13: Opened U2 PR #1185 from `codex/fast-tsx-u2-draft-payload`.
- 2026-05-13: U2 PR #1185 passed required checks and was squash-merged to `main` at `39d1c60b`.
- 2026-05-13: Removed the completed U2 worktree, fetched `origin/main`, and started U3 in `.Codex/worktrees/fast-tsx-u3-draft-render` on branch `codex/fast-tsx-u3-draft-render`.
- 2026-05-13: Began U3 by adding the iframe-backed `DraftAppletPreview` renderer inside AI Elements `WebPreview` chrome and routing `tool-preview_app` output to it.
- 2026-05-13: U3 focused verification passed: DraftAppletPreview/render typed-part tests, GeneratedArtifactCard/AppSync transport regression tests, Computer typecheck, Computer build, and `git diff --check`. Computer build emitted existing sourcemap/chunk-size warnings only.
- 2026-05-13: Opened U3 PR #1186 from `codex/fast-tsx-u3-draft-render`.
- 2026-05-13: U3 PR #1186 passed required checks and was squash-merged to `main` at `3e4ee371`.
- 2026-05-13: Removed the completed U3 worktree, fetched `origin/main`, and started U4 in `.Codex/worktrees/fast-tsx-u4-promote-draft` on branch `codex/fast-tsx-u4-promote-draft`.
- 2026-05-13: Began U4 by adding the `promoteDraftApplet` schema/resolver path, draft promotion proof verification, user-auth promotion boundary, deterministic draft app IDs, and a Save action in `DraftAppletPreview`.
- 2026-05-13: U4 focused verification passed: API applet resolver/access/runtime proof tests, Computer draft preview/query tests, Python applet tool tests, GraphQL contract test, API/Computer typechecks, API/Computer builds, CLI typecheck, root lint, Python ruff check for touched files, and `git diff --check`. Computer build emitted existing sourcemap/chunk-size warnings only.
- 2026-05-13: Opened U4 PR #1187 from `codex/fast-tsx-u4-promote-draft`.
- 2026-05-13: U4 PR #1187 CI failed in `test` because `render-typed-part.test.tsx` rendered `DraftAppletPreview` without a `urql` provider or mock after the Save hook was added; patched the test to mock `useMutation`.
- 2026-05-13: U4 CI fix verification passed: `render-typed-part` + `DraftAppletPreview` tests, Computer typecheck, and `git diff --check`.
- 2026-05-13: U4 PR #1187 passed required checks after a no-op CI nudge and was squash-merged to `main` at `d6975f60`.
- 2026-05-13: Removed the completed U4 worktree, fetched `origin/main`, and started U5 in `.Codex/worktrees/fast-tsx-u5-shadcn-guidance` on branch `codex/fast-tsx-u5-shadcn-guidance`.
- 2026-05-13: Began U5 by publishing a shadcn-compatible Thinkwork registry, expanding the generated-app component manifest, exposing local `list_components`, `search_registry`, `get_component_source`, and `get_block` registry tools in the Strands runtime, and updating Artifact Builder guidance to require registry consultation before TSX.
- 2026-05-13: U5 focused verification passed: UI registry export tests and typecheck, workspace-defaults tests and typecheck, API applet/source-policy/default-upgrade tests and typecheck, Computer import/render tests and typecheck, Python shadcn/app-preview/server/boot tests, targeted Python ruff checks, and `git diff --check`.
- 2026-05-13: U5 broader hygiene: `pnpm lint` passed. Root `pnpm format:check` could not run because root `prettier` is not installed; `pnpm dlx prettier@3.8.2 --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"` reported pre-existing formatting drift across the repository, while the touched TS/JSON/MD files passed targeted Prettier check.
- 2026-05-13: Opened U5 PR #1188 from `codex/fast-tsx-u5-shadcn-guidance`.
- 2026-05-13: U5 PR #1188 passed required checks and was squash-merged to `main` at `fee977e7`.
- 2026-05-13: Removed the completed U5 worktree, fetched `origin/main`, and started U6 in `.Codex/worktrees/fast-tsx-u6-preview-success` on branch `codex/fast-tsx-u6-preview-success`.
- 2026-05-13: Began U6 by making successful validated `preview_app` output count as preview-first artifact output while keeping save claims strict.
- 2026-05-13: U6 focused verification passed: API runtime tests and typecheck, Python server streaming tests, `ruff check --select F` for touched Python files, root `pnpm lint`, targeted Prettier check for touched TS/MD files, and `git diff --check`.
- 2026-05-13: Opened U6 PR #1189 from `codex/fast-tsx-u6-preview-success`.
- 2026-05-13: U6 PR #1189 passed required checks and was squash-merged to `main` at `d357ebb5`.
- 2026-05-13: Confirmed the plan has no implementation units beyond U6; fast TSX artifact preview autopilot implementation is complete.

## Pull Requests

- U1: #1184 - <https://github.com/thinkwork-ai/thinkwork/pull/1184>
- U2: #1185 - <https://github.com/thinkwork-ai/thinkwork/pull/1185>
- U3: #1186 - <https://github.com/thinkwork-ai/thinkwork/pull/1186>
- U4: #1187 - <https://github.com/thinkwork-ai/thinkwork/pull/1187>
- U5: #1188 - <https://github.com/thinkwork-ai/thinkwork/pull/1188>
- U6: #1189 - <https://github.com/thinkwork-ai/thinkwork/pull/1189>

## CI Failures

- 2026-05-13: U4 PR #1187 `test` failed once on missing `urql` provider in `apps/computer/src/components/computer/render-typed-part.test.tsx`; fixed with a test-local `useMutation` mock.

## Blockers

None.
