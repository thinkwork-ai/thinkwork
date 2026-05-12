---
date: 2026-05-12
topic: computer-html-artifact-substrate
---

# Computer HTML Artifact Substrate — collapse to plain HTML + host components

## Summary

Collapse the Computer artifact substrate to two payload kinds: agent-authored static HTML rendered in a thin script-disallowed iframe against one canonical stylesheet, and references to prebuilt host components rendered trusted in the React tree. Refresh and other chrome live on the host artifact container. The TSX / sucrase / iframe-RPC pipeline is deleted; agent-authored JavaScript leaves the system entirely.

---

## Problem Frame

Today's `apps/computer` artifact substrate is roughly 3,000 lines of `iframe-shell/` + `applets/` plumbing, a sucrase / esbuild-wasm transform pipeline, vendored React + shadcn + recharts + leaflet, a host-applet RPC protocol, and a leaflet CDN compatibility shim. It exists to let the Computer agent author and ship arbitrary TSX as runnable applets.

In practice, the artifacts the agent produces today are read-only displays — dashboards, summaries, formatted reports. The JavaScript runtime is dead weight for the content actually shipping. The CRM pipeline-risk dashboard could be a styled HTML table and lose nothing real; the meeting-prep brief is fundamentally a `<form>`; "interactive map" is the only generated-applet shape that genuinely needs JS, and even that is one widget, not a runtime.

Every new artifact also pays the cost of the agent reliably emitting valid TSX against a constrained import surface. HTML is closer to the agent's native skill. The substrate complexity isn't broken — it's doing far more than the artifacts in flight need, and every new artifact and every substrate change is more expensive than it should be.

---

## Actors

- A1. End user — opens artifacts in `apps/computer`, reads them, fills forms, refreshes data, persists state.
- A2. Computer agent — authors artifacts either as static HTML against a canonical CSS vocabulary, or as a reference to a prebuilt host component plus structured data.
- A3. `apps/computer` shell — fetches stored artifacts, dispatches to the renderer based on payload kind, owns the artifact chrome (refresh, share, favorite, title, version).
- A4. Host component registry — small host-owned map of `name → React component` pre-compiled into the app bundle.
- A5. Operator — pre-provisions users and adds new host components when product needs justify them.

---

## Key Flows

- F1. Agent authors a static-HTML artifact
  - **Trigger:** Agent decides a result is best expressed as a static document (report, summary, fillable form, dashboard of pre-rendered SVG data).
  - **Actors:** A2.
  - **Steps:** Agent emits one HTML string against the canonical class vocabulary → save-artifact tool validates against script/handler restrictions → tool stores payload as `kind: "html"` with provenance → artifact appears in the user's artifact list.
  - **Outcome:** Static HTML artifact exists, identical to today's storage shape except payload format.
  - **Covered by:** R1, R2, R3, R4, R5, R20.

- F2. Agent authors a component-reference artifact
  - **Trigger:** Agent decides a result needs interactivity beyond what static HTML provides (e.g., interactive map).
  - **Actors:** A2.
  - **Steps:** Agent picks a component by name from the registry → emits structured data conforming to that component's contract → save-artifact tool validates the component name is registered and the data shape matches → tool stores payload as `kind: "component"` with provenance → artifact appears in the user's artifact list.
  - **Outcome:** Component artifact exists; same chrome and list entry as an HTML artifact.
  - **Covered by:** R6, R7, R8, R20.

- F3. End user opens an HTML artifact
  - **Trigger:** A1 clicks an artifact in the list, deep-links from a chat message, or follows a provenance link.
  - **Actors:** A1, A3.
  - **Steps:** Shell fetches the artifact → host renders the HTML payload in a sandboxed iframe with the canonical stylesheet linked → artifact chrome (refresh, share, favorite, title) renders around the iframe.
  - **Outcome:** Artifact is visible and interactive at the level of native HTML (forms, links).
  - **Covered by:** R9, R10, R14, R15, R17.

- F4. End user opens a component artifact
  - **Trigger:** Same as F3.
  - **Actors:** A1, A3, A4.
  - **Steps:** Shell fetches the artifact → host resolves component name in the registry → mounts the React component in the artifact pane (no iframe) → passes stored data and any previously-persisted user state as props → artifact chrome renders around the component.
  - **Outcome:** Component is fully interactive at the level the host component supports.
  - **Covered by:** R11, R12, R16, R17.

- F5. End user refreshes an artifact (either kind)
  - **Trigger:** A1 clicks the host-provided Refresh button on the artifact container.
  - **Actors:** A1, A3.
  - **Steps:** Host invokes the recorded data recipe → recipe re-fetches data from its original source (MCP tool call, GraphQL query, etc.) → for HTML artifacts, host re-renders the HTML server-side and reloads the iframe; for component artifacts, host swaps in the new data prop and the component re-renders → UI signals "refreshed" distinct from "Ask Computer."
  - **Outcome:** Same artifact, fresh data, same user-visible chrome path for both payload kinds.
  - **Covered by:** R13, R14.

- F6. End user fills a form inside an HTML artifact
  - **Trigger:** A1 types into a native HTML form rendered inside an HTML artifact (e.g., meeting-prep agenda items).
  - **Actors:** A1, A3.
  - **Steps:** User types in `<input>` / `<textarea>` → form submits to a host-controlled endpoint chosen by the host, not the agent → host persists the submission keyed by artifact id → reopening the artifact restores the values.
  - **Outcome:** HTML artifact user-state persists separately from artifact source.
  - **Covered by:** R10, R15.

- F7. End user changes state inside a component artifact
  - **Trigger:** A1 toggles a filter, zooms, or otherwise mutates state inside a component artifact (e.g., panning the map).
  - **Actors:** A1, A3, A4.
  - **Steps:** Component emits state-change events to a host hook → host debounces and persists state keyed by artifact id → reopening the artifact restores the state.
  - **Outcome:** Component artifact user-state persists separately from artifact source.
  - **Covered by:** R12, R16.

---

## Requirements

**Payload kinds & dispatch**
- R1. Each artifact has exactly one of two payload kinds: `html` (static HTML markup) or `component` (a reference to a registered host component plus structured data). No mixing in v1.
- R2. The artifact list, artifact chrome (title, version, favorite, refresh, share, delete), provenance metadata, and per-user storage location are identical across both payload kinds.
- R3. The renderer used for an artifact is selected by payload kind at open time. The agent does not author or influence renderer code paths beyond choosing the payload kind.

**HTML artifact authoring & rendering**
- R4. HTML payloads are single self-contained HTML strings emitted by the agent. They reference one canonical, host-served stylesheet at a known URL.
- R5. HTML payloads must not contain `<script>` tags, inline `on*` handlers, or external script references. Validation rejects the artifact at save time if any are present, and surfaces a structured error the agent can recover from.
- R9. HTML artifacts render inside a sandboxed iframe that disallows script execution and permits form submission. The iframe must not enable same-origin privileges, top-window access, or arbitrary external navigation.
- R14. The host injects the canonical stylesheet link into every HTML payload at render time; the agent does not need to include it manually, and an agent-emitted `<link>` to a different stylesheet must be stripped or rejected at validation.

**Styling vocabulary**
- R17. There is exactly one canonical artifact stylesheet served by the host at a stable URL. All HTML artifacts reference it; design-token or visual-language changes are made in that single file.
- R18. HTML payloads use a small, host-defined semantic class vocabulary (e.g., container, table, callout, form-row, heading). The vocabulary is documented for the agent and enforced by validation — utility-class CSS, Tailwind-style classes, and `<style>` blocks are rejected at save time.
- R19. Expanding the class vocabulary is host PR work, not something the agent can do on demand.

**Component artifact authoring & rendering**
- R6. Component payloads consist of `{ name, data, state? }` where `name` is a registered component identifier and `data` matches the component's declared data contract.
- R7. The component registry is a single host-owned map from name to React component, pre-compiled into the `apps/computer` bundle. Adding a component is a host code change, never an agent action.
- R7a. The v1 registry contains exactly three components: an interactive map, an interactive table (client-side sort/filter), and an interactive chart (pan/zoom/tooltip). No additional components ship in v1.
- R8. Save-time validation rejects a component payload whose `name` is not in the registry or whose `data` fails the component's schema check.
- R11. Component artifacts render directly in the host React tree without an iframe.
- R16. The same registered component used inline in a chat message preview must be reusable as the component artifact's main renderer; the registry has one entry per component, not two.

**Host chrome: refresh, persistence, lifecycle**
- R13. The artifact chrome includes a Refresh control on every artifact that has a recorded data recipe. Clicking Refresh re-runs the recipe and swaps in the new data; for HTML artifacts this re-renders the HTML; for component artifacts it updates the component's data prop.
- R10. HTML form submissions target host-controlled endpoints. The form action and method are owned by the host injection layer; the agent does not choose the post target. The host persists submissions keyed by artifact id.
- R10a. On every reopen of an HTML artifact containing forms — including deep-links, list clicks, and opens on new devices — the host transparently pre-populates each form field with the last persisted value for the same artifact id and the same field name. The form is editable immediately; no read-only state or Edit toggle is shown. Submissions overwrite prior values for the same field.
- R12. Component artifacts persist user state (filters, zoom, etc.) through a single host hook the components consume. State is keyed by artifact id and restored on open.
- R15. When an artifact's render fails (HTML validation slip-through, unknown component name, runtime error during component mount), the artifact pane shows a recoverable error surface with a "Regenerate with Computer" CTA. Other artifacts continue to load.

**Provenance, storage, migration**
- R20. Every artifact records the same provenance set used today: originating thread, originating prompt, generation timestamp, agent version, model id, plus a new `payload_kind` discriminator.
- R21. Existing TSX-based applets do not coexist with the new substrate at runtime. The TSX/sucrase/iframe-RPC pipeline is removed once existing in-flight artifacts have been regenerated as HTML or component artifacts.
- R22. The constrained import surface validator, the host-applet RPC layer, the iframe-shell module loader, the leaflet CDN compatibility shim, and the vendored React/shadcn/recharts/leaflet bundle in the applet runtime are deleted as part of this change. No dormant escalation path is retained.

---

## Acceptance Examples

- AE1. **Covers R5.** Given the agent attempts to save an HTML artifact whose payload contains `<script>alert(1)</script>`, when save-artifact runs validation, the save is rejected with a structured error naming the disallowed element, and no artifact row is created.

- AE2. **Covers R5.** Given the agent attempts to save an HTML artifact whose payload contains `<button onclick="...">`, when save-artifact runs validation, the save is rejected with a structured error naming the disallowed inline handler.

- AE3. **Covers R8.** Given the agent attempts to save a component artifact with `name: "interactive-globe"` when no `interactive-globe` is in the registry, when save-artifact runs validation, the save is rejected and the error names which components are available.

- AE4. **Covers R10, R15.** Given an HTML artifact contains a `<form action="https://example.com/steal">`, when the host injects the rendered HTML into the iframe, the form action is rewritten or rejected such that submission can only reach a host-controlled endpoint.

- AE5. **Covers R13, R14.** Given an HTML artifact has a recorded recipe and a user clicks Refresh, when the recipe completes successfully, the iframe reloads with new HTML, the canonical stylesheet remains linked, and any previously-submitted form state is reapplied.

- AE6. **Covers R13.** Given a component artifact has a recorded recipe and a user clicks Refresh, when the recipe completes successfully, the component re-renders with the new `data` prop and any persisted `state` (filters, zoom) is preserved across the refresh.

- AE7. **Covers R15.** Given a component artifact references a name that has since been removed from the registry, when the user opens it, the artifact pane shows a recoverable error with a "Regenerate with Computer" CTA, and the rest of the artifact list continues to function.

- AE8. **Covers R18.** Given the agent emits HTML that includes `<style>...</style>` or class names matching a utility-CSS pattern, when save-artifact runs validation, the save is rejected naming the offending construct.

---

## Visual Aid

| Aspect | HTML artifact (`kind: "html"`) | Component artifact (`kind: "component"`) |
|---|---|---|
| Authored by | Agent — static HTML string | Agent — `{ name, data, state? }` |
| Author surface | Canonical class vocabulary | Registered component + data schema |
| Trust boundary | Untrusted (sandboxed iframe, no scripts) | Trusted (host React tree, no iframe) |
| Interactivity | Native HTML only (forms, links, navigation) | Full host-React capability |
| Adding new shape | Agent emits any conforming HTML | Host PR adds a component |
| Styling | One canonical stylesheet, semantic classes | Host component's own styling |
| User state | Native form posts → host endpoint | Host hook → keyed by artifact id |
| Refresh | Host re-renders HTML, reloads iframe | Host swaps `data` prop, component re-renders |
| Storage shape | `{ payload_kind: "html", html: "..." }` | `{ payload_kind: "component", name, data, state? }` |

---

## Success Criteria

- Existing read-only applet use cases (CRM pipeline-risk dashboard, meeting-prep brief, research summaries) are realized as HTML artifacts with no agent-authored JS and no degradation of the user-visible product surface.
- The interactive map shape ships as a component artifact whose host React renderer is reused both inline in chat and in the artifact pane.
- `apps/computer/src/iframe-shell/`, `apps/computer/src/applets/`, the sucrase / esbuild-wasm transform pipeline, the leaflet CDN compatibility shim, and the vendored applet-side React+shadcn+recharts+leaflet bundle are deleted from `main`. The substrate code line-count of the artifact subsystem demonstrably drops by at least an order of magnitude.
- The Computer agent's success rate at producing an openable artifact on first attempt is no worse than today, and qualitatively higher for the static-display cases.
- A reader of this doc and one follow-on planning doc can implement the v1 without inventing payload-kind semantics, component-registry shape, or refresh chrome behavior. `ce-plan` produces an executable plan without product re-litigation.

---

## Scope Boundaries

- Compound artifacts (an HTML doc with embedded interactive components) are out of v1. If a result wants both narrative and interactivity, the agent emits two artifacts.
- A TSX/iframe escalation tier kept alive in parallel is rejected. The substrate is removed, not dormant.
- Net-new host components beyond what current usage actually justifies are out. Adding components is host PR work, evaluated when a real case appears.
- Agent-authored JavaScript of any form (inline, external, in `<script>`, in `on*` handlers) is forbidden at v1 and beyond. This is a product constraint, not a v1 default with a back door.
- Live data streaming into artifacts is out — Refresh is the only data-update loop in v1.
- Renaming "applet" → "artifact" or "page" or "document" is a separate nomenclature decision, not in this scope.
- Reusing this substrate for non-Computer surfaces (admin reports, mobile, wiki) is out of v1, even though it may become attractive later.
- Agent generation-side specifics — the exact system-prompt rewrite, the save-artifact validator implementation, the migration mechanics for existing TSX applets — are plan-time content, not requirements.

---

## Key Decisions

- **Two payload kinds, one artifact entity**: HTML and component artifacts share the same table, the same chrome, the same list entry, and the same provenance. The differentiator is a payload-kind discriminator, not a separate type. Rationale: avoids forking the user's mental model and the data model; refresh, persistence, favorites, and provenance are one surface to build and maintain.
- **No agent-authored JavaScript**: locked as a product constraint, not a v1 simplification with a planned reversal. Rationale: the substrate cost dominantly came from making agent-authored JS safe and runnable; removing it permanently is what lets the substrate stay simple.
- **Iframe retained for HTML, dropped for components**: HTML payloads are untrusted markup and need structural isolation; component payloads are trusted host code. Rationale: a thin sandbox-only iframe (no scripts, no RPC, no module loader) is dramatically cheaper than today's iframe-shell and is the right boundary for untrusted markup; using one for trusted host code would be ceremony with no benefit.
- **One canonical stylesheet, semantic class vocabulary**: every HTML artifact references the same host-served stylesheet; agents emit semantic classes, never utility classes, never inline `<style>`. Rationale: central restyle-everything; agents have a tiny learnable surface; visual language stays consistent across artifacts forever.
- **Compound artifacts excluded from v1**: if a result needs narrative plus interactivity, two artifacts. Rationale: compound rendering reintroduces the iframe-as-mixed-render-host pattern we are deleting; deferring this until product evidence justifies it is cheaper than building the seam now.
- **Component registry is host code, not data**: components are real React components pre-compiled into the bundle; the registry is a TS map. Rationale: keeping it as code (not a runtime config) is what lets us delete the transform pipeline; treating component definitions as data would re-create a runtime build problem.
- **v1 registry = map + table + chart**: three components ship at launch — interactive map, interactive table, interactive chart. Rationale: covers the three known interactive shapes (geographic display, data exploration, time-series visualization) without speculative additions; static SVG charts and static HTML tables remain available inside HTML artifacts when interactivity isn't needed.
- **Form state restores transparently on reopen**: every reopen of an HTML artifact pre-populates fields with the last persisted values, editable immediately, no read-only state or Edit toggle. Rationale: matches user expectation of "the draft I was working on"; treats fillable artifacts as living documents rather than as forms-and-submissions; eliminates UX overhead of a separate edit-mode toggle.

---

## Dependencies / Assumptions

- The Vercel AI SDK / AI Elements chat rendering layer in `apps/computer` provides the React surface where component artifacts and HTML artifact previews can be embedded inline in messages.
- Today's per-user EFS-backed storage path for applets continues to serve as the storage location for both payload kinds; only the rendered payload format changes.
- The agent's existing constrained tool surface (`save-app` or equivalent) is the right hook to evolve into the new save-artifact validator; the tool surface concept is unchanged.
- The chat-side React stack (React + shadcn + AI Elements) continues to be the toolkit for host components; this brainstorm does not require changes to the chat-side substrate.
- Removing the leaflet CDN compatibility shim is acceptable because no shipped HTML artifact will need leaflet directly; interactive maps move into the host React tree where leaflet (or any alternative) can be imported normally.

---

## Outstanding Questions

### Resolve Before Planning

*All blocking questions from the brainstorm have been resolved. No items currently block planning.*

### Deferred to Planning

- [Affects R18][Technical] Enumerate the v1 semantic class vocabulary. Planning should audit in-flight applets (CRM pipeline-risk dashboard, meeting-prep brief, any other shipped or in-flight applet sources) plus the existing `apps/computer` shadcn-themed Tailwind surface, then propose the smallest vocabulary that covers both. The result feeds both the canonical stylesheet content and the save-artifact class-name validator.

- [Affects R6, R8][Technical] Exact JSON shape of the component payload (`name`, `data`, `state`), including how the registry declares each component's data schema for save-time validation.
- [Affects R13][Technical] Refresh recipe storage format and how recipes are recorded at artifact creation time (especially distinguishing a single MCP call from a small composed plan).
- [Affects R10][Technical] Form-action rewriting/injection mechanics — whether the host munges agent-emitted forms or requires forms to declare a host-controlled action by convention.
- [Affects R21, R22][Technical] Migration mechanics for existing TSX applets — regenerate via agent re-prompt, hand-port, or delete; in-flight CRM pipeline-risk dashboard is the primary case.
- [Affects R9][Needs research] Confirm `sandbox="allow-forms"` (without `allow-scripts` and without `allow-same-origin`) provides the desired isolation given the form-post-to-host-endpoint pattern, including any cross-origin posting nuances.
- [Affects R17][Technical] Where the canonical stylesheet lives and is served from (CDN, app bundle, separate route), and cache/versioning strategy when the design system evolves.
- [Affects R18][Technical] Whether the class-vocabulary validator runs in the agent's save-artifact tool, in the host on read, or both.
