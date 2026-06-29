---
date: 2026-06-29
linear: THINK-109
status: in_progress
plan: docs/plans/2026-06-29-002-feat-twenty-client-engagement-app-plan.md
---

# THINK-109 Autopilot Status

## Current State

- Autopilot started on 2026-06-29 from the user-provided attached workflow.
- Linear issue: `THINK-109` "Add Apps surface for Twenty CRM engagement projection".
- Primary plan: `docs/plans/2026-06-29-002-feat-twenty-client-engagement-app-plan.md`.
- Execution mode: one isolated branch/worktree per implementation unit where practical; one PR per unit unless dependencies require a buildable grouping.
- Production/deployed mutation policy: no manual deploys or production mutations from Codex.

## Context Read

- `AGENTS.md` for repository workflow, plugin verification, Linear update, and no-local-only constraints.
- `docs/plans/2026-06-29-002-feat-twenty-client-engagement-app-plan.md`.
- `docs/brainstorms/2026-06-29-twenty-client-engagement-app-requirements.md`.
- `docs/ideation/2026-06-29-apps-surface-twenty-engagement-dashboard-ideation.md`.
- Linear issue `THINK-109`, its comments, attachment, document, statuses, and related issue list.
- Related Linear issue `THINK-33`, its implementation history, key comments, and linked documents:
  - `U0 Verification: Twenty Embedded Application Proof Gate`
  - `Plan: Twenty Server Contract Verification`
  - `Requirements: Twenty-native ThinkWork operating surface`
  - `Twenty-native ThinkWork workflow options`
- Local historical plans and patterns:
  - `docs/plans/2026-06-12-001-feat-application-plugins-plan.md`
  - `docs/plans/2026-06-24-001-feat-company-data-shell-plugin-plan.md`
  - `docs/plans/2026-06-16-001-feat-twenty-native-operating-surface-plan.md`
  - `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  - `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  - `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
  - `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`

## Ground Rules Captured

- Convert the deployed prototype behavior into a real ThinkWork React app; do not iframe or host the raw HTML pages.
- Use the prototype HTML pages as product behavior source material:
  - `client-dashboard.html`
  - `discovery-value-alignment.html`
  - `discovery-presession-brief.html`
  - `discovery-tool-guide.html`
  - `discovery-tool.html`
  - `opportunity-pipeline.html`
- Production CRM data must use the authenticated Twenty plugin backend path, not browser MCP credentials.
- ThinkWork-owned engagement overlay state must persist in app/plugin state, not `localStorage`.
- `Apps` belongs in the main ThinkWork shell and appears only when installed plugin app surfaces exist.
- Settings remains install/configuration; app usage renders in the main content area.
- Twenty-specific frontend source should stay isolated under `apps/web/src/components/plugin-apps/twenty-client-engagement/`.

## Linear State Map

- Current Linear state at start: `Plan Review`.
- Available useful states:
  - `In Progress`
  - `Verification`
  - `Done`
- There is no exact `Review` state; use `Verification` for PR/verification handoff.

## Implementation Units

| Unit                                                | Status  | Branch                                          | PR                                                           | Notes                                                      |
| --------------------------------------------------- | ------- | ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| U1 ui-surface launch contract                       | merged  | `codex/think-109-u1-app-surface-contract`       | [#3107](https://github.com/thinkwork-ai/thinkwork/pull/3107) | Merged at `d7739fb09144b0e3c2ce302fcf42b12e3d6e7f64`.      |
| U2 installed plugin app discovery                   | merged  | `codex/think-109-u2-installed-app-discovery`    | [#3108](https://github.com/thinkwork-ai/thinkwork/pull/3108) | Merged at `f7fdecd5d8a8c9ad6e1bbca8c7eaf540b61871ad`.      |
| U3 shell Apps navigation                            | merged  | `codex/think-109-u3-apps-navigation`            | [#3110](https://github.com/thinkwork-ai/thinkwork/pull/3110) | Merged at `77d0a13794f22864959c368fd89ee7867a68fe44`.      |
| U4 Twenty engagement CRM data API                   | merged  | `codex/think-109-u4-twenty-engagement-api`      | [#3111](https://github.com/thinkwork-ai/thinkwork/pull/3111) | Merged at `b6286b872321e684a9949d196faefd6d91ded752`.      |
| U5 plugin app overlay persistence                   | merged  | `codex/think-109-u5-plugin-app-overlay-state`   | [#3113](https://github.com/thinkwork-ai/thinkwork/pull/3113) | Merged at `65925c1aff56b9d86ff647a62abc000fa28b4ac9`.      |
| U6 prototype characterization                       | merged  | `codex/think-109-u6-prototype-characterization` | [#3114](https://github.com/thinkwork-ai/thinkwork/pull/3114) | Merged at `4739a788fe8725ace41af685b9a91ad9308120ab`.      |
| U7 dashboard/opportunity React conversion           | active  | `codex/think-109-u7-dashboard-react`            |                                                              | Converts dashboard/account/opportunity workspace to React. |
| U8 discovery tools/strategic pipeline conversion    | pending |                                                 |                                                              | Depends on U5, U6, U7.                                     |
| U9 integration/generation/docs/rollout verification | pending |                                                 |                                                              | Final integration unit.                                    |

## Discoveries

- `origin/feat/engagement-dashboard` prototype files were previously verified to match the deployed Vercel pages by hash.
- The prototype includes direct browser MCP calls and credential material; those must not be ported.
- The prototype's local overlay buckets map to company, opportunity, and app-level overlay sections.
- Prior `THINK-33` work is adjacent but not the same surface: it focused on CRM-origin launch/status proof, while this issue builds a ThinkWork-origin application projection over CRM records.

## Activity Log

- 2026-06-29: Read primary plan, local requirements/ideation docs, Linear issue context, related `THINK-33` context, and repository guidance.
- 2026-06-29: Created this autopilot tracker before beginning implementation branches.
- 2026-06-29: Started U1 on branch `codex/think-109-u1-app-surface-contract`.
- 2026-06-29: Completed U1 local implementation. Verification: `pnpm --filter @thinkwork/plugin-catalog test -- contracts.test.ts plugin-registry.test.ts build-catalog.test.ts`; `pnpm --filter @thinkwork/plugin-twenty test -- manifest.test.ts`; `pnpm --filter @thinkwork/plugin-catalog typecheck`; `pnpm --filter @thinkwork/plugin-twenty typecheck`.
- 2026-06-29: Opened U1 draft PR [#3107](https://github.com/thinkwork-ai/thinkwork/pull/3107).
- 2026-06-29: U1 PR [#3107](https://github.com/thinkwork-ai/thinkwork/pull/3107) passed CI and merged at `d7739fb09144b0e3c2ce302fcf42b12e3d6e7f64`.
- 2026-06-29: Started U2 on branch `codex/think-109-u2-installed-app-discovery`.
- 2026-06-29: Completed U2 local implementation. Verification: `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugin-apps/installedPluginApps.query.test.ts src/__tests__/graphql-contract.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/web typecheck`; `pnpm --filter thinkwork-cli typecheck`. Codegen refreshed for `apps/web`, `apps/mobile`, and `apps/cli`.
- 2026-06-29: Opened U2 draft PR [#3108](https://github.com/thinkwork-ai/thinkwork/pull/3108).
- 2026-06-29: U2 PR [#3108](https://github.com/thinkwork-ai/thinkwork/pull/3108) passed CI and merged at `f7fdecd5d8a8c9ad6e1bbca8c7eaf540b61871ad`.
- 2026-06-29: Started U3 on branch `codex/think-109-u3-apps-navigation`.
- 2026-06-29: Completed U3 local implementation. Verification: `pnpm --filter @thinkwork/web test -- src/components/shell/ChatSidebar.test.tsx src/components/apps/PluginAppRoute.test.tsx`; `pnpm --filter @thinkwork/web build`; `pnpm --filter @thinkwork/web typecheck`.
- 2026-06-29: Opened U3 draft PR [#3110](https://github.com/thinkwork-ai/thinkwork/pull/3110).
- 2026-06-29: U3 PR [#3110](https://github.com/thinkwork-ai/thinkwork/pull/3110) passed CI and merged at `77d0a13794f22864959c368fd89ee7867a68fe44`.
- 2026-06-29: Started U4 on branch `codex/think-109-u4-twenty-engagement-api`.
- 2026-06-29: Completed U4 local implementation. Added `twentyEngagementDashboard`, `updateTwentyEngagementOpportunityStage`, and `updateTwentyEngagementOpportunityLayerStatus` GraphQL operations backed by the authenticated Twenty plugin MCP path. Verification: `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugin-apps/twenty-client-engagement.test.ts src/__tests__/graphql-contract.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/web typecheck`; `pnpm --filter thinkwork-cli typecheck`; `pnpm schema:build`; codegen refreshed for `apps/web`, `apps/mobile`, and `apps/cli`; targeted Prettier check passed for touched hand-edited files and generated CLI/mobile files. `@thinkwork/mobile` has no `typecheck` script.
- 2026-06-29: Opened U4 draft PR [#3111](https://github.com/thinkwork-ai/thinkwork/pull/3111).
- 2026-06-29: U4 PR [#3111](https://github.com/thinkwork-ai/thinkwork/pull/3111) passed CI after rebase and merged at `b6286b872321e684a9949d196faefd6d91ded752`.
- 2026-06-29: Started U5 on branch `codex/think-109-u5-plugin-app-overlay-state`.
- 2026-06-29: Completed U5 local implementation. Added generic `plugin_app_overlays` persistence, GraphQL query/mutation resolvers, generated client types/operations, and tests for tenant-shared app overlay behavior. Verification: `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugin-apps/pluginAppOverlays.test.ts src/__tests__/graphql-contract.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/database-pg typecheck`; `pnpm --filter @thinkwork/web typecheck`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter @thinkwork/mobile typecheck` (no script); `pnpm lint:plugin-source`; `pnpm schema:build`; codegen refreshed for `apps/web`, `apps/mobile`, and `apps/cli`; targeted Prettier check passed for touched hand-edited files and generated CLI/mobile files.
- 2026-06-29: Opened U5 draft PR [#3113](https://github.com/thinkwork-ai/thinkwork/pull/3113).
- 2026-06-29: U5 PR [#3113](https://github.com/thinkwork-ai/thinkwork/pull/3113) passed CI after applying the scoped dev migration and merged at `65925c1aff56b9d86ff647a62abc000fa28b4ac9`.
- 2026-06-29: Started U6 on branch `codex/think-109-u6-prototype-characterization`.
- 2026-06-29: Completed U6 local implementation. Added typed fixtures and characterization tests for the six prototype pages, stage and layer vocabularies, disabled SOW action behavior, opportunity tab unlock rules, seed record ids, and legacy `localStorage` overlay bucket mappings. Verification: `pnpm --filter @thinkwork/web test -- src/components/plugin-apps/twenty-client-engagement/prototype-behavior.test.ts`; `pnpm --filter @thinkwork/web typecheck`; targeted Prettier check passed for the new Twenty client engagement fixture/test files.
- 2026-06-29: Opened U6 draft PR [#3114](https://github.com/thinkwork-ai/thinkwork/pull/3114).
- 2026-06-29: U6 PR [#3114](https://github.com/thinkwork-ai/thinkwork/pull/3114) passed CI after rebase and merged at `4739a788fe8725ace41af685b9a91ad9308120ab`.
- 2026-06-29: Started U7 on branch `codex/think-109-u7-dashboard-react`. Objective: convert the main dashboard, account profile, opportunity list/detail, stage guidance, layer cards, and overlay-backed secondary tabs into a ThinkWork React app that launches from the Twenty app surface.
- 2026-06-29: Completed U7 local implementation. Added the `TwentyClientEngagementApp` React workspace, account sidebar/profile, opportunity list/detail, layer cards, secondary tabs, and `useTwentyEngagementData` hook backed by `twentyEngagementDashboard`, CRM mutation, and plugin overlay GraphQL operations. Verification: `pnpm --filter @thinkwork/web test -- src/components/apps/PluginAppRoute.test.tsx src/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp.test.tsx src/components/plugin-apps/twenty-client-engagement/prototype-behavior.test.ts`; `pnpm --filter @thinkwork/web typecheck`; `pnpm lint:plugin-source`; `pnpm --filter @thinkwork/web build`.
