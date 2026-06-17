---
issue: THNK-31
title: "refactor: Co-locate application plugin source"
updated: 2026-06-17
dispatcher: dispatcher:THNK-31:InProgress:Codex
project_context: TEI ThinkWork
---

# THNK-31 Autopilot Status

## Current Canonical Plugin Specification Slice

- Started from fresh `origin/main` at
  `ccc598c02d0a366f1448be5463e1d5d041d4f79d` in branch
  `codex/thnk-31-plugin-source-colocation`.
- Re-read Linear issue `THNK-31`, Linear document
  `81845c7a-ccb7-40c6-bf38-472bf42ae502`, issue comments, labels, returned
  relations, repo brainstorm, repo plan, and PR #2553 merge evidence before
  implementation.
- Moved Linear THNK-31 from `Ready to Work` to `In Progress` when this
  implementation pass began, preserving Codex/Human routing metadata.
- Added the canonical `plugins/README.md` package specification for TEI
  ThinkWork plugin ownership.
- Extended `FirstPartyPluginPackage` with machine-readable owned source
  descriptors and compatibility links.
- Populated Plane, Twenty, Company Brain, and LastMile package descriptors and
  READMEs with current owned source and remaining migration debt.
- PR #2555 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2555`
- PR #2555 merged into `main` as
  `203a8042934ceb837d22792b29a7ac5bfe6a87ce`.

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-plane typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/plugin-company-brain test`
- `pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/plugin-lastmile test`
- `pnpm --filter @thinkwork/plugin-lastmile typecheck`
- `node scripts/verify-plugin-source-boundary.mjs`
- `git diff --check`
- Formatting: `pnpm dlx prettier@3.8.2 --write ...` on touched files because
  the root `prettier` binary is not installed as a workspace dependency.

## Current Generated Catalog Registry Slice

- Started from fresh `origin/main` at
  `67260f686a886e4f2e7d149d7a9b762656ea858e` in branch
  `codex/thnk-31-generated-plugin-registry`.
- Replaced the hand-maintained first-party registry body in
  `packages/plugin-catalog/src/plugins/index.ts` with a generic re-export from
  generated aggregate source.
- Added `packages/plugin-catalog/scripts/generate-plugin-registry.ts` to
  discover first-party plugin packages from root `plugins/*/package.json` and
  render deterministic static imports for bundling/typechecking.
- Added checked-in `generated-first-party.ts` and stale-registry coverage so
  package discovery remains the source of truth.
- Wired `generate:plugins`, `check:plugins`, and catalog build freshness checks
  into `@thinkwork/plugin-catalog`.
- PR #2557 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2557`
- PR #2557 merged into `main` as
  `8d81914e36c8f9209a8726b922b5e0c7db56e36d`.

### Verification

- `pnpm --filter @thinkwork/plugin-catalog check:plugins`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `node scripts/verify-plugin-source-boundary.mjs`
- `git diff --check`
- Formatting: `pnpm dlx prettier@3.8.2 --write ...` on touched files.

## Current Managed-App Adapter Ownership Slice

- Started from fresh `origin/main` at
  `2f900027bc1ac6842c47a223b9804e19c33e02c4` in branch
  `codex/thnk-31-plugin-managed-app-adapters`.
- Moved Plane, Twenty, and Company Brain internal substrate managed-app adapter
  source from `packages/deployment-runner/src/apps/` into owning plugin
  packages.
- Updated the generic deployment-runner registry to import plugin-owned adapter
  exports while keeping shared planning, apply, and utility code in
  `@thinkwork/deployment-runner`.
- Added explicit plugin package adapter exports and dependency metadata.
- Removed the three deployment-runner adapter paths from the source-boundary
  migration allowlist. The guard now reports 33 migration paths, down from 36.
- PR #2560 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2560`
- PR #2560 merged into `main` as
  `d9296ad7248246c7d1fea2ea832e01cda60177aa`.

### Verification

- `pnpm install --lockfile-only`
- `pnpm install --ignore-scripts`
- `pnpm --filter @thinkwork/deployment-runner test`
- `pnpm --filter @thinkwork/deployment-runner typecheck`
- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-plane typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/plugin-company-brain test`
- `pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `node scripts/verify-plugin-source-boundary.mjs`
- `git diff --check`

## Current Terraform and Runtime Source Ownership Slice

- Started from fresh `origin/main` at
  `43565f1ca065f8fa78173165499afc86c7769169` in branch
  `codex/thnk-31-plugin-terraform-runtime`.
- Moved Plane, Twenty, and Company Brain/Cognee Terraform modules from
  `terraform/modules/app/` into owning plugin packages:
  `plugins/plane/terraform/plane`,
  `plugins/twenty/terraform/twenty`, and
  `plugins/company-brain/terraform/cognee`.
- Moved the Company Brain internal substrate runtime image source from
  `packages/cognee/Dockerfile` to
  `plugins/company-brain/runtime/cognee/Dockerfile`.
- Updated managed-app adapters, `terraform/modules/thinkwork`, deploy/release
  workflows, CLI Terraform fixtures, plugin package metadata, plugin READMEs,
  and the CLI Terraform bundler/init scaffold to use plugin-owned source paths.
- Removed the Terraform/runtime entries from the source-boundary migration
  allowlist. The guard now reports 20 migration paths, down from 33.
- PR #2562 merged into `main` as
  `4aad79f00db0a61f7675f7e220b4ee5d9a404906`.

### Verification

- `terraform fmt -recursive plugins/plane/terraform plugins/twenty/terraform plugins/company-brain/terraform terraform/modules/thinkwork`
- `pnpm dlx prettier@3.8.2 --write ...` on touched JS/TS/Markdown/YAML files.
- `node scripts/verify-plugin-source-boundary.mjs`
- `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts __tests__/terraform-plane-fixture.test.ts __tests__/terraform-twenty-fixture.test.ts`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `terraform -chdir=plugins/plane/terraform/plane init -backend=false && terraform -chdir=plugins/plane/terraform/plane validate`
- `terraform -chdir=plugins/twenty/terraform/twenty init -backend=false && terraform -chdir=plugins/twenty/terraform/twenty validate`
- `terraform -chdir=plugins/company-brain/terraform/cognee init -backend=false && terraform -chdir=plugins/company-brain/terraform/cognee validate`
- `terraform -chdir=terraform/examples/greenfield init -backend=false && terraform -chdir=terraform/examples/greenfield validate`
- `pnpm --filter @thinkwork/plugin-plane typecheck`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter thinkwork-cli typecheck`
- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-company-brain test`
- `pnpm --filter @thinkwork/deployment-runner test`
- `pnpm --filter @thinkwork/deployment-runner typecheck`
- `pnpm --filter thinkwork-cli build`
- `git diff --check`

`terraform -chdir=terraform/modules/thinkwork init -backend=false` resolved the
new plugin module sources, but direct child-module `validate` still requires the
root module's `aws.us_east_1` provider alias. The greenfield root validation
above supplies that alias and passed.

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
- #2527 `refactor(plugins): move LastMile manifest package` merged into `main`
  as `56b6947157e8be462701fade77f58e7f7b252ed2`.
- #2528 `docs(plugins): update plugin builder package workflow` merged into
  `main` as `44a7e75aa27bb95a2676d583cd2b18b00f2f11d6`.
- #2529 `test(plugins): enforce plugin source boundary` merged into `main` as
  `1199f741ff8107d78bb1d659ac8c954495c6446a`.
- #2530 `refactor(plugins): remove catalog compatibility wrappers` merged into
  `main` as `7106af539b43f3a91d816878babc87a6958fabfa`.
- #2531 `refactor(plugins): move plugin smoke scripts into packages` merged
  into `main` as `db405051a6555a675c214f5bb67340dcba871c2d`.
- #2532 `test(plugins): move catalog parity tests into packages` merged into
  `main` as `cd3725d5f888be73a575d934c191d06ab82a882e`.
- #2534 `test(plugins): move API manifest parity into packages` merged into
  `main` as `39ee24f01657e7b1be4a9ac0ef324da5cf74d8ab`.

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
- PR #2527 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2527`

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-lastmile test && pnpm --filter @thinkwork/plugin-lastmile typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/catalog-source.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

## Current Plugin Builder Docs Slice

- Started from fresh `origin/main` at `56b694715` in branch
  `codex/thnk-31-plugin-builder-docs`.
- Updating the ThinkWork plugin-builder workflow to produce root
  `plugins/<plugin-key>/` packages instead of legacy catalog plugin folders.
- Updating authoring templates, scanner enforcement, publication references,
  and docs-site guidance for the TEI ThinkWork plugin package boundary.
- PR #2528 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2528`

### Verification

- `node --test .agents/skills/thinkwork-plugin-builder/tests/plugin-builder-skill.test.mjs`
- `node .agents/skills/thinkwork-plugin-builder/scripts/scan-plugin-builder-output.mjs <fixture>`

## Current Repository Enforcement Slice

- Started from fresh `origin/main` at `44a7e75aa` in branch
  `codex/thnk-31-plugin-source-enforcement`.
- Adding a repository guard that fails when first-party plugin-key source paths
  appear outside the owning `plugins/<plugin-key>/` folder unless documented in
  `scripts/plugin-source-boundary-allowlist.mjs`.
- Wiring the guard into root lint and adding focused node tests for allowed
  plugin packages, misplaced source, shared false positives, documented
  migration paths, and stale allowlist entries.
- PR #2529 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2529`

### Verification

- `node scripts/verify-plugin-source-boundary.mjs`
- `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`

## Current Catalog Wrapper Removal Slice

- Started from fresh `origin/main` at `1199f741f` in branch
  `codex/thnk-31-remove-catalog-wrappers`.
- Removing the legacy `packages/plugin-catalog/src/plugins/<plugin-key>/`
  manifest/discovery compatibility wrappers now that all first-party catalog
  source is owned by root plugin packages.
- Updating the LastMile discovery drift test to import the fixture directly
  from `@thinkwork/plugin-lastmile`.
- Shrinking the plugin source boundary allowlist by removing wrapper entries.
- PR #2530 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2530`

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`

## Current Plugin Smoke Package Slice

- Started from fresh `origin/main` at `7106af539` in branch
  `codex/thnk-31-plugin-smoke-packages`.
- Moving LastMile, Twenty, and Company Brain/Cognee smoke scripts from the
  shared smoke kit into owning `plugins/<plugin-key>/smoke/` folders.
- Updating deployment-runner, release-manifest, smoke README, docs, and runbook
  references to use plugin-owned smoke command paths.
- Teaching the plugin source boundary guard that Cognee substrate source under
  `plugins/company-brain/` is owned by the Company Brain plugin.
- PR #2531 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2531`

### Verification

- `node --check` on moved plugin smoke scripts
- Dry-run execution for moved plugin smoke scripts
- `pnpm --filter @thinkwork/deployment-runner test`
- `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`
- `pnpm --filter @thinkwork/release-manifest test`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`

## Current Plugin Catalog Test Package Slice

- Started from fresh `origin/main` at `db405051a` in branch
  `codex/thnk-31-plugin-catalog-tests`.
- Moving plugin-specific catalog manifest/discovery tests into owning
  `plugins/<plugin-key>/test/` folders.
- Keeping catalog registration coverage in `@thinkwork/plugin-catalog` so
  package-local tests validate their own plugin contracts while the shared
  catalog remains the aggregate authority.
- Shrinking the plugin source boundary allowlist by removing the package-local
  parity test entries.
- PR #2532 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2532`
- PR #2532 merged into `main` as
  `cd3725d5f888be73a575d934c191d06ab82a882e`.

### Verification

- `pnpm --filter @thinkwork/plugin-company-brain test`
- `pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/plugin-lastmile test`
- `pnpm --filter @thinkwork/plugin-lastmile typecheck`
- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-plane typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`

## Current API Manifest Parity Test Package Slice

- Started from fresh `origin/main` at `b9e86176a` in branch
  `codex/thnk-31-api-parity-tests`.
- Moving Plane and Twenty manifest-to-deployment-runner parity assertions from
  API plugin-named tests into the owning plugin packages.
- Keeping API infrastructure handler coverage generic by asserting every catalog
  infrastructure component resolves through the managed-app adapter registry.
- Shrinking the plugin source boundary allowlist by removing the Plane and
  Twenty API manifest parity test entries.
- PR #2534 opened for this slice:
  `https://github.com/thinkwork-ai/thinkwork/pull/2534`
- PR #2534 merged into `main` as
  `39ee24f01657e7b1be4a9ac0ef324da5cf74d8ab`.

### Verification

- `pnpm --filter @thinkwork/plugin-plane test`
- `pnpm --filter @thinkwork/plugin-plane typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/plugins/handlers/infra-adapter-registry.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`

## Current LastMile API Package Slice

- Started from fresh `origin/main` at `db0fcbd31` in branch
  `codex/thnk-31-plugin-skill-mcp-content`.
- Moving the LastMile task adapter and its package-local tests from
  `packages/api/src/lib/lastmile/` into `plugins/lastmile/src/api/` and
  `plugins/lastmile/test/api/`.
- Exporting the adapter through `@thinkwork/plugin-lastmile/tasks-adapter` so
  shared API onboarding and linked-task flows consume plugin-owned source.
- Removing the LastMile adapter entries from the source-boundary migration
  allowlist; the guard now reports 18 migration paths and 2 shared paths.
- PR #2564 merged into `main` as
  `36ab33924e89cbe1725da0d3eccf4b8394d898b2`.

### Verification

- `pnpm --filter @thinkwork/plugin-lastmile test`
- `pnpm --filter @thinkwork/plugin-lastmile typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/linked-tasks/refresh-linked-tasks.test.ts src/lib/spaces/customer-onboarding-workflow.test.ts`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`
- `git diff --check`

## Current API Runtime Helper Package Slice

- Started from fresh `origin/main` at `36ab33924` in branch
  `codex/thnk-31-generic-extension-points`.
- Moving Company Brain migration helpers, context-engine provider, Cognee
  substrate client, and cluster identity helper into `plugins/company-brain`.
- Moving Twenty MCP cutover orchestration into `plugins/twenty`, with the API
  retaining only a generic DB/Secrets Manager/audit dependency adapter under
  `packages/api/src/lib/plugins/cutover/`.
- Updating GraphQL resolvers, knowledge-graph ingest handlers, context provider
  registration, and normalizer types to consume plugin package exports.
- Removing the moved Company Brain/Cognee and Twenty API helper entries from
  the source-boundary migration allowlist; the guard now reports 9 migration
  paths and 2 shared paths.
- PR #2566 merged into `main` as
  `134c829673ef3a1958af65d037b1bbe2bdcddb7c`.

### Verification

- `pnpm --filter @thinkwork/plugin-company-brain test`
- `pnpm --filter @thinkwork/plugin-company-brain typecheck`
- `pnpm --filter @thinkwork/plugin-twenty test`
- `pnpm --filter @thinkwork/plugin-twenty typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/brain/companyBrainMigration.mutation.test.ts src/graphql/resolvers/plugins/plugins-resolvers.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts src/handlers/knowledge-graph-observations-ingest.test.ts src/lib/knowledge-graph/normalizer.test.ts`
- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/api exec vitest run test/integration/context-engine/company-brain-context.e2e.test.ts` (test file collected and skipped by its environment guard)
- `pnpm lint:plugin-source`
- `pnpm test:plugin-source-boundary`
- `git diff --check`

## Current Plugin Authoring Workflow Slice

- Started from fresh `origin/main` at
  `134c829673ef3a1958af65d037b1bbe2bdcddb7c` in branch
  `codex/thnk-31-plugin-authoring-docs`.
- Updating the `thinkwork-plugin-builder` workflow, templates, references, and
  scanner to treat `plugins/<plugin-key>/` as the generated source root.
- Replacing stale instructions to hand-edit
  `packages/plugin-catalog/src/plugins/index.ts` with generated registry
  aggregation through
  `packages/plugin-catalog/scripts/generate-plugin-registry.ts`.
- Extending the builder scanner to block plugin-specific generated files under
  shared API, web, deployment-runner, Terraform, and legacy smoke roots unless
  that work is split into generic platform adapter changes.
- Updating the smoke README table to point at plugin-owned smoke scripts for
  Twenty, LastMile, and Company Brain.

### Verification

- `node --test .agents/skills/thinkwork-plugin-builder/tests/plugin-builder-skill.test.mjs`
- `pnpm dlx prettier@3.8.2 --write ...` on touched skill docs/scripts/tests
  and `scripts/smoke/README.md`.
- `git diff --check`
- `pnpm lint:plugin-source`

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
  - PR #2532 initially failed `Test` and `Typecheck` because package-local tests
    imported the catalog contract through `@thinkwork/plugin-catalog/contracts`
    without declaring the test-only workspace dependency. Added explicit
    devDependencies for the four plugin packages plus the minimal lockfile
    importer entries; rerun CI passed.

## Next Steps

- Continue shrinking the remaining migration allowlist from fresh `origin/main`
  worktrees, one implementation unit per PR.
- Prioritize the next generic extension-point slice with the smallest blast
  radius across API, deployment-runner, web, or Terraform-owned plugin source.
