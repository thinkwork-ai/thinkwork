---
title: "Autopilot status: THINK-113 n8n integrated app"
date: 2026-06-30
issue: THINK-113
plan: docs/plans/2026-06-30-001-feat-n8n-integrated-app-plan.md
status: complete
---

# Autopilot status: THINK-113 n8n integrated app

## Current state

- Linear issue: `THINK-113`, status `In Progress`, priority High, assignee Eric.
- Primary plan: `docs/plans/2026-06-30-001-feat-n8n-integrated-app-plan.md`.
- Origin requirements: `docs/brainstorms/2026-06-30-think-113-n8n-integrated-app-requirements.md`.
- Linear attached document: `Plan: Add n8n integrated app`.
- Child issues: none found. Autopilot will use plan units as implementation units.
- Blocking issue relations: none found.
- Current branch: none; THINK-113 implementation is merged to `main`.

## Context discovery

- The user clarified the earlier brainstorm session should have stayed requirements-only; implementation now proceeds from the reviewed plan under autopilot.
- The n8n plugin package already owns manifest, deployment, Terraform, runtime, web settings, skills, smoke, tests, and docs through `plugins/n8n/src/index.ts`.
- Twenty's native app is the packaging precedent, but its `twenty-sdk` host API is Twenty-specific and cannot be assumed for n8n.
- Existing n8n product constraints remain in force: managed ThinkWork install path, tenant service credential for native n8n MCP, stock HTTP Request plus Wait nodes for the agent-step bridge, redacted telemetry, and no V1 production workflow control actions.
- Relevant durable patterns loaded:
  - plugin source boundaries should be package-owned and deploy-verified;
  - external workflow agent-step bridges need resumable ledgers and redacted evidence;
  - plugin/provider setup surfaces are distinct from catalog visibility and selection surfaces;
  - screen-owned adapters keep table/list display semantics portable.

## Unit order

1. U1: Confirm/scaffold n8n app host and app-to-ThinkWork auth boundary.
2. U4: Simplify the ThinkWork n8n plugin detail to settings-only and add install access.
3. U2: Add read-only app data API for workflows and executions.
4. U3: Build the read-only n8n integrated app tables.
5. U5: Add guarded sync/docs/smoke verification for the integrated app.

U1 stays first because U2 and U3 depend on the host/auth decision. U4 can land independently after U1 because it fixes the current operator-facing plugin surface without depending on app data.

## Gate log

| Time | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 2026-06-30 | Requirements located | Requirements, primary plan, and Linear attached plan document found. | Passed |
| 2026-06-30 | Linear dependency scan | No child issues, blockers, duplicate, attachments, customer needs, or release blockers found. | Passed |
| 2026-06-30 | Repo baseline | Worktree was synced from `origin/main`; only requirements and plan artifacts were untracked before U1. | Passed |
| 2026-06-30 | Implementation started | Linear moved to `In Progress`; kickoff comment posted for U1. | Passed |
| 2026-06-30 | U1 branch created | Created `codex/think-113-u1-n8n-app-host` from `origin/main`. | Passed |
| 2026-06-30 | U1 package verification | `pnpm --filter @thinkwork/plugin-n8n test`; `pnpm --filter @thinkwork/plugin-n8n typecheck`. The typecheck now also runs `tsc -p n8n-app/tsconfig.json --noEmit`. | Passed |
| 2026-06-30 | U1 catalog verification | `pnpm --filter @thinkwork/plugin-catalog test`; `pnpm --filter @thinkwork/plugin-catalog check:plugins`. | Passed |
| 2026-06-30 | U1 source-boundary verification | `pnpm lint:plugin-source`. | Passed |
| 2026-06-30 | U1 review | Testing reviewer found missing `workflow-publish` contract coverage and nested app typecheck gap; correctness reviewer found manifest payload versioning risk. Both were fixed and reverified. Project-standards reviewer found no issues. | Passed |
| 2026-06-30 | Format command check | `pnpm exec prettier --write ...` could not run because the root dependency install does not expose a `prettier` binary. | Blocked |
| 2026-06-30 | U1 PR | Opened PR [#3135](https://github.com/thinkwork-ai/thinkwork/pull/3135), rebased after GitHub required the branch to be up to date, and waited for required checks. | Passed |
| 2026-06-30 | U1 merge | Squash-merged PR #3135 into `main`; remote branch was deleted by the merge flow and the local branch was deleted before starting U4. | Passed |
| 2026-06-30 | U4 branch created | Created `codex/think-113-u4-n8n-settings` from updated `origin/main`. | Passed |
| 2026-06-30 | U4 objective restated | Simplify the n8n plugin detail to settings-only, remove the Workflows tab from the plugin surface, redirect the legacy workflows route, route catalog opens to settings, and add an install action for uninstalled n8n. | Passed |
| 2026-06-30 | U4 web tests | `pnpm --dir apps/web exec vitest run src/components/settings/plugins/n8n/N8nPluginHome.test.tsx src/components/settings/plugins/PluginsPage.test.tsx`. | Passed |
| 2026-06-30 | U4 typecheck | `pnpm --filter @thinkwork/web typecheck`. | Passed |
| 2026-06-30 | U4 PR | Opened and linked PR [#3136](https://github.com/thinkwork-ai/thinkwork/pull/3136). Required checks `cla`, `lint`, `verify`, `test`, `typecheck`, and `Devin Review` passed. | Passed |
| 2026-06-30 | U4 merge | Squash-merged PR #3136 into `main` at `3a9e05112eea550efb8315ff4a17ae22a2f1e7ec`; remote branch was deleted by the merge flow and the local branch was deleted before starting U2. | Passed |
| 2026-06-30 | U2 branch created | Created `codex/think-113-u2-n8n-app-data` from updated `origin/main`. | Passed |
| 2026-06-30 | U2 objective restated | Add a ThinkWork-mediated, read-only n8n app data API for workflow rows, execution rows, native n8n navigation URLs, and redacted bridge linkage using the existing tenant `n8n-api` credential path. | Passed |
| 2026-06-30 | U2 schema/codegen | `pnpm schema:build`; `pnpm --filter ./apps/cli codegen`; `pnpm --filter @thinkwork/web codegen`; `pnpm --filter @thinkwork/mobile codegen`. CLI/mobile generated formatting churn was reverted because U2 does not consume the new query there yet. | Passed |
| 2026-06-30 | U2 API tests | `pnpm --filter @thinkwork/api test -- src/lib/workflows/n8n-discovery.test.ts src/lib/workflows/n8n-executions.test.ts src/graphql/resolvers/plugins/n8n-app-data.test.ts` expanded to the package suite; 617 files and 5655 tests passed. | Passed |
| 2026-06-30 | U2 focused tests | `pnpm --dir packages/api exec vitest run src/lib/workflows/n8n-discovery.test.ts src/lib/workflows/n8n-executions.test.ts src/graphql/resolvers/plugins/n8n-app-data.test.ts`. | Passed |
| 2026-06-30 | U2 typechecks | `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/web typecheck`. | Passed |
| 2026-06-30 | U2 CI lint failure | PR #3138 lint failed on `verify-plugin-source-boundary` because the new shared n8n app-data resolver paths were not documented in `scripts/plugin-source-boundary-allowlist.mjs`. Added explicit allowlist entries. | Fixed |
| 2026-06-30 | U2 source-boundary verification | `pnpm lint:plugin-source`. | Passed |
| 2026-06-30 | U2 merge | PR #3138 required a rebase onto current `main`, then passed required checks and was squash-merged at `ab4970dda3a138d46f5548eb9b6bbd66ed40e2c4`. | Passed |
| 2026-06-30 | U3 branch created | Created `codex/think-113-u3-n8n-app-tables` from updated `origin/main` at `ab4970dda`. | Passed |
| 2026-06-30 | U3 objective restated | Add the read-only native n8n app tables, search/filter/refresh behavior, empty/error states, native n8n drill-in links, and ThinkWork bridge links. | Passed |
| 2026-06-30 | U3 package tests | `pnpm --filter @thinkwork/plugin-n8n test`. | Passed |
| 2026-06-30 | U3 route tests | `pnpm --dir apps/web exec vitest run src/components/apps/PluginAppRoute.test.tsx`. | Passed |
| 2026-06-30 | U3 typechecks | `pnpm --filter @thinkwork/plugin-n8n typecheck`; `pnpm --filter @thinkwork/web typecheck`. | Passed |
| 2026-06-30 | U3 source-boundary verification | `pnpm lint:plugin-source`; added the narrow shared web-host adapter allowlist entry for the n8n app. | Passed |
| 2026-06-30 | U3 local dev server | Started `pnpm --filter @thinkwork/web dev -- --host 0.0.0.0 --port 5174`; fresh browser context loaded `/apps/n8n/workflows`, redirected to sign-in, and reported no page errors. | Passed |
| 2026-06-30 | U3 production web build | `pnpm --filter @thinkwork/web build`; existing route-test/sourcemap/chunk-size warnings only. | Passed |
| 2026-06-30 | U3 Devin feedback | Devin flagged a duration rollover edge case. Fixed `formatDuration(119500)` to render `1m 59s`, added coverage, replied, and resolved the review thread. | Passed |
| 2026-06-30 | U3 merge | PR #3141 passed required checks and was squash-merged into `main` at `d1f1cf4285b5bd617c866cbfb155b3b23259b7e0`. | Passed |
| 2026-06-30 | U5 branch created | Created `codex/think-113-u5-n8n-app-smoke` from updated `origin/main`. | Passed |
| 2026-06-30 | U5 objective restated | Add guarded sync/docs/smoke verification for the native n8n installed app and make the n8n install/update path discoverable from the n8n settings page. | Passed |
| 2026-06-30 | U5 install/update fix | Added n8n settings-page install/update affordances, an operator catalog refresh row, and a legacy pinned-install compatibility projection so installed n8n tenants can see `/apps/n8n/workflows` without mutating the historical `0.1.0` manifest. | Passed |
| 2026-06-30 | U5 script/docs guardrails | Added `plugins/n8n/scripts/sync-thinkwork-app.mjs`, `plugins/n8n/smoke/n8n-integrated-app-smoke.mjs`, the native-app install runbook, and docs updates. Dry-run mode is default and reports non-mutating prerequisites. | Passed |
| 2026-06-30 | U5 tests | `pnpm --filter @thinkwork/plugin-n8n test`; `npx vitest run src/graphql/resolvers/plugin-apps/installedPluginApps.query.test.ts`; `npx vitest run src/components/settings/plugins/n8n/N8nPluginHome.test.tsx src/components/apps/PluginAppRoute.test.tsx`. | Passed |
| 2026-06-30 | U5 typechecks/source-boundary | `pnpm --filter @thinkwork/plugin-n8n typecheck`; `pnpm --filter @thinkwork/web typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm lint:plugin-source`. | Passed |
| 2026-06-30 | U5 browser verification | Worktree server on `5174` shows Settings -> Plugins -> n8n with `Update available`, `Install update`, `Plugin catalog`, and `Refresh catalog` for installed `v0.1.0 -> v0.2.0`. `/apps` still shows deployed-API behavior until the local resolver change is deployed. Port `5180` is served by a different worktree (`c64d`). | Passed |
| 2026-06-30 | U5 managed app plan dialog fix | Addressed install approval confusion by polling `managedApplicationDeployment(jobId)` while the deployment plan dialog is open, showing an explicit preparing-plan state, and enabling deploy approval once the backend reaches `awaiting_approval`. | Passed |
| 2026-06-30 | U5 native app visibility fix | Added compatibility projection so existing installed n8n tenants expose the native n8n app surface in `/apps` after the resolver deploy, without mutating legacy pinned plugin manifests. | Passed |
| 2026-06-30 | U5 n8n app UI feedback | Removed workflow ID / last-seen columns, removed the app title area, matched the Twenty-style breadcrumb/action header, moved Workflows/Executions switching into the breadcrumb dropdown, replaced the custom filter select with Bessa `DataTableTokenFilter`, restored bordered search inputs, and simplified the executions table to workflow name, status, mode, compact started time, and duration. | Passed |
| 2026-06-30 | U5 final local verification | `corepack pnpm --filter @thinkwork/plugin-n8n typecheck`; `corepack pnpm --filter @thinkwork/web typecheck`; `corepack pnpm lint:plugin-source`; `npx vitest run src/components/apps/PluginAppRoute.test.tsx`; browser-verified `/apps/n8n/workflows` on port `5174`. | Passed |
| 2026-06-30 | U5 PR merge | PR [#3145](https://github.com/thinkwork-ai/thinkwork/pull/3145) passed CLA, lint, plugin catalog, supply-chain verify, test, typecheck, and Devin Review, then squash-merged into `main` at `3a589065dc92c102f353c08028ab55245bbd151c`. | Passed |
| 2026-06-30 | U5 cleanup | Remote branch `codex/think-113-u5-n8n-app-smoke` was deleted by the merge flow; local worktree `/Users/ericodom/.codex/worktrees/fffa/thinkwork` and the local branch were removed. | Passed |

## Final state

THINK-113 is complete. The n8n plugin settings surface is settings-only with clear install/update access, the installed native n8n app is discoverable from `/apps`, workflow and execution data are exposed through a ThinkWork-mediated read-only API, the native app tables follow the shared Bessa/Work Items interaction patterns, guarded sync/smoke tooling is documented, and PR #3145 merged the final U5 work into `main`.
