---
name: thinkwork-plugin-builder
description: Package existing Terraform projects as reviewable ThinkWork Application Plugin catalog contributions. Use when a user asks to convert Terraform, AWS infrastructure, customer POCs, managed applications, or integration repos into ThinkWork plugins, especially premium/key-gated plugins such as McPherson Lakehouse.
---

# ThinkWork Plugin Builder

Use this skill to guide a Terraform-backed project from raw source files to a
maintainer-reviewable ThinkWork Application Plugin contribution.

This skill is an authoring workflow. Do not deploy infrastructure, run
production mutations, invent manifest fields, commit raw tfvars, or store
customer secrets.

## Workflow

1. **Read source before designing.**
   - Locate Terraform roots, modules, provider config, variables, outputs,
     backends, state assumptions, scripts, and docs.
   - Load `references/terraform-intake.md` and complete the inventory before
     proposing plugin artifacts.

2. **Decide plugin shape.**
   - Load `references/plugin-design.md`.
   - Separate customer-facing product copy from internal implementation names.
   - Use existing ThinkWork premium install-key semantics for gated plugins.
   - Ask humans only for decisions the source cannot answer.

3. **Write a contribution plan before edits.**
   - Copy or adapt `assets/contribution-plan.template.md`.
   - Name planned repo paths, component shape, assumptions, validation, and any
     maintainer decision points.
   - Do not create manifest files until the plan is reviewable.

4. **Prepare plugin package and catalog aggregation artifacts.**
   - Load `references/catalog-contribution.md`.
   - Use `assets/plugin-manifest.template.ts` and
     `assets/manifest-test.template.ts` as examples, not as independent schema.
   - Align with `packages/plugin-catalog/src/contracts.ts` and existing plugin
     tests.
   - Treat `packages/plugin-catalog/scripts/generate-plugin-registry.ts` as the
     catalog aggregation check.

5. **Stop honestly on adapter gaps.**
   - Load `references/adapter-gap-review.md` for any infrastructure component.
   - Current managed-app adapter support is closed. If no supported adapter fits,
     write an adapter-gap review instead of emitting an invalid `managedAppKey`.

6. **Check generated output before handoff.**
   - Run `node scripts/scan-plugin-builder-output.mjs <generated-output-dir>`
     from this skill folder when generated artifacts exist.
   - Load `references/publication-checklist.md` and complete
     `assets/publication-checklist.template.md`.

## Required Output

End with one of these maintainer-facing outcomes:

- **Ready for catalog implementation:** contribution plan, manifest/test draft,
  catalog aggregation notes, and publication checklist are complete.
- **Blocked on adapter work:** adapter-gap review names the unsupported
  Terraform shape and follow-up platform paths.
- **Narrow first slice recommended:** broad Terraform scope is split into a
  smaller safe plugin candidate with the full scope preserved as evidence.

## Guardrails

- Use repo source files as the source of truth.
- Never assume hidden local paths or private customer context.
- Never copy raw `terraform.tfvars`, account credentials, environment values, or
  state files into generated artifacts.
- Treat `packages/plugin-catalog/src/contracts.ts` as the manifest contract.
- Treat `packages/deployment-runner/src/apps/registry.ts` as the managed-app
  adapter source of truth.
- Keep plugin-specific source under `plugins/<plugin-key>/`; shared API, web,
  deployment-runner, Terraform, or smoke changes should be generic platform
  extension points or adapter-gap follow-ups.
- Keep UI surfaces declared-only unless a separate ThinkWork issue changes that.
