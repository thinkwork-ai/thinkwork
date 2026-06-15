---
title: Terraform plugin-builder skills should stop at adapter gaps
date: 2026-06-14
category: docs/solutions/architecture-patterns
module: Application Plugins / Agent Skills
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Packaging an existing Terraform project as a ThinkWork Application Plugin"
  - "A generated plugin contribution includes an infrastructure component"
  - "A customer-specific premium plugin needs install-key gating without a new licensing path"
  - "A source project may require platform adapter work before catalog manifest work"
related_components:
  - plugin-catalog
  - deployment-runner
  - terraform
  - agent-skills
tags:
  [
    application-plugins,
    terraform,
    agent-skills,
    adapter-gap,
    premium-plugins,
    plugin-catalog,
    mcpherson-lakehouse,
  ]
---

# Terraform plugin-builder skills should stop at adapter gaps

## Context

THNK-26 produced `.agents/skills/thinkwork-plugin-builder/`, a portable Agent
Skill for turning existing Terraform projects into reviewable ThinkWork
Application Plugin catalog contributions. The first proof target was McPherson
Lakehouse, a premium AWS data-lake plugin candidate spanning S3, Glue, Iceberg,
Dagster, Athena, and related infrastructure.

The durable learning is not merely that a new skill exists. The useful pattern
is the boundary the skill enforces: Terraform intake and contribution planning
can be automated, but generated plugin artifacts must not pretend that an
unsupported deployment path exists. The skill reads source first, maps the
candidate to current catalog contracts, then either prepares catalog artifacts
or stops with an adapter-gap review.

Search mode was used for this compound pass. Evidence came from Linear THNK-26,
its requirements and plan documents, PR #2486, the autopilot status ledger,
verification evidence, repo-local searches for the issue and implementation
files, and Codex worker thread summaries for brainstorm, plan, implementation,
verification, and merge cleanup.

## Guidance

Build Terraform-to-plugin authoring workflows as a sequence of gates, not a
single scaffold generator.

1. **Inventory source before designing artifacts.** Locate Terraform roots,
   modules, providers, variables, outputs, state/backend assumptions, secrets,
   lifecycle risks, and operational docs before proposing a plugin shape.
2. **Target the signed Application Plugin catalog.** Generated work should point
   at `packages/plugin-catalog/src/contracts.ts`, repo-authored manifest files,
   catalog registration, validation tests, and publication checks. It should not
   invent marketplace uploads, sideloading, or a parallel plugin schema.
3. **Use existing premium semantics.** Customer-specific gated plugins should
   use ThinkWork premium install-key metadata and persistent entitlements, not a
   new `licenseKey` or customer-secret field in generated manifests.
4. **Treat managed-app adapters as a closed set.** Infrastructure components
   are valid only when `packages/deployment-runner/src/apps/registry.ts` exposes
   an adapter that can provision or adopt the source project. At THNK-26, the
   supported keys were `cognee` and `twenty`; a lakehouse-shaped Terraform
   project did not become valid by writing `managedAppKey: "lakehouse"`.
5. **Stop with evidence when the platform is missing.** If no adapter fits,
   generate an adapter-gap review that names the source resource categories,
   required inputs/secrets, lifecycle risks, current adapter comparison, and
   follow-up platform paths. That review is the deliverable until adapter work
   or a smaller first plugin slice is accepted.
6. **Keep generated output checkable and non-destructive.** THNK-26 added a
   read-only scanner that flags raw tfvars, secret markers, developer-local
   paths, unsupported license fields, invalid slugs, and unsupported
   `managedAppKey` values unless adapter-gap evidence is present.

## Why This Matters

Terraform projects often look easy to wrap: parse files, write a manifest, add
catalog registration, and call it a plugin. That shortcut is dangerous in
ThinkWork because Application Plugins are not arbitrary Terraform bundles. They
are catalog entries whose components connect to existing install, entitlement,
deployment-runner, MCP, and operator-review contracts.

The adapter-gap stop keeps the product promise honest. A tenant admin should
never see a premium plugin whose manifest claims platform support that the
deployment runner cannot execute. A maintainer should receive one of three
clear outcomes:

- ready for catalog implementation;
- blocked on named adapter/platform work;
- narrowed to a smaller first plugin slice.

That shape also protects customer data. Source Terraform can contain tfvars,
state assumptions, account details, and secret references. The builder should
convert those into input contracts and review notes, not commit the raw material
into a catalog contribution.

## When to Apply

- When an agent is asked to package Terraform, AWS infrastructure, a customer
  POC, a managed application, or an integration repo as a ThinkWork plugin.
- When a plugin contribution includes an `infrastructure` component.
- When a customer-facing premium plugin must preserve product copy while keeping
  substrate names and adapter details internal.
- When the source project may need deployment-runner or Terraform module work
  before a valid manifest can exist.
- When a generated scaffold would otherwise hide uncertainty behind placeholder
  manifest fields.

## Examples

Good outcome for an unsupported lakehouse project:

```text
Source: Terraform inventory shows S3, Glue, Iceberg, Dagster, Athena, IAM.
Catalog fit: premium Application Plugin candidate.
Adapter fit: no current cognee/twenty adapter fits.
Generated result:
- contribution plan
- adapter-gap review
- secret/tfvars exclusion checklist
- follow-up paths under deployment-runner and terraform/modules/app
No generated manifest with managedAppKey: "lakehouse"
```

Poor outcome:

```text
Generated manifest:
componentType: "infrastructure"
managedAppKey: "lakehouse"
licenseKey: "<customer value>"

No adapter exists, no deployment-runner tests exist, and private tfvars were
copied into the package.
```

The poor version gives maintainers a plausible-looking manifest that cannot
deploy safely. The good version preserves momentum without crossing the product
or security boundary.

## Related

- [THNK-26 requirements](../../brainstorms/2026-06-14-plugin-builder-skill-requirements.md)
- [THNK-26 implementation plan](../../plans/2026-06-14-006-feat-plugin-builder-skill-plan.md)
- [THNK-26 autopilot status](../../plans/autopilot/THNK-26-status.md)
- [McPherson Lakehouse plugin-builder proof](../../verification/mcpherson-lakehouse-plugin-builder-proof.md)
- [Plugin builder skill](../../../.agents/skills/thinkwork-plugin-builder/SKILL.md)
- [Company Brain premium plugin operations](../runbooks/company-brain-premium-plugin-operations-2026-06-13.md)
- [Managed applications should reconcile MCP connectors and keep user OAuth separate](./managed-app-mcp-oauth-lifecycle-2026-06-06.md)
- [Injected built-in tools are not workspace skills](../best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md)
- [Skill-catalog slug collisions between execution modes need explicit migration plans](../workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md)
- [PR #2486: add ThinkWork plugin builder](https://github.com/thinkwork-ai/thinkwork/pull/2486)
