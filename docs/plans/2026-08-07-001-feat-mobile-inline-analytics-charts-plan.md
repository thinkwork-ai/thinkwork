---
title: Mobile Inline Analytics Charts - Plan
type: feat
date: 2026-08-07
topic: mobile-inline-analytics-charts
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Mobile Inline Analytics Charts - Plan

## Goal Capsule

- **Objective:** Brain analytics responses render as rich inline chart cards in the mobile conversation thread — chart, takeaway caption, collapsible "Chart data" table — instead of a plain results table or an "Open this thread on web" artifact card. Target UX is the approved funnel-card mockup (2026-08-07).
- **Product authority:** Linear project "Mobile Inline Analytics Charts" (THINK-687 parent, children THINK-671…THINK-685) and the ideation artifact `docs/ideation/2026-08-07-mobile-inline-analytics-charts-ideation.html` (run 8bb84801, 7 ranked ideas verified against repo evidence). Web alignment (THINK-686) and broad directive-kind codegen are not active scope.
- **Open blockers:** None for planning. One human decision gate sits inside execution: the inspector's +3–5MB binary-size accept/reject (see Outstanding Questions).

---

## Product Contract

### Summary

Adopt the document compositor's house chart catalog as the single analytics chart vocabulary, transport validated chart directives to clients as typed data rather than rendered output, and run the shared house SVG renderer on-device in the mobile thread. The thread shows a static inline analytics card per the approved mockup; tapping it opens a full-screen GPU inspector. Provenance gating, derived accessibility narration, per-kind small-screen fitness rules, thread performance work, and golden-render CI for the shared renderer complete the release.

### Problem Frame

Brain analytics answers currently reach mobile as a degraded experience: `tw:chart` directives compile server-side into plate HTML viewed through a JS-disabled WebView behind a link-out card, and the mobile GenUI registry has no chart entry, so chart-bearing responses fall back to a generic "Open this thread on web" card. The exact moment an analytics answer matters — a rep glancing at a funnel in front of a customer — is the moment mobile punts.

The repo also carries structural drift risk around charts. Web thread GenUI renders a disjoint Recharts catalog (`area|bar|line|pie`) that cannot draw the approved funnel mockup; adding a `tw:` directive kind touches ~7 hand-maintained seams that fail silently; web's `--chart-1..5` tokens are byte-identical in light and dark; and a stale learnings doc claims a portable analytics contract shipped when it never did. Making mobile a third chart surface without settling the vocabulary and the token story would multiply exactly this drift.

### Key Decisions

All decisions below were settled during the 2026-08-07 ideation session (run 8bb84801) and recorded in the Linear project description.

- KD1. **House catalog is crowned as the single analytics chart vocabulary.** The compositor's `tw:chart` kinds (`bar|line|donut|stat-strip|sparkline|meter|funnel`) are the one chart language across surfaces; mobile builds against house SVG, not the GenUI/Recharts catalog, and the unshipped `analytics-display/v1` plan is formally superseded. (session-settled: user-approved — chosen over extending the GenUI Recharts catalog: Recharts cannot render the approved funnel mockup, and the competing portable contract was verified never-shipped.) Governs R1, R2, R19.
- KD2. **Chart-as-data transport.** The server stays the single validator of `tw:chart` fences and additionally emits the closed `ChartDirectiveData` shape as a typed Message.part at turn-finalize; each surface renders the data with its own engine. (session-settled: user-approved — chosen over shipping rendered output (HTML/SVG/PNG) as the wire format: spec-as-data dissolves the cross-surface problem and the persistence slot for typed parts already exists.) Governs R3, R4, R5.
- KD3. **Straight to native SVG — no PNG-sidecar v0 rung.** The shared house renderer runs on-device via `react-native-svg`; the render-ladder's PNG v0 is skipped. (session-settled: user-directed — chosen over the staged PNG-first ladder: sharpness, theming, and Dynamic Type land immediately rather than after an interim rung.) Governs R6, R7, R8, R9.
- KD4. **Inspector is in scope, gated on the binary-size decision.** Tap-to-open full-screen GPU inspector (Victory Native XL or Skia) ships in this project, contingent on an explicit product yes/no on the +3–5MB binary cost after the engine spike. (session-settled: user-approved — chosen over deferring interactivity entirely: the thread stays cheap while ambition lives in the inspector.) Governs R14, R15.
- KD5. **Provenance gating is in scope.** Chart numbers must trace to tool calls made this turn, extending the existing `tw:sources` ledger cross-check. (session-settled: user-approved — an inline chart is where a hallucinated number is most damaging and least detectable.) Governs R16.
- KD6. **Golden-render CI is scoped to the shared renderer** (server + mobile reflow goldens), not a full cross-surface preflight. Broader directive-kind mirror codegen is decision-gated behind the shared-package extraction. (session-settled: user-approved — chosen over the full codegen-the-seams bundle now: the package boundary will dissolve some mirrors into plain imports, so inventory before building generators.) Governs R20, R21.
- KD7. **Web alignment onto the house renderer is a deferred fast-follow** (THINK-686), recorded but not coupled to this release. (session-settled: user-directed.) Governs the Scope Boundaries below.

### Requirements

**Vocabulary and decision record**

- R1. The house chart catalog (`bar|line|donut|stat-strip|sparkline|meter|funnel`) is formally adopted as the single analytics chart vocabulary across surfaces, recorded in a decision doc under `docs/solutions/`.
- R2. The stale learnings doc `docs/solutions/architecture-patterns/analytics-display-portable-contract-cross-surface-2026-06-20.md` is corrected: the `analytics-display` portable contract never shipped, and future work must not build on it. Docs-only; no product code.

**Transport and validation**

- R3. The server continues validating `tw:chart` fences and additionally emits `ChartDirectiveData` (`type, title, qualifier?, series[1–24], caption?, max?` — `packages/api/src/lib/artifacts/document-directives.ts:292-305`) as a typed Message.part at turn-finalize, alongside document compilation.
- R4. The typed part travels through the GraphQL schema (`packages/database-pg/graphql/types/messages.graphql` typed UIMessage parts) with codegen regenerated in every consumer.
- R5. Existing surfaces and the document compilation path keep working unchanged while the part is added; the server remains the single validator.

**Shared renderer**

- R6. The house chart renderer (`packages/api/src/lib/artifacts/document-charts.ts`) is extracted into a shared workspace package consumable by `packages/api`, `apps/web`, and `apps/mobile`, preserving the KTD4 inject-after-sanitize escape boundary (`esc()` at every model-text insertion) on the web/document path.
- R7. The renderer's frame (width/height/paddings) and font scale are parameters: layout arithmetic reflows at actual device width and honors OS Dynamic Type for all seven kinds. Server output at the existing 720×250 frame stays byte-identical.
- R8. A canonical chart-role token set (ink, muted, accent, line, series ramp) with per-surface, per-theme resolved values replaces CSS `var()` references: the renderer takes a resolved palette parameter and emits literal colors. This is a hard requirement — `react-native-svg` cannot resolve CSS custom properties (verified 2026-08-07).
- R9. Mobile mounts the renderer's SVG string via `react-native-svg`'s `SvgXml` (dependency already present at 15.12.1), called locally with device width, font scale, and the active theme's resolved palette. No WebView anywhere in the thread. Theme switches re-render with the other palette.

**Inline analytics card (the mockup)**

- R10. The thread renders an inline analytics card: title, qualifier subtitle, chart body, caption takeaway line — no artifact link-out. A collapsible "Chart data" disclosure beneath reveals the table, derived client-side from the chart's own `series` array, never separately authored.
- R11. `data_view` gets its own card body (today `apps/mobile/components/chat/ArtifactCard.tsx:15-22` maps it identically to `report`), and the chart component is registered in `apps/mobile/lib/genui-registry.ts` so charts stop degrading to the "Open this thread on web" fallback.
- R12. Per-chart-kind mobile fitness rules govern what renders at phone width: the takeaway sentence leads; the chart renders when the kind survives the width; a stat-strip plus table replaces it when it doesn't. Small-screen degradation is a design principle, not a failure mode.
- R13. The card is validated on the TestFlight demo account with seeded analytics fixtures.

**Inspector**

- R14. An engine spike measures Victory Native XL and raw `react-native-skia` against `ChartDirectiveData` (funnel + line + bar): binary-size delta, startup cost, and 60fps interaction (scrub tooltip, series toggle). Its output feeds the gated binary-size decision and the navigation-shape choice (full-screen modal from card tap).
- R15. If the binary cost is accepted, tapping an inline chart card opens a full-screen GPU inspector — scrub tooltips, stage/series drill-in, series toggles — fed by the same `ChartDirectiveData` as the static card, no second payload. All seven kinds get at least a sensible default inspector treatment; reduced-motion is respected.

**Trust and accessibility**

- R16. Figures in analytics-bearing directives must trace to a tool call made this turn, extending the composer's ledger cross-check (`packages/pi-extensions/src/document-composer.ts:135-181`), which rejects violations for agent self-repair the same way citing an uncalled tool is rejected today.
- R17. One shared function derives canonical screen-reader narration from `ChartDirectiveData` ("Funnel, six stages, Contacted 2 down to Won 3; takeaway: …"); every surface gets `accessibilityLabel` / `aria-label` from it, including the inspector.

**Performance**

- R18. `ChatBubble` and the thread `renderItem` are memoized, the rendered SVG string is memoized per (data, width, theme, fontScale), and scroll benchmarks with inline charts in the inverted FlatList establish that chart cards do not degrade thread feel.

**Drift insurance**

- R19. Mobile consumes the crowned catalog through the shared package; it must not become an eighth hand-synced directive-kind seam.
- R20. Golden-render CI covers the shared renderer: a fixture corpus of every chart kind × edge cases (zero values, 24-point series, long labels, single point) × light/dark palettes × at least two frames (720×250 server, ~360pt mobile), diffed byte-exact — the renderer is deterministic by design.
- R21. After the shared-package extraction lands, the surviving hand-maintained directive-kind mirrors are inventoried and a decision is made on codegenning them from `DEFAULT_REGISTRY`; building generators before that inventory is out of scope.

### Key Flows

- F1. Analytics turn to inline card
  - **Trigger:** A Brain analytics response containing a `tw:chart` fence finalizes.
  - **Steps:** Server validates the fence (including the R16 provenance trace); emits `ChartDirectiveData` as a typed Message.part; mobile receives the part with the turn; the registered chart component renders the card via the shared renderer with device width, font scale, and resolved palette; the disclosure table derives from `series`.
  - **Outcome:** Chart card in the thread scroll, no artifact fetch, no navigation. **Covers R3, R9, R10, R11.**
- F2. Tap to inspect
  - **Trigger:** User taps an inline chart card (post-KD4 gate acceptance).
  - **Steps:** Full-screen inspector opens from the card tap, fed by the same `ChartDirectiveData`; user scrubs tooltips, toggles series, drills into stages; closing returns to the thread position.
  - **Outcome:** Interactivity without raising the thread's per-row cost. **Covers R14, R15.**
- F3. Degradation at phone width
  - **Trigger:** A chart kind fails its R12 fitness rule at the current width/font scale (e.g., a 24-point donut at 360pt).
  - **Steps:** The card leads with the takeaway sentence and renders a stat-strip plus the disclosure table instead of the unfit chart.
  - **Outcome:** The insight survives every screen size; no illegible chart ships. **Covers R12.**
- F4. Provenance rejection
  - **Trigger:** An agent emits a `tw:chart` whose figures do not trace to a tool call this turn.
  - **Steps:** The composer's extended ledger cross-check returns REJECTED; the agent self-repairs and re-emits.
  - **Outcome:** Untraceable numbers never reach a rendered chart. **Covers R16.**

### Acceptance Examples

- AE1. **Covers R8, R9.** Given a funnel `ChartDirectiveData` and the dark theme active, when the card renders, then the SVG contains only literal colors from the dark resolved palette (no `var(--…)` tokens), and toggling to light re-renders with the light palette.
- AE2. **Covers R7.** Given the same `ChartDirectiveData`, when rendered at the 720×250 server frame, then output is byte-identical to the pre-extraction renderer; when rendered at a ~360pt mobile frame with a raised OS font scale, then tick labels honor the scale rather than shrinking below legibility.
- AE3. **Covers R10.** Given a rendered chart card, when the user expands "Chart data", then every table row equals the corresponding `series` entry — there is no second authored copy of the numbers.
- AE4. **Covers R12.** Given a 24-point donut directive at 360pt width, when the fitness rule fires, then the card shows takeaway + stat-strip + table and no donut.
- AE5. **Covers R16.** Given a turn where the agent invoked no query tool, when it emits a `tw:chart` with numeric series, then validation rejects the directive for self-repair rather than rendering it.
- AE6. **Covers R11.** Given a chart-bearing message on a build with the registry entry, when the thread renders, then no "Open this thread on web" fallback card appears for the chart.

### Scope Boundaries

- **Deferred for later:** THINK-686 — web thread Data View consuming `ChartDirectiveData` via the house renderer. Until it lands, web keeps rendering its Recharts catalog; the drift is recorded and accepted for this release. Do not enroll or implement it here.
- **Decision-gated, not committed:** codegen of directive-kind mirrors from `DEFAULT_REGISTRY` (R21) — inventory first, generators only if the post-extraction inventory justifies them.
- **Out of scope:** PNG sidecar rendering (skipped rung per KD3); WebView-based chart rendering in the thread; multi-chart deck UX for multi-chart messages; email-surface chart upgrades; any change to the GenUI/Recharts catalog itself beyond mobile ceasing to depend on it.

### Dependencies / Assumptions

- `react-native-svg@15.12.1` is already a mobile dependency and remains the static-render engine; its inability to resolve CSS custom properties is the verified constraint behind R8.
- The house renderer is pure, deterministic, and DOM-free (fixed-precision `r2()` coordinates), which is what makes R7's byte-identical server goldens and R20's byte-exact CI feasible.
- Typed UIMessage parts are already persisted at turn-finalize; R3 fills an existing slot rather than adding a new artifact type.
- The GraphQL schema change (R4) touches the turn-finalize path and needs the repo's normal schema/codegen flow across `apps/cli`, `apps/web`, `apps/mobile`, `packages/api`.

### Outstanding Questions

- **Resolve during execution (human gate, not a planning blocker):** the inspector's +3–5MB binary-size accept/reject. This is a product decision reserved for the user after the R14 spike produces measurements; it must not be settled by planning or implementation agents. If spike data is not clearly decisive, escalate via the question protocol. Rejection removes R15 but leaves the rest of the release intact.
- **Deferred to Planning:** provenance-tracing design for R16 — how aggregates and derived figures trace to raw tool rows.
- **Deferred to Planning:** the concrete per-kind fitness thresholds for R12 (which kinds survive which widths) and where those rules live.
- **Deferred to Planning:** shared-package name, layout, and the exact seam inventory feeding R21.

### Sources / Research

- `docs/ideation/2026-08-07-mobile-inline-analytics-charts-ideation.html` — 7 ranked, adversarially verified ideas; grounding context; verified corrections (rn-svg `var()` limitation; `analytics-display` never shipped).
- `packages/api/src/lib/artifacts/document-charts.ts` — house renderer, seven kinds, CSS `var()` colors, deterministic layout.
- `packages/api/src/lib/artifacts/document-directives.ts:276-305` — catalog kinds and the closed `ChartDirectiveData` interface; caption is contractually "the takeaway, not a chart description".
- `packages/pi-extensions/src/document-composer.ts:135-181` — existing `tw:sources` ledger cross-check with REJECTED self-repair.
- `packages/thread-json-render/src/catalog.ts:302` — the disjoint GenUI chart catalog mobile stops building against.
- `apps/mobile/components/chat/ArtifactCard.tsx:15-22`, `apps/mobile/lib/genui-registry.ts`, `apps/mobile/app/settings/usage.tsx:120-125` — card mapping, registry fallback, and the shipped collapse pattern the card reuses.
- `docs/solutions/architecture-patterns/new-tw-directive-kind-checklist.md` — the ~7 silent seams motivating R19–R21.
- Linear: project "Mobile Inline Analytics Charts"; parent THINK-687; children THINK-671…THINK-685 carry per-unit scope and file pointers.
