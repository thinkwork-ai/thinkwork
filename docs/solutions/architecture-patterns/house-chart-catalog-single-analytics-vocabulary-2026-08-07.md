---
title: "The house chart catalog is the single analytics chart vocabulary"
date: 2026-08-07
category: architecture-patterns
module: packages/api/src/lib/artifacts
problem_type: architecture_decision
component: assistant
severity: high
applies_when:
  - "A surface (web, mobile, documents) needs to render an agent-authored chart"
  - "Someone proposes a second chart catalog, schema, or renderer for analytics output"
  - "Deciding how chart data crosses the wire between agent runtime and client"
  - "Reading the older analytics-display/v1 portable-contract learning"
related_components:
  - apps-mobile
  - apps-web
  - thread-genui
  - documentation
tags:
  - charts
  - analytics
  - document-compositor
  - house-chart-catalog
  - genui
  - spec-as-data
  - decision
  - think-671
---

# The house chart catalog is the single analytics chart vocabulary

## Decision

The document compositor's **house chart catalog** — `bar | line | donut |
stat-strip | sparkline | meter | funnel`, defined by `CHART_TYPES` and
`ChartDirectiveData` in `packages/api/src/lib/artifacts/document-directives.ts` —
is the single analytics chart vocabulary across **web, mobile, and documents**.

Mobile inline analytics builds against the **house SVG renderer**
(`packages/api/src/lib/artifacts/document-charts.ts`, being extracted to a shared
package), **not** the GenUI/Recharts catalog in
`packages/thread-json-render/src/catalog.ts` (`area | bar | line | pie`).

Reference: `docs/ideation/2026-08-07-mobile-inline-analytics-charts-ideation.html`.

## Why

- **One deterministic renderer.** The house renderer emits fixed-viewBox SVG with
  no script and no external references. The same string renders in a document
  plate, a web thread, and a React Native `react-native-svg` host. A second
  renderer means a second set of visual bugs and a second definition of "what a
  bar chart looks like here."
- **One validated data shape.** `ChartDirectiveData` is the only shape an agent
  has to learn, and the only shape a client has to trust. Two catalogs means two
  schemas, two validators, and drift between what the model is prompted to emit
  and what any given surface can draw.
- **Spec-as-data transport.** Chart data travels as a typed message part; clients
  render locally. Nothing ships a rendered image or an app route — the payload is
  portable by construction and replayable.
- **Funnel exists only in the house catalog.** The approved mobile mockup includes
  a funnel. The GenUI catalog (`area | bar | line | pie`) cannot render it. That
  alone settles the direction: the GenUI catalog is a strict subset that is
  missing a shape the product already committed to.
- **The GenUI chart catalog does not work on mobile today.** It currently degrades
  to an "open on web" fallback, so there is no installed-base cost to standardizing
  on the house catalog instead.

## Supersedes

This decision supersedes the unshipped **analytics-display/v1** portable-contract
direction (THNK-57 / PR #2748). That work was planned but **never shipped** —
verified 2026-08-07: no `packages/analytics-display` exists anywhere in the repo,
and nothing imports `@thinkwork/analytics-display`.

The older learning
`docs/solutions/architecture-patterns/analytics-display-portable-contract-cross-surface-2026-06-20.md`
describes that package as shipped. It has been annotated with a correction rather
than deleted — its by-value/portable-payload reasoning is still sound and is in
fact honored by the spec-as-data transport above; only the package, the version
string, and the `area|bar|line|pie` chart enum are obsolete.

## Consequences

- The house renderer gets **extracted to a shared package** consumable by
  `packages/api`, `apps/web`, and `apps/mobile`.
- The extraction must **parameterize the frame** (width/height/padding) — mobile
  viewports are not document plates.
- The extraction must accept **resolved palettes**. The current renderer writes
  `var(--accent)`, `var(--ink)`, `var(--muted)`, `var(--line)` directly into the
  SVG; `react-native-svg` **cannot resolve CSS `var()` references** (verified
  constraint). Colors must be injected as concrete values by the host, with the
  web/document hosts passing through their existing token values.
- **Web GenUI chart alignment is a deferred fast-follow** (THINK-686). Until then,
  `packages/thread-json-render/src/catalog.ts` keeps its Recharts catalog on web;
  it is a legacy surface, not a second sanctioned vocabulary, and no new work
  should extend it.
- Any proposal for a new chart kind belongs in `CHART_TYPES` in
  `document-directives.ts` plus the shared renderer — never in a parallel catalog.

## Related

- Ideation: `docs/ideation/2026-08-07-mobile-inline-analytics-charts-ideation.html`
- Catalog + schema: `packages/api/src/lib/artifacts/document-directives.ts`
- Renderer: `packages/api/src/lib/artifacts/document-charts.ts`
- Legacy GenUI catalog: `packages/thread-json-render/src/catalog.ts`
- Corrected learning:
  `docs/solutions/architecture-patterns/analytics-display-portable-contract-cross-surface-2026-06-20.md`
- Linear: THINK-671 (this decision), THINK-686 (web GenUI chart alignment)
