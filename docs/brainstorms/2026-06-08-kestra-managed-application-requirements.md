---
date: 2026-06-08
topic: kestra-managed-application
---

# Kestra Managed Application

## Problem Frame

ThinkWork should offer Kestra as an optional managed application for customers
who want durable orchestration but do not want to manually install, operate, or
author workflows inside a separate app. The target experience is not "open
Kestra and click around." It is "ask a ThinkWork agent to build, run, inspect,
and evolve orchestrations," while ThinkWork owns the application lifecycle,
evidence, credentials, and MCP tool surface.

The closest existing precedent is Twenty CRM: operators deploy and inspect a
managed app from Applications, and ThinkWork reconciles a managed MCP
registration for agents. Kestra extends that pattern because the managed MCP
server is not only a connector. It becomes the control plane that lets agents
create and operate Kestra flows through a curated, audited interface.

---

## Actors

- A1. ThinkWork operator: Deploys, parks, destroys, and inspects Kestra from
  Applications.
- A2. ThinkWork agent: Creates, updates, validates, triggers, and troubleshoots
  Kestra orchestrations through MCP.
- A3. ThinkWork platform: Runs the deploy pipeline, stores service credentials,
  reconciles MCP registration, and records evidence.
- A4. Customer stakeholder: Requests automations and reviews outcomes without
  needing to use the Kestra UI directly.
- A5. Kestra runtime: Executes flows, stores orchestration state, exposes API
  and UI access, and returns execution/log/status data.

---

## Key Flows

- F1. Deploy Kestra as a managed application
  - **Trigger:** An operator chooses Deploy for Kestra from Applications.
  - **Actors:** A1, A3, A5
  - **Steps:** ThinkWork prepares a managed-app deployment job, applies the
    selected Kestra release/configuration through the normal pipeline, waits for
    health evidence, and surfaces the running endpoint and runtime status.
  - **Outcome:** Kestra is running at a managed HTTPS URL and appears as a
    managed application with operational evidence.
  - **Covered by:** R1, R2, R3, R4, R5, R7, R8

- F2. Register the ThinkWork Kestra control MCP
  - **Trigger:** Kestra reaches ready/running state, or an operator uses a
    repair action from the Kestra application page.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** ThinkWork stores or resolves the tenant service credential,
    registers a system-managed MCP server for Kestra control, assigns it to the
    platform default agent path, and marks the row as managed by the Kestra
    application.
  - **Outcome:** Agents can use a ThinkWork-owned MCP tool surface to manage
    customer Kestra orchestrations without manual MCP setup.
  - **Covered by:** R9, R10, R11, R12, R13, R14

- F3. Agent builds and runs an orchestration
  - **Trigger:** A customer asks a ThinkWork agent to automate a process.
  - **Actors:** A2, A4, A5
  - **Steps:** The agent discovers relevant Kestra plugins/Blueprints, drafts
    flow YAML, validates it, creates or updates a flow in an allowed namespace,
    triggers an execution when appropriate, and returns execution evidence.
  - **Outcome:** A customer-visible orchestration exists in Kestra and can be
    rerun, inspected, and evolved by ThinkWork agents.
  - **Covered by:** R10, R15, R16, R17, R18, R19

- F4. Park or destroy Kestra
  - **Trigger:** An operator parks runtime capacity or explicitly destroys the
    managed app.
  - **Actors:** A1, A3, A5
  - **Steps:** Parking stops runtime capacity while retaining app data,
    storage, credentials, and MCP continuity. Destroy requires explicit
    destructive confirmation and removes app-owned resources, managed MCP
    registration, and service credential material.
  - **Outcome:** Parking is reversible and non-destructive; destroy is explicit,
    auditable, and cleans up dependent registrations.
  - **Covered by:** R6, R20, R21, R22

---

## Requirements

**Managed application lifecycle**

- R1. Applications includes Kestra as an operator-managed application alongside
  Cognee and Twenty CRM.
- R2. Kestra deploy, park, redeploy, and destroy actions use the same
  deployment-job, approval, evidence, and smoke-check lifecycle as other
  managed applications.
- R3. Kestra exposes a managed HTTPS UI/API endpoint after deployment, with
  enough status for an operator to see URL, stage, region, service names, log
  groups, load balancer/target-group details, and health status.
- R4. Kestra uses a dedicated database and durable internal storage owned by the
  managed application, not the shared ThinkWork application schema.
- R5. Kestra v1 is optimized for an ECS/Fargate managed runtime using
  Postgres-backed repository/queue state and durable object/file storage.
- R6. Kestra must model retained/provisioned state separately from
  runtime-enabled state so parking can stop capacity without deleting
  customer orchestration state.
- R7. Kestra app images and deployment artifacts must be pinned or otherwise
  reviewable through the release-manifest flow before customer deployment.
- R8. Kestra health evidence must prove the public endpoint and API are usable,
  not only that Terraform applied successfully.

**Agent control MCP**

- R9. ThinkWork registers a system-managed MCP server for Kestra when the
  managed app is running.
- R10. The Kestra MCP server is a ThinkWork control wrapper over the customer's
  Kestra instance, not merely the public read-only Kestra catalog MCP.
- R11. The control MCP uses a ThinkWork-managed tenant service credential for
  v1, stored server-side and never exposed to browser, desktop, mobile, or
  agent prompt state.
- R12. MCP registration is idempotent across deploy, redeploy, and repair, and
  updates the target endpoint when the Kestra URL changes.
- R13. Parking Kestra disables active agent use of the managed MCP server while
  preserving the row and service credential continuity for redeploy.
- R14. Destroying Kestra removes the managed MCP row, runtime assignments, and
  app-owned service credential material.

**Agent orchestration behavior**

- R15. The control MCP exposes curated orchestration tools for flow validation,
  create/update, execution trigger, execution status, log retrieval, namespace
  listing, and safe read-only inspection.
- R16. The control MCP constrains writes to ThinkWork-approved namespaces or
  ownership conventions so agents do not accidentally mutate arbitrary customer
  Kestra content.
- R17. The control MCP records enough audit context to connect agent requests,
  Kestra flow changes, executions, and returned evidence.
- R18. Agents may use the official public Kestra MCP/catalog as a read-only
  helper for plugin and Blueprint discovery, but state-changing operations must
  go through the ThinkWork control MCP.
- R19. A release proof must show a ThinkWork agent creating or updating a
  simple Kestra flow, triggering it, and returning execution evidence.

**Scope and safety**

- R20. V1 explicitly excludes Docker-in-Docker, host Docker socket access, and
  arbitrary script/container task execution that Fargate cannot support safely.
- R21. The Kestra application page must communicate v1 execution limits so
  operators understand which orchestration patterns are supported.
- R22. Destructive destroy must communicate that Kestra flow definitions,
  execution history, internal storage, credentials, and managed MCP
  registration are removed.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given an operator opens Applications, when Kestra
  is available in the release manifest, then the operator can plan and approve
  a Kestra deployment and later inspect its URL, runtime status, and evidence.
- AE2. **Covers R6, R13.** Given Kestra is running with a managed MCP row, when
  an operator parks Kestra, then runtime capacity stops, agent use is disabled,
  and the managed MCP row remains available for continuity after redeploy.
- AE3. **Covers R9, R10, R11, R12.** Given Kestra is running, when readiness
  reconciliation runs twice, then ThinkWork has one managed Kestra control MCP
  row pointing at the current Kestra endpoint and using a server-side service
  credential.
- AE4. **Covers R15, R16, R17, R19.** Given an assigned ThinkWork agent receives
  an automation request, when it uses the Kestra control MCP, then it can create
  or update an allowed flow, trigger an execution, and return flow/execution
  evidence tied to the agent request.
- AE5. **Covers R20, R21.** Given a customer asks for an orchestration that
  requires Docker-in-Docker or host Docker access, when the agent evaluates the
  request in v1, then it explains that the current managed Kestra runtime does
  not support that execution class and suggests a supported alternative or a
  future worker-pool path.
- AE6. **Covers R14, R22.** Given an operator approves destructive destroy, when
  the job completes, then Kestra app resources, app-owned orchestration data,
  service credential material, and the managed MCP registration are removed or
  recorded as removed in evidence.

---

## Success Criteria

- Customers can ask ThinkWork agents to build and operate basic Kestra
  orchestrations without manually configuring Kestra or MCP.
- Operators can deploy, park, repair, and destroy Kestra using the same
  managed-app mental model already established for Twenty CRM.
- Agents receive a narrow, auditable Kestra tool surface rather than raw
  unrestricted admin access.
- V1 is honest about Fargate execution limits and does not create a hidden
  dependency on Docker-in-Docker.
- Planning can proceed without inventing lifecycle semantics, identity model,
  MCP ownership, or v1 execution boundaries.

---

## Scope Boundaries

- No Kubernetes, EKS, Docker Compose, GCP, or Azure deployment path in v1.
- No EC2 worker pool in v1.
- No Docker-in-Docker, host Docker socket mounting, or arbitrary container task
  execution in v1.
- No per-user Kestra auth in v1; agents use a tenant service credential through
  ThinkWork policy and audit.
- No broad pass-through MCP that exposes every Kestra API operation without
  ThinkWork guardrails.
- No custom end-user orchestration builder UI inside ThinkWork in v1.
- No promise that all Kestra plugins are supported on the managed Fargate
  runtime.
- No replacement for ThinkWork's native workspace orchestration primitive;
  Kestra is for customer workflow/DAG automation, not internal folder-addressed
  agent wakeups.

---

## Key Decisions

- **Kestra control MCP:** Build a ThinkWork-managed control MCP wrapper for the
  customer Kestra instance. The public Kestra MCP is useful for plugin and
  Blueprint discovery, but it is read-only and does not manage the deployed
  customer instance.
- **Credential model:** Use a tenant service credential for v1. This keeps the
  agent-managed path practical with Kestra OSS basic auth and places audit and
  policy enforcement in ThinkWork.
- **Runtime target:** Use an ECS/Fargate managed orchestrator for v1. This
  matches ThinkWork's current AWS managed-app posture and avoids introducing
  EC2 worker operations before the value is proven.
- **Execution boundary:** Exclude Docker-in-Docker and host Docker access in
  v1. Those capabilities can return later as an EC2 worker pool or split
  runtime design.
- **Lifecycle model:** Follow Twenty's retained/runtime split. Parking should
  be reversible; destroy should be explicit and destructive.
- **Product framing:** Kestra is an agent-operated orchestration application,
  not a manual low-code workflow editor embedded into ThinkWork.

---

## Dependencies / Assumptions

- The managed-app registry and deployment-runner adapter pattern used by Twenty
  can be extended to a third application key.
- The current tenant MCP registry supports managed application ownership and
  can represent a system-managed Kestra control MCP row.
- Kestra OSS basic authentication can protect the UI/API for the service
  credential model.
- Kestra can run the intended v1 workload class on ECS/Fargate when Docker-heavy
  task classes are excluded.
- The official public Kestra MCP remains suitable as a read-only catalog for
  plugin/task schema and Blueprint discovery.
- External research checked Kestra's current docs for installation, MCP, basic
  authentication, and Terraform-provider behavior as of 2026-06-08.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R4, R5][Technical] Should the app module run Kestra in standalone
  mode for v1 or split webserver/scheduler/executor/worker services while still
  staying on Fargate?
- [Affects R4][Technical] Should Kestra internal storage use S3 directly, EFS,
  or a combined model for the first managed release?
- [Affects R5, R20][Needs research] Which Kestra plugins/tasks are safe and
  useful in the Fargate-only supported set, and how should unsupported tasks be
  detected or documented?
- [Affects R11][Technical] Should the tenant service credential be Kestra basic
  auth only, or should the control MCP internally support future API-token
  models when Enterprise deployments exist?
- [Affects R15, R16][Technical] What exact MCP tool set and namespace policy
  are the smallest useful surface for agent-managed orchestration?
- [Affects R18][Technical] Should ThinkWork register the public Kestra catalog
  MCP as a separate read-only managed MCP row, call it internally from the
  control MCP, or simply document that agents may use it during authoring?
- [Affects R19][Technical] What smoke flow should prove create/update,
  execution trigger, status polling, and evidence return without relying on
  unsupported task classes?
- [Affects R3][Technical] What managed subdomain should Kestra use by default,
  such as `orchestrate.<domain>`, `kestra.<domain>`, or another Applications
  naming convention?

---

## Next Steps

-> /ce-plan for structured implementation planning.
