---
title: Plugin source boundaries should be package-owned and deploy-verified
date: 2026-06-17
last_updated: 2026-06-17
category: architecture-patterns
module: Application Plugins / Plugin Source Boundary
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A first-party plugin owns manifest, runtime, Terraform, UI, smoke, or documentation source"
  - "Shared packages are starting to accumulate plugin-specific branches or imports"
  - "A plugin migration must preserve deployed install, OAuth, and MCP behavior"
  - "Repository checks need to distinguish shared platform code from misplaced plugin source"
related_components:
  - plugin-catalog
  - deployment-runner
  - terraform
  - mcp-runtime
  - webhooks
  - linked-tasks
  - database-pg
  - github-actions
  - plugin-builder
tags:
  - application-plugins
  - source-boundary
  - plugin-packages
  - mcp
  - deployment-runner
  - lastmile
  - ci
  - thnk-31
---

# Plugin source boundaries should be package-owned and deploy-verified

## Context

THNK-31 moved first-party application plugin source into root-level
`plugins/<plugin-key>/` packages. Before this work, plugin-specific behavior
was spread across the catalog, API, deployment runner, Terraform modules, web
settings, smoke scripts, docs, and the plugin-builder skill. That made each
plugin hard to review as one product and made shared packages drift toward
plugin-specific conditionals.

The durable learning is that `plugins/<plugin-key>/` has to be an ownership
boundary, not just a prettier folder. A maintainer should be able to open one
plugin package and understand its manifest, runtime hooks, Terraform shape,
operator UI, smokes, tests, docs, and remaining compatibility links. Shared
packages should keep generic platform contracts: validation, generated catalog
aggregation, GraphQL plumbing, install and activation state machines,
deployment-runner orchestration, shared web hosts, database schema, and common
test harnesses.

The migration also proved that source colocation is only complete after the
deployed product path still works. The final LastMile verification installed
the plugin through ThinkWork, kept LastMile pinned at `0.1.0`, restored the
active activation `c2d156a1-bdbf-49f5-9b9a-6aaf48ea2f85`, and exposed
`lastmile--crm`, `lastmile--tasks`, and `lastmile--routing` through
`/api/mcp/tools/list`. The optional CRM read call reached LastMile and failed
with `401 {"error":"User not found in LastMile directory."}`; that was an
external directory/access caveat, not a ThinkWork install or MCP restoration
regression.

THNK-33 added a companion edge case: sometimes the correct first slice is a
shared server contract for a plugin-related product proof, not plugin-owned
source yet. The Twenty native producer and embedded app install path was
blocked by the current component model, so the merged proof deliberately
targeted only `server_contract_verified`: signed `task-event` ingress, linked
task provider support, idempotent append/wake behavior, diagnostics, and a
deployed smoke runbook. That contract belongs in shared API/database/smoke
surfaces because it is the generic Thread Event Sources path, even though the
first fixture uses `producer: "twenty"`.

## Guidance

Make the plugin package the source of truth, then force shared code to consume
that package through generic extension points.

### 1. Give every plugin a machine-readable package contract

Each first-party plugin should export a package descriptor from
`plugins/<plugin-key>/src/index.ts`. THNK-31 used `FirstPartyPluginPackage` so
catalog builds, docs, source-boundary checks, and plugin-builder output agree on
the same shape:

```ts
export const lastmilePluginPackage = {
  packageKey: "lastmile",
  sourceRoot: "plugins/lastmile",
  manifest: lastmileManifest,
  ownedSources: [
    { path: "plugins/lastmile/src/manifest.ts" },
    { path: "plugins/lastmile/src/api/tasks-adapter.ts" },
    { path: "plugins/lastmile/smoke" },
    { path: "plugins/lastmile/test" },
  ],
} satisfies FirstPartyPluginPackage;
```

The descriptor should name plugin-owned source. If a legacy path still sits
outside the package, record it as a temporary compatibility link, not as a
hidden ownership claim.

### 2. Generate shared registries from plugin packages

When static bundling needs explicit imports, do not return to hand-maintained
plugin lists in shared packages. Generate a deterministic registry from
`plugins/*/package.json` and check the generated output for staleness:

```text
plugins/*/package.json
  -> packages/plugin-catalog/scripts/generate-plugin-registry.ts
  -> packages/plugin-catalog/src/plugins/generated-first-party.ts
  -> shared catalog exports
```

This keeps package discovery as the source of truth while preserving TypeScript
and bundler compatibility.

### 3. Move plugin-specific source; leave platform contracts shared

Use the package boundary aggressively for plugin-specific code:

- manifests, skill source, package docs, and package-local tests;
- managed-app adapters for Plane, Twenty, and Company Brain/Cognee;
- plugin-owned Terraform modules and runtime assets;
- plugin-specific API helpers such as LastMile task normalization or Twenty
  cutover orchestration;
- plugin-specific smokes and runbooks.

Leave shared packages generic. The API still owns activation and dispatch
state machines; deployment-runner still owns planning/apply orchestration; web
settings still own the shared plugin detail shell. If shared code needs to call
plugin behavior, add a generic adapter interface and import plugin packages
through the generated registry.

### 4. Enforce the boundary in CI, with explicit shared exceptions

THNK-31 closed `pluginSourceBoundaryAllowlist` to zero migration paths. The
remaining exceptions are shared or historical and are documented in
`sharedPluginTermAllowlist`.

The guard scans common source roots for first-party plugin terms and fails when
plugin-specific source appears outside the owning package:

```sh
node scripts/verify-plugin-source-boundary.mjs
# verify-plugin-source-boundary: OK - scanned 3742 files;
# 0 migration paths and 8 shared paths documented.
```

Keep shared exceptions narrow and named. A fixture that validates plugin-owned
Terraform packaging from the CLI bundle can be a shared exception; a new
`packages/deployment-runner/src/apps/foo.ts` adapter for one plugin should not.

### 5. Keep shared platform contract filenames provider-neutral

When a shared platform contract is first exercised by one provider, keep the
source path named after the platform contract, not the first provider. THNK-33's
first PR initially used Twenty-specific filenames for platform-level assets:

```text
packages/database-pg/drizzle/0171_twenty_linked_task_provider.sql
scripts/smoke/fixtures/twenty-task-status-changed.json
scripts/smoke/fixtures/twenty-task-comment-added.json
```

`scripts/verify-plugin-source-boundary.mjs` correctly failed the PR because
those paths contained a first-party plugin key outside `plugins/twenty/`. The
right fix was not to move a shared database constraint migration into the
Twenty package, and not to add a broad allowlist entry. The right fix was to
name the artifacts after the platform contract they verify:

```text
packages/database-pg/drizzle/0171_linked_task_external_providers.sql
scripts/smoke/fixtures/task-event-status-changed.json
scripts/smoke/fixtures/task-event-comment-added.json
```

The payload bodies can still contain provider values such as
`"producer": "twenty"` when that is the behavior under test. The boundary
concern is source ownership: a migration that broadens the shared
`linked_tasks.provider` constraint and a smoke fixture that exercises generic
`task-event` ingress are platform assets. Provider-specific producer code,
embedded app packaging, logic functions, manifest pieces, and package-local
smokes still belong under `plugins/<plugin-key>/`.

Prefer an explicit `sharedPluginTermAllowlist` entry only when the path itself
must include the plugin key for a durable shared reason, such as a CLI fixture
that validates plugin-owned Terraform packaging from the platform bundle.
Otherwise, provider-neutral naming keeps the guard meaningful and avoids
normalizing plugin leakage in shared code.

### 6. Put smoke verification inside the owning package

Package-owned smokes make the review boundary real. LastMile's deployed smoke
lives at `plugins/lastmile/smoke/lastmile-plugin-smoke.mjs` and verifies the
ThinkWork install/activation/MCP path, not only a direct vendor call:

```sh
SMOKE_ENABLE_LASTMILE_PLUGIN=1 \
  node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs --post-activation
```

That smoke proved all three restored LastMile MCP servers through ThinkWork.
The optional tool-call mode also cleanly classified the vendor-side directory
denial:

```sh
SMOKE_ENABLE_LASTMILE_PLUGIN=1 \
SMOKE_LASTMILE_MCP_CALL=1 \
  node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs --post-activation
# ThinkWork reaches lastmile--crm; LastMile returns 401 User not found.
```

This is the right shape for future plugins: each package owns the smoke that
proves its user-facing contract, while shared harnesses stay generic.

For provider-neutral shared contracts, put the reusable smoke helper and
fixtures near the shared contract until there is plugin-owned producer source.
THNK-33's `scripts/smoke/webhook-smoke.sh` and `task-event-*` fixtures prove
the generic signed ingress contract only. They do not prove
`native_producer_verified`, and they should not be used as evidence that a
native Twenty app package can be installed.

### 7. Separate authored source, signed catalog, verified cache, and install pins

THNK-37 added GitHub-backed catalog freshness without changing the source
boundary. The durable model is four layers:

```text
plugins/* authored source
  -> GitHub Actions signed catalog artifact
  -> API verified cache / stale fallback
  -> tenant install pinned version
```

The root `plugins/*` packages remain the authored source of truth. GitHub hosts
only a signed, generated catalog artifact, not runtime TypeScript source. The
GraphQL API fetches that artifact, verifies the ed25519 signature and payload
digests, caches only verified snapshots, and exposes freshness/provenance
through `pluginCatalogMetadata`. Browsers continue to read through GraphQL, and
manual refresh uses the operator-only `refreshPluginCatalog` mutation.

Verification should therefore prove both freshness and install behavior:

- a plugin source/version change produced the stable signed GitHub Release
  asset;
- the API refreshed or revalidated the artifact and reported source commit,
  digest, generated/fetched timestamps, and stale state correctly;
- Settings -> Plugins showed latest verified version versus installed pinned
  version;
- install/upgrade still ran through ThinkWork and package-owned smokes proved
  the plugin's MCP/application contract.

Do not treat "the GitHub asset changed" as sufficient verification. The
deployed ThinkWork API trust boundary and the tenant install pin are separate
states that must both be observed.

### 8. Deploy shared handler changes to every handler that consumes them

The final THNK-31 verification found a real deploy-target gap (session
history): a shared `packages/api` change reached only `graphql-http` and
`chat-agent-invoke`, but LastMile's fix also needed `skills` and `mcp-proxy`.
PR #2571 changed the package-only API deploy target from two named Lambda
resources to the full `aws_lambda_function.handler` collection.

For shared API/library changes, inspect the consuming handlers before calling a
deployed smoke authoritative. A green deploy is not enough if the relevant
handler fleet did not receive the new bundle.

## Why This Matters

Application plugins are product units, not scattered feature flags. If plugin
source lives in shared packages, every future plugin becomes harder to review:
maintainers have to chase catalog metadata, deployment adapters, Terraform,
runtime helpers, smokes, UI panels, docs, and tests across the repo. Shared
packages also become less reusable because they quietly accumulate
plugin-specific assumptions.

A package-owned source boundary makes plugin review and future submissions
tractable. It also gives automation a clear contract: plugin-builder emits
`plugins/<plugin-key>/`, catalog generation discovers packages from that root,
source-boundary CI blocks misplaced plugin code, and package-local smokes prove
the deployed behavior.

The deployed verification gate is just as important as the folder move. A
migration can be architecturally tidy and still break OAuth token selection,
MCP restoration, or Lambda rollout. THNK-31 only became trustworthy after the
LastMile install path, activation, handler deployment, and MCP tool surface
were proved through the live ThinkWork path.

## When to Apply

- Adding a new first-party application plugin.
- Moving an existing plugin's Terraform, adapter, UI, API, smoke, or docs.
- Reviewing a PR that adds plugin-specific code under `packages/`, `apps/`,
  `terraform/modules/app`, or `scripts/`.
- Adding the first provider to a shared platform contract, such as task-event
  ingress or linked-task provider support, where the provider value is real but
  the source path should stay provider-neutral.
- Updating plugin-builder templates or authoring guidance.
- Verifying a plugin migration where source layout changed but user behavior
  must stay the same.
- Debugging a deployed plugin smoke after shared API code changed.

Do not use this pattern to move shared platform infrastructure into a plugin
just because a plugin happens to be the first consumer. Shared install state,
catalog validation, GraphQL transport, deployment orchestration, and database
schema stay in their owning packages.

## Examples

Good source boundary:

```text
plugins/lastmile/
  src/manifest.ts
  src/api/tasks-adapter.ts
  src/discovery.fixture.ts
  smoke/lastmile-plugin-smoke.mjs
  test/
  README.md

packages/api/
  generic plugin activation, dispatch, and proxy state machines
```

Poor source boundary:

```text
packages/plugin-catalog/src/plugins/lastmile.ts
packages/api/src/lib/plugins/lastmile-tasks.ts
scripts/smoke/lastmile-plugin-smoke.mjs
terraform/modules/app/lastmile/*
apps/web/src/components/settings/LastMilePanel.tsx
```

That poor shape may work for one plugin, but it makes every later plugin and
review pay the same search tax again.

Good verification gate:

```text
source-boundary guard passes
plugin package tests/typecheck pass
signed catalog artifact is published and verified
API reports source commit, digest, fetched time, and stale state
Settings -> Plugins shows installed pin versus latest verified version
main deploy updates all consuming API handlers
ThinkWork install remains installed at pinned version
per-user activation is active
/api/mcp/tools/list exposes every plugin MCP server
optional tool call is classified at the right boundary
```

Poor verification gate:

```text
Terraform validates
direct vendor MCP curl works
repo folders look cleaner
issue is closed before the deployed ThinkWork install path is rechecked
```

## Related

- [THNK-31: Co-locate application plugin source](https://linear.app/thinkworkai/issue/THNK-31/co-locate-application-plugin-source)
- [THNK-31 requirements](../../brainstorms/2026-06-15-plugin-source-colocation-requirements.md)
- [THNK-31 implementation plan](../../plans/2026-06-15-003-refactor-plugin-source-colocation-plan.md)
- [THNK-31 autopilot status](../../plans/autopilot/THNK-31-status.md)
- [THNK-37: Move plugin catalog source to GitHub](https://linear.app/thinkworkai/issue/THNK-37/move-plugin-catalog-source-to-github)
- [THNK-37 implementation plan](../../plans/2026-06-17-002-feat-github-backed-plugin-catalog-plan.md)
- [Plugin package contract](../../../plugins/README.md)
- [LastMile plugin package notes](../../../plugins/lastmile/README.md)
- [PR #2570: restore LastMile MCP tokens after reauth](https://github.com/thinkwork-ai/thinkwork/pull/2570)
- [PR #2571: update all API handlers on package changes](https://github.com/thinkwork-ai/thinkwork/pull/2571)
- [PR #2572: record LastMile verification evidence](https://github.com/thinkwork-ai/thinkwork/pull/2572)
- [Plane-style managed apps need compact topology and product-path verification](./plane-managed-app-compact-topology-verification-2026-06-16.md)
- [Managed applications should reconcile MCP connectors and keep user OAuth separate](./managed-app-mcp-oauth-lifecycle-2026-06-06.md)
- [Terraform plugin-builder skills should stop at adapter gaps](./terraform-plugin-builder-skills-stop-at-adapter-gaps-2026-06-14.md)
