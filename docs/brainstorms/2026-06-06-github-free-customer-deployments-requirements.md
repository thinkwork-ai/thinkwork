---
date: 2026-06-06
topic: github-free-customer-deployments
---

# GitHub-Free Customer Deployments

## Problem Frame

ThinkWork is starting to deploy into multiple customer-owned AWS environments,
and not every customer has or wants GitHub. The previous enterprise deployment
repo model avoided source forks, but it still assumed each customer had a
GitHub repository and GitHub Actions workflow. That makes GitHub part of the
customer deployment control plane and creates friction for companies whose
delivery stack lives elsewhere.

The new model should make ThinkWork deployable from the CLI into a customer AWS
account without forking the source repo or creating a customer GitHub repo. The
CLI performs the first bootstrap, then the customer AWS account becomes the
steady-state deployment authority. Operators finish setup from the deployed
Spaces app, manage optional applications from Settings, and distribute one
universal desktop/mobile app that can bind to the customer's deployment
profile.

This document supersedes the GitHub-centered deployment assumptions in
`docs/brainstorms/2026-05-18-enterprise-customer-deployment-repo-requirements.md`.
That older document remains useful context for release manifests, overlays, and
enterprise auditability, but GitHub Actions is no longer the required customer
deployment substrate.

---

## Actors

- A1. Customer platform admin: Runs the first CLI bootstrap with temporary AWS
  administrator access and owns the customer AWS account.
- A2. First ThinkWork admin: Signs into the freshly deployed environment and
  claims the first admin role by email.
- A3. ThinkWork operator: Uses Spaces Settings to configure, deploy, approve,
  and tear down managed applications.
- A4. Customer AWS deployment control plane: Stores deployment configuration,
  runs plan/apply/destroy jobs, records status, and serves deploy evidence.
- A5. ThinkWork release publisher: Publishes signed/versioned release manifests
  and public artifacts that customer AWS deployments can pull without cloning a
  repo.
- A6. Desktop/mobile user: Installs the universal ThinkWork app and binds it to
  the customer's deployment profile before signing in.

---

## Key Flows

- F1. Bootstrap a customer AWS environment
  - **Trigger:** A customer is ready to deploy its first ThinkWork environment.
  - **Actors:** A1, A4, A5
  - **Steps:** The platform admin runs the CLI setup flow, answers deployment
    questions, provides AWS credentials and region, chooses identity-provider
    configuration, enters the first admin email, and selects a ThinkWork release
    manifest. The CLI deploys only the minimal foundation needed for auth, API,
    database, Spaces, deployment jobs, and configuration storage. The CLI prints
    the generated Spaces URL and deployment profile handoff.
  - **Outcome:** The customer AWS account contains a working minimal ThinkWork
    environment and the AWS-native deployment control plane needed for later
    changes.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7

- F2. Claim the first admin and finish setup
  - **Trigger:** The first admin opens the generated Spaces URL after bootstrap.
  - **Actors:** A2
  - **Steps:** The first admin signs in through the configured Cognito
    identity provider. ThinkWork matches the verified email to the pending
    bootstrap admin claim, grants the first tenant/admin role, and opens the
    in-environment setup surface.
  - **Outcome:** The deployed environment has a real admin user and no longer
    depends on the bootstrap operator machine for normal setup.
  - **Covered by:** R8, R9, R10

- F3. Deploy or tear down managed applications
  - **Trigger:** A ThinkWork operator opens Settings -> Managed Applications and
    enables or tears down Cognee, Twenty CRM, or another managed application.
  - **Actors:** A3, A4, A5
  - **Steps:** Spaces records the desired change, starts a plan job in the
    customer AWS deployment control plane, shows resource/data-impact summary
    and deploy evidence links, then requires explicit approval before apply or
    destroy. The deployment job pulls artifacts from the selected ThinkWork
    release manifest and updates status back into Spaces.
  - **Outcome:** Managed applications are deployed or destroyed without GitHub
    Actions, without local Terraform from the browser, and with auditable
    operator approval.
  - **Covered by:** R11, R12, R13, R14, R15, R16, R17, R18

- F4. Bind universal desktop/mobile apps to a customer deployment
  - **Trigger:** A user installs a generic ThinkWork desktop or mobile app and
    needs to use the customer-owned deployment.
  - **Actors:** A2, A6
  - **Steps:** The customer environment exposes or exports a deployment profile.
    The user imports that profile through a setup link, QR code, file, or
    entered deployment code. The app stores the customer API/Auth/AppSync
    endpoints locally and then starts the normal sign-in flow against that
    environment.
  - **Outcome:** The same distributed desktop/mobile app can point at customer
    deployments without customer-specific builds.
  - **Covered by:** R19, R20, R21, R22

---

## Requirements

**Deployment authority and bootstrap**

- R1. The default customer deployment model must not require a ThinkWork source
  fork, a customer GitHub repo, or GitHub Actions.
- R2. The CLI is the initial bootstrap tool; it must gather customer AWS
  account, region, identity-provider, first-admin email, and release-selection
  inputs.
- R3. After first bootstrap, the customer AWS account is the steady-state
  deployment authority, not GitHub and not the operator laptop.
- R4. Initial bootstrap deploys the minimal foundation only: auth, API,
  database, Spaces app, deployment runner/control plane, configuration storage,
  and enough outputs for login and profile binding.
- R5. Initial bootstrap must not require a custom domain. AWS-generated API,
  Cognito, and app URLs are acceptable for v1; custom domain setup is a later
  in-environment task.
- R6. Customer deployment configuration lives in customer AWS after bootstrap:
  non-secret settings in AWS-native config storage and secrets in Secrets
  Manager.
- R7. Customer deploy jobs pull from a signed/versioned ThinkWork release
  manifest and public release artifacts rather than cloning or forking the
  ThinkWork repo.

**First admin and identity**

- R8. Bootstrap asks for the first admin email and stores a pending first-admin
  claim in the deployed environment.
- R9. The first admin claim is completed by signing in with the configured
  Cognito identity provider and matching the verified email to the pending
  claim.
- R10. V1 bootstrap supports configurable enterprise identity providers through
  Cognito, including OIDC or SAML providers such as Microsoft Entra or Okta;
  Google may remain an easy preset.

**Managed applications**

- R11. Spaces Settings -> Managed Applications is the normal operator surface
  for managed application lifecycle after bootstrap.
- R12. V1 success requires at least Cognee and Twenty CRM to deploy and tear
  down through the GitHub-free customer AWS deployment system.
- R13. Managed application enablement and teardown must run through plan
  preview and explicit operator approval before apply or destroy.
- R14. Managed application teardown defaults to a destructive destroy of the
  application's resources and data, not merely parking runtime capacity.
- R15. Destructive teardown must communicate the app-specific data impact before
  approval, especially for CRM and knowledge-graph data.
- R16. Managed application status, plan summary, apply/destroy progress, logs,
  release version, and final endpoints must be visible from Spaces.
- R17. The deployment control plane must support both infrastructure creation
  and infrastructure destruction for optional applications without requiring
  local Terraform execution from the browser session.
- R18. CLI managed-app commands may exist for recovery, but the default operator
  path is Spaces-first rather than CLI-first.

**Universal client configuration**

- R19. Desktop and mobile distributions are universal by default, not
  customer-specific builds with endpoints baked in.
- R20. A deployment profile must contain the customer environment's API,
  GraphQL/AppSync, Cognito/Auth, stage, and display metadata needed for a user
  to bind the app and trust the target environment.
- R21. Desktop/mobile apps must support importing or entering a deployment
  profile before sign-in and storing that profile locally.
- R22. The user-facing sign-in experience must clearly show which customer
  deployment/profile the app is connected to, and must surface incomplete or
  invalid profile configuration before OAuth begins.

**Release and upgrade posture**

- R23. ThinkWork releases must be consumable by customer AWS deployment jobs as
  immutable, versioned artifacts coordinated by a release manifest.
- R24. Customer environments must be able to update the selected ThinkWork
  release without changing source code or creating a GitHub workflow.
- R25. The new model should preserve enough logs, plan artifacts, approvals,
  and smoke-check evidence that customer admins and ThinkWork support can
  diagnose deploy failures without access to a source repo CI run.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given a customer has no GitHub account, when a
  platform admin runs the CLI bootstrap with AWS credentials and a release
  manifest, then the customer receives a minimal working ThinkWork environment
  and AWS-owned deployment control plane.
- AE2. **Covers R8, R9, R10.** Given the CLI stored
  `admin@example.com` as the first admin email and configured an enterprise
  OIDC provider, when that user signs in with a verified matching email, then
  ThinkWork grants the first admin role.
- AE3. **Covers R11, R12, R13, R16.** Given the first admin opens Managed
  Applications, when they enable Cognee, then Spaces shows a plan preview,
  requires approval, starts the customer AWS deployment job, and later shows
  Cognee status and endpoint details.
- AE4. **Covers R14, R15, R17.** Given Twenty CRM has been deployed, when an
  operator tears it down, then Spaces warns that CRM data/resources will be
  destroyed, requires explicit approval, and runs a customer AWS destroy job.
- AE5. **Covers R19, R20, R21, R22.** Given a user installs the universal
  desktop app, when they import the customer's deployment profile, then the app
  stores the endpoints, shows the connected customer/stage, and signs in
  against that customer's Cognito configuration.
- AE6. **Covers R23, R24, R25.** Given a customer environment is on release
  `2026.6.1`, when an operator selects release `2026.6.2`, then the customer
  AWS deployment control plane pulls the new manifest/artifacts, produces plan
  evidence, and applies the upgrade after approval.

---

## Success Criteria

- A customer without GitHub can deploy a minimal ThinkWork environment into
  their AWS account and log into Spaces without a source fork or customer CI
  repository.
- Operators can enable and tear down Cognee and Twenty from Spaces using
  customer-AWS deployment jobs with plan preview and approval.
- Desktop and mobile users can connect one universal app distribution to a
  customer deployment through a deployment profile.
- Planning can proceed without inventing who owns steady-state deployment,
  where configuration lives, how first admin claim works, what managed-app
  lifecycle means, or how client apps find customer endpoints.

---

## Scope Boundaries

### Deferred for later

- Customer custom domains during bootstrap. V1 uses generated AWS/Cognito URLs
  first and adds domain setup after login.
- A ThinkWork-hosted central directory for endpoint discovery. Universal apps
  use deployment profiles first.
- Customer-specific branded desktop/mobile builds.
- Non-AWS deployment targets. ThinkWork remains AWS-native.
- A full generic app marketplace. V1 proves the lifecycle with Cognee and
  Twenty CRM.
- Rich policy automation for low-risk immediate applies. V1 uses plan preview
  and approval for managed-app changes.
- Migration tooling from existing GitHub deployment repos to the new
  AWS-native model.

### Outside this product's identity

- Making GitHub Actions the required customer deployment substrate.
- Making the operator laptop the steady-state deployment authority after
  bootstrap.
- Turning ThinkWork into a hosted SaaS control plane that deploys into customer
  accounts by default.
- Shipping separate customer-specific client binaries as the normal way to
  select a deployment.

---

## Key Decisions

- **Customer AWS owns steady-state deployment:** This removes GitHub and local
  laptops from normal deploy authority while preserving customer account
  ownership.
- **Bootstrap is minimal:** The CLI should get operators to a working login and
  setup surface, not ask every product and managed-app question up front.
- **First admin claim uses email:** This matches the existing pending-owner
  claim pattern and avoids generated bootstrap passwords or broadly shareable
  setup tokens.
- **Managed apps are Spaces-first:** The product surface should own normal
  app lifecycle; CLI remains bootstrap/recovery.
- **Teardown is destructive by default:** "Tear down" means destroy managed-app
  resources/data unless a future product introduces a separate park/disable
  mode.
- **Universal apps bind by deployment profile:** Desktop and mobile should not
  require customer-specific builds or a central directory to reach a customer
  environment.
- **Release manifests replace repo checkout:** Customer deployment jobs consume
  immutable ThinkWork releases, not source repos.

---

## Dependencies / Assumptions

- The existing `bootstrapUser` pending-owner email pattern can be extended for
  first admin claim in customer-owned bootstrap environments.
- The existing desktop and Spaces configuration model already exposes missing
  endpoint/auth values; planning can adapt that toward deployment profiles.
- ThinkWork can publish enough release artifacts for customer AWS jobs to
  deploy without compiling the monorepo from source.
- Customer platform admins can obtain temporary AWS administrator access for
  the initial bootstrap.
- Customer identity providers can provide a verified email claim through the
  chosen Cognito integration.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R3, R6, R13][Technical] What exact AWS services should form the
  deployment control plane: Step Functions plus CodeBuild, CodePipeline,
  AppConfig, SSM, DynamoDB, or a smaller combination?
- [Affects R7, R23][Technical] What should the signed release manifest contain,
  and how should customer AWS verify artifact integrity?
- [Affects R10][Technical] Which identity-provider inputs are required for
  OIDC versus SAML bootstrap, and what presets should the CLI offer?
- [Affects R14, R15][Technical] Which managed-app resources/data are destroyed
  for Cognee and Twenty, and what confirmation language/evidence is required?
- [Affects R20, R21][Technical] What exact deployment profile format and import
  mechanisms should desktop and mobile support first?
- [Affects R25][Technical] What smoke checks and deploy evidence should be
  mandatory for foundation deploys, managed-app deploys, and upgrades?

---

## Next Steps

-> /ce-plan for structured implementation planning.
