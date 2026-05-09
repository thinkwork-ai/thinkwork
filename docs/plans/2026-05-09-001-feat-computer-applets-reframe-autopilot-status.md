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

- **Started U8:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u8-live-route` on branch
  `codex/computer-applets-u8-live-route` from `origin/main` after U7 merged.
- **Progress:** Rebound the apps gallery and `/apps/$id` route toward the live
  applet GraphQL surface. The detail route now fetches `applet(appId)`,
  transforms source through the U5 applet transform path, lazy-loads host
  externals, dynamic-imports the compiled module, and mounts it inside the
  single bounded applet canvas.
- **Decision:** The mounted applet snapshots the source/version at first load
  and shows a "newer version available" reload affordance when polling observes
  a higher metadata version; it does not auto-remount over the user's active
  applet.
- **Verification note:** `pnpm install --frozen-lockfile`, focused app route
  and shell tests, `pnpm --filter @thinkwork/computer test`, `pnpm --filter
  @thinkwork/computer typecheck`, `pnpm --filter @thinkwork/computer build`,
  `git diff --check`, `pnpm lint`, `pnpm -r --if-present typecheck`, and
  `pnpm -r --if-present test` passed locally. Build still emits the existing
  shared UI sourcemap/chunk-size warnings and expected host-registry
  dynamic-import warnings.
- **Smoke note:** The apps/computer dev server returned HTTP 200 for
  `/apps/33333333-3333-4333-8333-333333333333` on port 5177. Browser OAuth
  verification must use `localhost:5174` (not `127.0.0.1`) because the Cognito
  callback allowlist is hostname/port sensitive; port 5174 was already occupied
  by another local dev worktree, so U8 did not take it over.
- **Rebase note:** Rebased U8 on fresh `origin/main`, refreshed worktree
  dependencies with `pnpm install --frozen-lockfile`, then reran the applet
  route test, `pnpm --filter @thinkwork/computer test` (34 files, 109 tests),
  `pnpm --filter @thinkwork/computer typecheck`, `pnpm --filter
  @thinkwork/computer build`, `pnpm lint`, `pnpm -r --if-present typecheck`,
  and `git diff --check`; all passed. Build warnings remain the existing
  sourcemap/chunk-size and host-registry dynamic-import warnings.
- **Rebase note:** Main moved again after PR #1060 opened. Resolved the
  GraphQL query test conflict by keeping both the new Brain assertions from
  main and the U8 applet query assertions, refreshed dependencies, and reran
  the applet route/query tests, `pnpm --filter @thinkwork/computer typecheck`,
  and `git diff --check`; all passed.
- **Current PR:** #1060 (`feat(computer): mount live applets`).
- **CI:** PR #1060 checks passed: CLA, lint, test, typecheck, verify.
- **Merged U7:** PR #1057 (`feat(computer): activate Strands applet tools`)
  was squash-merged to `main` at
  `c48a913291252dc6e94062aab3a79fdfadeed25f`; remote/local branches and the
  U7 worktree were deleted.
- **Started U7:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u7-strands-live` on branch
  `codex/computer-applets-u7-strands-live` from `origin/main` after U6 merged.
- **Progress:** Replaced the Strands applet tool default seams with live
  GraphQL callers. `save_app` dispatches to `saveApplet` or
  `regenerateApplet` based on `app_id`, `load_app` calls `applet(appId)`, and
  `list_apps` calls `applets`. Calls use a fresh `httpx.AsyncClient`, service
  bearer auth, and tenant/agent/computer headers.
- **Verification note:** `uv run pytest
  packages/agentcore-strands/agent-container/test_applet_tool.py`, `uv run
  pytest packages/agentcore-strands/agent-container/test_applet_tool.py
  packages/agentcore-strands/agent-container/test_boot_assert.py`, `uv run
  ruff check ...`, and `uv run --no-project --with pytest --with
  pytest-asyncio --with pyyaml --with mistune --with anyio --with boto3 --with
  strands-agents pytest
  packages/agentcore-strands/agent-container/test_server_registration.py`
  passed locally. `git diff --check` passed. `docker build -f
  packages/agentcore-strands/agent-container/Dockerfile -t
  thinkwork-agentcore-strands-applet-u7:local .` passed, including the
  container boot assert.
- **Verification note:** A broad `uv run pytest
  packages/agentcore-strands/agent-container` collection attempt failed before
  tests ran because this local invocation does not install optional broad-suite
  dependencies (`botocore`, `pytest_asyncio`, and
  `workspace_composer_client`). The targeted supported invocations above cover
  the changed applet tool and runtime registration paths.
- **Current PR:** #1057 (`feat(computer): activate Strands applet tools`).
- **CI:** PR #1057 checks passed: CLA, lint, test, typecheck, verify.
- **Merged U6:** PR #1056 (`feat(computer): activate applet API resolvers`)
  was squash-merged to `main` at
  `ecf82f879e5646b733de0c6b9314682f1e658c5d`; remote/local branches and the
  U6 worktree were deleted.
- **Started U6:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u6-live-api` on branch
  `codex/computer-applets-u6-live-api` from `origin/main` after U5 merged.
- **Progress:** Activated applet GraphQL reads/writes: `saveApplet` now
  validates source, writes source and metadata to S3, inserts the applet
  artifact row, and returns the contract `SaveAppletPayload`; `regenerateApplet`
  increments the metadata version and overwrites source for the stable appId;
  `applet` loads source + metadata and `applets` lists metadata previews.
- **Decision:** Corrected the temporary U3 GraphQL shape to match the frozen
  U1 contract before U7 consumes it: `applet(appId)`, `applets`, nullable
  `SaveAppletInput.appId`, `SaveAppletPayload`, `regenerateApplet`, and
  instance/key-shaped applet-state signatures. Applet-state bodies remain inert
  for U9.
- **Verification note:** `pnpm install --frozen-lockfile`, codegen for
  `thinkwork-cli`, `@thinkwork/admin`, and `@thinkwork/mobile`, `pnpm --filter
  @thinkwork/api test -- applets`, `pnpm --filter @thinkwork/api typecheck`,
  `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm --filter @thinkwork/api
  test`, `pnpm -r --if-present test`, `pnpm --filter @thinkwork/api build`,
  and `git diff --check` passed locally.
- **Current PR:** #1056 (`feat(computer): activate applet API resolvers`).
- **CI:** PR #1056 checks passed: CLA, lint, test, typecheck, verify.
- **Merged U5:** PR #1054 (`feat(computer): add inert applet transform path`)
  was squash-merged to `main` at
  `e4ff628bf5f7b9dce0498ab243ec4aae75e4dc9a`; remote/local branches and the
  U5 worktree were deleted.
- **Started U5:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u5-transform` on branch
  `codex/computer-applets-u5-transform` from `origin/main` after U4 merged.
- **Progress:** Added the inert apps/computer applet transform substrate:
  Sucrase compile path, acorn-based import shim, in-memory Blob URL cache,
  worker entry, and `globalThis.__THINKWORK_APPLET_HOST__` registration before
  app render. The applet transform path remains unreachable from user routes
  until U8.
- **Decision:** U5 keeps the `useAppletAPI` surface from U2 (`useAppletState`,
  `useAppletQuery`, `useAppletMutation`, `refresh`) and registers an inert
  host placeholder that throws `INERT_NOT_WIRED`; U9 will body-swap it live.
- **Verification note:** `pnpm --filter @thinkwork/computer test -- applets`,
  `pnpm --filter @thinkwork/computer typecheck`, `pnpm --filter
  @thinkwork/computer build`, `git diff --check`, `pnpm lint`, `pnpm -r
  --if-present typecheck`, and `pnpm -r --if-present test` passed locally.
  Build still emits the existing package sourcemap and chunk-size warnings.
- **Bundle note:** The U5 transform substrate is lazy from app routes until U8.
  Baseline `origin/main` app JS gzip was 351,859 bytes; U5 app JS gzip was
  352,031 bytes (+172 bytes), within the plan's +50KB main-bundle budget. The
  Sucrase worker chunk is not emitted yet because no route imports the
  transform path before U8.
- **Smoke note:** The apps/computer dev server started on port 5176 and
  returned HTTP 200 for `/`.
- **Current PR:** #1054 (`feat(computer): add inert applet transform path`).
- **CI:** PR #1054 checks passed: CLA, lint, test, typecheck, verify.
- **Started U4:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u4-strands-tools` on branch
  `codex/computer-applets-u4-strands-tools` from `origin/main` after U3
  merged.
- **Progress:** Added inert Strands `save_app`, `load_app`, and `list_apps`
  factory closures with env snapshot tests, server registration, and
  boot-assert coverage. The Dockerfile already wildcard-copies
  `container-sources/`; `_boot_assert.py` is the effective COPY drift guard.
- **Verification note:** `uv run pytest
  packages/agentcore-strands/agent-container/test_applet_tool.py`, `uv run
  pytest packages/agentcore-strands/agent-container/test_applet_tool.py
  packages/agentcore-strands/agent-container/test_boot_assert.py`, `uv run
  ruff check ...`, `uv run --no-project --with pytest --with pytest-asyncio
  --with pyyaml --with mistune --with anyio --with boto3 --with
  strands-agents pytest
  packages/agentcore-strands/agent-container/test_server_registration.py`,
  and `docker build -f
  packages/agentcore-strands/agent-container/Dockerfile -t
  thinkwork-agentcore-strands-applet-u4:local .` all passed. After installing
  worktree dependencies with `pnpm install --frozen-lockfile`, `git diff
  --check`, `pnpm lint`, `pnpm -r --if-present typecheck`, and `pnpm -r
  --if-present test` also passed.
- **Current PR:** #1053 (`feat(computer): add inert applet tools`).
- **CI:** PR #1053 checks passed: CLA, lint, test, typecheck, verify.
- **Interruption handled:** PR #1052
  (`fix(computer): simplify applet canvas layout`) was opened, verified, and
  merged for the requested Apps single-canvas/no-horizontal-scroll correction
  before resuming U4.
- **Started U3:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u3-api` on branch
  `codex/computer-applets-u3-api` from `origin/main` after U2 merged.
- **Progress:** Added the applet GraphQL contract, server-side S3 storage,
  metadata/access helpers, source validation, inert resolvers that expose the
  schema without wiring runtime behavior before U6, and regenerated GraphQL
  client types for CLI/admin/mobile.
- **Verification note:** `pnpm install --no-frozen-lockfile`, `pnpm install
  --frozen-lockfile`, applet-focused API tests, full API tests, codegen for
  `thinkwork-cli`, `@thinkwork/admin`, and `@thinkwork/mobile`, `git diff
  --check`, `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm -r
  --if-present test`, and `pnpm --filter @thinkwork/api build` all passed.
  `pnpm format:check` is still blocked by the existing missing `prettier`
  binary in the root workspace.
- **Current PR:** #1051 (`feat(computer): add inert applet API`).
- **CI:** PR #1051 checks passed: CLA, lint, test, typecheck, verify.
- **Started U2:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u2-stdlib` on branch
  `codex/computer-applets-u2-stdlib` from `origin/main` after U1 merged.
- **Progress:** Added the initial `@thinkwork/computer-stdlib` package with
  generic primitives, formatters, the inert `useAppletAPI` hook, and package
  contract tests. No consumers are wired yet.
- **Current PR:** #1049 (`feat(computer): add applet stdlib package`).
- **CI:** PR #1049 checks passed: CLA, lint, test, typecheck, verify.
- **Verification note:** `pnpm install --no-frozen-lockfile` updated the
  lockfile for the new workspace package, and `pnpm install --frozen-lockfile`
  then passed. `pnpm --filter @thinkwork/computer-stdlib test`, `pnpm
  --filter @thinkwork/computer-stdlib build`, `pnpm -r --if-present
  typecheck`, `pnpm lint`, `pnpm -r --if-present test`, and `git diff --check`
  all passed locally.
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
- **CI:** PR #1047 checks passed: CLA, lint, test, typecheck, verify.
- **Blockers:** None.
