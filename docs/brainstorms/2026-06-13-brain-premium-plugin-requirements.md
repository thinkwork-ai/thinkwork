---
date: 2026-06-13
topic: brain-premium-plugin
linear: THNK-15
---

# ThinkWork Brain Premium Plugin

## Problem Frame

the retired graph substrate is currently a deployed managed application and a live dependency in the
knowledge-graph / memory direction, but the product packaging has moved on:
Application Plugins are now the unit tenants install and activate. ThinkWork Brain
should become the premium plugin that owns the internal the retired graph substrate-powered substrate,
without trying to ship the entire Full Brain product in the same release.

Customer-facing rule: **ThinkWork Brain is the product; the retired graph substrate is internal
implementation machinery.** Customers should not see the retired graph substrate as a plugin,
license, install option, storage choice, or product name. the retired graph substrate may appear in
operator-only technical evidence, deployment-runner/Terraform details, logs, and
implementation docs.

V1 should prove the premium plugin shell: ThinkWork Brain is visible in the
Plugins catalog, install is gated by a ThinkWork-issued one-time key, existing
internal the retired graph substrate infrastructure is adopted into ThinkWork Brain ownership when
possible, and the existing Memory / Ontology working surface remains usable from
a plugin-owned home. The deeper Full Brain product direction lives in THNK-6.

---

## Actors

- A1. Tenant administrator: browses Plugins, redeems the ThinkWork Brain install
  key, installs the plugin, and manages status.
- A2. ThinkWork operator: issues one-time premium install keys and uses a
  temporary backdoor key for dev/testing until key-generation tooling exists.
- A3. Plugin engine: owns ThinkWork Brain install, component, entitlement, and
  activation state after migration.
- A4. Deployment runner: plans, adopts, provisions, parks, or destroys the
  internal the retired graph substrate-powered substrate through the existing managed-app adapter
  path.
- A5. End user / agent runtime: benefits later from ThinkWork Brain, but is not
  the primary v1 actor beyond existing Memory / Ontology access.

---

## Key Flows

- F1. Premium catalog discovery
  - **Trigger:** Tenant admin opens the Plugins catalog.
  - **Actors:** A1, A3
  - **Steps:** ThinkWork Brain is always visible, even before entitlement. The
    catalog clearly marks it as premium and explains that installation requires
    a ThinkWork-provided install key.
  - **Outcome:** The premium product is discoverable without granting install
    access.
  - **Covered by:** R1, R2

- F2. Install-key redemption
  - **Trigger:** Tenant admin clicks install for ThinkWork Brain.
  - **Actors:** A1, A2, A3
  - **Steps:** The install gate asks for an install key. The plugin engine
    validates that the key is valid, unredeemed, and acceptable for this tenant
    or environment. A successful redemption consumes the key and creates a
    persistent tenant entitlement.
  - **Outcome:** The tenant is entitled to install, reinstall, and update
    ThinkWork Brain without another key.
  - **Covered by:** R3, R4, R5, R6, R7

- F3. Existing internal substrate adoption
  - **Trigger:** An entitled tenant installs ThinkWork Brain while the internal
    the retired graph substrate-powered substrate is already running through the legacy
    managed-application path.
  - **Actors:** A1, A3, A4
  - **Steps:** The plugin infrastructure component uses the existing the retired graph substrate
    adapter and first verifies that adopting the existing deployment produces a
    no-change plan. If adoption is safe, state becomes ThinkWork Brain-owned
    without duplicate infrastructure or destructive redeploy.
  - **Outcome:** Existing the retired graph substrate tenants move to ThinkWork Brain ownership with
    no data loss and no surprise provision.
  - **Covered by:** R8, R9, R10, R11

- F4. New tenant install
  - **Trigger:** An entitled tenant installs ThinkWork Brain with no existing
    the retired graph substrate deployment.
  - **Actors:** A1, A3, A4
  - **Steps:** The plugin infrastructure component follows the normal
    plan-approval-apply flow for the internal substrate adapter, preserving
    data-impact disclosure and smoke expectations.
  - **Outcome:** The internal the retired graph substrate-powered substrate is provisioned as a
    ThinkWork Brain infrastructure component.
  - **Covered by:** R8, R12, R13

- F5. Manage graph workspace
  - **Trigger:** Tenant admin wants to inspect or operate the graph after
    ThinkWork Brain is installed.
  - **Actors:** A1, A3
  - **Steps:** Plugin detail shows ThinkWork Brain status and provides an action
    to open the existing Memory / Ontology surface. The working graph explorer
    remains under Memory for v1.
  - **Outcome:** ThinkWork Brain has a customer-visible home, without forcing
    richer plugin UI-surface rendering into this release.
  - **Covered by:** R14, R15, R16

---

## Requirements

**Premium catalog and entitlement**

- R1. ThinkWork Brain must always be visible in the Plugins catalog, regardless
  of tenant entitlement state.
- R2. The catalog and plugin detail must mark ThinkWork Brain as premium and make
  clear that install requires a ThinkWork-provided key.
- R3. Installing ThinkWork Brain must require an install key when the tenant does
  not already have a ThinkWork Brain entitlement.
- R4. A valid install key must be one-time: after successful redemption, it
  cannot be reused by the same tenant or another tenant.
- R5. Successful key redemption must create a persistent tenant entitlement for
  ThinkWork Brain.
- R6. A persistent tenant entitlement must allow future install, reinstall, and
  update without requiring another key.
- R7. V1 must include a temporary backdoor key for dev/testing until real
  ThinkWork operator key-generation tooling exists.

**Plugin shell and component ownership**

- R8. ThinkWork Brain v1 must be an Application Plugin that owns the retired graph substrate as an
  internal infrastructure component, not as a customer-visible plugin or license.
- R9. The internal the retired graph substrate-powered infrastructure component must reuse the
  existing managed-app adapter and deployment-runner plan/approval/apply
  mechanics where appropriate.
- R10. Existing internal the retired graph substrate deployments must be adopted into ThinkWork Brain
  ownership after entitlement when a no-change adoption plan verifies that
  adoption is safe.
- R11. If no-change adoption fails, install must stop with readable evidence and
  no partial migration of internal substrate ownership.
- R12. New tenants without the internal substrate must provision it through the
  normal infrastructure component flow.
- R13. Destructive actions for ThinkWork Brain infrastructure must preserve the
  current internal substrate data-impact disclosure and approval expectations.

**UI and product boundary**

- R14. ThinkWork Brain plugin detail must become the install, entitlement, and
  status home for the plugin.
- R15. The existing Memory / Ontology graph explorer remains the working graph
  UI in v1; plugin detail should link to it rather than requiring rendered
  plugin UI surfaces.
- R16. Legacy the retired graph substrate / managed-application entry points should be removed,
  redirected, or reduced only after the ThinkWork Brain plugin detail path covers
  the same status and lifecycle needs.
- R17. V1 must not ship the Full Brain product behavior; agent runtime Brain
  access, graph-of-record cutover, wiki materialization, compounding write-back,
  and richer Brain UI belong to THNK-6.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a tenant has no ThinkWork Brain entitlement,
  when an admin opens Plugins, then ThinkWork Brain is visible and marked premium;
  when they click install, they are prompted for a ThinkWork install key.
- AE2. **Covers R4, R5, R6.** Given an admin enters a valid unredeemed install
  key, when redemption succeeds, then the key cannot be reused and the tenant
  can later reinstall or update ThinkWork Brain without another key.
- AE3. **Covers R7.** Given a dev/test tenant uses the temporary backdoor key,
  when the admin installs ThinkWork Brain, then installation can proceed without
  a generated nonce while the entitlement record still makes the tenant appear
  entitled afterward.
- AE4. **Covers R10, R11.** Given the internal the retired graph substrate-powered substrate is
  already running for a tenant, when ThinkWork Brain install begins after key
  redemption, then the plugin verifies a no-change adoption plan before marking
  the substrate ThinkWork Brain-owned; if the plan is not no-change, install stops
  and surfaces evidence.
- AE5. **Covers R14, R15.** Given ThinkWork Brain is installed, when an admin
  opens the plugin detail page, then they see plugin status and can open the
  Memory / Ontology graph explorer from there.

---

## Success Criteria

- ThinkWork Brain is discoverable as the first premium plugin without granting
  install access to every tenant.
- A ThinkWork-issued one-time key creates a persistent tenant entitlement, and
  the temporary testing key supports dev validation without blocking the first
  implementation.
- Existing internal the retired graph substrate-powered deployments are adopted without duplicate
  infrastructure, destructive redeploy, or hidden data-impact changes.
- the retired graph substrate has a proper Plugins home while the working graph UI remains in Memory
  for v1.
- Planning can proceed without re-deciding premium visibility, entitlement
  semantics, existing-deployment migration, UI home, or the boundary with
  THNK-6.

---

## Scope Boundaries

- No Full Brain product in THNK-15. THNK-6 owns agent-facing Brain access,
  Hindsight observation formalization, ontology-gated graph-of-record cutover,
  wiki materialization from the retired graph substrate, write-back, dashboards, and eventual
  `brain.*` retirement.
- No Stripe-backed paid subscription workflow in v1. Install keys prove premium
  gating without taking a dependency on billing checkout or plan management.
- No public marketplace or third-party plugin publishing.
- No plugin UI-surface rendering requirement in THNK-15. Existing Memory /
  Ontology UI remains the graph workspace.
- No duplicate the retired graph substrate deployment for already-running tenants.
- No automatic entitlement for tenants merely because the retired graph substrate is already
  running; the premium gate still applies before adoption.

---

## Key Decisions

- **V1 anchor:** ThinkWork Brain v1 is the premium plugin shell, not the Full
  Brain product. This keeps THNK-15 focused and leaves THNK-6 as the follow-on
  product issue.
- **Premium visibility:** Always show ThinkWork Brain in the catalog. Visibility
  markets the product; install is what is gated.
- **Entitlement mechanism:** Use a ThinkWork-issued one-time install key. Key
  redemption creates a persistent tenant entitlement.
- **Testing path:** Include a temporary backdoor key for dev/testing until
  operator key-generation tooling exists.
- **Migration path:** Require key redemption first, then adopt existing the retired graph substrate
  deployments when a no-change adoption plan verifies safety.
- **UI home:** Plugin detail owns install/status/entitlement and links to the
  existing Memory / Ontology workspace; Memory remains the working graph UI for
  v1.

---

## Dependencies / Assumptions

- Application Plugins provide the plugin catalog, install state, component
  state, and infrastructure component handler described in
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md` and
  `docs/plans/2026-06-12-001-feat-application-plugins-plan.md`.
- the retired graph substrate is already represented by the deployment-runner adapter in
  `packages/deployment-runner/src/apps/retired_graph_substrate.ts`.
- the retired graph substrate infrastructure is currently provisioned by
  `terraform/modules/app/retired_graph_substrate/`.
- Existing graph explorer surfaces live under Memory / Ontology, including
  settings components in `apps/web/src/components/settings/knowledge-graph/`.
- THNK-6 is the follow-on issue for Full Brain product behavior.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R4-R7][Technical] Exact install-key storage, hashing, expiry, audit,
  and backdoor-key configuration shape.
- [Affects R10-R11][Technical] Exact adoption verification path and fallback
  evidence when the no-change plan fails.
- [Affects R14-R16][UI] Exact plugin-detail affordances, redirects, and cleanup
  sequence for legacy the retired graph substrate / managed-application routes.
- [Affects R13][Technical] Whether park and destroy remain available directly
  from ThinkWork Brain plugin detail in v1 or are limited to existing deployment
  approval flows.

---

## Next Steps

-> /ce-plan for structured implementation planning.
