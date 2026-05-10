---
name: artifact-builder
description: Builds reusable ThinkWork Computer apps and interactive artifacts from research prompts. Use when the user asks to build, create, generate, or make a dashboard, app, report, briefing, workspace, or other interactive surface.
---

# Artifact Builder

Use this skill when the user wants Computer to produce an interactive, reusable artifact. The expected output is a saved app, not just a prose answer.

## Contract

1. Research with the available tools and thread context.
2. If live sources are missing or partial, keep going with the best available workspace, memory, context, web, or fixture data. Keep the visible app focused on the user's requested output; do not render provenance, source coverage, or recipe/refresh explainers unless the user explicitly asks for them.
3. For CRM pipeline, opportunity, sales-risk, stage-exposure, stale-activity, or LastMile dashboard prompts, load and follow `skills/artifact-builder/references/crm-dashboard.md` before writing TSX. Use that full workspace path, not a relative `references/...` path.
4. Keep app generation and saving in this parent turn. Do not use `delegate` or `delegate_to_workspace` to write, generate, or save the app.
5. Generate TSX using `@thinkwork/computer-stdlib` primitives and `@thinkwork/ui`.
6. Export a deterministic `refresh()` function whenever the result should be refreshable. Refresh must rerun saved source queries or deterministic transforms; it must not reinterpret the whole user request.
7. Call `save_app` directly before responding. Pass at least `name`, `files`, and `metadata`.
8. Include `threadId`, `prompt`, `agentVersion`, and `modelId` in metadata when available.
9. After `save_app` returns `ok`, answer concisely with what was created and the `/artifacts/{appId}` route.

## Host Chrome And Runtime

The Computer host renders generated Apps inside host-provided Artifact chrome: title, `App` label, open-full action, refresh action placement, route header, iframe wrapper, and future provenance/version controls. Your TSX should render only the app body or canvas content.

Do not create an outer artifact card, duplicate route header, `App` badge, "Open full" button, refresh recipe, source coverage, evidence, or provenance panel unless the user explicitly asks for that in the app body.

Generated Apps run in the sandboxed iframe runtime. Do not assume access to parent app globals, credentials, cookies, local storage, window navigation, network, dynamic imports, or browser APIs outside the supported stdlib surface.

## App Shape

Use `App.tsx` as the main file. Export one default React component. Prefer concise component-local data transforms over large abstractions. Do not use network calls, browser globals, dynamic imports, `eval`, or raw HTML injection.

Good apps include:

- Focused body content that starts at the useful work, not wrapper chrome.
- KPI strip for key totals.
- Charts or tables that make comparison easy.
- Empty, partial, and failed-source states proportional to the requested task.

## Maps

When the user asks for a map (locations, regions, routes, geographic comparisons), use `MapView` from `@thinkwork/computer-stdlib`. **Do NOT embed an OpenStreetMap.org iframe, do NOT roll your own `react-leaflet` `<MapContainer>`, and do NOT enable `scrollWheelZoom` — `MapView` handles the tile provider, theming, default-icon bundler fix, and scroll-trap defaults correctly.** It uses Mapbox tiles when `VITE_MAPBOX_PUBLIC_TOKEN` is set (light/dark style swap from `useTheme`) and falls back to OpenStreetMap tiles when unset.

Pass `fit` (one of `{type: "country", code: "<ISO-3166-1-alpha-2>"}`, `{type: "bbox", bounds: [[lat,lng],[lat,lng]]}`, or `{type: "auto"}`) plus optional `markers`, `polylines`, and `geojson` arrays. See `@thinkwork/computer-stdlib/MapView` for the full prop shape.

## Missing Data

Missing data is not a reason to stop before creating the artifact. Create a runnable app that handles gaps gracefully, then ask for source setup or approval as a follow-up when needed.

For the LastMile CRM pipeline risk prompt, build an app that covers stale activity, stage exposure, and top risks. If live LastMile CRM records are unavailable, use the canonical LastMile-shaped structure and mention limitations only when they materially affect the displayed result.
