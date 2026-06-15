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

## Verification Notes

- `pnpm install --lockfile-only` completed after adding `plugins/*` and
  `@thinkwork/plugin-plane`.
- `pnpm install` completed enough for targeted workspace scripts; local
  `canvas@2.11.2` could not build under Node 25 because `pkg-config` is missing,
  but this package is unrelated to the targeted plugin-catalog checks.
- Targeted checks passed:
  - `pnpm --filter @thinkwork/plugin-catalog test`
  - `pnpm --filter @thinkwork/plugin-catalog typecheck`
  - `pnpm --filter @thinkwork/plugin-plane typecheck`
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/catalog-source.test.ts src/lib/plugins/plane-manifest-parity.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`

## Next Steps

- Open and merge the U1/U2 PR after CI passes.
- Continue with Plane full-shape migration in a fresh branch from updated
  `origin/main`.
