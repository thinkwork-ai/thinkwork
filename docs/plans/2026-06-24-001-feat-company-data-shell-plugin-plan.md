---
title: "feat: Add Company Data shell plugin"
type: feat
status: active
date: 2026-06-24
origin: docs/brainstorms/2026-06-23-company-data-operational-projection-requirements.md
linear: THNK-67
---

# feat: Add Company Data Shell Plugin

## Overview

Create a focused first-party `company-data` plugin shell by cloning the proven
`plugins/data-integrations/` shell-package pattern and renaming the product
identity, package metadata, manifest, tests, README, catalog dependency, and
source-boundary tooling for Company Data.

This plan is intentionally narrower than
`docs/plans/2026-06-23-002-feat-company-data-operational-projection-plan.md`.
It only establishes the package-owned catalog identity and installable shell
surface for THNK-67. It does not implement the operational projection,
database schema, extraction runner, mapping workflow, Context Engine provider,
or operator UI beyond a declared settings surface.

---

## Problem Frame

THNK-67 frames Company Data as the governed operational-facts substrate beside
Company Brain: Company Data holds detailed operational facts and current state,
while Company Brain holds meaning, ontology-shaped summaries, relationships,
and durable business context. The origin requirements explicitly decide that
Company Data must be its own first-party ThinkWork plugin, not a mode hidden
inside Data Integrations (see origin:
`docs/brainstorms/2026-06-23-company-data-operational-projection-requirements.md`).

The current repo already has a shell-only first-party plugin that matches this
slice almost exactly: `plugins/data-integrations/`. The safest first step is to
copy that package shape, preserve the inert-shell guardrails, and make Company
Data visible to the generated plugin catalog without promising runtime
capability before later THNK-67 implementation units exist.

---

## Requirements Trace

- R1. Add a new first-party plugin package at `plugins/company-data/`.
- R2. Use `plugins/data-integrations/` as the implementation template so the
  new plugin starts as an inert shell with empty OAuth scopes, empty
  capabilities, and one declared settings surface.
- R3. Give the shell customer-facing copy that reflects THNK-67: governed
  operational facts for agents and UI, distinct from Company Brain meaning and
  Data Integrations extraction plumbing.
- R4. Publish the shell through the generated first-party plugin catalog so it
  participates in catalog tests, signed catalog builds, and the normal install
  path.
- R5. Extend source-boundary tooling so `company-data` is recognized as a
  plugin-owned source root and misplaced Company Data-specific source is
  rejected.
- R6. Document that runtime capabilities are deferred: no extraction runner,
  database schema, mapping/projection workflow, MCP server, Context Engine
  provider, credentials, skills, Terraform-managed resources, BI, analytics,
  or live operator screen is delivered by this shell slice.

**Origin actors:** A1 ThinkWork data/integration designer, A2 customer data
owner, A3 ThinkWork agent, A4 agent or UI consumer, A5 downstream implementer.

**Origin flows:** F1 inspect and sample a source endpoint, F2 profile and map
the operational chain, F3 materialize the Aurora projection, F4 query approved
Company Data. This shell plan only creates the product/catalog identity those
future flows attach to.

**Origin acceptance examples:** AE1 through AE4 are deferred to follow-up
projection work. This plan only advances the prerequisite first-party plugin
identity from origin R4a.

---

## Scope Boundaries

### Deferred for later

- Cross-source reconciliation and identity resolution across ERP, FleetIO, CRM,
  and other systems.
- Multi-source conflict resolution and source-priority policies.
- Broad enterprise ontology modeling beyond the relationships required for the
  customer/order-chain tracer.
- Redshift, Athena, or other analytical query acceleration for workloads that
  outgrow the v1 Iceberg/Aurora split.
- Real-time CDC or sub-minute operational freshness unless the selected source
  endpoint already supports it cleanly.
- Writeback from Company Data into source systems.
- General-purpose self-serve modeling for every possible dataset.

### Outside this product's identity

- Company Brain as the warehouse for every operational fact.
- Neptune as the primary detail-data warehouse.
- Replacing source systems of record with ThinkWork-owned operational writes.
- Fetching routine operational facts live from MCP/source APIs on every agent
  request once an approved projection exists.
- A purely analytical lakehouse that never serves UI/agent operational reads.

### Deferred to Follow-Up Work

- Company Data TypeScript contracts for source inspection, extraction,
  profiling, mapping, projection, and query contracts.
- `company_data` Aurora/Postgres schema, migrations, ledgers, and projection
  tables.
- Meltano, S3/Iceberg, Dagster-compatible evidence, and projection materializer
  runtime work.
- Context Engine provider participation and agent-readable query contracts.
- Web/operator Company Data review surfaces beyond the declared no-op settings
  surface.
- Any deployed resources, credentials, MCP servers, skills, smoke tests, or
  Terraform modules.

---

## Context & Research

### Relevant Code and Patterns

- `plugins/data-integrations/package.json` is the closest template: private
  workspace package, `@thinkwork/plugin-data-integrations`, `main` and
  `exports` pointed at `src/index.ts`, and package-local `build`,
  `typecheck`, and `test` scripts.
- `plugins/data-integrations/src/manifest.ts` defines an inert shell manifest
  with one `ui-surface` component, empty scopes, and empty capabilities.
- `plugins/data-integrations/src/index.ts` exports the package descriptor with
  `packageKey`, `sourceRoot`, `manifest`, `ownedSources`, and
  `compatibilityLinks`.
- `plugins/data-integrations/test/manifest.test.ts` validates manifest shape,
  absence of side-effecting components/secrets/runtime promises, customer copy,
  package-owned source descriptors, and README deferred-resource language.
- `plugins/catalog/scripts/generate-plugin-registry.ts` discovers publishable
  plugin packages from `plugins/*/package.json`; `generated-first-party.ts` is
  generated, not hand-authored.
- `plugins/catalog/package.json` imports first-party plugin packages as
  workspace dependencies so the generated registry can statically import them.
- `pnpm-lock.yaml` records workspace importers and should change alongside the
  new plugin package and catalog dependency, even though no external package is
  being introduced.
- `plugins/catalog/src/__tests__/plugin-registry.test.ts`,
  `plugins/catalog/src/__tests__/plugin-package.test.ts`, and
  `plugins/catalog/src/__tests__/build-catalog.test.ts` hard-code expected
  catalog ordering and must be updated when a new plugin enters the catalog.
- `scripts/verify-plugin-source-boundary.mjs` has explicit `PLUGIN_KEYS` and
  `PLUGIN_SOURCE_ROOTS` lists; it will not enforce `company-data` until those
  lists and tests include it.

### Institutional Learnings

- `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  says first-party plugin source should live under `plugins/<plugin-key>/`,
  export a machine-readable package descriptor, and rely on generated shared
  registries rather than hand-maintained shared plugin lists.
- `docs/solutions/architecture-patterns/release-manifest-deployment-status-contract-2026-06-11.md`
  reinforces that published artifacts and deployed state are distinct. This
  shell should only change authored plugin source/catalog input; deployed
  runtime truth comes later through the normal install/update path.

### External References

- External research skipped. The repo has direct local patterns for shell
  plugin packages, generated catalog publication, and source-boundary checks.

---

## Key Technical Decisions

- **Create a new focused plan instead of editing the broad THNK-67 projection
  plan.** The user asked for a shell plugin cloned from Data Integrations; the
  existing projection plan is broader and includes database/runtime/provider
  work that would muddy this small first slice.
- **Clone the Data Integrations shell shape, not its product language.** The
  structure, tests, and deferred-resource guardrails should match
  `data-integrations`; the display name, plugin key, package name, descriptions,
  and README should express Company Data's operational-facts identity.
- **Publish through the generator.** Implementation should add package metadata
  and catalog dependency wiring, then refresh the generated registry rather
  than manually editing `generated-first-party.ts` as if it were source.
- **Keep the shell inert.** The first Company Data package should not declare
  infrastructure, MCP servers, skills, OAuth scopes, capabilities, credentials,
  or live handlers. Future runtime slices should extend the same package after
  separate plans/tests exist.
- **Make source-boundary enforcement part of the shell.** A new first-party
  plugin identity is not complete until misplaced `company-data` source can be
  caught by the repository check.

---

## Open Questions

### Resolved During Planning

- Should this be a new focused plan or an edit to the existing broad plan?
  Resolved by user choice: create a new focused plan for just the shell plugin.
- Should external research run? No. Local Data Integrations and plugin catalog
  patterns are direct and current enough for this shell slice.
- Should the shell include runtime contracts from the broader Company Data
  projection plan? No. Those contracts remain follow-up work; this plan creates
  the package identity and guardrails only.

### Deferred to Implementation

- Exact final customer-facing description text: defer to implementation copy
  polish, but it must preserve the facts-vs-meaning boundary and avoid runtime
  promises.
- Exact catalog ordering changes after generation: defer to the generator and
  package-local tests, while preserving deterministic sort expectations.

---

## Output Structure

    plugins/company-data/
      README.md
      package.json
      tsconfig.json
      src/
        index.ts
        manifest.ts
      test/
        manifest.test.ts

---

## Implementation Units

- U1. **Create Company Data shell package**

**Goal:** Add `plugins/company-data/` as an inert first-party plugin package
modeled on `plugins/data-integrations/`.

**Requirements:** R1, R2, R3, R6; origin R4a.

**Dependencies:** None.

**Files:**

- Create: `plugins/company-data/package.json`
- Create: `plugins/company-data/tsconfig.json`
- Create: `plugins/company-data/src/manifest.ts`
- Create: `plugins/company-data/src/index.ts`
- Create: `plugins/company-data/README.md`
- Create: `plugins/company-data/test/manifest.test.ts`

**Approach:**

- Copy the Data Integrations package skeleton and rename identifiers to
  `company-data`, `Company Data`, `@thinkwork/plugin-company-data`,
  `COMPANY_DATA_SETTINGS_SURFACE`, `companyDataManifest`, and
  `companyDataPluginPackage`.
- Keep the manifest at version `0.1.0` with `requiredOauthScopes: []`,
  `capabilities: []`, and a single declared `ui-surface` component targeting
  the same settings-plugin detail tab mount pattern used by Data Integrations.
- Write customer-facing copy that says Company Data is a governed operational
  facts substrate for agents and UI, while explicitly avoiding claims that the
  shell deploys extraction, projection, analytics, warehouse, BI, MCP, or
  Terraform resources.
- Keep `compatibilityLinks` empty because no legacy Company Data source exists
  outside the new package in this shell slice.
- Document deferred resources in the README with the same directness as
  `plugins/data-integrations/README.md`.

**Execution note:** Implement the manifest/package tests first by adapting the
Data Integrations assertions, then make the shell pass them.

**Patterns to follow:**

- `plugins/data-integrations/src/manifest.ts`
- `plugins/data-integrations/src/index.ts`
- `plugins/data-integrations/test/manifest.test.ts`
- `plugins/data-integrations/README.md`

**Test scenarios:**

- Happy path: `validatePluginManifest(companyDataManifest)` returns plugin key
  `company-data`, display name `Company Data`, version `0.1.0`, empty OAuth
  scopes, empty capabilities, and the expected settings UI surface.
- Happy path: `defineFirstPartyPluginPackage(companyDataPluginPackage)` accepts
  `packageKey: "company-data"`, `sourceRoot: "plugins/company-data"`, owned
  sources under the package root, and no compatibility links.
- Error path: serialized manifest/customer copy does not contain URLs,
  credentials, secrets, Terraform, managed app endpoints, MCP server
  declarations, skills, or runtime handler promises.
- Error path: customer-facing copy does not claim that Company Data stores
  every operational row in Company Brain, provides BI/dashboard/lakehouse query
  UI, deploys ELT jobs, or replaces source systems of record.
- Integration: README assertions prove deferred-resource language covers
  extraction runner, projection database/schema, mapping workflow, MCP,
  Context Engine provider, credentials, Terraform-managed resources, and live
  operator UI.

**Verification:**

- The package-local test suite proves Company Data has a valid inert shell
  manifest, package descriptor, README guardrails, and no runtime promises.

---

- U2. **Publish Company Data through the generated catalog**

**Goal:** Make the new package visible to the first-party plugin catalog and
signed catalog build path through the existing generator and tests.

**Requirements:** R4.

**Dependencies:** U1.

**Files:**

- Modify: `plugins/catalog/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `plugins/catalog/src/registry/generated-first-party.ts`
- Modify: `plugins/catalog/src/__tests__/plugin-registry.test.ts`
- Modify: `plugins/catalog/src/__tests__/plugin-package.test.ts`
- Modify: `plugins/catalog/src/__tests__/build-catalog.test.ts`

**Approach:**

- Add `@thinkwork/plugin-company-data` as a workspace dependency of
  `@thinkwork/plugin-catalog` so generated static imports resolve.
- Refresh `pnpm-lock.yaml` so the new plugin importer and catalog dependency
  are represented in the workspace lockfile.
- Refresh `plugins/catalog/src/registry/generated-first-party.ts` using the
  existing registry generator after the new package metadata exists.
- Update catalog tests that assert deterministic plugin ordering. Because the
  generator sorts package keys and the signed catalog sorts manifest display
  names, tests should expect `company-data` near `company-brain` by key and
  `Company Data` near other display-name-sorted manifests.
- Do not hand-edit any runtime install behavior. The generated catalog should
  be the only shared publication change needed for this shell.

**Patterns to follow:**

- `plugins/catalog/scripts/generate-plugin-registry.ts`
- `plugins/catalog/src/registry/generated-first-party.ts`
- `plugins/catalog/src/__tests__/plugin-registry.test.ts`
- `plugins/catalog/src/__tests__/plugin-package.test.ts`
- `plugins/catalog/src/__tests__/build-catalog.test.ts`

**Test scenarios:**

- Happy path: registry discovery includes `company-data` with package name
  `@thinkwork/plugin-company-data`, export name `companyDataPluginPackage`,
  manifest export name `companyDataManifest`, and raw export name
  `rawCompanyDataPluginPackage`.
- Happy path: checked-in generated registry content matches
  `expectedPluginRegistry()` after the new package is added.
- Happy path: `firstPartyPluginPackages` and `allPluginManifests` include
  `company-data` in the deterministic expected arrays.
- Integration: signed catalog build verification includes `company-data` in
  the verified plugin-key list without changing signature validation behavior.
- Error path: if the generated registry is stale, the existing freshness test
  fails and instructs the implementer to regenerate it.

**Verification:**

- Catalog package tests prove the new shell is discoverable, statically
  imported, included in manifest aggregates, and compatible with the signed
  catalog build path.

---

- U3. **Extend plugin source-boundary enforcement**

**Goal:** Teach the source-boundary check that `company-data` is a first-party
plugin key whose plugin-specific source belongs under `plugins/company-data/`.

**Requirements:** R5.

**Dependencies:** U1.

**Files:**

- Modify: `scripts/verify-plugin-source-boundary.mjs`
- Modify: `scripts/__tests__/verify-plugin-source-boundary.test.mjs`

**Approach:**

- Add `company-data` to the plugin key list and map it to
  `plugins/company-data/` in `PLUGIN_SOURCE_ROOTS`.
- Extend the positive fixture test so source under
  `plugins/company-data/src/manifest.ts` is accepted.
- Extend negative fixture coverage so `company-data` references under another
  plugin package or shared package are rejected unless explicitly allowlisted
  in the future.
- Keep the active migration allowlist closed. This shell slice should not need
  new migration-debt exceptions.

**Patterns to follow:**

- `scripts/verify-plugin-source-boundary.mjs`
- `scripts/__tests__/verify-plugin-source-boundary.test.mjs`
- `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`

**Test scenarios:**

- Happy path: a fixture file under `plugins/company-data/src/manifest.ts`
  produces no source-boundary violation.
- Error path: a fixture file such as
  `plugins/lastmile/src/company-data-notes.md` is reported as misplaced
  Company Data-specific source.
- Error path: a fixture file such as
  `packages/api/src/lib/plugins/company-data-extra.ts` is reported as
  misplaced Company Data-specific source.
- Edge case: the default plugin source-boundary allowlist remains empty after
  adding `company-data`; no hidden migration debt is introduced.

**Verification:**

- Source-boundary tests prove Company Data source is accepted only in its
  package root or a future explicit allowlist entry.

---

## System-Wide Impact

- **Interaction graph:** The new package enters the authored plugin source
  layer, the generated first-party registry, signed catalog tests, and
  source-boundary check. It should not affect GraphQL resolvers, install
  handlers, deployment runner, database schema, Context Engine providers, or
  web routes beyond existing generic catalog consumption.
- **Error propagation:** Stale generated registry content should fail catalog
  tests; misplaced Company Data source should fail the source-boundary check;
  invalid manifest/package descriptors should fail package-local tests.
- **State lifecycle risks:** No tenant install state or deployed resources are
  changed by this plan. The new manifest becomes available as catalog input
  after normal publication/deploy processes.
- **API surface parity:** The public package export surface should match Data
  Integrations: root export and `./manifest` export only.
- **Integration coverage:** Package-local, catalog, signed catalog, and
  source-boundary tests together cover the cross-package publication path.
- **Unchanged invariants:** Company Data remains distinct from Company Brain
  and Data Integrations; this shell does not create runtime data flows,
  credentials, MCP tools, or database tables.

---

## Risks & Dependencies

| Risk                                                                          | Mitigation                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The shell copy accidentally promises runtime behavior that does not exist.    | Mirror Data Integrations negative-copy tests and README deferred-resource assertions.               |
| The generated registry is edited by hand or left stale.                       | Treat `generated-first-party.ts` as generated output and rely on existing freshness tests.          |
| Catalog dependency wiring is missed, causing generated imports to fail.       | Include `plugins/catalog/package.json` in U2 and verify catalog tests/typecheck.                    |
| Workspace lockfile importers drift from package metadata.                     | Include `pnpm-lock.yaml` in U2 so package creation and catalog dependency updates are reproducible. |
| Source-boundary tooling misses the new plugin key.                            | Include U3 before handoff and add positive and negative boundary fixtures.                          |
| The focused shell is mistaken for delivery of the broader THNK-67 projection. | Scope Boundaries and README must explicitly defer projection/runtime/provider work.                 |

---

## Documentation / Operational Notes

- Update `plugins/company-data/README.md` as part of U1 with shell scope,
  owned source, deferred resources, and package-local verification notes.
- No operator rollout, database migration, or deployed infrastructure is part
  of this plan.
- Keep Linear `THNK-67` in Plan Review after this plan is attached; Ready to
  Work should wait for human acceptance of this focused shell slice.

---

## Sources & References

- **Linear issue:** THNK-67, `https://linear.app/thinkworkai/issue/THNK-67/company-data`
- **Origin document:** `docs/brainstorms/2026-06-23-company-data-operational-projection-requirements.md`
- **Related broader plan:** `docs/plans/2026-06-23-002-feat-company-data-operational-projection-plan.md`
- **Template package:** `plugins/data-integrations/`
- **Catalog generator:** `plugins/catalog/scripts/generate-plugin-registry.ts`
- **Source-boundary tooling:** `scripts/verify-plugin-source-boundary.mjs`
- **Institutional learning:** `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
