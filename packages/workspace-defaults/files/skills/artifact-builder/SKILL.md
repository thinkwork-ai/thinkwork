---
name: artifact-builder
description: Builds reusable ThinkWork Computer apps and interactive artifacts from research prompts. Use when the user asks to build, create, generate, or make a dashboard, app, report, briefing, workspace, or other interactive surface.
---

# Artifact Builder

Use this skill when the user wants Computer to produce an interactive, reusable artifact. The expected output is a fast unsaved app preview first, not just a prose answer. Save only after the user asks to keep it or an active runbook explicitly requires durable output.

This skill is a compatibility shim for the published ThinkWork runbooks. When a Runbook Execution Context is present, the runbook phase guidance is the source of truth and this skill supplies only the artifact-generation, preview, and optional `save_app` mechanics for the current phase. Do not replace the active runbook with a separate plan.

## Contract

1. Research with the available tools and thread context.
2. If live sources are missing or partial, keep going with the best available workspace, memory, context, web, or fixture data. Keep the visible app focused on the user's requested output; do not render provenance, source coverage, or recipe/refresh explainers unless the user explicitly asks for them.
3. For CRM pipeline, opportunity, sales-risk, stage-exposure, stale-activity, or LastMile dashboard prompts outside an active runbook, load and follow `skills/artifact-builder/references/crm-dashboard.md` before writing TSX. Use that full workspace path, not a relative `references/...` path. During an active runbook, prefer the runbook's current phase guidance and use the reference only as fallback detail.
4. Keep app generation and saving in this parent turn. Do not use `delegate` or `delegate_to_workspace` to write, generate, or save the app.
5. Before writing TSX, consult the shadcn registry source for generated apps. Use the shadcn MCP tools when available: `list_components`, `search_registry`, `get_component_source`, and `get_block`. If MCP is unavailable, use the compact local registry generated from `packages/ui/registry/generated-app-components.json` or the runtime `shadcn_registry` helper. If neither source is available, stop with a structured guidance error instead of emitting TSX.
6. Generate TSX using approved shadcn-compatible primitives from `@thinkwork/ui` plus approved domain primitives from `@thinkwork/computer-stdlib`. You must use approved shadcn primitives for their roles. Hand-rolled replacements for cards, tabs, badges, buttons, tables, selects, form controls, dialogs, sheets, separators, tooltips, scroll areas, charts, or maps are rejected.
7. Never embed Theme CSS, `<style>` tags, or app-owned theme objects in artifact metadata or TSX. App style is tenant-controlled host configuration. Build with semantic shadcn token classes and chart variables so the host-injected style controls the rendered iframe.
8. Export a deterministic `refresh()` function whenever the result should be refreshable. Refresh must rerun saved source queries or deterministic transforms; it must not reinterpret the whole user request.
9. Call `preview_app` before responding. Pass at least `name`, `files`, and `metadata`. Metadata must include `threadId`, `prompt`, `agentVersion`, `modelId`, `uiRegistryVersion`, `uiRegistryDigest`, and `shadcnMcpToolCalls` when available. Use `["local_registry_fallback"]` for `shadcnMcpToolCalls` when MCP was unavailable but the local registry was consulted.
10. Call `save_app` only after the user explicitly asks to save/keep the preview, or when an active runbook phase explicitly requires a durable saved artifact. Save metadata must preserve the preview's registry, data-provenance, prompt, source, agent, and model metadata. It must not include theme CSS.
11. After `preview_app` returns `ok`, answer concisely with what is ready to inspect. After `save_app` returns `ok`, answer concisely with what was saved and the `/artifacts/{appId}` route.
12. Never use emoji as icons, status markers, bullets, tabs, headings, empty states, or data labels in generated apps. Use `lucide-react` named icon imports only when an icon materially improves scannability; otherwise use plain text, `Badge`, or approved registry components.

## Host Chrome And Runtime

The Computer host renders generated Apps inside host-provided Artifact chrome: title, `App` label, open-full action, refresh action placement, route header, iframe wrapper, and future provenance/version controls. Your TSX should render only the app body or canvas content.

Do not create an outer artifact card, duplicate route header, `App` badge, "Open full" button, refresh recipe, source coverage, evidence, or provenance panel unless the user explicitly asks for that in the app body.

Generated Apps run in the sandboxed iframe runtime for both preview and save. Do not assume access to parent app globals, credentials, cookies, local storage, window navigation, network, dynamic imports, or browser APIs outside the supported stdlib surface.

## App Shape

Use `App.tsx` as the main file. Export one default React component. Prefer concise component-local data transforms over large abstractions. Do not use network calls, browser globals, dynamic imports, `eval`, or raw HTML injection.

## Component System

Generated dashboards must look like ThinkWork product UI, not raw HTML. The shadcn registry is the source of truth for approved generated-app components, examples, roles, and substitutions. Import structure and controls from `@thinkwork/ui`: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `Select`, `Checkbox`, `Switch`, `Tooltip`, `Dialog`, `Sheet`, `ScrollArea`, `Separator`, `ChartContainer`, `Combobox`, and `DropdownMenu` where applicable.

Use `@thinkwork/computer-stdlib` for semantic dashboard primitives such as `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`, `DataTable`, `MapView`, and formatters. It is fine to combine stdlib charts with `@thinkwork/ui` layout chrome.

Use shadcn semantic tokens, not one-off colors: `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `border-border`, `text-muted-foreground`, `bg-muted`, `text-primary`, `text-destructive`, and chart colors from `var(--chart-1)` through `var(--chart-5)`. User-uploaded shadcn Create Theme CSS is injected by the host from tenant app style settings; do not paste a `<style>` tag or theme metadata into `App.tsx`.

Do not use emoji icons. Use `lucide-react` named icon imports only when an icon materially improves scannability; otherwise use plain text, `Badge`, or approved registry components.

Do not create adjacent plain text tabs, raw `<button>` controls, raw `<table>` layouts for tabular data, raw form controls, inline-pill badges, chart wrappers outside `ChartContainer`, or bespoke card CSS. Tabs must use `Tabs`/`TabsList`/`TabsTrigger`; data grids must use `DataTable` or `Table`; status labels must use `Badge`; general metric panels may use `Card` or `KpiStrip`; charts must use the approved chart surface; maps must use `MapView`.

For CRM, sales, pipeline, opportunity, account-risk, stage-exposure, stale-activity, or LastMile dashboards, top-level KPIs must use `KpiStrip` from `@thinkwork/computer-stdlib`. Do not hand-compose KPI metrics as individual full-width `Card` components, do not stack KPI cards vertically, and do not rely on generated `grid-cols-*` or responsive `md:grid-cols-*` Tailwind layout classes for the core dashboard structure. Use compiled stdlib primitives for the dashboard shape and reserve `Card` for chart, table, or detail sections.

Good apps include:

- Focused body content that starts at the useful work, not wrapper chrome.
- `KpiStrip` for CRM dashboard key totals.
- Charts or tables that make comparison easy.
- Empty, partial, and failed-source states proportional to the requested task.

Dashboard apps must be dashboard-shaped, not prose-only markdown reports. Do not save a dashboard artifact that is primarily a prose report, markdown summary, or stack of text-only cards. A useful dashboard should show at least one meaningful visual comparison through a chart, table, map, timeline, or other structured UI surface.

## Maps

When the user asks for a map (locations, regions, routes, geographic comparisons), use `MapView` from `@thinkwork/computer-stdlib`. **Do NOT embed an OpenStreetMap.org iframe, do NOT roll your own `react-leaflet` `<MapContainer>`, and do NOT enable `scrollWheelZoom` — `MapView` handles the tile provider, theming, default-icon bundler fix, and scroll-trap defaults correctly.** It uses Mapbox tiles when `VITE_MAPBOX_PUBLIC_TOKEN` is set (light/dark style swap from `useTheme`) and falls back to OpenStreetMap tiles when unset.

Pass `fit` (one of `{type: "country", code: "<ISO-3166-1-alpha-2>"}`, `{type: "bbox", bounds: [[lat,lng],[lat,lng]]}`, or `{type: "auto"}`) plus optional `markers`, `polylines`, and `geojson` arrays. See `@thinkwork/computer-stdlib/MapView` for the full prop shape.

## Preview And Save

The first useful result should be an unsaved preview. `preview_app` validates and renders the same TSX payload shape that `save_app` persists later, using the same generated-app policy. Do not save every preview as a durable artifact row.

Use only real available data, partial real data, or honest empty states. Do not invent CRM accounts, customers, metrics, events, opportunities, locations, or evidence to make a preview look complete. Missing or partial inputs should produce a runnable app with proportional empty states and concise limitations.

When the user asks to save, promote the preview by calling `save_app` with the same files and provenance metadata. Include the preview's `uiRegistryVersion`, `uiRegistryDigest`, and `shadcnMcpToolCalls` or `["local_registry_fallback"]` so the saved artifact records which shadcn registry source shaped the TSX.

## Missing Data

Missing data is not a reason to stop before creating the preview. Create a runnable app that handles gaps gracefully, then ask for source setup, approval, or save confirmation as a follow-up when needed.

For the LastMile CRM pipeline risk prompt, build an app that covers stale activity, stage exposure, and top risks. If live LastMile CRM records are unavailable, use the canonical LastMile-shaped structure and mention limitations only when they materially affect the displayed result.

## Runbook Bridge

For published runbooks, treat artifact creation as the implementation detail of the active `produce` phase:

- CRM Dashboard uses the `crm-dashboard` runbook and the `CrmDashboardData` shape.
- Research Dashboard uses the `research-dashboard` runbook and should expose findings, evidence, confidence, and caveats.
- Map Artifact uses the `map-artifact` runbook and `MapView` from `@thinkwork/computer-stdlib`.

Always preserve runbook queue semantics: complete the current task, preview the artifact through `preview_app`, save through `save_app` only when the runbook phase requires persistence, and report the saved `/artifacts/{appId}` route only after persistence succeeds.
