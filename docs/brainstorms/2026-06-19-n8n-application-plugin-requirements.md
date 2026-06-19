---
date: 2026-06-19
topic: n8n-application-plugin
linear: THNK-50
---

# n8n Application Plugin

## Problem Frame

ThinkWork needs a curated n8n application plugin so tenants can run a clean,
self-hosted orchestration runtime inside their AWS deployment and let agents
help build and maintain n8n workflows. The starting point is the existing
LastMile n8n ECS deployment pattern, but THNK-50 is not a migration of the
LastMile custom nodes or workflows. V1 should package n8n as a ThinkWork
Application Plugin, deploy it through the managed-app runner, expose native
n8n MCP to agents, and preserve human control over production workflow
activation.

The plugin exists alongside ThinkWork's native Routines work. It is for cases
where keeping n8n as the orchestration application is the right customer path,
not a replacement for the previous plan to migrate selected n8n workflows into
Step Functions-backed ThinkWork routines.

---

## Actors

- A1. Tenant operator: Installs, configures, deploys, parks, destroys, and
  reviews evidence for the n8n plugin.
- A2. Shared n8n operator: Uses the native n8n UI account to review and
  activate production workflow changes.
- A3. ThinkWork agent: Uses n8n MCP to inspect, draft, create, update, test,
  and run allowed workflows on behalf of the tenant.
- A4. ThinkWork platform: Owns plugin install state, managed-app deployment
  jobs, image build evidence, MCP registration, and runtime health reporting.
- A5. n8n runtime: Runs the self-hosted workflow editor, API, webhooks, queue,
  workers, native MCP server, and Code node package environment.

---

## Key Flows

- F1. Install and deploy n8n
  - **Trigger:** A tenant operator installs or upgrades the n8n plugin from
    Settings -> Plugins.
  - **Actors:** A1, A4, A5
  - **Steps:** ThinkWork records the plugin install, gathers required n8n
    desired configuration, produces a managed-app deployment plan, requires
    approval, provisions the queue-mode n8n runtime through the deployment
    runner, and records endpoint, image, service, database, queue, and smoke
    evidence.
  - **Outcome:** n8n is running at `n8n.[thinkwork domain]` with a managed
    runtime status visible in ThinkWork.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R18

- F2. Configure Code node packages
  - **Trigger:** A tenant operator changes the n8n custom package list in the
    plugin detail settings.
  - **Actors:** A1, A4, A5
  - **Steps:** ThinkWork validates the package specs, stores them as desired
    config, produces a new managed-app plan, rebuilds or selects a digest-pinned
    wrapper image containing the packages, updates n8n main and worker services
    after approval, and records the package/image evidence.
  - **Outcome:** n8n Code nodes can import the approved packages after the
    approved deployment completes.
  - **Covered by:** R9, R10, R11, R12, R18

- F3. Agent drafts or updates workflows
  - **Trigger:** A user asks a ThinkWork agent to inspect, create, revise, test,
    or run an n8n workflow.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** ThinkWork exposes the native n8n MCP server through the plugin's
    tenant service credential. The agent reads the relevant workflow and
    execution context, drafts or updates workflow definitions through native
    n8n MCP, returns evidence, and leaves production activation to the shared
    n8n operator.
  - **Outcome:** Workflow changes can be prepared by agents, but production
    activation remains a human action in n8n.
  - **Covered by:** R13, R14, R15, R16, R17

- F4. Park or destroy n8n
  - **Trigger:** A tenant operator parks runtime capacity or approves
    destructive teardown.
  - **Actors:** A1, A4, A5
  - **Steps:** ThinkWork runs the managed-app lifecycle action through the same
    job, approval, evidence, and smoke pattern used for deploy. Parking retains
    data and re-enable state; destroy removes app-owned runtime resources and
    records destructive impact.
  - **Outcome:** Operators can stop or remove n8n without bypassing managed-app
    evidence and approval controls.
  - **Covered by:** R6, R7, R18, R19, R20

---

## Requirements

**Plugin and managed runtime**

- R1. n8n must ship as a first-party Application Plugin under the plugin package
  model, with n8n-specific manifest, deployment, runtime, settings, smoke, and
  documentation source owned by the n8n plugin package.
- R2. The plugin must deploy through the ThinkWork application-plugin installer
  and managed-app deployment runner, not through a local Docker Compose run,
  manual Terraform shortcut, or vendor cloud deployment.
- R3. The public runtime URL must default to `n8n.[thinkwork domain]`.
- R4. V1 must deploy n8n in queue mode with a main service plus one or more
  worker services.
- R5. n8n must use a separate database named `thinkwork_n8n` by default on the
  existing ThinkWork database instance.
- R6. n8n queue mode must use a dedicated private managed Valkey/Redis queue,
  not a shared platform cache and not an ECS sidecar queue.
- R7. n8n binary/file storage must use durable AWS storage appropriate for the
  managed runtime, following the LastMile template's S3-backed lesson without
  copying LastMile custom nodes.
- R8. The runtime must expose enough status and smoke evidence for operators to
  inspect endpoint health, main/worker service state, queue/database/storage
  wiring, image digest, and recent deployment result.

**Runtime image and custom packages**

- R9. V1 must use a thin ThinkWork-owned n8n wrapper image based on the official
  n8n image, without including the LastMile custom n8n nodes, credentials, or
  vendor-specific package layer.
- R10. The n8n Plugin Detail settings must let an operator configure custom Code
  node npm packages using only pinned public npm package specs such as
  `lodash@4.17.21`.
- R11. V1 must reject unpinned package specs, semver ranges, git URLs, tarballs,
  private registry packages, and registry credential configuration.
- R12. The approved package list must drive both the wrapper image install and
  n8n's external module allow-list configuration, including task-runner
  placement if planning confirms task runners are part of the deployed n8n
  shape.

**Agent control and human activation**

- R13. The plugin must register n8n's native instance-level MCP server for
  ThinkWork agent use.
- R14. n8n MCP access must use a tenant service credential because the selected
  self-hosted n8n edition does not provide the required per-user activation
  model.
- R15. Agents may inspect workflows and executions, create or update draft
  workflows, test workflows, and run already-approved workflows through native
  n8n MCP when the native tool surface supports those actions.
- R16. V1 relies on instruction-level guardrails for `publish_workflow` and
  `unpublish_workflow`: agents must be instructed not to publish, unpublish, or
  otherwise activate production workflow changes.
- R17. Human production activation and recovery must happen through one native
  n8n local/shared operator account because the selected n8n edition does not
  include the desired enterprise identity model.

**Lifecycle and safety**

- R18. n8n deploy, package changes, upgrades, park, and destroy actions must use
  the managed-app plan, approval, apply, smoke, and evidence flow.
- R19. Parking n8n must stop runtime capacity while preserving the
  `thinkwork_n8n` database, queue continuity needed for re-enable, storage,
  secrets, package configuration, and the public URL/redeploy path where
  practical.
- R20. Destroying n8n must be explicit and destructive, with evidence that
  app-owned runtime resources, stored service credentials, custom package image
  references, storage, and database state were removed or intentionally retained
  according to the approved plan.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R5, R6, R8.** Given a tenant operator installs
  the n8n plugin, when the managed-app deployment is approved and applied, then
  n8n is available at `n8n.[thinkwork domain]`, runs in queue mode with main and
  worker services, uses `thinkwork_n8n` on the existing ThinkWork database
  instance, uses a dedicated managed Valkey/Redis queue, and shows runtime
  evidence in ThinkWork.
- AE2. **Covers R9, R10, R11, R12, R18.** Given an operator enters
  `lodash@4.17.21` and `date-fns@4.1.0` in the n8n Plugin Detail package
  settings, when they approve the resulting plan, then ThinkWork rebuilds or
  selects a digest-pinned wrapper image containing those packages, updates the
  relevant n8n services, configures n8n to allow those packages in Code nodes,
  and records package/image evidence.
- AE3. **Covers R10, R11.** Given an operator enters `lodash`, `lodash@^4`,
  a git URL, a tarball URL, or a private package spec, when they save the n8n
  package settings, then ThinkWork rejects the input before plan/apply with a
  clear validation message.
- AE4. **Covers R13, R14, R15, R16, R17.** Given n8n is running and native MCP
  is configured with the tenant service credential, when a ThinkWork agent is
  asked to create a workflow, then the agent can draft or update the workflow
  through native n8n MCP and return evidence, but its bundled instructions tell
  it to leave `publish_workflow` and `unpublish_workflow` to the shared n8n
  operator.
- AE5. **Covers R18, R19, R20.** Given n8n is running with custom packages and
  workflow data, when an operator parks it, then runtime capacity stops without
  deleting data or desired config; when an operator later approves destroy,
  then ThinkWork records destructive impact and cleanup evidence.

---

## Success Criteria

- A tenant operator can install n8n from ThinkWork, approve the deployment, and
  open a healthy self-hosted n8n runtime at `n8n.[thinkwork domain]`.
- The deployed n8n runtime is production-shaped for the expected use case:
  queue mode, separate workers, dedicated Valkey/Redis, separate
  `thinkwork_n8n` database, durable storage, and managed smoke evidence.
- ThinkWork agents can use native n8n MCP to inspect, draft, update, test, and
  run workflows while the v1 product contract leaves production activation to a
  human n8n operator.
- Operators can add pinned public npm packages for Code nodes through the n8n
  plugin settings, and those package changes follow the same approval/evidence
  path as other runtime changes.
- Planning can proceed without inventing product scope around auth model,
  runtime topology, package policy, human activation, or LastMile custom-node
  migration.

---

## Scope Boundaries

- V1 does not bring over LastMile custom nodes, credentials, workflows, or
  vendor-specific node packages.
- V1 does not replace n8n workflows with ThinkWork Routines; selected workflow
  migration remains covered by earlier routine-migration work.
- V1 does not deploy n8n Cloud or n8n Enterprise.
- V1 does not promise per-user n8n activation, SSO, or user-scoped n8n MCP
  credentials.
- V1 does not hard-block native MCP `publish_workflow` or `unpublish_workflow`
  at the tool layer; the selected guardrail is instruction-level only.
- V1 does not support private npm registries, git dependencies, tarball
  dependencies, unpinned packages, or broad `NODE_FUNCTION_ALLOW_EXTERNAL=*`.
- V1 does not expose a general arbitrary Dockerfile editor to operators.
- V1 does not make package edits live immediately outside the managed-app
  approval flow.

---

## Key Decisions

- **Native n8n stays in the product.** THNK-50 keeps n8n as a managed
  application rather than replacing it with native ThinkWork Routines.
- **Queue mode is required.** The LastMile deployment's reusable lesson is the
  production n8n topology: main process, workers, Postgres, Redis/Valkey queue,
  S3-style durable storage, and ALB health checks.
- **Use the existing database instance with a separate database.** n8n defaults
  to `thinkwork_n8n` on the existing ThinkWork database instance rather than a
  separate database instance.
- **Use a dedicated queue.** n8n's queue mode gets a dedicated managed
  Valkey/Redis resource to avoid coupling workflow execution to shared platform
  cache behavior.
- **Use tenant service credentials.** The selected self-hosted n8n edition does
  not provide the desired per-user activation model, so v1 uses a tenant
  service credential for native MCP.
- **Use native MCP directly.** ThinkWork does not build a custom n8n control
  MCP wrapper in v1.
- **Leave production activation to humans by instruction.** Native MCP exposes
  publish/unpublish tools, but v1 intentionally relies on agent instructions
  rather than technical tool filtering.
- **Own a thin image, not custom nodes.** ThinkWork owns a wrapper image only
  to support approved Code node packages and bootstrap needs; it does not clone
  the LastMile node catalog.
- **Package changes are runtime changes.** Custom package edits require
  managed-app plan/approval/apply and evidence because they change executable
  code inside the running n8n environment.

---

## Dependencies / Assumptions

- n8n native MCP remains available in the selected self-hosted edition and
  exposes the workflow management, execution, and builder tools needed for v1.
- The selected n8n image/version supports Code node external packages through
  installed npm modules plus n8n allow-list configuration.
- The deployment runner can either build the thin wrapper image as part of the
  managed-app flow or consume an image artifact produced by a controlled build
  step, while recording the resulting digest in evidence.
- ThinkWork can create and manage a dedicated `thinkwork_n8n` database on the
  existing database instance without weakening isolation for the primary
  ThinkWork schema.
- n8n package settings in the plugin detail page can be represented as desired
  config for the managed-app deployment job.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R4, R14][Technical] Confirm whether the deployed n8n shape uses
  n8n task runners in addition to queue-mode workers, and where package
  allow-list environment variables must be placed.
- [Affects R9-R12][Technical] Decide the exact image build path, digest
  capture, cache behavior, and rollback behavior for package-list changes.
- [Affects R10-R11][Technical] Define the package-spec validator, including
  allowed npm name syntax, exact-version syntax, duplicate handling, and
  package removal behavior.
- [Affects R13-R16][Technical] Confirm native n8n MCP endpoint, authentication
  token creation/rotation, and registration details for the ThinkWork plugin
  manifest.
- [Affects R5-R8, R18-R20][Technical] Decide the Terraform resource ownership
  split for database creation, Valkey/Redis, storage, ALB/DNS, secrets,
  service desired counts, and smoke outputs.
- [Affects R16][Technical] Decide the exact bundled n8n skill wording that
  instructs agents not to publish or unpublish production workflows.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
