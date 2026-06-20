---
title: "Analytics display payloads need one portable cross-surface contract"
date: 2026-06-20
category: architecture-patterns
module: "@thinkwork/analytics-display / analytics.display v1"
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "Dashboard and Thread surfaces need to render the same analytical chart, table, or metric payloads"
  - "A feature risks creating a second chart/table catalog for GenUI or dashboard rendering"
  - "Agent-authored analytical output must be validated before host rendering"
  - "A shared package must stay React-free at the core boundary while app hosts own concrete renderers"
related_components:
  - assistant
  - development_workflow
  - documentation
  - apps-web
  - thread-genui
  - dashboards
tags:
  - analytics-display
  - analytics-display-v1
  - dashboards
  - thread-genui
  - portable-contract
  - shared-package
  - thnk-57
  - thnk-14
---

# Analytics display payloads need one portable cross-surface contract

## Context

THNK-57 turned the THNK-14/THNK-34 planning boundary into code. The product need
was straightforward: ThinkWork agents need to return charts, tables, and metric
summaries from analytical data sources, styled consistently with the app. The
architectural risk was less obvious: durable dashboards and inline Thread GenUI
could each invent their own chart/table catalog and slowly drift.

The shipped foundation in PR #2748 created `@thinkwork/analytics-display` plus
`docs/specs/analytics-display-contract-v1.md`. THNK-14 owns the shared analytical
display/spec foundation. THNK-34 consumes it for inline Thread/json-render charts
instead of creating a parallel catalog. Dashboard persistence, refresh, sharing,
routes, and Thread GenUI renderer wiring remain follow-on work.

## Guidance

Use a by-value, portable payload as the contract between analytical producers
and rendering hosts. The envelope should carry:

- `kind: "analytics.display"`
- `analyticsDisplayVersion: "analytics-display/v1"`
- `spec` with catalogued metric, chart, table, filter, column, empty-state, and
  palette metadata
- bounded `data.rows`
- `freshness`
- `provenance`
- optional `diagnostics`
- optional `sensitivity`

Do not put dashboard IDs, dataset IDs, app routes, URLs, renderer names,
component names, raw CSS/style fields, unresolved references, or unbounded source
data in the payload. If a Thread payload points at a dashboard or dataset ID, it
has already stopped being portable and now depends on hidden dashboard state.

Keep the core package React-free. Server, runtime, mobile, and tests should be
able to import `@thinkwork/analytics-display` without pulling React, Recharts,
TanStack Router, or app routes into their dependency graph. Put host-facing
projection behind a separate adapter entry point such as
`@thinkwork/analytics-display/react`; even that adapter should return renderer
identifiers and density hints, not concrete app UI.

Validate before rendering. Consumers should pass only validated payloads to host
renderers or adapters:

```ts
import { validateAnalyticsDisplayPayload } from "@thinkwork/analytics-display";
import { createAnalyticsDisplayRenderModel } from "@thinkwork/analytics-display/react";

const validation = validateAnalyticsDisplayPayload(candidatePayload);
if (!validation.ok) {
  return { diagnostics: validation.diagnostics };
}

const model = createAnalyticsDisplayRenderModel(validation.payload, {
  host: "thread",
  density: "thread",
});
```

Use catalogued shapes instead of free-form UI instructions. In v1, supported
elements are metric, chart, and table; supported chart kinds are `bar`, `line`,
`area`, and `pie`; supported palette values are `chart-1` through `chart-5`;
supported filter operators are `text_contains`, `value_select`, and `range`.
Raw colors, `style`, `className`, `fill`, `stroke`, and
`dangerouslySetInnerHTML` belong outside the agent-authored payload.

Host-specific density is adapter output, not payload content:

```ts
const dashboard = createAnalyticsDisplayRenderModel(payload, {
  host: "dashboard",
  density: "dashboard",
});

const thread = createAnalyticsDisplayRenderModel(payload, {
  host: "thread",
  density: "thread",
});
```

Both hosts consume the same validated payload. Dashboard mode can preview more
rows and allow taller charts; Thread mode can use tighter limits. The payload
does not need separate dashboard and Thread variants.

## Why This Matters

The shared contract prevents dashboard and Thread work from forking into
competing analytics contracts. A single payload can serve durable dashboard
snapshots and inline Thread/GenUI chart payloads while each host owns density and
actual component mapping.

The by-value boundary also protects replay, persistence, mobile compatibility,
and audits. A payload that requires a route, renderer, dashboard ID, or dataset
ID cannot be safely stored, replayed, rendered in a different host, or inspected
without extra app state. Treating those keys as validation failures keeps the
boundary honest.

The React-free core keeps analytical payload production usable from Lambda,
runtime, mobile, and package tests. The host adapter can say "this element maps
to `thinkwork.ui.ChartContainer` in Thread density" without importing the actual
component or teaching the agent a UI library.

Strict validation is part of the pattern, not polish. THNK-57's review pass
hardened the validator against undeclared row fields, unchecked enum metadata,
unbounded labels, unsafe HTML, missing element IDs, app-specific references,
malformed nested arrays, trusted `mobileFallback`, and unredacted sensitive
values. Those checks are what make the payload safe enough for future hosts to
trust.

## When to Apply

Apply this pattern when a new analytics-rendering surface needs chart, table, or
metric output from an agent or analytical source. Generate or receive a complete
`AnalyticsDisplayRenderPayload`, validate it through the shared package, then
let the host map renderer identifiers to local UI.

Apply it when deciding whether to extract a shared package. Extraction is worth
it here because drift would create multiple analytical schemas across dashboard,
Thread GenUI, runtime, mobile, and future persistence. This is the counterexample
to small helpers that can stay duplicated when drift is already forced loud by a
database constraint or local contract test.

Apply it when sensitive data may appear in analytical output. Sensitive columns
must be redacted or aggregate-only before embedding, and redacted row values
must stay redacted in the snapshot.

Do not treat this pattern as permission to wire UI or persistence into the
contract package. THNK-57 stops at the spec, validation, catalog, summaries,
formatters, diagnostics, limits, fixtures, and route-independent render model.
Dashboard persistence/refresh/sharing and generic Thread GenUI renderer
implementation stay in their owning features.

## Examples

Valid portable shape:

```ts
const payload = {
  kind: "analytics.display",
  analyticsDisplayVersion: "analytics-display/v1",
  spec: {
    title: "Support Volume",
    columns: [
      { key: "day", label: "Day", type: "date" },
      { key: "total", label: "Total", type: "number" },
    ],
    elements: [
      {
        type: "metric",
        id: "total",
        title: "Total Tickets",
        valueKey: "total",
        palette: "chart-1",
      },
    ],
  },
  data: { rows: [{ day: "2026-06-18", total: 59 }] },
  freshness: { takenAt: "2026-06-18T15:30:00.000Z" },
  provenance: { sourceLabels: ["Warehouse daily rollup"] },
};
```

Invalid shape:

```ts
const payload = {
  ...validPayload,
  dashboardId: "dash_123",
  spec: {
    ...validPayload.spec,
    dataset_id: "dataset_123",
    route: "/threads/123",
    renderer: "ThreadChart",
    color: "#1d4ed8",
  },
};
```

That second payload fails because portable analytical payloads cannot contain
dashboard, dataset, route, renderer, or raw style references.

## Related

- Linear issue: THNK-57 Shared analytical display/spec foundation
- Implementation PR: https://github.com/thinkwork-ai/thinkwork/pull/2748
- Merge commit:
  `e7bb9e972b76363f5cb97ec80ae6ab068e5a12b1`
- Spec: `docs/specs/analytics-display-contract-v1.md`
- Related plan: `docs/plans/2026-06-12-004-feat-agent-native-analytics-plan.md`
- Related plan:
  `docs/plans/2026-06-17-001-feat-thread-genui-json-render-plan.md`
- Related learning:
  `docs/solutions/design-patterns/screen-owned-list-display-adapters-2026-06-14.md`
  - the list-display cousin of host-owned adapters around reusable primitives
- Related learning:
  `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`
  - the counterexample: keep helpers inline only when extraction costs more and
    drift is already forced loud
- Related learning:
  `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md`
  - the LLM-authored DSL cousin of catalogued vocabulary plus validator
