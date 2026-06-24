---
date: 2026-06-15
updated: 2026-06-16
topic: plugin-source-colocation
linear: THNK-31
---

# Co-locate Application Plugin Source - Requirements

## Problem Frame

ThinkWork's Application Plugin model is directionally right, but
plugin-specific source is scattered across shared catalog, API, deployment,
Terraform, web, smoke, docs, and plugin-builder locations. That makes a single
plugin difficult to understand, review, test, and eventually submit as a
complete unit.

The desired ownership boundary is stronger than "move the manifest": root-level
`plugins/<plugin-key>/` should own the plugin's product surface. A reviewer
should be able to open one plugin folder and find the plugin-specific behavior,
UI surfaces, substrate assets, deployment/runtime hooks, docs, tests, and
operations material. Shared packages should retain only generic platform
infrastructure that is not specific to Twenty CRM, Twenty, LastMile, Company Brain,
Cognee, or any future plugin.

This revision tightens the original THNK-31 scope after implementation revealed
that manifests, smokes, and parity tests could move while important plugin
behavior still remained scattered across `apps/web`, `packages/api`,
`packages/cognee`, `packages/deployment-runner`, `terraform/modules/app`, and
CLI/CI fixtures.

---

## Actors

- A1. Plugin author: adds or updates a first-party plugin package.
- A2. Platform maintainer: reviews shared engine changes separately from
  plugin-specific behavior.
- A3. Release operator: builds, signs, validates, and deploys plugin catalog
  artifacts.
- A4. Tenant/operator user: installs a plugin, opens plugin detail, and uses
  plugin-owned admin or ontology surfaces from the plugin context.

---

## Key Flows

- F1. Plugin review
  - **Trigger:** A plugin-specific behavior change is proposed.
  - **Actors:** A1, A2
  - **Steps:** Open `plugins/<plugin-key>/README.md`; inspect the manifest,
    skills, UI surfaces, substrate assets, Terraform/deployment source, tests,
    smoke contracts, and operations notes from that folder; identify any
    shared-engine changes as explicit platform work.
  - **Outcome:** Review can understand the plugin as one submission-shaped
    package.
  - **Covered by:** R1-R9, R12-R16

- F2. Catalog and deployment discovery
  - **Trigger:** The catalog build, API unsigned fallback, deployment runner,
    web extension surface, or smoke tooling needs plugin-specific data.
  - **Actors:** A2, A3
  - **Steps:** Discover plugin package descriptors from `plugins/*`; validate
    their manifests; load only generic extension contracts from shared packages;
    reject hidden plugin-specific imports in shared infrastructure.
  - **Outcome:** Shared packages stay generic while plugins own their source.
  - **Covered by:** R5-R8, R21-R23

- F3. Plugin-owned operator UI
  - **Trigger:** A tenant/operator user opens a plugin detail page such as
    Company Brain.
  - **Actors:** A2, A4
  - **Steps:** The shared web shell loads the plugin detail frame and renders
    plugin-declared UI surfaces from the owning plugin package. For Company
    Brain, ontology and knowledge-graph administration appear inside the
    Company Brain plugin context rather than as standalone settings screens
    owned by `apps/web`.
  - **Outcome:** Users experience plugin-specific operations as part of the
    plugin, and developers review those screens from the plugin folder.
  - **Covered by:** R9-R11, R17-R18

- F4. Future plugin submission
  - **Trigger:** A future customer, partner, or first-party team prepares a
    plugin contribution.
  - **Actors:** A1, A2
  - **Steps:** Generate a complete `plugins/<plugin-key>/` package from the
    plugin-builder workflow; validate the package contract; run package-local
    tests and repository enforcement.
  - **Outcome:** V1 remains first-party, but the folder shape is ready for
    future submissions.
  - **Covered by:** R12-R16, R21-R23

---

## Requirements

**Source boundary**

- R1. Create root-level `plugins/` as the canonical home for application plugin
  packages.
- R2. Each plugin must own a single `plugins/<plugin-key>/` folder.
- R3. The plugin folder is the product ownership boundary, not only a catalog
  manifest boundary. Plugin-specific source outside the plugin folder is
  migration debt unless explicitly classified as generic platform code or
  historical immutable migration evidence.
- R4. Plugin-specific manifests, skills, UI surfaces, Terraform/runtime assets,
  deployment adapters, API/runtime extensions, substrate image wrappers, docs,
  examples, tests, smokes, release notes, and runbooks must move into the
  owning plugin folder as applicable.

**Shared platform boundary**

- R5. Shared packages must retain generic plugin infrastructure only:
  validation, catalog build/signing, GraphQL plumbing, install/activation state
  machines, deployment-runner core, shared web shell, DB tables, and common test
  harnesses.
- R6. Shared code must not hide vendor/plugin-specific behavior unless it is
  explicitly classified as a platform extension point.
- R7. `packages/plugin-catalog` must not remain a first-party plugin source
  owner. It may remain only as a generic plugin platform package for contracts,
  validation, catalog build/signing, and discovery infrastructure; if the name
  creates ambiguity, planning should consider renaming or splitting it.
- R8. Shared aggregate registration must discover plugin packages rather than
  owning first-party manifests, fixtures, parity tests, or plugin-specific
  registry code.

**Plugin-owned UI and product surfaces**

- R9. The shared web application may provide generic plugin frames, routing,
  authentication, data hooks, layout primitives, and extension-host plumbing,
  but plugin-specific screens must be owned by the plugin package.
- R10. Plugin detail must be able to render plugin-declared UI surfaces. For
  this migration, rendering inside the plugin detail screen is sufficient; a
  more general marketplace/app-shell surface can be deferred.
- R11. Company Brain ontology, knowledge graph, migration, operations, and
  substrate evidence UI must move into `plugins/company-brain/` and render from
  the Company Brain plugin context. Legacy settings routes may redirect or host
  compatibility shims during migration, but they must not be the owning source.

**Substrate and infrastructure ownership**

- R12. Cognee is treated as the internal Company Brain substrate unless a
  future requirements decision promotes it to a standalone shared platform
  service. Its Dockerfile/image wrapper, Terraform module source, deployment
  adapter, smoke tests, and customer-facing copy must therefore be owned by
  `plugins/company-brain/` or explicitly marked as temporary migration debt.
- R13. Twenty CRM and Twenty managed-app Terraform modules and deployment adapters
  must move behind plugin-owned source while preserving current deployment
  behavior.
- R14. LastMile skill/MCP-only plugin content must remain package-local,
  including discovery fixtures, endpoint notes, OAuth assumptions, skills, and
  smoke checks.

**Review and submission contract**

- R15. Add a canonical plugin specification, preferably rooted at
  `plugins/README.md`, that explains how plugins work, what a plugin may own,
  what must remain generic platform code, required files, UI surface rules,
  infrastructure/runtime ownership, verification commands, and submission
  expectations.
- R16. Each plugin package must include a README/package contract that explains
  owned source, compatibility links during migration, verification commands,
  runtime/substrate assets, UI surfaces, and operational evidence.
- R17. A plugin package should be reviewable as one folder, with shared-engine
  changes called out separately.
- R18. V1 can remain first-party only, but the structure must be
  submission-shaped for future customer/partner plugins.
- R19. The plugin-builder workflow must output the root
  `plugins/<plugin-key>/` shape and include the canonical README/spec guidance.

**Migration coverage**

- R20. Migrate Twenty CRM first as the full-shape proof plugin.
- R21. Migrate Twenty while preserving install, infrastructure deployment, MCP
  registration, and user activation behavior.
- R22. Migrate Company Brain/Cognee infrastructure and UI source without leaking
  Cognee implementation vocabulary into customer-facing plugin package copy.
- R23. Migrate LastMile and skill/MCP-only content without changing endpoint,
  OAuth, or dispatch behavior.

**Tooling and enforcement**

- R24. Tooling must be able to list, validate, build, and test plugins from the
  folder source of truth.
- R25. Repository checks must fail when new plugin-specific source appears
  outside `plugins/<plugin-key>/` unless it is explicitly allowlisted as shared
  platform code or temporary migration debt.
- R26. The migration allowlist must shrink toward zero plugin-specific source
  entries. Remaining exceptions must be either historical immutable artifacts,
  generic shared-platform paths, or explicitly deferred migration debt with a
  named removal plan.
- R27. Compatibility paths should be removed after the full migration/release
  pass.

---

## Acceptance Examples

- AE1. **Covers R1-R8, R13, R20.** Twenty CRM can be understood from
  `plugins/twenty/README.md` and local links to its manifest, skill source,
  Terraform, adapter, smokes, tests, and operations notes.
- AE2. **Covers R5-R8.** `packages/plugin-catalog` exposes only generic plugin
  contracts/catalog infrastructure and does not own first-party plugin behavior.
- AE3. **Covers R9-R12, R22.** Company Brain ontology and knowledge-graph
  administration render inside the Company Brain plugin detail context, with
  source owned by `plugins/company-brain/`, while legacy settings routes are
  compatibility redirects or generic hosts only.
- AE4. **Covers R12, R22.** Cognee image/runtime wrapper source is owned by
  `plugins/company-brain/` unless a future requirements decision explicitly
  promotes Cognee to a shared platform service.
- AE5. **Covers R21.** Twenty still installs/upgrades with the same
  infrastructure deployment, MCP registration, and user activation behavior
  after migration.
- AE6. **Covers R15, R16, R19, R24.** Plugin-builder outputs a complete
  `plugins/<plugin-key>/` folder that passes validation.
- AE7. **Covers R25, R26.** Misplaced plugin-specific files outside
  `plugins/<plugin-key>/` fail repository checks with actionable guidance.

---

## Success Criteria

- Plugin package source and product surfaces live under root
  `plugins/<plugin-key>/` folders.
- Shared packages expose generic extension points instead of plugin-specific
  imports.
- `packages/plugin-catalog` no longer reads as the owner of first-party plugin
  source; it is generic infrastructure only, renamed or split if needed.
- Company Brain's ontology/knowledge-graph UI and Cognee substrate assets are
  owned by `plugins/company-brain/`.
- A canonical plugin spec/README exists and is good enough for a new plugin
  author to know what belongs in a plugin package.
- Existing product behavior for Twenty CRM, Twenty, LastMile, and Company Brain
  remains unchanged through migration.
- Repository checks make the new boundary durable and report any remaining
  plugin-specific migration debt.

---

## Scope Boundaries

- Do not change the plugin install/activation product behavior while moving
  source.
- Do not use this migration to redesign Company Brain ontology workflows; the
  requirement is source ownership and rendering context, not new ontology
  behavior.
- Do not introduce local-only, Kubernetes, Docker Compose, GCP, or Azure paths.
- Do not manually deploy or mutate production resources.
- Do not remove compatibility wrappers until all first-party plugins have moved
  and the catalog/release path has completed a migration pass.
- Do not move generic database schema, GraphQL transport, authentication,
  install state machines, or shared UI shell code into plugin packages just
  because plugins consume them.

---

## Key Decisions

- `plugins/<plugin-key>/` is the canonical source of truth for each plugin.
- Shared packages own reusable infrastructure; plugin packages own
  plugin-specific behavior.
- Plugin ownership includes UI surfaces and operational/admin product surfaces,
  not only manifests, tests, and smoke scripts.
- Company Brain owns Cognee as an internal substrate unless a future
  requirements pass explicitly promotes Cognee to shared platform infrastructure.
- `packages/plugin-catalog` is allowed only as generic platform infrastructure;
  it must not be treated as a first-party plugin source folder.
- Twenty CRM is the first proof plugin because it exercises manifest, skills,
  infrastructure, MCP activation, smokes, and operations material.
- Temporary migration allowlists are acceptable only while their removal is
  tracked by THNK-31 implementation units.

---

## Dependencies / Assumptions

- Existing merged THNK-31 PRs moved manifests, smokes, and parity tests, but did
  not complete full plugin ownership.
- The current migration allowlist still identifies plugin-specific source
  outside plugin folders, including web screens, API Company Brain helpers,
  `packages/cognee`, deployment-runner adapters, Terraform modules, and CLI/CI
  fixtures.
- Historical database migration tests may remain outside plugins if they verify
  immutable schema history rather than active plugin source.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7-R8][Technical] Should `packages/plugin-catalog` keep its current
  name as a generic infrastructure package, or should planning split/rename it
  to avoid implying first-party plugin ownership?
- [Affects R9-R11][Technical] What exact UI surface contract should let plugin
  packages render inside shared plugin detail without coupling the web shell to
  plugin-specific screens?
- [Affects R12][Technical] How should moving `packages/cognee/Dockerfile` into
  `plugins/company-brain/` preserve current CI/release image names and Terraform
  wiring?
- [Affects R24-R26][Technical] What migration allowlist categories should remain
  permanently for historical artifacts, and which entries must be removed before
  THNK-31 can move to Verification?

---

## Sources / Research

- Linear issue `THNK-31`.
- Linear document `81845c7a-ccb7-40c6-bf38-472bf42ae502`.
- `docs/plans/2026-06-12-001-feat-application-plugins-plan.md`.
- `docs/brainstorms/2026-06-14-twenty-application-plugin-requirements.md`.
- `docs/brainstorms/2026-06-14-plugin-builder-skill-requirements.md`.
- Historical catalog source under `packages/plugin-catalog/src/plugins/`; root
  `plugins/<plugin-key>/` packages are now the intended source boundary.
- Existing managed application adapters under `packages/deployment-runner/src/apps/`.
- Current remaining migration allowlist in
  `scripts/plugin-source-boundary-allowlist.mjs`.
- User clarification on 2026-06-16: plugin folders should colocate all
  plugin-specific resources, Company Brain ontology UI should be plugin-owned
  and rendered from plugin detail, `packages/cognee` should move under Company
  Brain unless explicitly justified, and a standard plugin spec/README is
  required.

---

## Next Steps

-> /ce-plan for structured implementation planning
