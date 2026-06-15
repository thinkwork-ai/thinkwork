---
issue: THNK-31
title: "refactor: Co-locate application plugin source"
updated: 2026-06-15
dispatcher: dispatcher:THNK-31:ReadyToWork:Codex
project_context: TEI ThinkWork
---

# THNK-31 Autopilot Status

## Current Pass

- Started from fresh `origin/main` at `e468998e7` in branch
  `codex/thnk-31-plugin-contract`.
- Discovery read Linear issue `THNK-31`, Linear document
  `81845c7a-ccb7-40c6-bf38-472bf42ae502`, issue comments, labels, project
  context, and child issues.
- Linear status was `Ready to Work` with labels `Codex` and `Improvement`; no
  child issues were returned.
- Moved Linear THNK-31 to `In Progress` when implementation began, preserving
  routing metadata.
- Project framing for status evidence is `TEI ThinkWork` under the broader
  Texas Enterprises projects area, per Eric's correction.

## Implementation Progress

- U1/U2 first slice in progress:
  - Added `plugins/*` to the pnpm workspace.
  - Added `FirstPartyPluginPackage` validation in
    `packages/plugin-catalog/src/plugin-package.ts`.
  - Created `plugins/plane/` as the first root plugin package.
  - Moved the Plane catalog manifest source to `plugins/plane/src/manifest.ts`.
  - Kept `packages/plugin-catalog/src/plugins/plane/manifest.ts` as a validated
    compatibility wrapper.
  - Updated the catalog manifest aggregate to consume root plugin packages plus
    a temporary legacy migration list for Company Brain, LastMile, and Twenty.
  - Added the missing repo brainstorm and plan documents referenced by Linear.
- PR #2522 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2522`
- Initial implementation commit:
  `24cf19860 feat(plugins): add first-party plugin package contract`

## Merged PRs

- #2522 `feat(plugins): add first-party plugin package contract` merged into
  `main` as `e6fbbfa4d08050d83b326f85f71ecc6454de1b82`.
- #2524 `refactor(plugins): move Plane smoke scripts into plugin package`
  merged into `main` as `defd784dc2d49ef9412638a865fe25778a428c37`.
- #2526 `refactor(plugins): move Twenty and Company Brain manifests` merged
  into `main` as `ab297af54197daa85d94ea96ff37b6d7f8521297`.

## Current Plane Package Slice

- Started from fresh `origin/main` at `e6fbbfa4d` in branch
  `codex/thnk-31-plane-package`.
- Moving Plane-owned smoke scripts into `plugins/plane/smoke/`.
- Updating deployment-runner and release manifest smoke contract paths to point
  at the plugin-owned smoke scripts.
- PR #2524 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2524`

### Verification

- `node --check plugins/plane/smoke/plane-managed-app-smoke.mjs && node --check plugins/plane/smoke/plane-mcp-smoke.mjs`
- `COMPUTER_ENV_FILE=none node plugins/plane/smoke/plane-managed-app-smoke.mjs && COMPUTER_ENV_FILE=none node plugins/plane/smoke/plane-mcp-smoke.mjs`
- `pnpm --filter @thinkwork/deployment-runner test`
- `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`
- `pnpm --filter @thinkwork/release-manifest test`
- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-plane typecheck`

## Current Twenty / Company Brain Package Slice

- Started from fresh `origin/main` at `defd784dc` in branch
  `codex/thnk-31-twenty-brain-packages`.
- Moving Twenty and Company Brain catalog manifests into
  `plugins/twenty/` and `plugins/company-brain/`.
- Keeping validated compatibility wrappers under
  `packages/plugin-catalog/src/plugins/{twenty,company-brain}/manifest.ts`.
- Shrinking the catalog legacy migration list to LastMile only.
- PR #2526 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2526`

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test && pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/plugin-company-brain test && pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/twenty-manifest-parity.test.ts src/lib/plugins/plane-manifest-parity.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

## Current LastMile Package Slice

- Started from fresh `origin/main` at `ab297af54` in branch
  `codex/thnk-31-lastmile-package`.
- Moving LastMile catalog manifest and recorded OAuth discovery fixture into
  `plugins/lastmile/`.
- Keeping validated/re-export compatibility wrappers under
  `packages/plugin-catalog/src/plugins/lastmile/`.
- Emptying the catalog legacy migration list now that every first-party catalog
  manifest is owned by a root plugin package.

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-lastmile test && pnpm --filter @thinkwork/plugin-lastmile typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/catalog-source.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

## Verification Notes

- `pnpm install --lockfile-only` completed after adding `plugins/*` and
  `@thinkwork/plugin-plane`.
- `pnpm install` completed enough for targeted workspace scripts; local
  `canvas@2.11.2` could not build under Node 25 because `pkg-config` is missing,
  but this package is unrelated to the targeted plugin-catalog checks.
- Targeted checks passed:
  - `pnpm --filter @thinkwork/plugin-catalog test`
  - `pnpm --filter @thinkwork/plugin-catalog typecheck`
  - `pnpm --filter @thinkwork/plugin-plane test`
  - `pnpm --filter @thinkwork/plugin-plane typecheck`
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/catalog-source.test.ts src/lib/plugins/plane-manifest-parity.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
- CI rebound:
  - PR #2522 initially failed `Test` because `@thinkwork/plugin-plane` had a
    package `test` script but no package-local test files yet. Updated the
    script to `vitest run --passWithNoTests`; package behavior is covered by the
    catalog tests in this slice.

## Next Steps

- Open and merge the U1/U2 PR after CI passes.
- Continue with Plane full-shape migration in a fresh branch from updated
  `origin/main`.
