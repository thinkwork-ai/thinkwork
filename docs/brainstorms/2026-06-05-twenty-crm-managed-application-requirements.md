---
date: 2026-06-05
topic: twenty-crm-managed-application
---

# Twenty CRM Managed Application

## Problem Frame

ThinkWork now has an operator-managed Cognee deployment for Knowledge Graph
infrastructure. Twenty CRM should follow the same optional-add-on philosophy:
operators can turn it on from ThinkWork, Terraform provisions the app, and the
rest of the product exposes CRM-specific settings only after the app is actually
enabled.

The v1 goal is not a custom CRM experience inside ThinkWork. It is a small,
reliable managed-application release that proves ThinkWork can deploy and
operate Twenty CRM as a public HTTPS app for the current stage, while setting up
later CRM integration work.

---

## Actors

- A1. ThinkWork operator: Enables, disables, and inspects optional managed
  applications from Settings.
- A2. ThinkWork platform deploy pipeline: Applies Terraform and reports deployed
  app status back to ThinkWork.
- A3. Twenty CRM admin user: Manually creates the first Twenty workspace/admin
  account inside the deployed Twenty app.
- A4. Future ThinkWork CRM user or agent: Uses CRM data after follow-up
  integration work connects Twenty to ThinkWork capabilities.

---

## Key Flows

- F1. Enable Twenty CRM
  - **Trigger:** A ThinkWork operator turns on Twenty CRM in Settings ->
    General.
  - **Actors:** A1, A2
  - **Steps:** The operator sees a confirmation dialog, confirms that Terraform
    will deploy Twenty, and ThinkWork queues the deployment. The app remains in
    a pending/disabled visible state until deployed status reports Twenty as
    enabled.
  - **Outcome:** The deploy pipeline is queued with the desired Twenty enabled
    state.
  - **Covered by:** R1, R2, R5, R6

- F2. Reveal CRM settings after deployment
  - **Trigger:** ThinkWork receives deployment status showing Twenty CRM is
    enabled.
  - **Actors:** A1, A2
  - **Steps:** The Settings navigation adds the CRM settings page. The page
    shows status, stage, region, service details, logs, and the public HTTPS
    Twenty URL.
  - **Outcome:** Operators can open and inspect the deployed Twenty app.
  - **Covered by:** R3, R4, R7, R8

- F3. First Twenty admin setup
  - **Trigger:** The operator opens the deployed Twenty URL for the first time.
  - **Actors:** A1, A3
  - **Steps:** The operator follows Twenty's native first-user flow and creates
    the first workspace/admin account directly in Twenty.
  - **Outcome:** Twenty is usable as a standalone CRM without ThinkWork SSO.
  - **Covered by:** R8, R11, R12

- F4. Disable Twenty CRM
  - **Trigger:** A ThinkWork operator turns off Twenty CRM from Settings.
  - **Actors:** A1, A2
  - **Steps:** The operator confirms that runtime resources will be stopped or
    parked, while CRM data and secrets are retained. ThinkWork queues the
    Terraform deployment.
  - **Outcome:** Twenty runtime is disabled without deleting business-critical
    CRM data.
  - **Covered by:** R5, R9, R10

---

## Requirements

**Managed application settings**

- R1. Settings -> General includes a new operator-only section named **Managed
  Applications**.
- R2. The Managed Applications section lists optional stage applications as rows,
  initially Cognee and Twenty CRM.
- R3. Cognee's current deploy toggle behavior is represented from Managed
  Applications, while its Knowledge Graph settings page remains hidden unless
  Cognee is enabled.
- R4. Twenty CRM has a Managed Applications row with a toggle, concise
  description, status, and confirmation before any deploy or disable action is
  queued.

**Twenty deployment lifecycle**

- R5. Toggling Twenty CRM on queues the normal ThinkWork deployment pipeline
  rather than applying infrastructure from the browser session.
- R6. While Twenty enablement is queued but not yet reflected in deployment
  status, CRM settings remain hidden from the Settings navigation.
- R7. Once deployment status reports Twenty enabled, an operator-only CRM
  settings page appears in the Settings navigation.
- R8. The CRM settings page exposes the public HTTPS Twenty URL and enough
  operational detail for an operator to confirm what stage, region, service,
  logs, and endpoint are active.
- R9. Toggling Twenty CRM off requires confirmation and must communicate that
  runtime resources will stop or be parked while CRM data is retained.
- R10. Disabling Twenty CRM must preserve the Twenty database, generated
  secrets, persistent storage, and re-enable path.

**CRM app behavior**

- R11. Twenty CRM v1 uses Twenty's native single-workspace first-user flow:
  the operator creates the first Twenty admin account directly in Twenty.
- R12. ThinkWork SSO, Cognito federation, Google OAuth handoff, and pre-seeded
  Twenty invites are documented follow-up work, not v1 requirements.
- R13. Twenty CRM is exposed at a managed stage subdomain derived from the
  existing public domain pattern, such as `crm.<stage-domain>` or equivalent.
- R14. Twenty CRM must use a dedicated database and dedicated role on the
  existing ThinkWork Postgres/Aurora instance, not the shared ThinkWork
  application database or schema.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4.** Given an operator opens Settings -> General, when
  the deployment status is available, then they see a Managed Applications
  section with separate Cognee and Twenty CRM rows.
- AE2. **Covers R5, R6.** Given Twenty CRM is disabled, when an operator turns
  the Twenty toggle on and confirms, then ThinkWork queues deployment and the
  CRM settings page remains hidden until deployed status reports Twenty enabled.
- AE3. **Covers R7, R8, R13.** Given deployment status reports Twenty enabled,
  when the operator opens Settings, then CRM appears in navigation and its page
  includes a public HTTPS URL for the managed Twenty app.
- AE4. **Covers R9, R10.** Given Twenty CRM is enabled, when an operator turns
  it off and confirms, then ThinkWork communicates data retention and queues a
  disable deployment that preserves CRM data and secrets.
- AE5. **Covers R11, R12.** Given a fresh Twenty deployment is reachable, when
  an operator opens the URL, then they complete Twenty's native first-user setup
  rather than being redirected through ThinkWork SSO.

---

## Success Criteria

- Operators can enable Twenty from ThinkWork without leaving the settings flow
  to hand-edit Terraform variables.
- CRM settings are not visible until Twenty is actually enabled according to
  deployment status, avoiding a dead settings page.
- The deployed Twenty app is reachable at a public HTTPS managed subdomain.
- Disable behavior is safe for CRM data: a casual settings toggle cannot erase
  customer, contact, opportunity, file, or secret data.
- Planning can proceed without inventing product behavior around visibility,
  first-user setup, URL shape, database isolation, or disable semantics.

---

## Scope Boundaries

- No custom ThinkWork CRM UI in v1 beyond settings/status/linking.
- No ThinkWork SSO, Cognito federation, Google SSO, or identity sync into
  Twenty in v1.
- No pre-seeding Twenty users, workspaces, roles, or invites in v1.
- No CRM connector, MCP tool, webhook adapter, or agent read/write integration
  in v1.
- No generic managed-app registry refactor is required before Twenty ships,
  though the UI and API naming should leave room for that direction.
- No separate Postgres/Aurora instance in v1 unless planning discovers a hard
  Twenty requirement that prevents using a dedicated database on the existing
  instance.
- No destructive delete path for Twenty CRM data from the settings toggle.

---

## Key Decisions

- **Section name:** Use **Managed Applications**. It describes operator-managed,
  optional app deployments more clearly than "Integrations" or "Add-ons",
  because these are deployed applications with infrastructure, not just API
  connections.
- **First release shape:** Ship Deployable App first: toggle, confirmation,
  deploy queue, deployed-status gating, CRM settings page, and health/status
  details.
- **Visibility rule:** CRM settings appears only after Terraform/API deployment
  status reports Twenty enabled.
- **Access rule:** Twenty v1 is reachable through a public HTTPS managed
  subdomain.
- **Identity rule:** v1 uses manual first-user setup inside Twenty; ThinkWork
  SSO is explicit follow-up work.
- **Disable rule:** Turning Twenty off stops or parks runtime resources while
  retaining CRM data, storage, secrets, and re-enable path.
- **Database rule:** Twenty uses a dedicated database and role on the existing
  ThinkWork Postgres/Aurora instance.

---

## Dependencies / Assumptions

- Cognee's existing pattern for optional Terraform add-ons, deployment status,
  and settings controls is the starting point for Twenty.
- ThinkWork's existing public-domain infrastructure can support an additional
  managed subdomain for CRM.
- Twenty's self-hosted shape includes at least a server, worker, Redis,
  Postgres, persistent app storage, `SERVER_URL`, and `ENCRYPTION_KEY`.
- Twenty's native single-workspace first-user flow is acceptable for v1 because
  only the managed deployment foundation is in scope.
- CRM data is business-critical enough that disable cannot imply deletion.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R8][Technical] Should Twenty be deployed with an ECS/Fargate
  pattern mirroring Cognee, and how should server, worker, Redis, and storage
  be modeled in Terraform?
- [Affects R8, R13][Technical] What exact managed subdomain should be used:
  `crm.<domain>`, `twenty.<domain>`, or a stage-qualified variant for non-prod?
- [Affects R10, R14][Technical] What is the safest Terraform lifecycle model
  for "disabled but retained" database, secrets, Redis data, and file storage?
- [Affects R14][Technical] How should the dedicated Twenty database and role be
  created without repeating Cognee's database ownership and migration failures?
- [Affects R8][Needs research] Which Twenty health endpoint and operational
  checks should the CRM settings page expose?
- [Affects R12][Technical] What later SSO shape best fits ThinkWork and Twenty:
  Cognito OIDC, Google OAuth configured in Twenty, or a ThinkWork-mediated
  launch flow?

---

## Next Steps

-> /ce-plan for structured implementation planning.
