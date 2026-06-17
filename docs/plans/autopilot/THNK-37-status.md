---
issue: THNK-37
title: "feat: GitHub-backed plugin catalog"
updated: 2026-06-17
dispatcher: dispatcher:THNK-37:InProgress:Codex
project_context: ThinkWork / Enterprise Agent OS
---

# THNK-37 Autopilot Status

## Current U1 Catalog Provenance Slice

- Started from fresh `origin/main` at
  `070f58e845e8a2f778c91843f2d30d0fdd50fced` in branch
  `codex/thnk-37-u1-catalog-provenance`.
- Read the merged plan artifact
  `docs/plans/2026-06-17-002-feat-github-backed-plugin-catalog-plan.md`,
  Linear issue `THNK-37`, issue comments, labels/statuses, attachments,
  returned relations, and the plugin source-boundary solution note before
  implementation.
- Moved Linear THNK-37 from `Ready to Work` to `In Progress` when
  implementation began, preserving the `Codex` routing label.
- Added optional signed catalog source provenance:
  `repository`, `ref`, and `commitSha`.
- Kept provenance optional so bundled fallback catalogs remain valid while the
  GitHub-hosted signed artifact can carry source metadata.
- Extended catalog build plumbing so publishers can pass source provenance
  explicitly or inherit it from GitHub Actions environment variables.
- Added tests proving source provenance verifies, invalid provenance is
  rejected, and tampered provenance covered by the signature fails closed.

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test` passed.
- `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- `git diff --check` passed.
- Formatting: `pnpm dlx prettier --write ...` on touched files because the
  root `prettier` binary is not installed as a workspace dependency.

## Current U2 Catalog Release Channel Slice

- Started from fresh `origin/main` at
  `245dafc5d0fcbcf4c1a3818eecced3d0ee59062f` in branch
  `codex/thnk-37-u2-catalog-release`.
- Added `.github/workflows/plugin-catalog.yml` to validate signed catalog
  builds on PRs and publish the main-channel signed catalog asset on qualifying
  `main` pushes.
- The workflow validates the generated plugin registry, catalog package tests,
  package typecheck, ephemeral-key signing, and signature verification before
  publication.
- The publish job uses the repository secret `PLUGIN_CATALOG_SIGNING_KEY`,
  targets the stable release tag `plugin-catalog-main`, and uploads
  `thinkwork-plugin-catalog-main.json` with source provenance stamped from the
  GitHub event.
- Added docs in `plugins/README.md` for the authored source boundary, stable
  release asset, signing secret, docs-only skip behavior, and GraphQL/API
  runtime trust boundary.

### Verification

- Ephemeral ed25519 signed catalog build and verification passed using the same
  `build:catalog` and `verifyPluginCatalog` path as the workflow.
- `pnpm --filter @thinkwork/plugin-catalog test` passed.
- `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/plugin-catalog.yml")'`
  passed.
- `git diff --check` passed.

## Current U3 API GitHub Catalog Source Slice

- Started from fresh `origin/main` at
  `490852d1b54740adf212d5584210729992dd1c49` in branch
  `codex/thnk-37-u3-api-catalog-github`.
- Added `packages/api/src/lib/plugins/catalog-github-source.ts` as the
  GitHub release-asset loader for signed plugin catalogs.
- The loader fetches the stable release metadata with GitHub API headers,
  optional bearer auth, conditional ETag requests, a warm-container TTL cache,
  and rate-limit metadata capture.
- Remote documents are verified with the trusted ed25519 public key before
  becoming cache snapshots. Bad signatures, malformed documents, missing
  assets, and GitHub/rate-limit failures do not overwrite the last verified
  snapshot.
- Integrated the loader into `catalog-source.ts` behind opt-in GitHub catalog
  configuration while preserving bundled signed and unsigned fallback behavior.
- Added tests for remote success, TTL cache, 304 not modified, stale fallback
  on transient/rate-limit failures, bad signature rejection without cache,
  malformed remote data preserving the last good cache, missing asset errors,
  env config gating, and `getPluginCatalogSnapshot` integration.

### Verification

- `pnpm --filter @thinkwork/api test -- src/lib/plugins/catalog-source.test.ts src/lib/plugins/catalog-github-source.test.ts`
  passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `git diff --check` passed.

## Current U4 Runtime Configuration And Cache Storage Slice

- Started from fresh `origin/main` at
  `ab82681b331f0c2fdb0aa1416b97aca1763cf7ba` in branch
  `codex/thnk-37-u4-catalog-runtime-config`.
- Moved GitHub catalog runtime settings into the GraphQL API
  runtime-config document instead of Lambda environment variables:
  source mode, repository, release tag, asset name, TTL, User-Agent, S3 cache
  bucket/key, and optional GitHub token secret ARN.
- Kept browser access behind ThinkWork GraphQL: the runtime configuration is
  consumed by the API catalog source, not the web client.
- Added a verified S3 cache for GitHub catalog snapshots. The cache stores the
  signed catalog document plus release metadata, and every cache read
  re-verifies the signed document with the trusted public key before it can be
  served.
- Reused the existing API role workspace-bucket S3 permissions for cache
  storage, and added a narrowly conditional `secretsmanager:GetSecretValue`
  grant for the optional GitHub token secret ARN.
- Exposed the optional token secret variable through the `thinkwork` module and
  greenfield example. Empty keeps unauthenticated GitHub requests.

### Verification

- `pnpm --filter @thinkwork/api test -- src/lib/plugins/catalog-source.test.ts src/lib/plugins/catalog-github-source.test.ts`
  passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm --filter thinkwork-cli test -- terraform-runtime-config-fixture.test.ts`
  passed.
- `terraform fmt` passed on touched Terraform files.
- `git diff --check` passed.
