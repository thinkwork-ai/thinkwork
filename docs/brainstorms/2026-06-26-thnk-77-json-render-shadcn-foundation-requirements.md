---
date: 2026-06-26
topic: thnk-77-json-render-shadcn-foundation
linear_issue: THNK-77
---

# json-render/shadcn as the Thread GenUI Foundation

## Problem Frame

ThinkWork's generated UI path drifted into a proprietary Thread GenUI dialect:
`data-genui` plus `@thinkwork/genui`. That keeps the platform safe, but it
throws away the ecosystem leverage that motivated the json-render direction in
the first place. ThinkWork should not re-create Vercel Labs json-render examples
inside a private schema when the upstream package, spec, renderer, and shadcn
catalog already exist.

THNK-77 should hard cut Thread generated UI onto the real json-render stack:
`@json-render/core`, `@json-render/react`, and especially
`@json-render/shadcn`. ThinkWork owns the Thread transport, persistence,
tenant/security policy, durable action governance, and artifact promotion. The
UI tree itself should be json-render-shaped.

---

## Actors

- A1. End user: Reads and interacts with generated UI inside a Thread.
- A2. ThinkWork agent/runtime: Emits json-render specs as part of Thread turns.
- A3. Web Thread renderer: Renders json-render specs through the upstream React
  renderer and shadcn catalog.
- A4. ThinkWork platform: Owns Thread persistence, tenant visibility, action
  governance, fallback behavior, and artifact promotion.
- A5. Planner/implementer: Converts THNK-77 into a cutover plan without
  preserving an internal generated-UI DSL.

---

## Key Flows

- F1. Render a new json-render Thread UI
  - **Trigger:** An agent response needs more than text, such as a task review,
    compact dashboard, approval surface, or small form.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The agent emits a json-render spec using upstream shape
    (`root`, `elements`, `type`, `props`, `children`). The Thread stream and
    final message persistence carry that spec. The web Thread renderer validates
    and renders it through json-render and the selected shadcn catalog. Invalid
    specs fail closed with a compact unsupported state.
  - **Outcome:** The user sees a safe, shadcn-native generated UI without
    arbitrary React code or a ThinkWork-only UI dialect.
  - **Covered by:** R1, R2, R3, R5, R6, R7, R10

- F2. Hard cut over from old `data-genui`
  - **Trigger:** THNK-77 lands and new Thread generated UI is enabled.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** New generated UI uses json-render specs only. Old persisted
    `data-genui` parts are not migrated into the new authoring contract. If
    encountered, they may be ignored, discarded from the rendered part list, or
    shown as unsupported. No read-through compatibility layer is built.
  - **Outcome:** The codebase stops carrying two generated-UI contracts.
  - **Covered by:** R4, R8, R9, R13

- F3. Invoke generated UI actions
  - **Trigger:** A user clicks, submits, opens, or changes local state in a
    generated UI.
  - **Actors:** A1, A3, A4
  - **Steps:** Local json-render state actions remain local and bounded.
    Durable actions route through ThinkWork's server-validated Thread action
    path with tenant/thread visibility checks and idempotency. Generated UI does
    not get arbitrary browser callbacks, arbitrary URLs, or direct effect
    authority.
  - **Outcome:** Generated UI can be interactive without becoming an
    ungoverned client-side execution surface.
  - **Covered by:** R11, R12, R14

---

## Requirements

**Upstream json-render foundation**

- R1. Thread generated UI must use real json-render packages for the production
  render path unless a documented hard blocker prevents adoption.
- R2. The generated UI payload must use upstream json-render spec shape:
  `root`, `elements`, `type`, `props`, and `children`.
- R3. `@json-render/shadcn` is the preferred primitive catalog and renderer
  source because ThinkWork's web UI is already shadcn-based.
- R4. `data-genui` must stop being the generated UI product contract. If an AI
  SDK typed part is needed, use a json-render-specific carrier such as
  `data-json-render`.
- R5. `@thinkwork/genui` must be removed, retired, or reduced to short-lived
  cutover code; it must not remain the canonical generated UI catalog or
  renderer.

**Thread behavior**

- R6. Web Threads must render nested json-render specs inline in the
  conversation without agent-authored React, arbitrary CSS, callbacks, scripts,
  or unrestricted URLs.
- R7. Thread persistence must store the final json-render spec for new
  generated UI so reopening a Thread renders the same final generated view.
- R8. Old persisted `data-genui` payloads do not require migration, backfill, or
  read-through rendering. They may be ignored, discarded, or surfaced as
  unsupported during the hard cutover.
- R9. Planning must remove old `data-genui` fallback assumptions rather than
  preserving them as a parallel compatibility product path.
- R10. Invalid, unsupported, oversized, or unsafe json-render specs must fail
  closed with a compact user-visible fallback that does not break surrounding
  Thread content.

**Catalog and actions**

- R11. The primitive catalog must come from upstream json-render/shadcn APIs
  wherever compatible, with ThinkWork selecting or constraining components
  through policy rather than reimplementing an unrelated schema.
- R12. ThinkWork-specific domain components may be added only as json-render
  catalog entries, adapters, or compositions; they must extend json-render
  rather than bypass it.
- R13. Legacy domain components such as `task.review`, `workflow.status`,
  `keyValue.list`, `form.action`, and `analytics.display` must be represented as
  json-render catalog entries/adapters/compositions or explicitly removed as
  superseded.
- R14. Local json-render state actions must be distinguished from durable
  ThinkWork actions. Durable effects must route through ThinkWork's
  server-validated Thread action path.

**Cross-surface compatibility**

- R15. Mobile compatibility must be explicit: either use a future json-render
  React Native path or require a bounded fallback summary for Thread-carried
  generated UI while web leads.
- R16. MCP Apps are out of scope for THNK-77; adopting json-render/shadcn for
  Thread GenUI must not blur into the separate MCP Apps surface.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R6.** Given an agent emits a json-render spec whose
  tree is `Card -> Stack -> Heading/Text/Button`, when the web Thread renders
  the assistant message, then the UI appears through `@json-render/react` and a
  json-render shadcn registry without any `data-genui` conversion layer.
- AE2. **Covers R4, R5, R8, R9.** Given an older Thread contains a persisted
  `data-genui` part, when the Thread opens after THNK-77, then the old part may
  be ignored or shown as unsupported, and no migration/read-through layer is
  required.
- AE3. **Covers R11, R12, R13.** Given a task review UI is still valuable, when
  it is supported after the cutover, then it is represented as a json-render
  catalog entry, adapter, or composition rather than a `@thinkwork/genui`
  native component.
- AE4. **Covers R10, R14.** Given a generated spec tries to attach an arbitrary
  URL, callback, script, or unregistered durable action, when validation runs,
  then the part fails closed and the surrounding Thread remains readable.
- AE5. **Covers R15.** Given a mobile user opens a Thread with a web-first
  json-render part before native rendering exists, when mobile loads the
  message, then it shows a bounded fallback summary or unsupported generated UI
  state rather than crashing or blanking the conversation.

---

## Success Criteria

- New Thread generated UI is authored and rendered as upstream json-render, not
  as a ThinkWork-only `data-genui` dialect.
- The web Thread can render useful shadcn-native primitive compositions from an
  agent turn with validation and without arbitrary executable UI code.
- The implementation removes meaningful carrying cost by retiring
  `@thinkwork/genui`/`data-genui` as canonical contracts instead of preserving a
  duplicate path.
- Planning can proceed without re-deciding whether to adopt json-render,
  whether to use `@json-render/shadcn`, or whether old `data-genui` needs a
  compatibility bridge.

---

## Scope Boundaries

- Do not build a migration, backfill, or read-through compatibility layer for
  old `data-genui` payloads.
- Do not fork json-render's spec into a new ThinkWork-only schema.
- Do not keep `@thinkwork/genui` as the long-term catalog or renderer.
- Do not adopt arbitrary generated React/TSX as the Thread GenUI mechanism.
- Do not solve MCP Apps in THNK-77.
- Do not require full mobile json-render rendering in the first web cutover;
  mobile may use fallback behavior while web leads.
- Do not create a parallel chart/table catalog inside Thread GenUI if existing
  analytics display work can become a json-render adapter/composition.

---

## Key Decisions

- **Hard cutover from `data-genui`.** Old generated UI payloads can be ignored or
  discarded because preserving them would keep the duplicate contract alive.
- **Use `@json-render/shadcn` as the primitive path.** ThinkWork already uses
  shadcn, so the upstream shadcn catalog is the highest-leverage way to avoid a
  private component grammar.
- **Keep ThinkWork ownership around the host boundary.** ThinkWork should own
  Thread state, tenant visibility, durable effects, fallback behavior, and
  promotion policy, but not the generic generated UI spec.
- **Domain components extend json-render.** Product-specific components remain
  allowed, but only as json-render catalog entries/adapters/compositions.

---

## Dependencies / Assumptions

- The existing spike `docs/spikes/2026-06-17-json-render-adoption.md` verified
  `@json-render/core` and `@json-render/react` as dev-only candidates but
  deferred production adoption.
- Current npm metadata shows `@json-render/shadcn` is Apache-2.0 and peers on
  React 19, React DOM 19, Tailwind 4, and Zod 4, which appears aligned with the
  web app's stack; planning should verify this in the actual lockfile.
- Existing web Thread rendering and message persistence already support typed
  message parts, so planning should be able to replace the payload shape without
  inventing a new Thread concept.
- Existing old `data-genui` payloads are not important enough to justify a
  compatibility bridge.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R3][Needs research] Confirm the exact `@json-render/shadcn`
  exports, component count, package size, and peer compatibility under the
  current web lockfile.
- [Affects R4, R7][Technical] Decide the exact Thread message part name and
  persisted shape for json-render specs.
- [Affects R14][Technical] Define the boundary between json-render local state
  actions and ThinkWork durable Thread actions.
- [Affects R15][Technical] Decide whether mobile gets a required fallback field
  on Thread-carried json-render specs or waits for a later
  `@json-render/react-native` path.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
