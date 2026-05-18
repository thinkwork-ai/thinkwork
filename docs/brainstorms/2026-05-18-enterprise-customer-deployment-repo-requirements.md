---
date: 2026-05-18
topic: enterprise-customer-deployment-repo
---

# Enterprise Customer Deployment Repo

## Problem Frame

ThinkWork needs a repeatable way to deploy the foundation into a new enterprise customer's AWS account while still supporting contracted customization such as evals, seed data, skills, workspace defaults, and limited product changes.

The deployment model should not ask customers to fork the whole ThinkWork source repo as the normal path. A full fork makes customer one faster but turns every future customer into a merge-management problem. The durable strategy is a customer-owned deployment repo that pins a ThinkWork release, carries customer overlays, and deploys through customer-owned CI after a one-time local bootstrap.

---

## Actors

- A1. Enterprise platform admin: Runs the first bootstrap with temporary AWS admin access and owns the customer AWS account.
- A2. Customer GitHub admin: Grants repo/environment access and approves production deployments.
- A3. ThinkWork delivery engineer: Builds customer-specific changes, eval packs, and seed packs; upstreams reusable platform changes.
- A4. Customer deployment CI: Assumes an AWS deploy role through GitHub OIDC and performs repeatable deploys.
- A5. ThinkWork source repo/release pipeline: Produces versioned platform artifacts that customer deployment repos can pin and upgrade.

---

## Key Flows

- F1. Bootstrap a new customer AWS account

  - **Trigger:** A new enterprise customer is ready for its first ThinkWork environment.
  - **Actors:** A1, A2, A3
  - **Steps:** Admin installs the CLI locally -> CLI verifies AWS identity, region, quotas, Bedrock access, and permissions -> CLI creates Terraform state storage and lock table -> CLI creates the GitHub OIDC provider and scoped deploy roles -> CLI creates or updates the customer deployment repo configuration -> CLI dispatches the first CI deployment.
  - **Outcome:** CI, not the local laptop, becomes the deploy authority for subsequent runs.
  - **Covered by:** R1, R2, R3, R4

- F2. Deploy or upgrade ThinkWork

  - **Trigger:** A customer deployment repo changes, a ThinkWork version is bumped, or an operator manually dispatches a workflow.
  - **Actors:** A2, A4, A5
  - **Steps:** CI reads the pinned ThinkWork version and customer overlay -> CI applies Terraform and deploys application artifacts -> CI runs migrations -> CI applies baseline and customer seed packs -> CI runs smoke checks -> production deploys require the configured GitHub Environment approval.
  - **Outcome:** The customer AWS account is reproducibly deployed from auditable CI logs.
  - **Covered by:** R5, R6, R7, R8

- F3. Deliver customer-specific customization
  - **Trigger:** Contracted work requires a new eval pack, skill, workspace default, seed, branding change, or platform capability.
  - **Actors:** A3, A5
  - **Steps:** Delivery engineer starts in the customer overlay when the change is customer-specific -> reusable platform behavior is implemented in the ThinkWork source repo behind a releaseable extension point or configuration boundary -> ThinkWork cuts a release -> customer deployment repo bumps the pinned version and overlay as needed.
  - **Outcome:** Customer customization ships without making a full ThinkWork fork the official operating model.
  - **Covered by:** R9, R10, R11, R12

---

## Requirements

**Operating model**

- R1. The default enterprise deployment model is a customer-owned deployment repo, not a fork of the full ThinkWork source repo.
- R2. The local CLI is the bootstrap and orchestration tool for initial setup; it is not the steady-state production deployment authority.
- R3. The first bootstrap runs from an admin laptop with temporary AWS admin-equivalent access and creates the trust bridge needed for CI to deploy afterward.
- R4. Steady-state deploys use GitHub Actions OIDC to assume scoped AWS deploy roles. Long-lived AWS access keys are not the default enterprise path.

**Deployment repo**

- R5. The customer deployment repo pins a ThinkWork release/version and contains customer-owned deployment configuration, environment overlays, and customer-specific assets.
- R6. The deployment repo supports multiple stages in one AWS account for the first enterprise model, with GitHub Environment approval available for production-like stages.
- R7. CI deploys infrastructure, application artifacts, runtime artifacts, database migrations, baseline seeds, customer seeds, and eval packs from the pinned release plus overlay.
- R8. CI produces enough logs and smoke-check output that the customer and ThinkWork can diagnose failed deploys without relying on the original bootstrap machine.

**Customization boundary**

- R9. Customer-specific customization starts in the customer overlay: evals, seed data, skills, workspace defaults, branding, customer docs, and environment-specific configuration.
- R10. Reusable product or platform behavior is implemented in the ThinkWork source repo, released, and consumed by bumping the pinned version in the deployment repo.
- R11. If a customer need cannot be expressed through the overlay, the preferred next move is to add an upstream extension point or configuration surface, not fork the platform.
- R12. A full ThinkWork fork is an emergency escape hatch only; it is not a recommended customer deployment strategy and should create explicit fork-debt tracking if used.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R7.** Given a new customer deployment repo with a pinned ThinkWork version and an eval pack, when CI deploys `prod`, then the customer's AWS account receives the pinned ThinkWork foundation plus that eval pack without requiring a fork of the ThinkWork source repo.
- AE2. **Covers R2, R3, R4.** Given a customer admin has temporary AWS admin access, when they run the bootstrap command, then the command creates state storage, lock table, GitHub OIDC trust, and scoped deploy roles, and future deploys run through CI without long-lived AWS access keys.
- AE3. **Covers R9, R10, R11.** Given a contracted customization starts as a new customer eval and later reveals a missing platform capability, when ThinkWork delivers the capability, then the reusable part lands upstream behind a releaseable boundary and the deployment repo consumes it through a version bump.

---

## Success Criteria

- A first enterprise customer can deploy ThinkWork into a fresh AWS account from a customer-owned GitHub workflow after one local bootstrap.
- Customer-specific evals, seeds, skills, and workspace defaults can ship without modifying the ThinkWork source repo.
- Reusable contracted work flows back into the ThinkWork source repo and is adopted by customer deployment repos through version bumps.
- A downstream planner can identify the bootstrap work, release packaging work, CI deployment work, and overlay contract work without inventing the deployment model.

---

## Scope Boundaries

- Forking the whole ThinkWork source repo as the normal customer path is out of scope.
- A fully managed ThinkWork-hosted SaaS deployment is out of scope for this model.
- Separate AWS accounts for staging and production are deferred; first enterprise shape is one AWS account with multiple stages.
- Local laptop production deploys after bootstrap are out of scope except for break-glass recovery.
- Customer-specific secrets must not be committed to the deployment repo; GitHub Environments, AWS Secrets Manager, and SSM are the intended homes.
- The exact implementation of release artifact packaging is deferred to planning.

---

## Key Decisions

- Use a deployment repo, not a source fork: This keeps the customer-owned operating surface small and makes upgrades a version bump instead of a recurring merge project.
- Keep the CLI in the loop, but not in charge forever: The CLI is ideal for guided bootstrap and workflow dispatch; CI is better for auditability, approvals, and repeatability.
- Treat customization as overlay-first: Evals, skills, seeds, workspace defaults, and branding are customer assets. Core platform changes should become upstream capabilities.
- Use OIDC for AWS access: It avoids long-lived AWS keys in GitHub and matches enterprise security expectations.

---

## Dependencies / Assumptions

- ThinkWork can produce or already has enough versioned release artifacts for a deployment repo to pin the platform without copying the whole source tree.
- The current Terraform module and greenfield example provide a starting point, but planning must decide the exact release and environment overlay mechanics.
- The customer is comfortable with one AWS account and multiple stages for the first deployment.
- GitHub is the assumed customer CI provider for the first version.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R7][Technical] What exact artifact set does a customer deployment repo pin: Terraform module version, CLI version, container images, Lambda zips, SPA bundles, seed bundle, or a release manifest that coordinates all of them?
- [Affects R7, R9][Technical] What is the customer overlay contract for evals, seeds, skills, workspace defaults, and branding?
- [Affects R3, R4][Technical] What IAM permissions are required for the one-time bootstrap role versus the steady-state CI deploy role?
- [Affects R6][Technical] How should `dev` and `prod` state keys, workspace names, and GitHub Environments be named for customer repos?

---

## Next Steps

-> /ce-plan for structured implementation planning.
