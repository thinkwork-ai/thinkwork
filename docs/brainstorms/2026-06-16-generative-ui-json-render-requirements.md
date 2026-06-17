---
date: 2026-06-16
topic: generative-ui-json-render
linear_issue: THNK-34
---

# Generative UI in Threads with json-render

## Problem Frame

ThinkWork Threads need a safer, more native way for agents to stream useful UI
inside the conversation: task cards, decision panels, data summaries, forms,
charts, and other small working surfaces that are more helpful than markdown but
lighter than a durable artifact.

The current platform already has several pieces of this story:

- `apps/web` has AI SDK / AI Elements typed message parts, an AppSync chat
  transport, `Message.parts` persistence, and a renderer for known part types.
- Unknown `data-*` parts currently degrade to a debug strip rather than a real
  UI surface.
- Mobile has a separate `_type`/```genui registry that renders known tool-result
  cards, but it is not the canonical web Thread contract.
- Prior GenUI brainstorms explored TSX fragments and iframe execution, but the
  current THNK-34 question is specifically whether
  [json-render](https://json-render.dev/) gives ThinkWork a better contract:
  host-defined component catalogs, JSON specs, validation, and progressive
  rendering without arbitrary agent-authored code.

The value is not "install one library." The value is making Thread conversations
feel like an operating surface: the agent can compose real interface pieces as
the work unfolds, while ThinkWork keeps component ownership, validation, actions,
and persistence under host control.

---

## Actors

- A1. End user: Works in a Thread, reads streamed UI cards inline, invokes
  allowed actions, and saves durable outputs only when the UI is worth keeping.
- A2. ThinkWork agent runtime: Emits structured UI specs as part of an assistant
  turn, updates those specs as work progresses, and never emits arbitrary
  same-origin UI code for this v1 path.
- A3. Web Thread renderer: `apps/web` Thread surfaces that merge streamed typed
  parts, render json-render specs through a host registry, and reconcile with
  persisted `Message.parts` on reload.
- A4. Host component catalog owner: ThinkWork engineering/design owns the
  catalog of components, props, actions, validation, and visual behavior that an
  agent may compose.
- A5. Durable artifact path: Existing artifact/applet persistence used only when
  a user or agent intentionally promotes a transient inline UI into a named
  durable output.
- A6. Mobile Thread renderer: Existing mobile GenUI registry that should not
  block web v1 but must have a clear compatibility path for supported specs.

---

## Key Flows

- F1. Agent streams a new inline UI
  - **Trigger:** The agent decides a response needs a small interactive or
    structured surface rather than markdown alone.
  - **Actors:** A2, A3, A4, A1
  - **Steps:** The runtime emits a typed message part such as `data-genui` with
    a stable part id and a json-render-compatible spec. The web stream merger
    upserts the part by id. The renderer validates the spec against the
    host-owned catalog and mounts the matching React components inline in the
    assistant message.
  - **Outcome:** The user sees a real UI surface appear in the conversation
    without creating a durable artifact.
  - **Covered by:** R1, R2, R3, R5, R6, R10

- F2. Agent updates an existing inline UI
  - **Trigger:** Work progresses, a tool returns richer data, or the user asks
    to refine the displayed UI.
  - **Actors:** A1, A2, A3
  - **Steps:** The runtime emits another `data-genui` part with the same part id
    and an updated spec or patch. The existing part is replaced in place, using
    the current per-type-and-id `data-*` merge semantics rather than adding a
    duplicate message bubble.
  - **Outcome:** The UI changes in place and the conversation remains readable.
  - **Covered by:** R4, R7, R8, R9

- F3. User invokes an allowed action
  - **Trigger:** The user clicks or submits an action exposed by a rendered UI
    card.
  - **Actors:** A1, A3, A4, A2
  - **Steps:** The component emits an action that exists in the catalog. The
    host validates the action name and params, routes it through an existing
    ThinkWork command path or appends a normal Thread message, and the agent
    responds through the normal wake/turn loop.
  - **Outcome:** Inline UI can be useful without giving the agent arbitrary
    client-side behavior.
  - **Covered by:** R11, R12, R13

- F4. User reopens a Thread containing inline UI
  - **Trigger:** The user navigates away and later reopens the Thread.
  - **Actors:** A1, A3
  - **Steps:** The Thread query loads persisted `Message.parts`. The web
    renderer normalizes `data-genui` parts, validates them against the catalog,
    and renders the final known spec. Unsupported or invalid specs show a
    recoverable fallback without hiding the surrounding message.
  - **Outcome:** Inline UI is durable enough to read later, but still distinct
    from saved artifacts.
  - **Covered by:** R14, R15, R16

- F5. User promotes an inline UI to a durable artifact
  - **Trigger:** The user chooses to save or pin a generated UI as a durable
    output, or the agent has explicit instructions to produce a named artifact.
  - **Actors:** A1, A3, A5
  - **Steps:** The current spec is captured and routed through the existing
    artifact/applet persistence path with provenance back to the source Thread
    message. Future inline updates do not mutate the saved snapshot unless a
    separate artifact update flow explicitly does so.
  - **Outcome:** The artifact library stays curated; transient inline UI does
    not become save-everything noise.
  - **Covered by:** R17, R18, R19

---

## Requirements

**Inline UI contract**

- R1. Web Threads must support a first-class typed message part for generated UI
  specs, represented as `data-genui` or a similarly explicit `data-*` part, not
  as markdown fences or raw assistant text.
- R2. Each generated UI part must have a stable id so streamed updates can
  replace the existing part in place.
- R3. The part payload must be a structured JSON UI spec constrained by a
  host-owned catalog of components, props, actions, and validation rules.
- R4. Updates for the same generated UI part must reuse the same part id and
  replace or patch the existing rendered UI, not append duplicate cards.
- R5. The v1 render target is `apps/web` Thread conversation surfaces. Mobile
  compatibility is required as a design constraint, but mobile implementation
  may follow after web v1.

**json-render adoption gates**

- R6. Planning must validate `@json-render/core` and `@json-render/react`
  against the current `apps/web` stack before committing to production
  adoption: React 19, Vite, Tailwind/shadcn styling, pnpm workspace behavior,
  bundle impact, and license compatibility.
- R7. The preferred v1 direction is json-render if the spike confirms that its
  catalog, validation, and renderer model fit ThinkWork's typed part stream.
- R8. If json-render fails a material gate, the fallback is to preserve the same
  product contract with a smaller host-owned JSON registry, not to return to
  arbitrary agent-authored TSX as the default inline UI path.
- R9. The plan must explicitly decide whether updates are whole-spec replacement
  or json-render-compatible patching. The user-facing requirement is in-place
  update; the patch mechanism is a planning decision.

**Catalog and rendering behavior**

- R10. ThinkWork owns the catalog. Agents may compose only catalog entries and
  may not introduce new component names, imports, CSS, actions, or arbitrary
  JavaScript at runtime.
- R11. Catalog actions must be allowlisted and schema-validated. Unknown actions
  or invalid params must fail closed with a recoverable user-visible state.
- R12. UI actions that need agent follow-up must route through normal Thread
  messages or existing command/wakeup paths so the resulting work remains part
  of the Thread record.
- R13. Catalog components must render with the same visual language as the web
  Thread surface and must not create nested card chrome that fights the message
  layout.
- R14. Persisted `Message.parts` must retain generated UI specs so a Thread
  reload renders the same final UI state without replaying the live stream.
- R15. Invalid, unsupported, or catalog-mismatched specs must render a compact
  fallback that preserves surrounding text and gives enough diagnostic detail
  for an agent/developer to recover.
- R16. Generated UI must remain tenant-scoped and must not fetch tenant data from
  the browser unless an allowlisted host action intentionally performs that
  operation.

**Promotion and artifacts**

- R17. Inline generated UI is transient by default and must not automatically
  create an artifact row.
- R18. The user must have a deliberate way to promote a useful inline UI into a
  durable artifact when the UI represents an output worth keeping.
- R19. Promotion captures a snapshot of the current spec plus provenance. Later
  in-thread updates do not silently mutate the saved artifact.

**Cross-surface compatibility**

- R20. The generated UI contract must have a mobile compatibility story: either
  a shared catalog subset that can render in React Native later, or a graceful
  mobile fallback for unsupported web-only components.
- R21. Existing mobile `_type` GenUI cards and web durable artifact rendering
  must continue to work while the new web `data-genui` path is introduced.
- R22. The v1 must not require replacing AppSync subscriptions, the AI SDK
  `UIMessage` stream protocol, or the existing `Message.parts` persistence
  model.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R10.** Given an agent emits a `data-genui` part for
  a task review card with id `genui:task-review:123`, when the chunk reaches the
  web Thread renderer, then the renderer validates it against the catalog and
  mounts the host-owned task review component inline.
- AE2. **Covers R4, R9, R14.** Given the same generated UI part is already
  visible, when the agent emits an update with the same id after a tool result
  arrives, then the existing card updates in place and a Thread reload shows the
  updated final card once.
- AE3. **Covers R8, R10, R15.** Given an agent emits a spec referencing
  `UnapprovedChart3D`, when validation runs, then the UI shows a recoverable
  unsupported-component fallback and does not execute arbitrary code or hide the
  rest of the assistant message.
- AE4. **Covers R11, R12, R16.** Given a rendered card includes an `approve`
  action, when the user clicks it, then the host validates the action payload and
  records the result through a normal Thread command/message path rather than
  letting the generated UI call arbitrary browser APIs.
- AE5. **Covers R17, R18, R19.** Given the agent streams a dashboard preview
  inline, when the user chooses Save as artifact, then a durable artifact is
  created from the current spec with source-message provenance and future inline
  refinements do not mutate that saved snapshot.
- AE6. **Covers R20, R21.** Given a mobile user opens a Thread containing a web
  v1 generated UI part before mobile rendering support lands, then mobile shows
  a readable fallback summary instead of a broken blank region, and existing
  mobile `_type` GenUI cards continue to render.

---

## Success Criteria

- A web Thread can stream and persist at least two catalog-constrained generated
  UI cards from an agent turn without using markdown fences or agent-authored
  TSX as the UI contract.
- The first implementation proves one update-in-place path and one allowlisted
  action path through normal Thread state.
- json-render is either validated as the implementation substrate or rejected
  with concrete evidence and a compatible host-registry fallback plan.
- The artifact library remains curated: inline generated UI does not create
  durable artifacts until promotion is explicit.
- Planning can proceed without re-litigating the product shape, persistence
  semantics, security boundary, or web-first scope.

---

## Scope Boundaries

- V1 is web Thread conversation rendering first. Mobile render parity is a
  follow-on, though mobile fallback behavior is in scope.
- V1 does not replace AppSync, `UIMessage`, `Message.parts`, or the current
  Thread wake/finalize flow.
- V1 does not use markdown fences as the canonical generated UI transport.
- V1 does not let agents ship arbitrary React/TSX, imports, CSS, browser APIs,
  or same-origin executable code through this path.
- V1 does not automatically persist every generated UI as an artifact.
- V1 does not migrate all existing durable applets/artifacts to json-render.
- V1 does not require broad catalog coverage. A small catalog that proves the
  pattern is preferable to a large speculative component library.
- V1 does not make json-render a platform-wide dependency until the adoption
  gates are explicitly passed during planning/spike work.

---

## Key Decisions

- **Use a typed message part, not markdown.** The current web stack already has
  streamed and persisted `data-*` parts. A first-class generated UI part fits
  that contract and avoids fragile content parsing.
- **Prefer catalog-constrained JSON over agent-authored TSX for THNK-34.** The
  json-render model lines up with ThinkWork's need for guardrails: host-owned
  components, typed props, known actions, and validation before render.
- **Treat json-render as the candidate substrate, not the product requirement
  itself.** The product requirement is safe streamed UI in Threads. If the
  library fails integration gates, the same JSON/catalog contract should still
  survive.
- **Web v1 before mobile parity.** The current richest typed-part substrate is
  in `apps/web`. Mobile has useful GenUI precedent but a different registry and
  should adopt once the web contract stabilizes.
- **Inline first, artifact by promotion.** Streaming generated UI is part of the
  conversation by default. Durable artifacts remain intentional outputs.
- **Actions route through ThinkWork.** Generated UI can expose buttons and
  forms, but actions must become normal host-validated Thread events rather than
  arbitrary client behavior.

---

## Dependencies / Assumptions

- `apps/web` continues to use the AI SDK `UIMessage` stream protocol and
  `Message.parts` persistence as the Thread message substrate.
- The existing `data-*` stream merge behavior, which replaces parts by matching
  `type` and `id`, is suitable for generated UI updates or can be extended
  without changing the user-facing contract.
- json-render's documented model of catalogs, validation, structured specs, and
  React rendering remains available in the packages selected during planning.
- A small initial catalog can cover meaningful Thread UI without needing a broad
  component marketplace.
- The current mobile GenUI registry can either consume a subset of the same spec
  later or render readable fallbacks until parity is planned.
- Security review treats generated JSON specs as untrusted input even though the
  rendered components are host-owned.

---

## Outstanding Questions

### Resolve Before Planning

*None. Brainstorm is ready for planning.*

### Deferred to Planning

- [Affects R6, R7][Technical] Validate json-render package installation,
  rendering, streaming, and bundle impact inside `apps/web`.
- [Affects R3, R10][Design/Technical] Define the smallest useful v1 catalog:
  likely task/decision card, metric or chart summary, compact table/list, and a
  form/action component.
- [Affects R9][Technical] Decide whole-spec replacement versus patch updates for
  streamed changes to an existing part id.
- [Affects R11, R12][Technical] Map catalog actions to existing Thread message,
  command, wakeup, or mutation paths.
- [Affects R14][Technical] Decide the persisted `data-genui` payload shape and
  any migration/codegen changes required for web queries.
- [Affects R15][Design] Design the fallback UI for invalid or unsupported specs.
- [Affects R18, R19][Technical] Choose the promotion path from inline spec to
  durable artifact/applet and record the provenance fields.
- [Affects R20, R21][Technical] Define mobile fallback behavior and the first
  shared catalog subset that React Native can eventually render.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
