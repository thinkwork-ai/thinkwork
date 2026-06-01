---
title: "Workspace Contract v1 hardening autopilot status"
date: 2026-06-01
status: active
plan: docs/plans/2026-06-01-003-feat-workspace-contract-v1-hardening-plan.md
---

# Workspace Contract v1 Hardening Autopilot Status

## Objective

Implement Workspace Contract v1 end to end with one isolated branch/worktree and
one PR per implementation unit, then run full desktop, mobile, AgentCore, API,
write-back, progress, telemetry, migration, and docs regression coverage before
declaring the architecture complete.

## Progress

| Unit                                                  | Branch                        | PR      | Status     | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 Shared workspace contract and default instructions | `codex/workspace-contract-u1` | [#1951] | Merged     | `pnpm --filter @thinkwork/api test -- workspace-lanes prefixes src/lib/chat-finalize/reconcile.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/workspace-defaults test`; `pnpm --filter @thinkwork/workspace-defaults build`; `pnpm --filter @thinkwork/docs build`; `git diff --check`; GitHub checks passed (`cla`, `lint`, `test`, `typecheck`, `verify`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Squash merged into `main` as `5030fb002ddf9d4ad4240bc82f995885f81f258c`; remote and local branch cleaned up.                                                                                                                                                                                                                                                                                 |
| U2 Runtime renderer and hydration parity              | `codex/workspace-contract-u2` | [#1952] | Merged     | `pnpm --filter @thinkwork/api test -- src/lib/workspace-renderer/compose-tuple.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/agentcore-pi test -- tests/bootstrap-workspace.test.ts tests/workspace-diff.test.ts`; `pnpm --filter @thinkwork/agentcore-pi typecheck`; `pnpm --filter @thinkwork/desktop test -- test/sidecar/workspace-cache.test.ts test/sidecar/local-turn-runner.test.ts`; `pnpm --filter @thinkwork/desktop typecheck`; `pnpm --filter @thinkwork/mobile test -- lib/agent/workspace-cache.test.ts lib/agent/tools/workspace-tools.test.ts lib/agent/extensions/__tests__/local-bash-extension.test.ts lib/agent/thread-turn.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_bootstrap_workspace_rendered.py`; `uv run ruff check packages/agentcore-strands/agent-container/container-sources/bootstrap_workspace.py packages/agentcore-strands/agent-container/test_bootstrap_workspace_rendered.py`; `git diff --check`; touched-file Prettier check; GitHub checks passed (`cla`, `lint`, `test`, `typecheck`, `verify`) | Squash merged into `main` as `31a2dd0108249b09afa9aca058a4616d9890eda9`; remote and local branch cleaned up. Hydrate manifests now project root Agent files, `User/`, active `Spaces/<slug>/`, generated read-only `Spaces/INDEX.md`, and `Thread/` status mounts across API, desktop/mobile caches, and AgentCore bootstraps.                                                               |
| U3 `SPACE.md` manifest parser and Space overview UI   | `codex/workspace-contract-u3` | [#1953] | Merged     | `pnpm --filter @thinkwork/api test -- space-md-parser workspace-files-handler`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/spaces codegen`; `pnpm --filter @thinkwork/spaces test -- SettingsSpaceConfig src/routes/_authed/_shell/-spaces-route.test.tsx`; `pnpm --filter @thinkwork/spaces typecheck`; `git diff --check`; touched-file Prettier check; GitHub checks passed (`cla`, `lint`, `test`, `typecheck`, `verify`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Squash merged into `main` as `9f0b663d0db10b6d8c76d85a305eebf5015ded3f`; remote and local branch cleaned up. Adds typed `SPACE.md` parsing/projection, refreshes Space manifest projection on `SPACE.md` saves, and renders read-only Settings overview panels for workflows, tools, skills, and policy.                                                                                     |
| U4 Thread projections and Refresh progress            | `codex/workspace-contract-u4` | [#1955] | Merged     | `pnpm install --frozen-lockfile`; `pnpm schema:build`; `pnpm --filter thinkwork-cli codegen`; `pnpm --filter @thinkwork/admin codegen`; `pnpm --filter @thinkwork/mobile codegen`; `pnpm --filter @thinkwork/spaces codegen`; `pnpm --filter @thinkwork/api test -- task-status-tool thread-progress threadGoalFiles refreshThreadProgress customer-onboarding-goal-md storage compose-tuple workspace-lanes`; `pnpm --filter @thinkwork/spaces test -- SpacesThreadDetailRoute`; `pnpm --filter @thinkwork/api test -- graphql-contract`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/spaces test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/spaces typecheck`; `git diff --check`; touched-file Prettier check; GitHub checks passed (`cla`, `lint`, `test`, `typecheck`, `verify`)                                                                                                                                                                                                                                                                       | Squash merged into `main` as `9730371d97bbad2d17b49c7efbe5b8cb0b16ea87`; remote and local branch cleaned up. Extends generated Thread projections to `THREAD.md`, `GOAL.md`, `PROGRESS.md`, and `TASKS.md`; adds `refreshThreadProgress`; wires the Spaces right info panel refresh; and makes progress readers folder-aware so UI reads the same thread runtime prefix that refresh writes. |
| U5 Write-back lanes                                   | `codex/workspace-contract-u5` | Pending | Local pass | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/api test -- reconcile compose-tuple workspace-lanes`; `pnpm --filter @thinkwork/api test -- process-finalize chat-agent-finalize`; `pnpm --filter @thinkwork/pi-runtime-core test -- workspace-diff`; `pnpm --filter @thinkwork/desktop test -- test/sidecar/local-turn-runner.test.ts`; `pnpm --filter @thinkwork/mobile test -- lib/agent/extensions/__tests__/local-bash-extension.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/pi-runtime-core typecheck`; `pnpm --filter @thinkwork/desktop typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/pi-runtime-core test`; touched-file Prettier check; `git diff --check`                                                                                                                                                                                                                                                                                                                                                           | Ready to open PR. Mounts `thread_notes` in hydrate manifests, classifies `Thread/` narrative files correctly, routes Agent/Space/User/Thread notes writes through reconcile, rejects generated projections, and pins diff producer behavior for v1 paths.                                                                                                                                    |

## Activity Log

- 2026-06-01: Pulled `main` with `git pull --ff-only origin main`; repository
  was already up to date at `768a274d`.
- 2026-06-01: Read AGENTS.md, the hardening plan, the origin requirements, and
  prior workspace-defaults parity guidance in
  `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`.
- 2026-06-01: Created worktree
  `.Codex/worktrees/workspace-contract-u1` on
  `codex/workspace-contract-u1` from `origin/main` for U1.
- 2026-06-01: Implemented U1 and ran local verification. `pnpm install --frozen-lockfile`
  succeeded; optional native rebuilds for `node-liblzma` and
  `canvas` logged missing `pkg-config`, matching prior worktree behavior, but
  install exited successfully. Focused API/workspace-defaults tests, API
  typecheck, workspace-defaults build, docs build, and whitespace checks passed.
- 2026-06-01: Opened PR #1951. First CI run passed `cla`, `lint`,
  `typecheck`, and `verify`, but failed `test` in
  `packages/api/src/lib/chat-finalize/reconcile.test.ts` because the suite still
  used legacy root `memory/...` paths to mean User memory after U1 made root
  `memory/` Agent-owned. Updated reconcile fixtures to use
  `User/memory/...` for the User lane and reran focused API tests/typecheck.
- 2026-06-01: U1 CI passed on rerun. Squash merged PR #1951 into `main`,
  removed `codex/workspace-contract-u1`, pruned remotes, and fast-forwarded the
  main checkout to `5030fb002ddf9d4ad4240bc82f995885f81f258c`.
- 2026-06-01: Created U2 worktree
  `.Codex/worktrees/workspace-contract-u2` on
  `codex/workspace-contract-u2` from `origin/main`.
- 2026-06-01: Implemented and locally verified U2. `pnpm install
--frozen-lockfile` exited successfully with the same optional native
  `pkg-config` rebuild noise seen in U1. Focused API, desktop, mobile,
  AgentCore Pi, and Strands bootstrap tests passed; API, desktop, and
  AgentCore Pi typechecks passed; Python ruff checks passed. Manual
  `pnpm --filter @thinkwork/mobile exec tsc --noEmit` is not an app script and
  still fails on pre-existing mobile-wide type errors unrelated to this unit
  (`app/(tabs)/fleet.tsx`, `app/_layout.tsx`,
  `components/agents/agent-detail.tsx`, extension tests, and others).
- 2026-06-01: Rebasing U2 onto current `origin/main` picked up
  `bd440d6b` (`feat(desktop): translucent sidebar vibrancy on macOS (#1950)`)
  with no conflicts. Reran focused verification after the rebase and opened
  PR #1952.
- 2026-06-01: PR #1952 first CI run passed `cla`, `lint`, and `verify`, but
  failed `test` in `apps/mobile/lib/agent/tools/workspace-tools.test.ts`
  because the expected grep/find paths still used the legacy `Agent/` root.
  Updated the workspace tools expectations to the v1 root Agent path
  (`docs/notes.md`) and reran
  `pnpm --filter @thinkwork/mobile test -- lib/agent/workspace-cache.test.ts lib/agent/tools/workspace-tools.test.ts`.
- 2026-06-01: PR #1952 second CI run passed `cla`, `lint`, and `verify`, but
  failed `test` in `apps/desktop/test/sidecar/local-turn-runner.test.ts`
  because the desktop local debug bundle now reports `### AGENTS.md` instead
  of legacy `### Agent/AGENTS.md`. Fixed the underlying desktop and mobile
  local bash hydration adapters so `User/`, `Spaces/<space>/`, and `Thread/`
  stay v1-shaped instead of flattening to root `USER.md` or singular `Space/`.
  Reran
  `pnpm --filter @thinkwork/desktop test -- test/sidecar/local-turn-runner.test.ts test/sidecar/workspace-cache.test.ts`,
  `pnpm --filter @thinkwork/desktop typecheck`, and
  `pnpm --filter @thinkwork/mobile test -- lib/agent/workspace-cache.test.ts lib/agent/tools/workspace-tools.test.ts lib/agent/extensions/__tests__/local-bash-extension.test.ts lib/agent/thread-turn.test.ts`.
- 2026-06-01: PR #1952 third CI run passed all required checks. Squash merged
  PR #1952 into `main` as `31a2dd0108249b09afa9aca058a4616d9890eda9`,
  pruned the remote branch, removed the U2 worktree/local branch, and
  fast-forwarded the main checkout.
- 2026-06-01: Created U3 worktree
  `.Codex/worktrees/workspace-contract-u3` on
  `codex/workspace-contract-u3` from `origin/main`.
- 2026-06-01: Implemented and locally verified U3. `pnpm install
--frozen-lockfile` exited successfully with the same optional native
  `pkg-config` rebuild noise seen in U1/U2. Focused API parser/workspace-files
  tests, API typecheck, Spaces codegen, SettingsSpaceConfig/Space route tests, Spaces
  typecheck, whitespace checks, and touched-file Prettier check passed.
- 2026-06-01: Opened PR #1953 for U3.
- 2026-06-01: PR #1953 passed all required checks, squash merged into `main`
  as `9f0b663d0db10b6d8c76d85a305eebf5015ded3f`, removed the remote/local
  branch and U3 worktree, and fast-forwarded the main checkout.
- 2026-06-01: Created U4 worktree
  `.Codex/worktrees/workspace-contract-u4` on
  `codex/workspace-contract-u4` from `origin/main`.
- 2026-06-01: Began U4. `pnpm install --frozen-lockfile` exited successfully
  with the same optional native `pkg-config` rebuild noise seen in earlier
  units. `pnpm schema:build` and consumer GraphQL codegen for CLI, admin,
  mobile, and Spaces succeeded after adding the refresh mutation and new Thread
  projection file kinds.
- 2026-06-01: Locally verified U4. Focused API progress/projection suites,
  Spaces route test, API/Spaces typechecks, full API tests, full Spaces tests,
  whitespace checks, and touched-file Prettier checks passed. The first broad
  API run exposed a brittle GraphQL contract assertion for multiline AppSync
  auth directives on `onWorkspaceAccessRevoked`; updated the assertion and
  reran `pnpm --filter @thinkwork/api test -- graphql-contract` plus the full
  API suite successfully.
- 2026-06-01: Opened PR #1955 for U4.
- 2026-06-01: PR #1955 passed all required checks, squash merged into `main`
  as `9730371d97bbad2d17b49c7efbe5b8cb0b16ea87`, removed the remote/local
  branch and U4 worktree, and fast-forwarded the main checkout.
- 2026-06-01: Created U5 worktree
  `.Codex/worktrees/workspace-contract-u5` on
  `codex/workspace-contract-u5` from `origin/main`.
- 2026-06-01: Implemented and locally verified U5. `pnpm install
--frozen-lockfile` exited successfully with the same optional native
  `pkg-config` rebuild noise seen in earlier units. Focused API
  reconcile/render/lane/finalize tests, focused pi-runtime-core, desktop, and
  mobile runtime diff tests, API/pi-runtime-core/desktop typechecks, full API
  tests, full pi-runtime-core tests, touched-file Prettier check, and
  whitespace checks passed.

[#1951]: https://github.com/thinkwork-ai/thinkwork/pull/1951
[#1952]: https://github.com/thinkwork-ai/thinkwork/pull/1952
[#1953]: https://github.com/thinkwork-ai/thinkwork/pull/1953
[#1955]: https://github.com/thinkwork-ai/thinkwork/pull/1955

## Blockers

None.
