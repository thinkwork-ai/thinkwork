---
date: 2026-06-14
topic: plugin-builder-skill
linear: THNK-26
---

# Plugin Builder Skill

## Problem Frame

ThinkWork now has an Application Plugin model: curated catalog manifests can
bundle skills, MCP servers, infrastructure components, and reserved UI surfaces,
with premium plugins gated by ThinkWork install keys. The next customer proof is
the McPherson Lakehouse POC, an AWS data-lake Terraform project spanning S3,
Glue, Iceberg, Dagster, Athena, and related infrastructure.

Turning that Terraform project into a ThinkWork catalog plugin is still expert
work. A contributor must understand the plugin manifest contract, premium
entitlement semantics, managed-application infrastructure expectations, skill
folder conventions, catalog registration, and publication checks. THNK-26 should
produce a portable Claude Code / Codex Skill that an agent can install into a
repo and use to guide this packaging workflow.

The skill should not invent a parallel marketplace, sideload path, or bespoke
licensing system. It should help an agent convert an existing Terraform project
into a contribution that fits the current ThinkWork plugin catalog and publish
process, with clear checkpoints where platform repo changes or human approval
are required.

---

## Actors

- A1. Plugin author: Runs the builder skill from a repo containing an existing
  Terraform project or integration artifact.
- A2. Packaging agent: Uses the builder skill to inspect source Terraform, ask
  targeted questions, create plugin-ready artifacts, and prepare a catalog
  contribution.
- A3. ThinkWork maintainer: Reviews and merges the resulting ThinkWork plugin
  catalog and infrastructure changes.
- A4. Tenant administrator: Later discovers and installs the published plugin
  from the ThinkWork Plugins catalog.

---

## Key Flows

- F1. Source project intake
  - Trigger: A plugin author asks the agent to package an existing Terraform
    project as a ThinkWork plugin.
  - Actors: A1, A2.
  - Steps: The skill has the agent locate the source project, summarize the
    infrastructure it creates, identify required inputs/secrets/outputs, and
    confirm the intended plugin identity, customer-facing name, and premium
    gating.
  - Outcome: The source project is understood well enough to map into the
    ThinkWork plugin model.
  - Covered by: R1, R2, R3, R4.
- F2. Plugin package design
  - Trigger: Intake confirms the source project is a candidate plugin.
  - Actors: A1, A2.
  - Steps: The skill leads the agent through manifest identity, versions,
    infrastructure, optional skills/MCP servers, customer-facing descriptions,
    install-key prompt, operational notes, and publication checklist.
  - Outcome: The package design aligns with the Application Plugin contract
    before files are generated.
  - Covered by: R5, R6, R7, R8, R9.
- F3. Catalog contribution preparation
  - Trigger: Plugin design is accepted by the author.
  - Actors: A2, A3.
  - Steps: The skill has the agent create or update catalog contribution
    artifacts, run validation checks where available, and produce a review
    summary naming assumptions, required platform repo changes, and follow-up
    tests.
  - Outcome: A maintainer can review the contribution without reconstructing
    the plugin packaging rationale.
  - Covered by: R10, R11, R12, R13.
- F4. McPherson Lakehouse proof
  - Trigger: The skill is used against the McPherson Lakehouse Terraform POC.
  - Actors: A1, A2, A3.
  - Steps: The agent applies the builder workflow to the lakehouse project,
    preserving AWS-native scope while mapping it into ThinkWork's premium plugin
    and infrastructure component model.
  - Outcome: McPherson Lakehouse has a gated ThinkWork plugin path or explicit
    adapter/scope follow-up evidence.
  - Covered by: R14, R15, R16.

---

## Requirements

**Skill packaging and portability**

- R1. THNK-26 must produce a Claude Code / Codex compatible Skill that can be
  installed into a working repo and invoked by an agent during plugin packaging.
- R2. The skill must operate from source files present in the working repo; it
  must not assume access to Eric's local paths, unpublished secrets, or hidden
  McPherson-only context.
- R3. The skill must begin by discovering and summarizing the source Terraform
  project, including resources, variables, outputs, providers, secrets, state
  expectations, and operational assumptions at a level useful for plugin
  packaging.
- R4. The skill must ask the human only for decisions that cannot be safely
  inferred from source files, such as customer-facing plugin name, premium
  install-key copy, destructive lifecycle stance, or publication target.

**ThinkWork plugin alignment**

- R5. The skill must target the existing Application Plugin model documented in
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md`, not a new
  packaging or sideload system.
- R6. The skill must guide authors toward the current catalog manifest contract
  in `packages/plugin-catalog/src/contracts.ts`, including versioned plugin
  identity and the v1 component types: infrastructure, skills, MCP servers, and
  declared-only UI surfaces.
- R7. For gated customer solutions, the skill must use existing premium plugin
  semantics: a customer-visible premium plugin with ThinkWork-provided install
  key gating and a persistent entitlement after successful redemption.
- R8. The skill must distinguish customer-facing product copy from internal
  implementation names, following the Company Brain precedent where the plugin
  name is the product and substrate/tool names can remain internal.
- R9. The skill must reject or flag source projects whose shape cannot fit the
  current catalog model without platform changes, instead of silently inventing
  unsupported manifest fields.

**Generated contribution**

- R10. The skill must produce a maintainer-reviewable contribution plan before
  changing files, naming which repo areas will be touched and why.
- R11. The skill must help create the plugin manifest, catalog registration, and
  validation/test updates expected by the existing plugin catalog package.
- R12. When the source Terraform cannot be represented by an already-supported
  infrastructure adapter, the skill must surface required managed-application or
  deployment-runner work as explicit follow-up work rather than hiding it in the
  manifest.
- R13. The skill must leave a publication checklist covering catalog validation,
  signature/build steps, premium entitlement checks, install/provision smoke
  tests, and operator review notes.

**McPherson Lakehouse proof**

- R14. The first proof must target the McPherson Lakehouse POC as a premium,
  customer-specific AWS data-lake plugin.
- R15. The McPherson proof must preserve the intended data-lake scope: S3, Glue,
  Iceberg, Dagster, Athena, and related AWS-native infrastructure, while keeping
  any customer secrets or environment-specific values out of committed catalog
  artifacts.
- R16. The proof must produce enough review evidence for a ThinkWork maintainer
  to decide whether the lakehouse Terraform should be wrapped by an existing
  managed-application adapter, a new adapter, or a smaller first plugin slice.

---

## Acceptance Examples

- AE1. Covers R1-R4. Given a repo contains a Terraform project for the
  McPherson Lakehouse POC, when the user invokes the Plugin Builder Skill, then
  the agent inventories Terraform variables, outputs, providers, resources,
  secrets, and state assumptions before proposing plugin artifacts.
- AE2. Covers R5-R9. Given the source project is intended to be sold or gated,
  when the skill asks for packaging decisions, then it steers the agent to a
  premium Application Plugin with ThinkWork install-key gating, not a new
  licensing or marketplace mechanism.
- AE3. Covers R10-R13. Given the agent has enough source context and human
  decisions, when it prepares the contribution, then it lists planned repo
  changes, creates catalog-aligned artifacts, runs available validation, and
  records any required deployment-runner or managed-app work as explicit
  follow-up.
- AE4. Covers R12, R16. Given the Terraform project requires an infrastructure
  deployment path not currently represented by the platform, when the skill
  reaches manifest creation, then it stops short of pretending the adapter exists
  and asks the agent to document the missing platform work.
- AE5. Covers R14, R15. Given McPherson-specific values are needed to deploy the
  lakehouse, when artifacts are generated, then committed catalog files include
  product contracts and input descriptions but not secrets, raw tfvars, or
  environment-specific customer credentials.

---

## Success Criteria

- A contributor can install the skill into a repo with an existing Terraform
  project and get from raw project to reviewable ThinkWork plugin catalog
  contribution without already knowing plugin internals.
- The McPherson Lakehouse POC has a clear path to becoming a premium catalog
  plugin, including visible gaps where platform adapter work is still needed.
- The generated contribution follows the same product model as LastMile, Twenty,
  and Company Brain rather than adding another distribution path.
- Planning can proceed without re-deciding whether this is a skill, a new CLI, a
  plugin marketplace, or a separate licensing system.

---

## Scope Boundaries

- No new public plugin marketplace, third-party self-publishing flow, or
  arbitrary plugin upload path.
- No new licensing or billing system beyond existing premium install-key and
  entitlement semantics.
- No requirement that the builder skill deploy infrastructure itself; deployment
  remains the job of ThinkWork platform/plugin install machinery.
- No requirement to make every Terraform project automatically packageable.
- No committed customer secrets, raw tfvars, or customer-specific credentials.
- No plugin UI-surface rendering requirement for this work; UI surfaces remain
  declared-only unless a separate issue changes that.

---

## Key Decisions

- Deliverable shape: Build a portable Claude Code / Codex Skill, not a new web UI
  or CLI command.
- Distribution model: Target the curated ThinkWork Application Plugin catalog.
- Premium model: Use existing ThinkWork premium install-key semantics for gated
  customer plugins instead of introducing a separate licensing concept.
- First proof: Use McPherson Lakehouse as the proving case because it exercises
  Terraform intake, AWS-native infrastructure scope, premium gating, and
  publication review.
- Adapter honesty: The skill must expose missing managed-app/deployment adapter
  work as a gap rather than emitting invalid catalog manifests.

---

## Dependencies / Assumptions

- Application Plugin requirements are captured in
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md`.
- Premium plugin precedent is captured in
  `docs/brainstorms/2026-06-13-company-brain-premium-plugin-requirements.md`.
- Current plugin manifest types and validation live in
  `packages/plugin-catalog/src/contracts.ts`; examples live under
  `packages/plugin-catalog/src/plugins/`.
- Existing CLI custom skill upload commands are retired; application plugins
  install from the signed catalog rather than a tenant zip-upload flow.
- The McPherson Lakehouse Terraform project exists outside the issue context
  available to this brainstorm. The builder skill must discover it from the repo
  where it is run.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- Final install location for the builder skill in this repo or external
  distribution path.
- Exact helper scripts, validators, or templates bundled with the skill versus
  expressed as instructions.
- Whether the implementation should add a reusable plugin manifest scaffold
  command/test helper inside `packages/plugin-catalog` or keep scaffolding in
  the skill.
- Whether the McPherson Lakehouse Terraform can reuse an existing infrastructure
  component path or needs a new managed-application/deployment-runner adapter.

---

## Next Steps

Proceed to the THNK-26 implementation plan.
