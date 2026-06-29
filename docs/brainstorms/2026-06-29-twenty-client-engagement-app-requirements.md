---
date: 2026-06-29
topic: twenty-client-engagement-app
linear_issue: THINK-109
source_branch: origin/feat/engagement-dashboard
---

# Twenty Client Engagement App

## Problem Frame

ThinkWork has a deployed prototype suite at `thinkwork-tools.vercel.app` and
matching source files on `origin/feat/engagement-dashboard`:

- `client-dashboard.html`
- `discovery-value-alignment.html`
- `discovery-presession-brief.html`
- `discovery-tool-guide.html`
- `discovery-tool.html`
- `opportunity-pipeline.html`

The prototype proves a valuable customer-facing workflow: revenue and customer
leaders can review live Twenty CRM companies and opportunities, organize each
account into engagement stages, capture discovery and value-alignment notes,
track opportunity layers, record KPI baselines and 30/60/90 check-ins, and
produce an executive summary view.

The prototype is not production-ready. It is a standalone HTML/CSS/JS app with
browser-side MCP credentials, direct calls to the Twenty MCP endpoint, and
dashboard-specific overlay fields stored in `localStorage`. The product goal is
to convert the prototype into a real ThinkWork application: a Twenty CRM plugin
app launched from the new ThinkWork Apps surface, rebuilt with ThinkWork
components and design system, backed by authenticated Twenty plugin data access
and durable ThinkWork-owned engagement overlay state.

The v1 should be behavior-preserving. The point is not to redesign the product
manager prototype during conversion; it is to make the same client engagement
suite coherent, secure, installable, and durable inside ThinkWork.

---

## Actors

- A1. Revenue or customer manager: Uses the dashboard to understand account
  engagement health, opportunity stages, owner accountability, open questions,
  next steps, KPI progress, and executive summary narratives.
- A2. Account owner or engagement lead: Maintains account profile details,
  stakeholder maps, opportunity layers, discovery artifacts, KPI baselines, and
  check-in updates.
- A3. ThinkWork user with Twenty access: Launches the app from ThinkWork and
  expects CRM reads and writes to respect their authenticated Twenty access.
- A4. Tenant admin or operator: Installs and configures the Twenty CRM plugin
  and needs app readiness to reflect plugin, CRM, and auth state accurately.
- A5. ThinkWork agent/planning implementer: Uses this requirements document to
  plan the conversion without inventing product behavior beyond the prototype.

---

## Key Flows

- F1. Launch the client engagement app from ThinkWork
  - **Trigger:** A3 has an installed Twenty plugin with at least one launchable
    app surface.
  - **Actors:** A3, A4
  - **Steps:** ThinkWork shows an `Apps` nav item only when launchable apps
    exist. The user opens the Apps picker and selects the Twenty Client
    Engagement app. ThinkWork renders the app in the main content area, not in
    Settings and not as an external Vercel page.
  - **Outcome:** The user is inside a ThinkWork-native app surface with the
    engagement suite available.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Review live CRM accounts and opportunities
  - **Trigger:** A1 opens the app after their Twenty access is ready.
  - **Actors:** A1, A3
  - **Steps:** The app loads companies, opportunities, opportunity stages, and
    opportunity layers from Twenty through the ThinkWork/Twenty plugin path.
    The user selects an account from the sidebar, reviews its opportunities,
    opens a specific opportunity, and drills between stage/tools, layers,
    strategic goals, baseline capture, KPI framework, check-ins, and executive
    view.
  - **Outcome:** The user sees the same CRM-centered engagement workspace the
    prototype demonstrates, but without browser-side raw MCP credentials.
  - **Covered by:** R6, R7, R8, R9, R10

- F3. Capture engagement overlay state
  - **Trigger:** A2 edits a field that is not a native Twenty CRM field, such
    as stakeholder mapping, opportunity discovery notes, KPI baseline, check-in
    notes, or executive narrative.
  - **Actors:** A2, A3
  - **Steps:** The app saves the overlay field as ThinkWork-owned durable app
    state keyed to the relevant Twenty company or opportunity. A later app load
    restores the overlay for that same CRM record and user/tenant context.
  - **Outcome:** Prototype-specific engagement data survives browser refreshes,
    device changes, and sessions without relying on `localStorage`.
  - **Covered by:** R11, R12, R13, R14

- F4. Use converted discovery and pipeline tools as one suite
  - **Trigger:** A1 or A2 follows a stage/tool action from the dashboard or
    opens a related client engagement tool.
  - **Actors:** A1, A2
  - **Steps:** The app exposes the prototype's linked tools as part of one
    coherent Client Engagement app: value alignment, pre-session brief,
    discovery guide/tooling, KPI/impact tracking, and opportunity pipeline.
    Navigation remains in ThinkWork's main content area and preserves the
    working context where possible.
  - **Outcome:** The full deployed prototype suite is converted into one
    production app experience rather than split into disconnected pages.
  - **Covered by:** R15, R16, R17

- F5. Handle unavailable CRM or app state
  - **Trigger:** Twenty is not installed, the managed app is unavailable, the
    current user lacks Twenty access, or the app cannot load required records.
  - **Actors:** A3, A4
  - **Steps:** The Apps picker and app surface show a specific readiness reason
    and route the user toward the correct fix path, such as plugin install
    detail, managed app health, or user reconnect.
  - **Outcome:** Users do not see a blank dashboard, silent failure, or generic
    missing-tool error.
  - **Covered by:** R18, R19

---

## Requirements

**Apps surface and plugin packaging**

- R1. The Twenty Client Engagement app must be declared and launched as part of
  the Twenty CRM plugin, not hard-coded as a one-off ThinkWork route.
- R2. ThinkWork must show a main-shell `Apps` entry only when at least one
  installed plugin exposes a launchable app surface.
- R3. The Apps picker must list the Twenty Client Engagement app when the
  Twenty plugin is installed and the app surface is launchable.
- R4. Selecting the app must render it in ThinkWork's main content area.
- R5. Settings remains the install/configuration surface; day-to-day app use
  happens through Apps, not Settings.

**Prototype conversion and product parity**

- R6. V1 must convert the full deployed client engagement suite, not only the
  landing dashboard: `client-dashboard.html`, `discovery-value-alignment.html`,
  `discovery-presession-brief.html`, `discovery-tool-guide.html`,
  `discovery-tool.html`, and `opportunity-pipeline.html`.
- R7. V1 must preserve the prototype's core information architecture: account
  sidebar, account profile, opportunities, opportunity detail, primary tabs,
  secondary opportunity tabs, stage guidance, tool links, layer cards, KPI
  framework, 30/60/90 check-ins, executive view, and strategic pipeline.
- R8. V1 must preserve the prototype's CRM stage concepts and user-facing stage
  labels: Identified, Value Alignment, Discovery & Scope, SOW Delivered, Active
  Engagement, Closed Lost, and Deferred where applicable.
- R9. V1 must preserve opportunity layer concepts from the prototype: Core
  Problem, Optimization Opportunity, and Strategic Control, including the
  status progression from Identified through Ready for SOW, Approved, and
  Deferred.
- R10. V1 should preserve seed/demo content where useful for empty-state,
  demo, or development verification, but production records must come from the
  authenticated tenant's Twenty data when available.

**Data model and persistence**

- R11. The app must use live Twenty CRM records for CRM-owned data such as
  companies, opportunities, opportunity stages, opportunity amount/close date,
  and opportunity layers.
- R12. The app must use ThinkWork-owned engagement overlay state for fields the
  prototype stores locally, including account profile enrichment, stakeholder
  maps, decision-maker maps, strategic goals, baseline capture, KPI framework,
  use-case scope, check-ins, action items, and executive narrative.
- R13. Overlay state must be durable across browser refreshes, devices, and
  sessions; `localStorage` is not acceptable for production persistence.
- R14. Overlay state must remain keyed to the relevant Twenty company,
  opportunity, or layer so CRM record navigation restores the correct
  engagement context.

**Auth, security, and readiness**

- R15. The production app must not include browser-side hard-coded MCP tokens,
  API keys, or tenant-wide credentials.
- R16. CRM reads and writes must flow through ThinkWork's authenticated Twenty
  plugin path and respect the current user's Twenty access.
- R17. CRM mutations already proven in the prototype, such as opportunity stage
  changes and opportunity layer status updates, must remain available when the
  user has permission and must fail with a clear user-facing reason when not.
- R18. App launch readiness must distinguish at least: Twenty plugin not
  installed, managed Twenty app unavailable, user Twenty auth missing, and app
  data load failure.
- R19. The app must give unready users a specific next action rather than a
  blank dashboard or generic error.

**ThinkWork UX and design-system fit**

- R20. The converted app must use ThinkWork components and design-system
  conventions rather than embedding the raw prototype HTML/CSS as an iframe or
  static page.
- R21. The app should preserve the prototype's dense operational dashboard
  character while aligning spacing, typography, controls, empty states, dark
  theme behavior, and navigation with the current ThinkWork app.
- R22. The app must work inside the current ThinkWork shell without duplicating
  the global sidebar, global top bar, authentication chrome, or Settings
  navigation.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R5.** Given the Twenty plugin is installed and
  exposes the Client Engagement app, when a user opens the main ThinkWork
  sidebar, then `Apps` is visible, the picker lists the Twenty app, and selecting
  it renders the app in the main content area.
- AE2. **Covers R6, R7, R8, R9.** Given the user opens a Twenty opportunity from
  the converted dashboard, when the opportunity detail renders, then the stage
  track, stage guidance, layer cards, secondary tabs, KPI/check-in/executive
  views, and tool actions match the prototype's product behavior.
- AE3. **Covers R11, R15, R16.** Given a user with valid Twenty access opens the
  app, when companies and opportunities load, then the data comes through the
  ThinkWork/Twenty plugin path and the browser page contains no hard-coded MCP
  token.
- AE4. **Covers R12, R13, R14.** Given a user edits KPI baseline and executive
  narrative fields for a Twenty opportunity, when they reload ThinkWork or sign
  in from another browser, then those overlay values are restored for that same
  opportunity.
- AE5. **Covers R17, R18, R19.** Given a user's Twenty auth is missing, when
  they launch the app, then ThinkWork explains that user reconnect is required
  and routes them to the reconnect path instead of showing a failed dashboard.
- AE6. **Covers R20, R21, R22.** Given the app is rendered in ThinkWork, when a
  reviewer compares it to the rest of the product shell, then it feels like a
  ThinkWork-native operational app while preserving the prototype's engagement
  workflow.

---

## Success Criteria

- A revenue or customer manager can use the converted app for the same client
  engagement workflow demonstrated by the deployed prototype.
- The app reads and updates CRM-owned state through the Twenty plugin without
  leaking raw MCP credentials into the browser.
- Engagement overlay state survives normal production use instead of living in
  per-browser `localStorage`.
- The full suite appears as one coherent ThinkWork app under Apps, not as
  disconnected static pages or Settings tools.
- A downstream `ce-plan` pass can plan implementation without inventing the
  product behavior, v1 data posture, or scope boundary.

---

## Scope Boundaries

- V1 is not a raw iframe or static hosting exercise; the prototype pages are
  source material for a real ThinkWork app implementation.
- V1 is not a redesign of the product manager prototype. Clean up broken,
  insecure, or duplicate implementation details, but preserve product behavior
  unless planning finds an unavoidable blocker.
- V1 does not require billing or premium entitlement enforcement beyond
  metadata hooks that can support a future premium projection-pack model.
- V1 does not require every overlay field to become a Twenty custom object or
  native CRM field.
- V1 does not require a public third-party marketplace or arbitrary remote app
  runtime.
- V1 does not replace the Twenty CRM product, CRM list views, CRM record pages,
  or manual CRM workflows.

---

## Key Decisions

- Create a new focused requirements document rather than extending the existing
  Twenty-native operating surface or application plugin requirements: this work
  combines user-facing app behavior and plugin launch mechanics without being
  identical to either prior topic.
- Convert the full prototype suite as one Client Engagement app: the deployed
  pages are linked parts of a single workflow and should not become separate
  disconnected Apps entries in v1.
- Use a hybrid data posture: live Twenty CRM records for CRM-owned state, and
  ThinkWork-owned engagement overlay state for prototype-specific workflow
  fields.
- Preserve product behavior while changing implementation: the conversion
  should remove raw HTML hosting, browser-side credentials, and `localStorage`
  persistence, but it should not reimagine the dashboard workflow during v1.

---

## Dependencies / Assumptions

- The branch files under `origin/feat/engagement-dashboard` match the currently
  deployed Vercel prototype; hashes were checked during brainstorming.
- The Twenty plugin can provide an authenticated backend path for current-user
  CRM reads and writes during implementation.
- The current ThinkWork design system has enough form, tabs, table/list, card,
  empty-state, and shell primitives to rebuild the prototype without importing
  the raw HTML/CSS.
- Some exact prototype data fields may need normalized names during
  implementation, but the user-facing workflow should remain recognizable.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R5][Technical] What is the v1 `ui-surface` launch metadata shape
  for plugin-owned apps?
- [Affects R11-R17][Technical] Which ThinkWork backend/API path should the app
  use for current-user Twenty reads and writes?
- [Affects R12-R14][Technical] Where should ThinkWork-owned engagement overlay
  state be persisted, and what tenant/user sharing model should it use?
- [Affects R20-R22][Technical] Which existing ThinkWork components should map
  to the prototype's tabs, forms, layer cards, and dense dashboard tables?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
