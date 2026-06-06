---
title: "GitHub-free customer deployments use an AWS-native bootstrap-to-control-plane pattern"
date: 2026-06-06
category: architecture-patterns
module: customer-deployments
problem_type: architecture_pattern
component: development_workflow
severity: high
applies_when:
  - "Customer deployment currently depends on a customer-owned GitHub repository, GitHub Actions, or workflow dispatch permissions"
  - "A one-time CLI bootstrap is acceptable, but steady-state deploy, destroy, and upgrade authority must live inside the customer AWS account"
  - "Managed applications need browser-visible plan, approval, progress, logs, endpoints, and evidence instead of CI-run breadcrumbs"
  - "Desktop or mobile clients must connect to customer-specific endpoints without shipping customer-specific binaries"
  - "Deployment changes span CLI bootstrap, Terraform, AWS orchestration, GraphQL APIs, product UI, identity claim, and client profile binding"
related_components:
  - authentication
  - database
  - tooling
  - documentation
tags:
  - github-free
  - customer-deployments
  - aws-native
  - bootstrap
  - control-plane
  - managed-apps
  - release-manifest
  - deployment-profile
---

# GitHub-free customer deployments use an AWS-native bootstrap-to-control-plane pattern

## Context

ThinkWork's enterprise deployment path had already moved away from customer
source forks, but it still made a customer-owned GitHub deployment repository
and GitHub Actions the effective deployment control plane. That failed the next
customer requirement: not every customer has GitHub, and a ThinkWork deployment
should not require workflow dispatch permissions in a customer repository.

The replacement pattern is bootstrap-first and AWS-native. The CLI performs the
first-mile setup with temporary AWS administrator access, then steady-state
deployment authority moves into the customer AWS account. Step Functions
orchestrates deployment jobs, CodeBuild owns Terraform execution, customer AWS
stores configuration and secrets, Spaces becomes the operator surface, and
desktop/mobile clients bind to a customer environment with deployment profiles.

Session history confirmed two important rejected paths. The old Cognee path
patched GitHub Actions variables such as `COGNEE_ENABLED` and dispatched
`.github/workflows/deploy.yml`. An earlier idea treated the new runner like
another Lambda path, but the final plan corrected that so CodeBuild owns
Terraform execution while Lambda/API code handles control-plane callbacks and
product state (session history).

## Guidance

Use this split when replacing a repo-backed customer deployment path:

1. Keep CLI bootstrap narrow. It should gather AWS account, region,
   first-admin email, release selection, and identity-provider inputs, then
   deploy only the foundation needed to sign in and operate the environment.
2. Move durable deployment authority into customer AWS. Use SSM/AppConfig for
   non-secret config, Secrets Manager for secrets, S3 for artifacts/evidence,
   Aurora for job state, Step Functions for orchestration, and CodeBuild for
   Terraform plan/apply/destroy.
3. Make release artifacts explicit and fail-closed. Deployment jobs consume
   signed/versioned release manifests and public artifact digests instead of
   cloning or forking source.
4. Model managed applications as durable deployment jobs. Each app needs a plan
   preview, approval, destructive-impact summary, job events, status,
   endpoint/log evidence, and smoke result.
5. Put the normal operator flow in Spaces. CLI managed-app commands are
   recovery/bootstrap support, not the happy path.
6. Claim the first admin through Cognito verified email. Avoid bootstrap
   passwords, forwarded setup tokens, or local credentials that become a second
   authority.
7. Ship universal clients. Desktop and mobile apps import a deployment profile
   before OAuth so customer-specific endpoints do not require customer-specific
   app binaries.

The implemented sequence landed as reviewable slices:

- [#2163](https://github.com/thinkwork-ai/thinkwork/pull/2163) added the
  signed release manifest contract, artifact verification, and fail-closed CLI
  digest handling.
- [#2165](https://github.com/thinkwork-ai/thinkwork/pull/2165) added the
  inert AWS deployment control-plane substrate and GitHub-free bootstrap
  planning.
- [#2166](https://github.com/thinkwork-ai/thinkwork/pull/2166) hardened
  first-admin Cognito claims and Google/OIDC/SAML bootstrap validation.
- [#2169](https://github.com/thinkwork-ai/thinkwork/pull/2169) added durable
  managed-app deployment jobs, APIs, approvals, and evidence.
- [#2172](https://github.com/thinkwork-ai/thinkwork/pull/2172) added Cognee and
  Twenty runner adapters, destructive-impact summaries, and smoke contracts.
- [#2174](https://github.com/thinkwork-ai/thinkwork/pull/2174) moved managed
  app lifecycle into Spaces.
- [#2177](https://github.com/thinkwork-ai/thinkwork/pull/2177),
  [#2180](https://github.com/thinkwork-ai/thinkwork/pull/2180), and
  [#2183](https://github.com/thinkwork-ai/thinkwork/pull/2183) added the
  deployment profile contract plus desktop and mobile profile binding.
- [#2187](https://github.com/thinkwork-ai/thinkwork/pull/2187) added operator
  docs and smoke evidence envelopes.
- [#2190](https://github.com/thinkwork-ai/thinkwork/pull/2190) closed out the
  plan and autopilot ledger.

## Why This Matters

This removes GitHub from the customer deployment critical path without losing
auditability. Customers can deploy into their own AWS account without a source
fork, customer GitHub repository, customer GitHub Actions, or local Terraform
as the long-term authority.

It also makes deployment supportable. Each operation can be tied to a release
manifest digest, Terraform plan/apply artifacts, an explicit approval, a Step
Functions execution, a CodeBuild build, S3 evidence, CloudWatch logs, and smoke
results. When a managed-app deployment fails, support can inspect the customer
control-plane evidence instead of reconstructing intent from a GitHub workflow
run and a browser toggle.

The sequencing matters as much as the destination. The work followed the
substrate-first/inert-to-live pattern: release contract, control-plane
substrate, identity, job API, app adapters, UX, profile clients, and finally
docs/smokes. That kept each PR independently reviewable and mergeable while
avoiding a big-bang replacement of the GitHub workflow path.

## When to Apply

- A customer-owned AWS deployment must not depend on customer GitHub or GitHub
  Actions.
- The initial operator can run a guided CLI bootstrap, but steady-state
  operations need to live inside customer AWS.
- Optional infrastructure-backed applications need plan/approve/apply/destroy
  lifecycle and evidence.
- Desktop or mobile clients must connect to many customer deployments without
  per-customer builds.
- Release upgrades need immutable artifact verification and supportable
  evidence.
- You are replacing an existing deployment substrate and need incremental,
  reviewable migration slices.

Do not apply this when the product requirement is a hosted SaaS control plane
that deploys into customer accounts, non-AWS infrastructure, or
customer-specific branded binaries as the default routing mechanism.

## Examples

Before:

```text
customer GitHub repo -> GitHub Actions deploy.yml -> Terraform apply
Spaces toggle -> GitHub token/variable/workflow dispatch
desktop/mobile build -> endpoints baked from env
```

After:

```text
thinkwork deploy --bootstrap -> customer AWS foundation
Spaces Managed Applications -> GraphQL deployment job
Step Functions -> CodeBuild Terraform runner -> S3 evidence
signed release manifest -> verified artifacts
deployment profile -> universal desktop/mobile OAuth target
```

Operational guardrails from the rollout:

- Keep workspace-only packages out of published CLI runtime dependencies unless
  the published package can resolve them; PR #2163 initially failed CI from a
  `workspace:*` runtime dependency.
- Hand-rolled migrations must be applied to dev before Migration Drift Precheck
  can pass; this affected first-admin claim and managed deployment migrations.
- Expect `main` to move during a multi-PR autopilot arc. Rebase each unit,
  rerun focused checks, and merge only after current-base checks pass.
- Treat existing warnings separately from new failures. The rollout recorded
  existing docs build warnings, optional `canvas` native build warnings, and
  pre-existing mobile typecheck issues instead of hiding them.
- Do not bypass failed deployment jobs with local Terraform. Retry through the
  customer AWS control plane so approvals, manifests, evidence, and job state
  remain aligned.

## Related

- [`docs/brainstorms/2026-06-06-github-free-customer-deployments-requirements.md`](../../brainstorms/2026-06-06-github-free-customer-deployments-requirements.md)
  - origin requirements.
- [`docs/plans/2026-06-06-001-feat-github-free-customer-deployments-plan.md`](../../plans/2026-06-06-001-feat-github-free-customer-deployments-plan.md)
  - implementation plan and U1-U8 breakdown.
- [`docs/src/content/docs/deploy/github-free-customer-deployments.mdx`](../../src/content/docs/deploy/github-free-customer-deployments.mdx)
  - operator runbook for the new deployment path.
- [`docs/src/content/docs/deploy/managed-applications.mdx`](../../src/content/docs/deploy/managed-applications.mdx)
  - Cognee and Twenty lifecycle operations.
- [`docs/src/content/docs/deploy/deployment-profiles.mdx`](../../src/content/docs/deploy/deployment-profiles.mdx)
  - universal client binding.
- [`docs/src/content/docs/deploy/release-manifests.mdx`](../../src/content/docs/deploy/release-manifests.mdx)
  - artifact trust and upgrade evidence.
- [`inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`](./inert-first-seam-swap-multi-pr-pattern-2026-05-08.md)
  - substrate-first sequencing pattern used by this rollout.
- [`../developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md`](../developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md)
  - precedent for closing a long multi-PR plan with a status-only PR.
- [`../workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`](../workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md)
  - why smoke/evidence gates matter for deployment work.
- GitHub issues: no directly related issues were found during compounding.
