---
date: 2026-06-28
topic: mcp-app-host-theming-context
linear_issue: THINK-102
companion_issues:
  - TEI-16
---

# MCP Apps Host Theming Context

## Summary

ThinkWork should implement the MCP Apps host context bridge so embedded MCP
Apps can receive the host theme and standardized style variables. The first
complete slice is theme-focused: initial render must match the current
ThinkWork theme, live theme changes must propagate to already-rendered apps,
and the Dispatch MCP App will prove the contract through the companion
TEI-16 issue.

---

## Problem Frame

ThinkWork can now render MCP App HTML returned by MCP tools in a thread, but
the rendered view is visually isolated from the host. The immediate example is
the Dispatch optimization app rendering as a light iframe inside a dark
ThinkWork conversation. That makes a successful MCP App feel bolted on instead
of native to the thread.

The fix should not be a Dispatch-only style argument, a ThinkWork-only
`styleContext`, or arbitrary CSS pushed through a model/tool call. The MCP Apps
extension already defines a host context contract for theme and style
variables. ThinkWork should implement that contract as a reusable host
capability, while individual MCP Apps opt in by consuming the standard CSS
variables with fallbacks.

---

## Actors

- A1. ThinkWork user - views and interacts with MCP Apps embedded in a thread.
- A2. ThinkWork host runtime - renders MCP App views and supplies host context.
- A3. MCP App view - runs inside the embedded app iframe and consumes host
  context when it supports the MCP Apps lifecycle.
- A4. Dispatch MCP App - first real app-side proof that host theming works.
- A5. MCP App author - builds future apps that should be portable across
  ThinkWork and other MCP App hosts.

---

## Key Decisions

- **Spec contract first.** The host/app contract is MCP Apps
  `hostContext`, not a ThinkWork-only style API. This keeps the work portable
  to other hosts that implement the extension.

- **Host plus app, split by ownership.** `THINK-102` owns the ThinkWork
  host/runtime bridge. `TEI-16` owns the Dispatch app consuming the variables
  and proving the visible result.

- **General bridge shell, theme slice complete.** ThinkWork should establish
  the MCP Apps host bridge shape now, but this issue only requires theme,
  `styles.variables`, and theme-change notifications to be complete.

- **Backward compatible rendering.** MCP Apps that do not consume host context
  continue rendering as they do today. The host provides the bridge; app
  participation is not required for basic rendering.

- **Portable theme semantics, exact variables.** ThinkWork's `dark-blue` theme
  maps to MCP Apps `theme: "dark"`. The exact dark-blue colors travel through
  `hostContext.styles.variables`.

- **No arbitrary CSS injection.** The host supplies standardized variables and
  lifecycle notifications. It does not accept arbitrary CSS from a model, user,
  tool input, or Dispatch-specific configuration for this first slice.

---

## Key Flows

- F1. MCP App renders with host context
  - **Trigger:** An assistant message includes an MCP App part.
  - **Actors:** A1, A2, A3.
  - **Steps:** ThinkWork renders the app view, initializes the MCP Apps host
    bridge, and supplies `hostContext.theme` plus
    `hostContext.styles.variables`.
  - **Outcome:** A participating MCP App can style itself from host-provided
    variables on first render.
  - **Covered by:** R1, R2, R3, R6.

- F2. User changes ThinkWork theme while an MCP App is visible
  - **Trigger:** A1 toggles ThinkWork between light, dark, or dark-blue.
  - **Actors:** A1, A2, A3.
  - **Steps:** ThinkWork updates its theme state and sends the MCP Apps
    `ui/notifications/host-context-changed` notification to participating
    app views.
  - **Outcome:** The embedded app updates without requiring a new tool call or
    thread refresh.
  - **Covered by:** R4, R5.

- F3. Non-participating MCP App renders
  - **Trigger:** An MCP App ignores the host bridge or predates it.
  - **Actors:** A2, A3.
  - **Steps:** ThinkWork still renders the app using the existing embedded app
    path.
  - **Outcome:** Existing apps remain usable even if they do not match the
    host theme.
  - **Covered by:** R7.

- F4. Dispatch proves the contract
  - **Trigger:** The Dispatch MCP App is called in a ThinkWork thread after
    `THINK-102` and `TEI-16` are available in the deployed environment.
  - **Actors:** A1, A2, A4.
  - **Steps:** ThinkWork supplies host context, Dispatch consumes the standard
    variables, and the user toggles theme while the app remains visible.
  - **Outcome:** Production verification shows the real Dispatch app rendering
    and updating with the host theme.
  - **Covered by:** R8, R9, R10.

---

## Requirements

**Host bridge**

- R1. ThinkWork provides an MCP Apps host bridge for embedded MCP App views.
  The bridge is the abstraction for host-to-app lifecycle messages.
- R2. The bridge supplies `hostContext.theme` on initialization using MCP Apps
  portable values. `light` maps to `"light"`; `dark` and `dark-blue` map to
  `"dark"`.
- R3. The bridge supplies `hostContext.styles.variables` with standardized MCP
  Apps CSS custom properties for core surface, text, border, typography,
  radius, and chart/accent needs that ThinkWork can map from its current
  tokens.
- R4. The bridge sends `ui/notifications/host-context-changed` when the
  ThinkWork theme changes while an MCP App is already rendered.
- R5. Theme-change notifications carry enough updated host context for a
  participating app to update without a new tool call, iframe reload, or
  thread refresh.

**Theme semantics**

- R6. ThinkWork's exact visual theme is represented by variables, not by
  extending the portable `theme` enum. `dark-blue` remains visually distinct
  through variables while advertising the portable `"dark"` theme value.
- R7. MCP Apps that do not consume the bridge remain renderable. Lack of
  bridge participation is not an error and does not block existing MCP App
  output from appearing in the thread.

**App-side proof**

- R8. Dispatch app-side styling belongs to TEI-16. `THINK-102` defines the
  host contract that TEI-16 consumes.
- R9. Completion evidence for `THINK-102` includes a real MCP App smoke test
  in a ThinkWork thread. Dispatch is the preferred proof once TEI-16 is ready.
- R10. Production verification on `app.thinkwork.ai` is required before this
  work is considered done. Localhost verification is useful but not sufficient.

**Safety and portability**

- R11. ThinkWork does not introduce a `styleContext` field, Dispatch-specific
  style argument, arbitrary CSS input, or Tailwind-class dependency as the
  primary contract.
- R12. MCP App views should be able to remain readable when a host provides
  partial style context or no style context, by relying on app-owned fallback
  values. This is an app-authoring expectation, not a host rendering gate.
- R13. The first slice may expose additional host context fields if they are
  already available, but dimensions, locale, time zone, display mode, and
  platform do not define done for `THINK-102`.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R6.** Given ThinkWork is in `dark-blue`, when an MCP
  App initializes, then the host context advertises `theme: "dark"` and style
  variables contain the dark-blue surface, text, and border values.

- AE2. **Covers R2, R3.** Given ThinkWork is in `light`, when an MCP App
  initializes, then the host context advertises `theme: "light"` and style
  variables contain light surface, text, and border values.

- AE3. **Covers R4, R5.** Given a participating MCP App is visible in a
  thread, when the user toggles ThinkWork theme, then the app receives a
  host-context-changed notification and updates without a new assistant turn.

- AE4. **Covers R7.** Given an older MCP App ignores the host bridge, when its
  tool result appears in a thread, then ThinkWork still renders it using the
  existing app frame.

- AE5. **Covers R8, R9, R10.** Given `THINK-102` and `TEI-16` are deployed,
  when the Dispatch MCP App is called on `app.thinkwork.ai`, then the
  optimization UI matches the current host theme and updates when the theme
  changes.

- AE6. **Covers R11.** Given an implementation proposes a Dispatch `style`
  argument or ThinkWork-only `styleContext`, when reviewed against this
  requirements doc, then that path is rejected as outside the contract.

---

## Success Criteria

- A planner can produce a host-runtime implementation plan without inventing
  whether the work is spec-first, Dispatch-first, or style-injection-first.
- A participating MCP App can prove initial theme and live theme-change
  behavior in automated or browser-level verification.
- Existing MCP App rendering does not regress for apps that ignore host
  context.
- `TEI-16` can consume this document as the host-side contract for the
  Dispatch app-side brainstorm.
- Production verification captures the real app on `app.thinkwork.ai`, not
  only a local fixture.

---

## Scope Boundaries

**In scope for THINK-102**

- Implementing the MCP Apps host bridge shell in ThinkWork.
- Supplying `hostContext.theme` and `hostContext.styles.variables`.
- Propagating theme changes to already-rendered participating apps.
- Keeping non-participating MCP Apps renderable.
- Verifying the host contract with a real MCP App in production.

**Owned by TEI-16**

- Updating the Dispatch MCP App CSS to consume MCP Apps variables.
- Defining Dispatch-specific fallback styling.
- Proving the Dispatch optimization UI visually matches ThinkWork in the
  deployed thread surface.

**Deferred for later**

- Full completion of every MCP Apps host context field beyond theme and style.
- App-level brand or accent configuration.
- A reusable public style-authoring guide for all future MCP App authors.
- Cross-host certification against ChatGPT, Claude, or other MCP App hosts.

**Out of scope**

- Arbitrary CSS injection into iframe documents.
- A ThinkWork-only `styleContext` API.
- A Dispatch-specific tool parameter for style.
- Forcing all existing MCP Apps to adopt the bridge before rendering.

---

## Dependencies / Assumptions

- The MCP Apps extension's theming model remains the target contract for host
  theme and style variables.
- ThinkWork can map its current theme tokens into the MCP Apps standardized
  CSS variables without exposing implementation-specific Tailwind classes.
- Dispatch can be updated under TEI-16 to consume the variables with fallbacks.
- Production verification may require both the ThinkWork host change and the
  Dispatch app change to be deployed.

---

## Outstanding Questions

### Resolve Before Planning

_None. Brainstorm scope is closed for planning._

### Deferred to Planning

- [Affects R3][Technical] Exact mapping from ThinkWork theme tokens to the MCP
  Apps standardized variable list.
- [Affects R1, R4][Technical] Exact message transport and lifecycle shape for
  the host bridge in the current iframe renderer.
- [Affects R9, R10][Verification] Whether the production smoke uses Dispatch
  only or also includes a fixture MCP App for host-isolated regression tests.
- [Affects R13][Technical] Which non-theme host context fields are cheap to
  include in the bridge shell without expanding done criteria.

---

## Sources / Research

- `apps/web/src/components/workbench/render-typed-part.tsx:235` shows the
  current `data-mcp-app` renderer and iframe `srcDoc` path.
- `packages/pi-runtime-core/src/mcp-app-runtime.ts:14` defines the current MCP
  App part data shape as HTML, URI, title, server name, and tool name.
- `packages/ui/src/context/ThemeContext.tsx:10` defines ThinkWork's current
  `light`, `dark`, and `dark-blue` theme values.
- `packages/ui/src/theme.css:9` exports ThinkWork's theme tokens and
  `packages/ui/src/theme.css:124` defines the dark-blue values.
- MCP Apps theming spec:
  `https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#theming`.
