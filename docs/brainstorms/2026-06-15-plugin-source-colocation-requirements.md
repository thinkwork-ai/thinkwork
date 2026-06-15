---
date: 2026-06-15
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

The desired ownership boundary is root-level `plugins/<plugin-key>/`: each
plugin folder should contain plugin-specific source and review material, while
shared packages retain generic platform infrastructure.

---

## Actors

- A1. Plugin author: adds or updates a first-party plugin package.
- A2. Platform maintainer: reviews shared engine changes separately from
  plugin-specific behavior.
- A3. Release operator: builds, signs, validates, and deploys plugin catalog
  artifacts.

---

## Key Flows

- F1. Plugin review
  - **Trigger:** A plugin-specific behavior change is proposed.
  - **Actors:** A1, A2
  - **Steps:** Open `plugins/<plugin-key>/README.md`; inspect the manifest,
    skills, Terraform/deployment source, tests, smoke contracts, and operations
    notes from that folder or local links; identify any shared-engine changes
    as explicit platform work.
  - **Outcome:** Review can understand the plugin as one submission-shaped
    package.
  - **Covered by:** R1-R9

- F2. Catalog and deployment discovery
  - **Trigger:** The catalog build, API unsigned fallback, deployment runner,
    web extension surface, or smoke tooling needs plugin-specific data.
  - **Actors:** A2, A3
  - **Steps:** Discover plugin package descriptors from `plugins/*`; validate
    their manifests; load only generic extension contracts from shared packages;
    reject hidden plugin-specific imports in shared infrastructure.
  - **Outcome:** Shared packages stay generic while plugins own their source.
  - **Covered by:** R4, R5, R14-R16

- F3. Future plugin submission
  - **Trigger:** A future customer, partner, or first-party team prepares a
    plugin contribution.
  - **Actors:** A1, A2
  - **Steps:** Generate a complete `plugins/<plugin-key>/` package from the
    plugin-builder workflow; validate the package contract; run package-local
    tests and repository enforcement.
  - **Outcome:** V1 remains first-party, but the folder shape is ready for
    future submissions.
  - **Covered by:** R6-R9, R14-R16

---

## Requirements

**Source boundary**

- R1. Create root-level `plugins/` as the canonical home for application plugin
  packages.
- R2. Each plugin must own a single `plugins/<plugin-key>/` folder.
- R3. Plugin-specific manifests, skills, Terraform, deployment adapters,
  API/runtime extensions, web UI extensions, docs, examples, tests, smokes,
  release notes, and runbooks should move into the owning plugin folder as
  applicable.

**Shared platform boundary**

- R4. Shared packages must retain generic plugin infrastructure only:
  validation, catalog build/signing, GraphQL plumbing, install/activation state
  machines, deployment-runner core, shared web shell, DB tables, and common test
  harnesses.
- R5. Shared code must not hide vendor/plugin-specific behavior unless it is
  explicitly classified as a platform extension point.

**Review and submission contract**

- R6. Each plugin package must include a README/package contract that explains
  owned source, legacy links during migration, and verification commands.
- R7. A plugin package should be reviewable as one folder, with shared-engine
  changes called out separately.
- R8. V1 can remain first-party only, but the structure must be submission-shaped
  for future customer/partner plugins.
- R9. The plugin-builder workflow must output the root `plugins/<plugin-key>/`
  shape.

**Migration coverage**

- R10. Migrate Plane first as the full-shape proof plugin.
- R11. Migrate Twenty while preserving install, infrastructure deployment, MCP
  registration, and user activation behavior.
- R12. Migrate Company Brain/Cognee infrastructure source without leaking Cognee
  implementation vocabulary into customer-facing plugin package copy.
- R13. Migrate LastMile and skill/MCP-only content without changing endpoint,
  OAuth, or dispatch behavior.

**Tooling and enforcement**

- R14. Tooling must be able to list, validate, build, and test plugins from the
  folder source of truth.
- R15. Repository checks must fail when new plugin-specific source appears
  outside `plugins/<plugin-key>/` unless it is explicitly allowlisted as shared
  platform code or temporary migration debt.
- R16. Compatibility paths should be removed after the full migration/release
  pass.

---

## Acceptance Examples

- AE1. **Covers R1-R7, R10.** Plane can be understood from
  `plugins/plane/README.md` and local links to its manifest, skill source,
  Terraform, adapter, smokes, tests, and operations notes.
- AE2. **Covers R4-R5.** Shared-engine changes are explicit platform
  extensions, not hidden plugin-specific code.
- AE3. **Covers R11.** Twenty still installs/upgrades with the same
  infrastructure deployment, MCP registration, and user activation behavior
  after migration.
- AE4. **Covers R9, R14.** Plugin-builder outputs a complete
  `plugins/<plugin-key>/` folder that passes validation.
- AE5. **Covers R15.** Misplaced plugin-specific files outside
  `plugins/<plugin-key>/` fail repository checks with actionable guidance.

---

## Success Criteria

- Plugin package source lives under root `plugins/<plugin-key>/` folders.
- Shared packages expose generic extension points instead of plugin-specific
  imports.
- Existing product behavior for Plane, Twenty, LastMile, and Company Brain
  remains unchanged through migration.
- Repository checks make the new boundary durable.

---

## Scope Boundaries

- Do not change the plugin install/activation product behavior while moving
  source.
- Do not introduce local-only, Kubernetes, Docker Compose, GCP, or Azure paths.
- Do not manually deploy or mutate production resources.
- Do not remove compatibility wrappers until all first-party plugins have moved
  and the catalog/release path has completed a migration pass.

---

## Key Decisions

- `plugins/<plugin-key>/` is the canonical source of truth for each plugin.
- Shared packages own reusable infrastructure; plugin packages own
  plugin-specific behavior.
- Plane is the first proof plugin because it exercises manifest, skills,
  infrastructure, MCP activation, smokes, and operations material.
- Temporary migration allowlists are acceptable only while their removal is
  tracked by THNK-31 implementation units.

---

## Sources / Research

- Linear issue `THNK-31`.
- Linear document `81845c7a-ccb7-40c6-bf38-472bf42ae502`.
- `docs/plans/2026-06-12-001-feat-application-plugins-plan.md`.
- `docs/brainstorms/2026-06-14-plane-application-plugin-requirements.md`.
- `docs/brainstorms/2026-06-14-plugin-builder-skill-requirements.md`.
- Historical catalog source under `packages/plugin-catalog/src/plugins/`; root
  `plugins/<plugin-key>/` packages are now the intended source boundary.
- Existing managed application adapters under `packages/deployment-runner/src/apps/`.

---

## Next Steps

-> /ce-plan for structured implementation planning
