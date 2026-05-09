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

- **Started U13:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u13-admin-observability` on branch
  `codex/computer-applets-u13-admin-observability` from `origin/main` after
  U12 merged.
- **Progress:** Added tenant-admin applet observability GraphQL queries,
  resolver tests, generated API client types, and admin routes for browsing
  tenant applets, filtering by user id, and inspecting source plus metadata.
  The route is read-only and linked from the sidebar and command palette.
- **Verification note:** `pnpm install --frozen-lockfile`, `pnpm schema:build`,
  codegen for admin/mobile/CLI, focused API/admin type/build/test checks,
  `pnpm lint`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`,
  and `git diff --check` passed locally. Root `pnpm exec prettier --check`
  remains blocked by the repo's existing missing root `prettier` binary; touched
  files were formatted before verification. Local browser smoke for `/applets`
  is deferred until the new backend query fields are deployed because the admin
  dev server points at the deployed GraphQL API.
- **Merged U12:** PR #1067 (`refactor(computer): delete legacy CRM dashboard path`)
  was squash-merged to `main` at
  `e188c253f111f5bf7d724fedcf0c3b1c12765f53`; remote/local branches and the
  U12 worktree were deleted. CI passed: CLA, lint, test, typecheck, verify.
- **Started U12:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u12-legacy-delete` on branch
  `codex/computer-applets-u12-legacy-delete` from `origin/main` after U11
  merged.
- **Progress:** Deleted the legacy CRM dashboard orchestrator, dashboard
  artifact GraphQL/query/mutation surface, dashboard fixture, dashboard-kind
  task plumbing, split provenance panel, and old dashboard-specific Computer
  UI/tests. The app gallery now treats artifacts as applet previews only, and
  regenerated GraphQL outputs no longer expose the dashboard artifact contract.
- **Verification note:** `pnpm install --frozen-lockfile`, `pnpm
schema:build`, codegen for admin/mobile/CLI, focused Computer/API
  typechecks and tests, `pnpm lint`, recursive typecheck, recursive tests,
  Computer build, targeted Prettier check, legacy symbol grep, and `git diff
--check` passed locally. `pnpm format:check` is still blocked by the existing
  missing root `prettier` binary, so the touched files were checked with
  one-off `pnpm dlx prettier --check`.
- **Rebase note:** Rebased U12 cleanly onto fresh `origin/main` at
  `60cc2f2e` after PR #1065 merged, then reran `pnpm lint`, `pnpm -r
--if-present typecheck`, `pnpm -r --if-present test`, `pnpm --filter
@thinkwork/computer build`, the legacy-symbol grep, and diff whitespace
  checks; all passed. Build warnings remain the existing shared UI sourcemap,
  dynamic import, and chunk-size warnings.
- **Merged U11:** PR #1064 (`feat(computer): migrate CRM applet fixture`) was
  squash-merged to `main` at
  `ba02bbcd2c8d3b684e7c851b69d87ffc11056732`; remote/local branches and the
  U11 worktree were deleted. CI passed: CLA, lint, test, typecheck, verify.
- **Started U11:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u11-crm-cutover` on branch
  `codex/computer-applets-u11-crm-cutover` from `origin/main` after U10
  merged.
- **Progress:** Migrated the CRM pipeline-risk fixture into a canonical
  agent-style applet source and metadata fixture under
  `apps/computer/src/test/fixtures/crm-pipeline-risk-applet/`. The applet
  imports the generic stdlib primitives (`AppHeader`, `RefreshBar`, `KpiStrip`,
  `BarChart`, `StackedBarChart`, `DataTable`, `SourceStatusList`,
  `EvidenceList`), exports deterministic `refresh()`, and is bounded to a
  `max-w-[1280px]` canvas with no horizontal table scrolling. Added an
  idempotent `scripts/seed-crm-pipeline-risk-applet.ts` dry-run/seed path and
  taught workspace defaults about `save_app`, `load_app`, and `list_apps`.
- **Decision:** The legacy JSON dashboard manifest remains parseable until U12
  deletes the legacy CRM orchestrator and manifest path. It was not marked
  inside the JSON because `parseDashboardManifestV1` forbids additional
  properties and the remaining legacy tests still validate that fixture.
- **Verification note:** `pnpm install --frozen-lockfile`, U11-focused applet
  route/transform/visual tests, package tests/typechecks for `computer`,
  `computer-stdlib`, and `workspace-defaults`, the Computer build, API
  applet-source validation, seed-script dry-run, lint, recursive typecheck,
  and diff whitespace checks passed locally. `pnpm format:check` is still
  blocked by the existing missing root `prettier` binary; a one-off Prettier
  check against the touched files passed.
- **Verification note:** A broad `pnpm -r --if-present test` run had one
  unrelated timeout in
  `packages/api/src/lib/__tests__/plugin-zip-safety.test.ts` during the
  oversized-zip case while the full monorepo test run was under load. The
  failing file passed immediately on focused rerun (`10` tests in under one
  second), and the changed Computer package test suite passed afterward (`38`
  files, `146` tests).
- **Smoke note:** Started the apps/computer dev server from the U11 worktree on
  `http://localhost:5174` using `localhost` for OAuth routing. The logged-in
  browser reached the authenticated app route, but the deployed backend does
  not yet contain the new canonical CRM applet ID, so the canonical CRM applet
  route returned `[GraphQL] Applet artifact not found`. The seed script was
  only dry-run locally because the autopilot contract forbids manual backend
  mutation outside the normal pipeline.
- **Current PR:** #1064 (`feat(computer): migrate CRM applet fixture`).
- **Merged U10:** PR #1062 (`feat(computer): activate applet refresh`) was
  squash-merged to `main` at
  `540ad2bad14461c242939137befa956a8d25d014`; remote/local branches and the
  U10 worktree were deleted.
- **Started U10:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u10-refresh` on branch
  `codex/computer-applets-u10-refresh` from `origin/main` after U9 merged.
- **Progress:** Activated the live applet refresh contract. Applet modules can
  export `refresh()`, the app detail canvas registers it per `(appId,
instanceId)`, the host `useAppletAPI().refresh()` routes to that registered
  handler, and the UI only shows refresh controls when an applet provides the
  export. Refresh results surface per-source success/partial/failed status and
  preserve prior rendered data for thrown refreshes, null data, or all-source
  failures.
- **Verification note:** `pnpm install --frozen-lockfile`, U10-focused
  computer refresh/host/route tests, `pnpm --filter @thinkwork/computer-stdlib
test`, `pnpm --filter @thinkwork/computer-stdlib typecheck`, `pnpm --filter
@thinkwork/computer typecheck`, `pnpm --filter @thinkwork/computer test`,
  `pnpm --filter @thinkwork/computer build`, `git diff --check`, `pnpm lint`,
  `pnpm -r --if-present typecheck`, and `pnpm -r --if-present test` passed
  locally. Build warnings remain the existing shared UI sourcemap/chunk-size
  and host-registry dynamic-import warnings. `pnpm format:check` is blocked by
  the existing missing root `prettier` binary in this workspace.
- **Smoke note:** Started the apps/computer dev server from the U10 worktree on
  `http://localhost:5174` and confirmed the applet route returned HTTP 200.
  The smoke used `localhost` rather than `127.0.0.1` to match the OAuth
  callback hostname requirement.
- **Current PR:** #1062 (`feat(computer): activate applet refresh`).
- **CI:** PR #1062 checks passed: CLA, lint, test, typecheck, verify.
- **Merged U9:** PR #1061 (`feat(computer): activate applet host api`) was
  squash-merged to `main` at
  `b8887161791bb01b171919c7526831a114da8acf`; remote/local branches and the
  U9 worktree were deleted.
- **Started U9:** Created isolated worktree
  `.Codex/worktrees/computer-applets-u9-host-api` on branch
  `codex/computer-applets-u9-host-api` from `origin/main` after U8 merged.
- **Progress:** Activated `appletState` and `saveAppletState` over
  `artifacts` rows of `type = 'applet_state'`, with same-tenant applet access
  checks. Replaced the browser host registry placeholder with a live
  `useAppletAPI` implementation that restores state, debounces saves, scopes
  state by `(appId, instanceId, key)`, surfaces save errors without losing
  in-memory state, and keeps applet queries/mutations behind curated catalogs.
  The applet mount now passes stable per-route `appId` and `instanceId` props
  to generated components.
- **Verification note:** `pnpm install --frozen-lockfile`, U9-focused
  computer host/route tests, applet API resolver tests, `pnpm --filter
@thinkwork/computer typecheck`, `pnpm --filter @thinkwork/api typecheck`,
  `pnpm --filter @thinkwork/computer test`, `pnpm --filter
@thinkwork/computer build`, `pnpm --filter @thinkwork/api test -- applets`,
  `git diff --check`, `pnpm lint`, `pnpm -r --if-present typecheck`, and
  `pnpm -r --if-present test` passed locally. Build warnings remain the
  existing shared UI sourcemap/chunk-size and host-registry dynamic-import
  warnings.
- **Current PR:** #1061 (`feat(computer): activate applet host api`).
- **CI:** PR #1061 checks passed: CLA, lint, test, typecheck, verify.
- **Merged U8:** PR #1060 (`feat(computer): mount live applets`) was
  squash-merged to `main` at
  `b72de07a44558d4ae22f47caffdf15c94b7ed8d7`; remote/local branches and the
  U8 worktree were deleted.
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
