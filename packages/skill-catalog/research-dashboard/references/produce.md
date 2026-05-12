# Produce research dashboard artifact

Build an inspectable dashboard artifact that exposes findings alongside evidence. Include useful comparison views, source-backed claims, confidence or caveat indicators, and filters appropriate to the topic.

Use the Artifact Builder compatibility shim only as the implementation mechanism. The runbook owns discovery, synthesis, validation, and queue semantics; this phase owns the saved research dashboard.

Shape the app around the evidence gathered in earlier phases:

- Findings or entities grouped by theme, vendor, market, source, location, risk, or another dimension that matches the request.
- Source-backed claims with compact confidence or caveat indicators.
- Filters, comparisons, or drill-in tables that let the user inspect the evidence rather than read a static report.
- Empty, partial, and failed-source states that explain the gap without turning the artifact into a provenance report.

Use `@thinkwork/computer-stdlib` primitives where they fit. Keep the app body focused and let the host provide Artifact chrome. Do not render a duplicate route header, `App` badge, open-full button, refresh chrome, or standalone recipe explainer.

Export `refresh()` only when the research dashboard can be deterministically refreshed from saved source queries or transforms. Refresh must preserve the same dashboard shape and must not reinterpret the whole user request.

Call `save_app` directly in the parent Computer turn. Include:

- `metadata.kind`: `computer_applet`.
- `metadata.threadId`: current thread id when available.
- `metadata.prompt`: user prompt.
- `metadata.recipe`: `research-dashboard`.
- `metadata.recipeVersion`: `1`.
- `metadata.runbookSlug`: `research-dashboard`.

Only report success after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`.
