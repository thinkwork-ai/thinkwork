---
date: 2026-06-30
topic: think-113-n8n-integrated-app
linear: THINK-113
---

# THINK-113 n8n Integrated App

## Summary

Build a native n8n installed app surface for ThinkWork, following the Twenty app
template. The first useful slice is read-oriented workflow and execution
DataTables inside n8n, while the ThinkWork plugin detail page becomes a
settings-only operator surface with a clear install action.

---

## Problem Frame

The n8n plugin already establishes n8n as a managed ThinkWork application and
workflow runtime. The current ThinkWork-side plugin workflow table is useful
for operator discovery, but it puts n8n workflow inspection in the wrong home
once an installed app surface exists. Workflow authors and n8n operators should
inspect workflows and executions from n8n itself, while ThinkWork keeps owning
plugin installation, managed runtime configuration, package settings, bridge
credentials, and deployment evidence.

The missing install affordance makes the specialized n8n plugin page a dead end
when the plugin is not installed. A tenant operator who opens the n8n plugin
detail page must be able to install the plugin from that page before configuring
settings.

---

## Key Decisions

- **Native app is the operational surface.** Workflow and execution tables move
  into an installed n8n app, not another ThinkWork plugin tab.
- **ThinkWork plugin detail is settings-only.** ThinkWork keeps install,
  runtime, package, and bridge configuration, with no Workflows/Settings tab
  switcher.
- **Installation stays in ThinkWork.** The n8n plugin detail page must include a
  direct operator install action when the plugin is absent.
- **V1 is read-oriented.** The integrated app can inspect and link workflows and
  executions, but production workflow activation remains in native n8n and agent
  workflow edits remain governed by the existing MCP guardrails.

---

## Actors

- A1. Tenant operator: Installs the n8n plugin and configures the managed
  runtime, package settings, and bridge credentials from ThinkWork.
- A2. n8n workflow author: Uses native n8n to inspect workflows, executions,
  and ThinkWork-related operational context.
- A3. Shared n8n operator: Reviews workflow state and production activation
  inside n8n.
- A4. ThinkWork agent: Uses the existing n8n MCP and bridge contracts to inspect
  and participate in workflows without owning the native app UI.
- A5. ThinkWork platform: Owns plugin install state, deployment evidence,
  settings, and the data made available to the installed app.

---

## Key Flows

- F1. Install n8n from the plugin detail page
  - **Trigger:** A tenant operator opens the n8n plugin detail page before the
    plugin is installed.
  - **Actors:** A1, A5
  - **Steps:** ThinkWork shows an uninstalled state with a primary install
    action. The operator starts installation from that page. ThinkWork records
    the plugin install and continues through the existing managed-app install
    and deployment flow.
  - **Outcome:** The n8n plugin page is not a dead end, and the operator can
    proceed to configuration after install.
  - **Covered by:** R1, R2, R3

- F2. Configure n8n in ThinkWork
  - **Trigger:** A tenant operator opens the n8n plugin page after install.
  - **Actors:** A1, A5
  - **Steps:** ThinkWork presents a single settings surface for component
    status, package settings, runtime settings, and bridge credentials. Workflow
    discovery and execution inspection are absent from this page.
  - **Outcome:** ThinkWork remains the operator control plane rather than a
    duplicate workflow operations console.
  - **Covered by:** R4, R5, R6

- F3. Inspect workflows in native n8n
  - **Trigger:** A workflow author or n8n operator opens the ThinkWork installed
    app inside n8n.
  - **Actors:** A2, A3, A5
  - **Steps:** The app shows a workflow DataTable with workflow identity,
    name, active state, trigger/readiness context, and links back to the native
    workflow where appropriate. The table supports the basic scanning and
    filtering expected from an operational list.
  - **Outcome:** Workflow inspection happens where n8n users already work.
  - **Covered by:** R7, R8, R10

- F4. Inspect executions in native n8n
  - **Trigger:** A workflow author or n8n operator needs recent run evidence.
  - **Actors:** A2, A3, A5
  - **Steps:** The app shows an execution DataTable with recent execution
    identity, workflow, status, timing, failure summary when available, and
    ThinkWork trace or thread linkage when the run used the bridge.
  - **Outcome:** Operators can connect n8n execution evidence to ThinkWork
    context without leaving n8n for the first read.
  - **Covered by:** R9, R10, R11

---

## Requirements

**ThinkWork plugin detail**

- R1. The n8n plugin detail page must show a clear uninstalled state when the
  plugin is absent.
- R2. The uninstalled state must include a primary operator action to install
  the n8n plugin from the n8n plugin detail page.
- R3. Installing from the n8n plugin detail page must use the same plugin
  install lifecycle as the catalog install flow.
- R4. The n8n plugin detail page must be a single settings surface, not a
  Workflows/Settings tabbed page.
- R5. The settings surface must retain runtime, component, package, and
  agent-step bridge configuration.
- R6. The previous ThinkWork-side workflows page must stop being the primary
  workflow inspection surface; any retained route should preserve compatibility
  without reintroducing the tabbed model.

**Native n8n installed app**

- R7. ThinkWork must provide a native installed n8n app surface modeled on the
  Twenty native app pattern.
- R8. The native app must include a workflows DataTable for workflow identity,
  name, active state, trigger context, readiness context, and native workflow
  navigation.
- R9. The native app must include an executions DataTable for recent execution
  identity, workflow association, status, timing, failure context, and native
  execution navigation.
- R10. Workflow and execution tables must be optimized for scanning,
  filtering, and drill-in rather than for authoring workflows.
- R11. When an execution is connected to ThinkWork bridge or agent-step context,
  the native app must expose enough linkage for a user to continue review in
  ThinkWork.

**Safety and scope**

- R12. V1 must not add native-app controls for production publish, unpublish,
  activation, or deactivation.
- R13. V1 must not create a second credential model for workflow operations; it
  should rely on the installed plugin context and existing n8n/ThinkWork
  credentials selected during planning.
- R14. The native app must not replace the ThinkWork managed-app evidence,
  package settings, or bridge settings surfaces.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given n8n is not installed for a tenant, when an
  operator opens the n8n plugin detail page, then the page shows `Not
  installed` and a primary `Install` action that starts the standard plugin
  install lifecycle.
- AE2. **Covers R4, R5, R6.** Given n8n is installed, when an operator opens the
  n8n plugin detail page, then the page shows settings and component/runtime
  status without Workflows/Settings tabs or a workflow discovery table.
- AE3. **Covers R7, R8, R10.** Given the native ThinkWork n8n app is installed,
  when a workflow author opens it inside n8n, then they can scan and filter
  workflows and open the corresponding native workflow record.
- AE4. **Covers R9, R10, R11.** Given recent n8n executions exist, when a user
  opens the executions table, then they can identify failed or relevant runs
  and follow available native n8n or ThinkWork links.
- AE5. **Covers R12, R14.** Given a user is viewing workflows or executions in
  the native app, when they need to publish a workflow or change managed runtime
  configuration, then the app routes them to the existing owner surface instead
  of providing a duplicate control.

---

## Success Criteria

- A tenant operator can install n8n from the n8n plugin detail page before
  configuring settings.
- The ThinkWork n8n plugin page reads as Settings only, with no orphaned
  workflow tab or dead-end uninstalled state.
- n8n workflow authors can inspect workflows and executions from a native n8n
  installed app surface.
- Planning can proceed without deciding whether workflow/execution tables live
  in ThinkWork or n8n.
- Planning can proceed without inventing the install affordance required for
  the uninstalled plugin state.

---

## Scope Boundaries

- V1 does not replace the previously defined managed n8n application plugin.
- V1 does not replace the n8n-to-ThinkWork agent-step bridge.
- V1 does not build a general workflow authoring or publishing console inside
  ThinkWork.
- V1 does not move package, runtime, or bridge settings into native n8n.
- V1 does not introduce production activation controls in the native app.
- V1 does not require private registry, enterprise SSO, or per-user n8n
  activation changes.

---

## Dependencies / Assumptions

- The managed n8n plugin foundation remains governed by
  `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md`.
- The agent-step bridge remains governed by
  `docs/brainstorms/2026-06-20-n8n-thinkwork-agent-step-bridge-requirements.md`.
- The native app direction should borrow the proven pattern from
  `plugins/twenty/twenty-app/README.md`.
- Planning must confirm the exact n8n installed-app capabilities available for
  workflow and execution DataTables.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R7, R8, R9][Technical] Confirm the native n8n app SDK surface for
  rendering DataTables and fetching workflow/execution data.
- [Affects R11, R13][Technical] Decide which existing credential path safely
  powers the native app's ThinkWork-linked context.
- [Affects R6][Technical] Decide whether the old ThinkWork workflows route is
  removed, redirected, or retained as a hidden compatibility URL.

---

## Sources / Research

- `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md` captures
  the managed n8n plugin foundation, operator install flow, and human activation
  boundaries.
- `docs/brainstorms/2026-06-20-n8n-thinkwork-agent-step-bridge-requirements.md`
  captures the bridge contract and execution linkage needs.
- `plugins/twenty/twenty-app/README.md` shows the native installed app template
  requested as the model for this work.
- `apps/web/src/components/settings/plugins/n8n/N8nPluginWorkflows.tsx` shows
  the current ThinkWork-side workflow discovery table that this brainstorm moves
  out of the plugin tab model.
