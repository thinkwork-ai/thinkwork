---
date: 2026-06-18
topic: lakehouse-plugin-shell
linear: THNK-45
---

# LakeHouse Plugin Shell

## Problem Frame

ThinkWork is preparing a LakeHouse solution for McPherson that will eventually
cover datalake, data warehouse, and related agent-operable infrastructure. The
immediate need is intentionally smaller: create a catalog-visible LakeHouse
Application Plugin shell that can be installed in the McPherson environment
before the next status meeting, without deploying any LakeHouse resources yet.

This slice proves the product identity, package ownership boundary, catalog
publication path, and tenant install lifecycle. It should leave the later
LakeHouse implementation free to add real infrastructure, MCP tools, skills,
and operator surfaces without changing the plugin key or creating a parallel
integration model.

---

## Actors

- A1. ThinkWork plugin author: creates and validates the first-party LakeHouse
  plugin package.
- A2. Release/operator maintainer: lands the plugin shell and confirms it is
  available through the signed catalog path.
- A3. McPherson tenant administrator: installs the LakeHouse plugin from
  ThinkWork's Plugins surface.
- A4. Future LakeHouse implementer: extends the same plugin package with real
  LakeHouse resources and agent capabilities later.

---

## Key Flows

- F1. Publish shell
  - **Trigger:** ThinkWork decides the LakeHouse plugin should appear in the
    catalog for McPherson.
  - **Actors:** A1, A2
  - **Steps:** Add a first-party `lakehouse` plugin package; declare a valid
    shell manifest; include it in generated catalog discovery; run package,
    catalog, and source-boundary validation.
  - **Outcome:** The LakeHouse shell is part of the authored plugin source and
    can be published through the existing signed catalog workflow.
  - **Covered by:** R1, R2, R3, R6, R7

- F2. Install for McPherson
  - **Trigger:** A McPherson tenant administrator opens the Plugins catalog.
  - **Actors:** A2, A3
  - **Steps:** The administrator finds LakeHouse, starts install, and the
    platform records an installed plugin state without provisioning any
    LakeHouse infrastructure or requesting runtime credentials.
  - **Outcome:** LakeHouse appears installed for McPherson, ready to discuss
    and extend, with no cloud-resource side effects from this shell slice.
  - **Covered by:** R3, R4, R5, R8, R9

- F3. Extend later
  - **Trigger:** The LakeHouse solution is ready to add datalake, warehouse,
    MCP, skill, or UI behavior.
  - **Actors:** A1, A4
  - **Steps:** Future work updates the existing `lakehouse` plugin package and
    bumps its manifest version rather than creating a second plugin identity.
  - **Outcome:** The shell becomes the stable foundation for the real
    LakeHouse plugin.
  - **Covered by:** R10, R11

---

## Requirements

**Plugin identity and package**

- R1. The shell must use the stable plugin key `lakehouse`.
- R2. Customer-facing copy must identify the plugin as McPherson's LakeHouse
  solution shell without promising live datalake, warehouse, query, monitoring,
  or automation capabilities in this slice.
- R3. The LakeHouse source must live under the root plugin package boundary
  used by existing first-party plugins, with a package descriptor that makes the
  package reviewable as one unit.

**Catalog and install behavior**

- R4. The shell must be visible in the ThinkWork plugin catalog and installable
  through the same tenant-admin plugin install flow used by other first-party
  plugins.
- R5. Installing the shell must not create, update, or destroy LakeHouse AWS
  resources, Terraform-managed infrastructure, MCP server registrations,
  user OAuth activations, skills, schedules, data pipelines, storage buckets,
  warehouses, or credentials.
- R6. The shell manifest must still be structurally valid under the current
  plugin catalog contract so catalog build/signing can include it.
- R7. Catalog registry generation and source-boundary checks must treat
  LakeHouse as a first-party plugin package, not as shared platform code.

**Verification**

- R8. Repository validation for this slice must prove the LakeHouse package
  manifest, generated plugin registry, catalog package, and plugin source
  boundary are valid.
- R9. Product verification should prove the McPherson environment can see and
  install the LakeHouse shell through ThinkWork's normal plugin path, not by a
  manual database edit or direct catalog mutation.

**Future expansion**

- R10. Later LakeHouse infrastructure, MCP, skill, UI, and operations work must
  extend the same `lakehouse` plugin package and version line unless a future
  requirements decision explicitly changes the product identity.
- R11. The shell should include enough package documentation for a future
  implementer to see that resource deployment is intentionally deferred, not
  forgotten.

---

## Acceptance Examples

- AE1. **Covers R1-R7.** Given the plugin catalog is built from repo-authored
  plugin packages, when the LakeHouse shell is added, then `lakehouse` appears
  as a valid first-party catalog entry with no infrastructure, MCP, skills, or
  activation components that would provision resources.
- AE2. **Covers R4, R5, R9.** Given McPherson's tenant administrator installs
  LakeHouse from Settings -> Plugins, when install completes, then the tenant
  has an installed LakeHouse plugin record and no LakeHouse AWS resources or
  runtime credentials were created by this shell slice.
- AE3. **Covers R10, R11.** Given a later LakeHouse implementation adds
  Iceberg, Athena, ETL, monitoring, or agent tooling, when planning starts, then
  it extends the existing `lakehouse` plugin package instead of creating a new
  product identity.

---

## Success Criteria

- McPherson can see and install a LakeHouse plugin shell through ThinkWork's
  normal plugin catalog path before the status meeting.
- The shell creates confidence in the product and install path without
  accidentally provisioning unfinished LakeHouse infrastructure.
- A downstream implementer can move directly into planning the plugin shell
  implementation without inventing product identity, install behavior, scope
  boundaries, or verification evidence.

---

## Scope Boundaries

- Do not deploy LakeHouse resources in this slice.
- Do not add Terraform modules, managed-application adapters, MCP servers,
  agent skills, UI surfaces, data pipelines, warehouse schemas, or credentials
  unless they are inert documentation/examples required for the shell.
- Do not use Docker Compose, Kubernetes, GCP, Azure, or local-only substitutes.
- Do not bypass the normal ThinkWork plugin catalog/install path for
  verification.
- Do not make LakeHouse a McPherson-only hard-coded exception in shared plugin
  platform code.
- Do not rename or fork the plugin identity later without a new requirements
  decision.

---

## Key Decisions

- The immediate product is a shell, not a partial LakeHouse runtime.
- The stable plugin key is `lakehouse`.
- A normal plugin install with no resource side effects is the proof point for
  THNK-45.
- Future LakeHouse capabilities should accrue inside the same package instead
  of creating a second integration path.

---

## Dependencies / Assumptions

- Existing application-plugin requirements establish plugins as the universal
  package for customer solutions such as LakeHouse.
- The current plugin catalog contract requires at least one manifest component;
  planning may choose the least-side-effect valid component shape that satisfies
  the shell requirement without provisioning resources.
- The signed catalog publication path can expose a merged plugin source change
  to the deployed McPherson environment quickly enough for the status-meeting
  goal.
- McPherson has or will have access to a ThinkWork environment where the
  Plugins surface and catalog refresh/install path are enabled.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R6][Technical] What inert component shape should satisfy the
  current plugin manifest validator while guaranteeing install has no resource
  side effects?
- [Affects R8, R9][Technical] Which verification command set and deployed-stage
  evidence are fastest enough for the status-meeting deadline while still using
  the normal ThinkWork plugin path?

---

## Sources / Research

- Linear issue `THNK-45`.
- `docs/brainstorms/2026-06-12-application-plugins-requirements.md`.
- `docs/brainstorms/2026-06-15-plugin-source-colocation-requirements.md`.
- `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`.
- `plugins/README.md`.
- Existing plugin packages under `plugins/company-brain/`,
  `plugins/lastmile/`, `plugins/n8n/`, and `plugins/twenty/`.
- Plugin catalog contracts and registry generation under `plugins/catalog/`.

---

## Next Steps

-> /ce-plan for structured implementation planning
