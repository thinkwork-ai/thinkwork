# ThinkWork Plugin Packages

`plugins/<plugin-key>/` is the canonical ownership boundary for first-party
ThinkWork application plugin source. A maintainer should be able to open one
plugin package and understand the plugin-specific manifest, skills, deployment
shape, runtime assets, UI surfaces, smoke coverage, tests, and operating notes
without hunting through shared platform packages.

Shared packages still own generic infrastructure: manifest validation, catalog
build/signing, GraphQL transport, install and activation state machines,
deployment-runner orchestration, common web shell code, database schema, and
common test harnesses. Plugin packages own the product-specific source that
plugs into those contracts.

The generic catalog/contract package lives at `plugins/catalog` and is still
published inside the workspace as `@thinkwork/plugin-catalog`. It is not a
first-party application plugin; registry generation skips it and discovers only
real `plugins/<plugin-key>/` application packages.

## Package Contract

Each plugin package should include the pieces that apply to that plugin:

- `package.json` and `tsconfig.json` so the package participates in the pnpm
  workspace.
- `src/index.ts` exporting a `FirstPartyPluginPackage` descriptor with
  `packageKey`, `sourceRoot`, the validated manifest, owned source descriptors,
  and temporary compatibility links.
- `src/manifest.ts` for the versioned catalog manifest.
- `src/api/` for plugin-specific API/runtime hooks.
- `src/deployment/` for managed-application adapters.
- `src/web/` for plugin-specific operator UI panels rendered by shared hosts.
- `terraform/<managed-app-key>/` for plugin-owned Terraform source.
- `runtime/` for plugin-owned Dockerfiles or runtime assets.
- `smoke/` for live or dry-run smoke validation scripts.
- `test/` for package-local contract and parity tests.
- `README.md` for review, operation, migration debt, and verification notes.

The descriptor is intentionally machine-readable so docs, release tooling,
source-boundary checks, and plugin-builder output can agree on the same package
shape.

## Temporary Compatibility Links

During THNK-31 migration, a plugin README and descriptor may reference legacy
paths outside `plugins/<plugin-key>/` only when the path is documented as
migration debt. Each compatibility link must explain why it remains outside the
package and which implementation unit or release pass removes it.

Compatibility links are not ownership claims. They are breadcrumbs that keep
review honest while source moves behind the package boundary.

## Shared Platform Code

Do not move generic platform code into a plugin package just because a plugin
uses it. Keep shared contracts and orchestration in the owning workspace package
and expose a generic extension point when plugin-specific behavior needs to be
called from shared code.

## Verification

For package-local changes, run the plugin package test or typecheck command:

```bash
pnpm --filter @thinkwork/plugin-<key> test
pnpm --filter @thinkwork/plugin-<key> typecheck
```

For catalog contract changes, also run:

```bash
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
```

## Signed Catalog Publication

The authored source of truth stays in root `plugins/*` packages. The runtime
freshness channel is a signed JSON artifact produced from that source by the
`Plugin Catalog` GitHub Actions workflow.

On pull requests that touch `plugins/**`, the workflow:

- checks the generated first-party plugin registry;
- runs the catalog package tests and typecheck;
- builds a signed catalog with an ephemeral ed25519 key; and
- verifies the signed JSON before the PR can merge.

On pushes to `main`, the workflow publishes a stable GitHub Release asset only
when catalog-affecting source changed under `plugins/catalog/**`,
`plugins/<plugin-key>/src/**`, or `plugins/<plugin-key>/package.json`. Docs-only
changes under plugin folders leave the previous catalog asset in place. A manual
workflow dispatch can force a publish when an operator needs to republish the
current `main` catalog.

The stable channel is:

- release tag: `plugin-catalog-main`;
- asset: `thinkwork-plugin-catalog-main.json`;
- private signing secret: `PLUGIN_CATALOG_SIGNING_KEY`; and
- signed provenance: repository, ref, source commit SHA, generated timestamp,
  catalog digest, and per-version payload digests.

The signing key is used only by GitHub Actions. Deployed ThinkWork stages should
trust the matching public key through runtime configuration and continue to read
catalog data through ThinkWork GraphQL, not browser-side GitHub calls.

## Runtime Freshness Model

Plugin authors change source under `plugins/<plugin-key>/`. The release path
turns that source into a signed catalog artifact; the deployed API fetches that
artifact from GitHub, verifies the signature and payload digests, and caches
only verified snapshots. The browser never fetches GitHub directly, and the API
never compiles or evaluates plugin TypeScript from GitHub.

ThinkWork has four distinct catalog states to keep straight during review:

| Layer              | Owner                                    | What changes it                                                                          |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Authored source    | `plugins/*` package maintainers          | Pull requests that edit manifests, package metadata, skills, adapters, or runtime source |
| Signed artifact    | GitHub Actions `Plugin Catalog` workflow | Merge to `main` with catalog-affecting plugin source, or manual workflow dispatch        |
| API verified cache | Deployed GraphQL API                     | TTL refresh, conditional GitHub revalidation, or operator `refreshPluginCatalog`         |
| Installed pin      | Tenant plugin install state              | `installPlugin` or `upgradePlugin` mutations through ThinkWork                           |

Settings -> Plugins reads `pluginCatalog` plus `pluginCatalogMetadata` through
GraphQL. Operators see the installed pinned version next to the latest verified
catalog version, the source repository/tag/commit, generated and fetched
timestamps, stale fallback status, and a `Refresh catalog` action. That action
calls `refreshPluginCatalog`; it bypasses the API freshness TTL but still uses
the same signature/digest verification and stale-safe fallback path.

If GitHub is unavailable, rate limited, returns a malformed artifact, or serves
an artifact with a bad signature, the API must not trust it. A previously
verified snapshot may be served as stale fallback; otherwise the catalog fails
closed and installed plugin state remains in Aurora.

## Release And Verification Checklist

When a plugin version bump should become visible without a full app deploy:

1. Land the plugin source change under `plugins/*` on `main`.
2. Confirm the `Plugin Catalog` workflow published
   `thinkwork-plugin-catalog-main.json` on release tag `plugin-catalog-main`.
3. Verify the signed artifact with the deployed trusted public key, or at least
   confirm the artifact metadata contains the expected repository, ref, source
   commit SHA, generated timestamp, catalog digest, and version payload digest.
4. In a GitHub-backed stage, refresh the API cache by waiting for TTL or using
   the operator `Refresh catalog` action in Settings -> Plugins.
5. Confirm Settings -> Plugins shows the expected latest version, source
   metadata, stale/fallback state when applicable, and update availability for
   tenants with an older installed pin.
6. Install or upgrade through ThinkWork. Do not substitute a direct Terraform
   apply, vendor cloud login, local Docker Compose run, or manual catalog edit.
7. Run the package-owned smoke for the plugin after install/upgrade. For
   LastMile, that means proving `lastmile--crm`, `lastmile--tasks`, and
   `lastmile--routing` through ThinkWork's MCP proxy.

Before closing a migration slice, run the source-boundary check:

```bash
node scripts/verify-plugin-source-boundary.mjs
```
