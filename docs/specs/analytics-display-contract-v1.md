# Analytics Display Contract v1

THNK-57 defines the shared analytical display/spec foundation for ThinkWork analytical surfaces. The contract is owned by THNK-14 and consumed by THNK-34 for inline Thread/json-render charts. Durable dashboards, persistence, refresh, sharing, and dashboard-specific navigation stay outside this contract.

## Package Boundary

`@thinkwork/analytics-display` has two entry points:

- `@thinkwork/analytics-display`: React-free core types, catalog metadata, validators, limits, diagnostics, formatters, and safe summaries.
- `@thinkwork/analytics-display/react`: route-independent render-model adapters that describe how dashboard or Thread hosts should render validated payloads. The adapter exposes ThinkWork renderer identifiers and density hints, but does not import React, Recharts, TanStack Router, or app routes.

Server/runtime/mobile callers may import only the core entry point. Web surfaces may import the adapter and connect renderer identifiers to app-owned components.

## Envelope

Every portable analytical render payload must be by value:

```json
{
  "kind": "analytics.display",
  "analyticsDisplayVersion": "analytics-display/v1",
  "spec": {},
  "data": { "rows": [] },
  "freshness": { "takenAt": "2026-06-18T15:30:00.000Z" },
  "provenance": { "sourceLabels": ["Warehouse"] },
  "diagnostics": [],
  "sensitivity": { "containsSensitiveFields": false }
}
```

Payloads must not contain dashboard IDs, dataset IDs, unresolved references, route references, app-specific component names, raw style fields, or unbounded source data. Inline Thread payloads and durable dashboard render snapshots use the same envelope.

## Spec

`spec` declares the renderable analytical display:

- `title` and optional `description`.
- `columns`: bounded column declarations with `key`, `label`, `type`, optional `sensitivity`, and optional `redaction`.
- `elements`: metric, chart, or table elements.
- `filters`: optional display filter metadata using catalogued filter operators.
- `emptyState`: stable empty-copy fallback.

Supported chart kinds are `bar`, `line`, `area`, and `pie`. Chart colors must use approved palette tokens `chart-1` through `chart-5`. Raw colors, `style`, `className`, `fill`, `stroke`, and `dangerouslySetInnerHTML` are rejected.

## Data And Bounds

`data.rows` is a bounded row snapshot. Row values must be strings, numbers, booleans, or null. v1 limits are:

- rows: 500
- chart points: 200
- elements: 12
- table columns: 20
- chart series: 5
- label length: 120
- row string value length: 1,000
- serialized payload size: 100,000 bytes
- safe summary lines: 6

Thread renderers may preview fewer rows by density, but they must not request hidden data from a dashboard or dataset by ID. Host summaries are derived from the validated payload by default; agent-supplied summary hints must not override the shared summary without a future validated adapter contract.

## Freshness, Provenance, And Sensitivity

Freshness is required through `freshness.takenAt`; `oldestAt` and `status` may clarify stale rollups. Provenance is required through human-readable `sourceLabels`; source slugs are optional and must remain descriptive, not authorization handles.

Sensitive or PII columns must be redacted or aggregate-only before embedding. If a redacted sensitive column contains an unredacted value, validation fails. Safe summaries and formatters escape snapshot values before display.

## Validation Policy

Hosts must validate payloads before rendering. v1 validation rejects:

- unsupported `kind` or `analyticsDisplayVersion`
- missing `spec`, `data.rows`, freshness, or provenance
- raw HTML labels and raw style fields
- unsupported chart kinds, filter operators, palette tokens, or column references
- too many rows, chart points, series, elements, or table columns
- dashboard, dataset, route, URL, renderer, or component reference keys anywhere in the payload
- unminimized sensitive fields or embedded sensitive values
- undeclared row fields, row values outside the primitive snapshot set, or unbounded row strings

Diagnostics are structured with `code`, `message`, optional `path`, and `severity`.

## Consumer Boundary

THNK-14 owns the shared catalog and dashboard use. THNK-34 consumes this contract for inline Thread/json-render chart payloads and should not create a parallel chart/table catalog. THNK-34 U8 may add a GenUI adapter that recognizes this envelope, validates through `@thinkwork/analytics-display`, and maps the adapter render model into Thread density.

Durable dashboard persistence, refresh jobs, sharing, access inheritance for promoted dashboards, LastMile demos, and generic GenUI renderer implementation are intentionally out of scope for THNK-57.
