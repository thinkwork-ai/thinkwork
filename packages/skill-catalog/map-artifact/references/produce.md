# Produce map artifact

Build a map-centered artifact with clear layers, filters, entity details, and caveats for missing or approximate location data.

Use the Artifact Builder compatibility shim only as the implementation mechanism. The runbook owns location discovery, spatial analysis, validation, and queue semantics; this phase owns the saved map artifact.

Use `MapView` from `@thinkwork/computer-stdlib` for the primary map. Do not embed an OpenStreetMap.org iframe, hand-roll `react-leaflet` setup, or enable scroll-wheel trapping inside the artifact. `MapView` owns tile-provider fallback, theming, default marker handling, and map interaction defaults.

Prepare map-ready data before writing TSX:

- `markers` for point entities with labels, coordinates, category/risk metadata, and detail payloads.
- `polylines` for routes or flows when the request includes movement or path relationships.
- `geojson` for territories, regions, risk zones, or boundaries when source data supports them.
- `fit` set to an explicit country, bounding box, or `auto` based on the available evidence.

Represent ambiguous, missing, approximate, or inferred locations visibly but proportionally. The app should help the user inspect spatial patterns, not act as a static illustration or a provenance report.

Keep the app body focused and let the host provide Artifact chrome. Do not render a duplicate route header, `App` badge, open-full button, refresh chrome, or standalone recipe explainer.

Call `save_app` directly in the parent Computer turn. Include:

- `metadata.kind`: `computer_applet`.
- `metadata.threadId`: current thread id when available.
- `metadata.prompt`: user prompt.
- `metadata.recipe`: `map-artifact`.
- `metadata.recipeVersion`: `1`.
- `metadata.runbookSlug`: `map-artifact`.

Only report success after `save_app` returns `ok`, `persisted`, and an `appId`. Link to `/artifacts/{appId}`.
