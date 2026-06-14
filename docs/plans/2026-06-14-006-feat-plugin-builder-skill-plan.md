---
title: "feat: Plugin Builder Skill"
type: feat
status: active
date: 2026-06-14
linear: THNK-26
origin: docs/brainstorms/2026-06-14-plugin-builder-skill-requirements.md
---

# feat: Plugin Builder Skill

## Overview

Build a portable Claude Code / Codex Skill that helps an agent turn an existing
Terraform project into a reviewable ThinkWork Application Plugin catalog
contribution. The first proof is McPherson Lakehouse: a premium
customer-specific AWS data-lake plugin candidate spanning S3, Glue, Iceberg,
Dagster, Athena, and related infrastructure.

The skill is an authoring workflow, not a plugin marketplace, CLI, or deployment
engine. It inspects source files, inventories Terraform and operational
assumptions, asks only the decisions the repo cannot answer, produces a
maintainer-reviewable contribution plan, and then helps create catalog-aligned
artifacts without inventing unsupported manifest fields.

---

## Requirements Trace

- R1. Produce a Claude Code / Codex compatible Skill installable into a working
  repo and invokable during plugin packaging.
- R2. Operate only from source files present in the working repo; no local-only
  paths, unpublished secrets, hidden customer context, raw tfvars, or customer
  credentials.
- R3. Start by discovering Terraform resources, variables, outputs, providers,
  secrets, state expectations, and operational assumptions.
- R4. Ask humans only for decisions not safely inferable from source.
- R5. Target the Application Plugin model in
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md`.
- R6. Guide authors toward `packages/plugin-catalog/src/contracts.ts`,
  including `infrastructure`, `skills`, `mcp-server`, and `ui-surface`.
- R7. Use existing premium plugin semantics: ThinkWork install-key gate and
  persistent entitlement after redemption.
- R8. Distinguish customer-facing product copy from internal implementation
  names, following the Company Brain precedent.
- R9. Reject or flag projects that do not fit current catalog contracts instead
  of inventing unsupported fields.
- R10. Produce a maintainer-reviewable contribution plan before changing files.
- R11. Help create plugin manifest, catalog registration, validation, and tests
  expected by `packages/plugin-catalog`.
- R12. Surface missing managed-application or deployment-runner adapter work as
  explicit follow-up work.
- R13. Leave a publication checklist covering catalog validation, signing/build
  steps, premium entitlement checks, install/provision smoke tests, and operator
  review notes.
- R14. First proof targets McPherson Lakehouse as a premium customer-specific
  AWS data-lake plugin.
- R15. Preserve McPherson's AWS-native data-lake scope while keeping secrets and
  environment-specific values out of committed artifacts.
- R16. Produce evidence for a maintainer to decide whether the lakehouse
  Terraform should use an existing managed-app adapter, a new adapter, or a
  smaller first plugin slice.

---

## Scope Boundaries

- No public marketplace, third-party self-publishing flow, arbitrary plugin
  upload, or new sideload mechanism.
- No new licensing or billing system beyond existing premium install-key and
  entitlement semantics.
- No deployment of infrastructure by the builder skill itself.
- No promise that every Terraform project is automatically packageable.
- No committed raw tfvars, customer secrets, customer credentials, or
  environment-specific McPherson values.
- No plugin UI rendering work; UI surfaces remain declared-only.
- No broad rewrite of `packages/plugin-catalog`; use existing manifest contracts
  and validators.

### Deferred to Follow-Up Work

- New managed-app/deployment-runner adapter for McPherson Lakehouse, if existing
  `cognee`/`twenty` adapter paths do not fit.
- Actual McPherson Lakehouse catalog plugin implementation beyond the builder
  skill's proof run and review evidence.
- Full automated skill eval integration.

---

## Context & Research

- `packages/plugin-catalog/src/contracts.ts` defines pure TypeScript validation
  for plugin manifests, premium metadata, component keys, skill slugs,
  supporting files, infrastructure input specs, and component types.
- `packages/plugin-catalog/src/plugins/company-brain/manifest.ts` is the premium
  product boundary precedent: customer-facing product name, internal substrate
  adapter, ThinkWork install-key prompt, and no exposed internal product naming.
- `packages/plugin-catalog/src/plugins/twenty/manifest.ts` shows an
  infrastructure-bundling plugin that mirrors deployment-runner required inputs
  and uses `endpointFrom` for per-tenant MCP endpoints.
- `packages/plugin-catalog/src/__tests__/contracts.test.ts`,
  `company-brain-manifest.test.ts`, and `twenty-manifest.test.ts` are validation
  patterns a generated contribution should imitate.
- `packages/deployment-runner/src/apps/registry.ts` currently exposes only
  `cognee` and `twenty` managed-app adapters; infrastructure plugin components
  must name one of those supported adapter keys.
- `packages/api/src/lib/plugins/handlers/infra.ts` maps infrastructure
  components onto existing deployment-job machinery and records handler
  evidence.
- `.agents/skills/` is the repo-local skill convention already used for local
  agent workflows.

---

## Key Technical Decisions

- Install the builder under `.agents/skills/thinkwork-plugin-builder/` so it is
  repo-local, skill-shaped, and copyable to Claude/Codex skill locations.
- Use the slug `thinkwork-plugin-builder` to avoid generic skill slug collisions.
- Keep the deliverable instruction-first with focused references and templates.
  Helper scripts are limited to non-destructive checks and report shaping.
- Do not add a broad `packages/plugin-catalog` scaffold generator in v1.
- Treat current infrastructure support as a closed set backed by
  `packages/deployment-runner/src/apps/registry.ts`; if McPherson Lakehouse
  cannot fit `cognee` or `twenty`, record an adapter gap instead of emitting an
  invalid `managedAppKey`.
- Teach `premium.entitlementProductKey`, `installKeyRequired: true`, and
  customer-facing `installKeyPrompt`; never ask for or store a separate license
  key.

---

## Implementation Units

- U1. **Restore Approved Requirements Reference**

**Goal:** Make THNK-26's approved requirements available in the repo.

**Files:**

- Create: `docs/brainstorms/2026-06-14-plugin-builder-skill-requirements.md`

**Verification:** The file exists and matches the approved Linear requirement
substance.

---

- U2. **Create Portable Builder Skill Package**

**Goal:** Add the `thinkwork-plugin-builder` skill with progressive disclosure
and clear activation metadata.

**Files:**

- Create: `.agents/skills/thinkwork-plugin-builder/SKILL.md`
- Create: `.agents/skills/thinkwork-plugin-builder/references/terraform-intake.md`
- Create: `.agents/skills/thinkwork-plugin-builder/references/plugin-design.md`
- Create: `.agents/skills/thinkwork-plugin-builder/references/catalog-contribution.md`
- Create: `.agents/skills/thinkwork-plugin-builder/references/adapter-gap-review.md`
- Create: `.agents/skills/thinkwork-plugin-builder/references/publication-checklist.md`
- Test: `.agents/skills/thinkwork-plugin-builder/tests/plugin-builder-skill.test.mjs`

**Verification:** The skill folder is copyable as a standalone Agent Skill and
its structural test passes.

---

- U3. **Add Templates and Non-Destructive Output Checks**

**Goal:** Give the skill reusable templates and a small checker that catches
unsafe or non-portable generated output.

**Files:**

- Create: `.agents/skills/thinkwork-plugin-builder/assets/plugin-manifest.template.ts`
- Create: `.agents/skills/thinkwork-plugin-builder/assets/manifest-test.template.ts`
- Create: `.agents/skills/thinkwork-plugin-builder/assets/contribution-plan.template.md`
- Create: `.agents/skills/thinkwork-plugin-builder/assets/publication-checklist.template.md`
- Create: `.agents/skills/thinkwork-plugin-builder/scripts/scan-plugin-builder-output.mjs`
- Create: `.agents/skills/thinkwork-plugin-builder/tests/fixtures/minimal-terraform-project/`
- Modify: `.agents/skills/thinkwork-plugin-builder/tests/plugin-builder-skill.test.mjs`

**Verification:** The checker runs against fixtures without network or cloud
access and produces deterministic findings.

---

- U4. **Wire Skill Guidance to Existing Plugin Catalog Validation**

**Goal:** Ensure the builder workflow leads contributors to concrete
`packages/plugin-catalog` changes and tests without adding a premature scaffold
abstraction.

**Verification:** A contributor reading the skill and references can identify
the existing package files and tests needed for a catalog contribution.

---

- U5. **Add Adapter Gap Review Workflow for McPherson Lakehouse**

**Goal:** Make the first proof produce clear evidence when McPherson Lakehouse
cannot fit current managed-app infrastructure support.

**Verification:** A McPherson-like fixture yields either a catalog contribution
plan or explicit adapter gap review, never an invalid infrastructure manifest.

---

- U6. **Document Publication and Reviewer Handoff**

**Goal:** Ensure the skill's final output is maintainer-reviewable and ready for
human approval before implementation or publication.

**Verification:** The final skill output gives a maintainer enough evidence to
decide the next implementation step without reconstructing the packaging
rationale.

---

- U7. **Run McPherson Lakehouse Proof and Record Evidence**

**Goal:** Apply the builder workflow to available McPherson Lakehouse source, or
record a sanitized proof using a McPherson-like fixture when the real source is
not available in this worktree.

**Files:**

- Create: `docs/verification/mcpherson-lakehouse-plugin-builder-proof.md`

**Verification:** A maintainer can read the proof document and decide whether
implementation should proceed as a catalog plugin, adapter work, or a smaller
first slice.

---

## Risks & Dependencies

| Risk                                                                       | Mitigation                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The builder emits invalid manifests by overgeneralizing Terraform projects | Teach closed component types, validate with `validatePluginManifest`, and stop on adapter gaps                 |
| Customer secrets leak into generated artifacts                             | Scanner flags raw tfvars, common secret markers, absolute local paths, and checklist requires secret exclusion |
| A generic skill slug collides with other skills                            | Use `thinkwork-plugin-builder` and document namespaced skill slug guidance                                     |
| McPherson Lakehouse source is unavailable in this worktree                 | Record sanitized fixture-based proof and explicitly note the missing real-source dependency                    |

---

## Sources & References

- Linear issue: THNK-26 "Plugin Builder Skill"
- Origin requirements: `docs/brainstorms/2026-06-14-plugin-builder-skill-requirements.md`
- Application Plugin requirements:
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md`
- Company Brain premium precedent:
  `docs/brainstorms/2026-06-13-company-brain-premium-plugin-requirements.md`
- Plugin contracts: `packages/plugin-catalog/src/contracts.ts`
- Managed-app adapters: `packages/deployment-runner/src/apps/registry.ts`
