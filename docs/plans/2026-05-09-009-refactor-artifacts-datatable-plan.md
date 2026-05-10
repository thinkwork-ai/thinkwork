---
title: "refactor: Convert Artifacts page to Customize-style DataTable"
type: refactor
status: completed
created: 2026-05-09
plan_id: 2026-05-09-009
---

## Summary

Refactor the Artifacts list page (`apps/computer/src/routes/_authed/_shell/artifacts.index.tsx`) from a card-grid (`AppsGallery` + `AppPreviewCard`) into a Customize-style DataTable with a centered toolbar (search left, type tabs center, kind dropdown right). Preserve the existing artifact viewer route at `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` — only the index/list surface changes. This is a chrome-mirroring refactor, not a data-model change: artifacts continue to come from `AppletsQuery` and the `AppArtifactPreview` shape produced by `apps/computer/src/lib/app-artifacts.ts`.

The Customize page at `apps/computer/src/routes/_authed/_shell/customize.tsx` is the visual and structural reference — same toolbar geometry, same `DataTable` from `@thinkwork/ui`, same row-click affordance pattern.

---

## Problem Frame

The Artifacts index today is a card grid with a non-functional search input that only renders when there are 2+ artifacts. It does not match the established list-surface vocabulary of the rest of the Computer app (Customize and Memory both use the centered-toolbar `DataTable` pattern). Operators scanning many artifacts cannot sort, filter, or scan dense rows the way they can on Customize. Visual inconsistency also fragments the design language as more list surfaces are added.

The refactor is a pure presentation change: artifact data, queries, fields, route shape, and the per-artifact viewer all remain the same.

---

## Scope

### In scope

- New `apps/computer/src/components/artifacts/` directory containing the Customize-mirroring components: `ArtifactsTable`, `ArtifactsToolbar`, `ArtifactsListBody`, `artifacts-filtering.ts`.
- Replace `AppsGallery` usage in `artifacts.index.tsx` with `ArtifactsListBody`.
- Centered toolbar: search box left, two type tabs ("All", "Applets") center, kind dropdown right (mirrors `CustomizeToolbar` exactly).
- DataTable with columns: Name, Kind, Model, Stdlib, Generated, Version. Row click navigates to `/artifacts/$id` (preserves current behavior).
- Tab state and search/kind filter state are in-page React state (not route children, not URL search params) — matches the user's confirmed scope decision and keeps the refactor minimal.
- Migrate `AppsGallery.test.tsx` coverage onto the new components: empty state, populated state, search filtering, row click destination.

### Out of scope

#### Deferred to Follow-Up Work

- Convert tabs to route children (`artifacts.applets.tsx`, etc.) — requires a second artifact kind to land first.
- Add a real category dimension to artifacts (server-side field on `Applet`) — pre-requisite for a meaningful category dropdown beyond the current Kind filter.
- ArtifactDetailSheet (side sheet variant of row click) — current scope navigates straight to the existing viewer page.
- Column sorting, column visibility toggles, server-side pagination — not present in Customize either; add when artifact volume forces them.

#### Outside this product's identity

- Charts and Documents as artifact kinds. The page header copy mentions them aspirationally, but they do not exist in the data model and no work in this plan creates them.
- Any change to `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` (the full applet viewer page) or `AppArtifactSplitShell`.
- Any change to `AppPreviewCard` — it is still consumed in other surfaces (e.g., thread inline visualizations) and remains untouched.

---

## Key Technical Decisions

- **Filtering source = client-side, in `artifacts-filtering.ts`** — mirror `customize-filtering.ts` exactly. Artifact volume per tenant is small enough that client-side filter + sort is fine; server-side filter is a future concern. *Rationale:* `AppletsQuery` already returns the full list; introducing server-side filter args here is premature optimization.
- **Tabs are in-page state, not route children.** User-confirmed in scope synthesis. Route children only become valuable when each tab has different data fetching, mutations, or empty-state copy — Artifacts has one kind today.
- **Tab values are `"all"` and `"applet"`.** `"all"` shows every row; `"applet"` filters `kind === "applet"`. New kinds added later append a new tab value matching their `kind` literal.
- **Category dropdown filters on `kind`.** User-confirmed. `uniqueKinds(items)` derives the option list from the rendered artifacts. With one kind today, the dropdown effectively has two options ("All kinds", "applet"); it is wired through the same Select machinery as `CustomizeToolbar` so adding more kinds is invisible to the toolbar.
- **Row click navigates to `/artifacts/$id`** (TanStack Router `useNavigate({ to: "/artifacts/$id", params: { id } })` from inside `onRowClick`). Customize's `Sheet`-on-row-click pattern does not transfer because the artifact viewer is full-screen.
- **Reuse existing data.** No new GraphQL queries. The new `ArtifactsListBody` consumes the same `AppletsQuery` + `toAppletPreview` machinery that `AppsGallery` uses today, just projected into table rows.
- **Date column uses `toLocaleDateString` matching `AppPreviewCard.formatDate`** — preserves the "May 9" rendering operators already see, and falls back to "—" on missing/invalid dates.
- **Model column uses `shortModel` from `AppPreviewCard`** — extract into the new `artifacts/` directory so both the (now-removed) gallery card and the table use the same display logic. `AppPreviewCard` itself stays put because it is still rendered elsewhere; the helper can move with a re-export from the card file if needed for backward compatibility.

---

## High-Level Technical Design

```
apps/computer/src/
├── routes/_authed/_shell/
│   └── artifacts.index.tsx         (modify: render <ArtifactsListBody/> instead of <AppsGallery/>)
└── components/artifacts/           (new directory)
    ├── ArtifactsListBody.tsx        — composes Toolbar + Table; owns search/tab/kind state
    ├── ArtifactsToolbar.tsx         — search left, tabs center, kind dropdown right (mirrors CustomizeToolbar)
    ├── ArtifactsTable.tsx           — DataTable + columns: Name | Kind | Model | Stdlib | Generated | Version
    ├── artifacts-filtering.ts       — ArtifactItem shape, filterArtifactItems, uniqueKinds, ALL_KINDS
    └── ArtifactsListBody.test.tsx   — empty/populated/filter/row-click coverage (mirror CustomizeTabBody.test)
```

The directional shape — directional guidance for review, not implementation specification:

```ts
// artifacts-filtering.ts (sketch only)
export const ALL_KINDS = "__all__" as const;

export interface ArtifactItem {
  id: string;
  title: string;
  kind: string;          // "applet" today; future kinds extend without code change
  modelId: string | null;
  stdlibVersion: string | null;
  generatedAt: string;   // ISO
  version: number | null;
}

export function filterArtifactItems(input: {
  items: ArtifactItem[];
  search: string;
  kind: string;          // ALL_KINDS or a concrete kind value
  tab: string;           // "all" or a concrete kind value
}): ArtifactItem[];

export function uniqueKinds(items: ArtifactItem[]): string[];
```

The toolbar geometry copies `CustomizeToolbar` line-for-line at the layout level (same flex container, same `pointer-events-none absolute left-1/2` centering trick for tabs, same `ml-auto` Select), with text changed to "Search artifacts…", tab labels "All" / "Applets", placeholder "All kinds".

---

## Implementation Units

### U1. Extract `ArtifactItem` shape and filtering helpers

**Goal:** Stand up the data shape and pure filter/sort helpers that the new components consume.

**Dependencies:** none

**Files:**
- create `apps/computer/src/components/artifacts/artifacts-filtering.ts`
- create `apps/computer/src/components/artifacts/artifacts-filtering.test.ts`

**Approach:**
- Define `ArtifactItem` as the projection of `AppArtifactPreview` the table needs (see High-Level Technical Design sketch).
- Add `toArtifactItem(preview: AppArtifactPreview): ArtifactItem` for the index page to convert from `toAppletPreview` output without re-querying.
- Mirror `customize-filtering.ts`: `ALL_KINDS` sentinel, `filterArtifactItems` (search OR kind OR tab), `uniqueKinds`.
- Search matches `title`, `modelId`, `kind` (case-insensitive substring) — chosen because those are the visible columns; if it appears on screen, it is searchable.
- `tab === "all"` matches every kind. `tab === "applet"` matches `kind === "applet"`. Kind dropdown applies on top of tab.

**Patterns to follow:** `apps/computer/src/components/customize/customize-filtering.ts` (one-to-one translation, swap names).

**Test scenarios:**
- `filterArtifactItems` returns all items when `search === ""`, `kind === ALL_KINDS`, `tab === "all"`.
- Search "lastmile" matches title `"LastMile CRM pipeline risk"` (case-insensitive).
- Search matching `modelId` substring returns rows whose title doesn't contain the term.
- `tab === "applet"` excludes a synthetic `{ kind: "chart" }` item (forward-compat check).
- `kind === "applet"` excludes a synthetic non-applet item even when `tab === "all"`.
- Empty input returns empty output without throwing.
- `uniqueKinds` returns sorted-unique kind strings; empty list returns `[]`.
- `toArtifactItem` preserves id/title/version/generatedAt and coerces null model/stdlib to `null`.

**Verification:** Vitest passes for `artifacts-filtering.test.ts`. No production code consumes the helpers yet.

---

### U2. Build `ArtifactsToolbar`

**Goal:** Render the search-left / tabs-center / kind-dropdown-right toolbar.

**Dependencies:** U1

**Files:**
- create `apps/computer/src/components/artifacts/ArtifactsToolbar.tsx`

**Approach:**
- Copy `CustomizeToolbar.tsx` structurally; replace `CUSTOMIZE_TABS` with an inline `ARTIFACT_TABS = [{ value: "all", label: "All" }, { value: "applet", label: "Applets" }]`.
- Tabs render via `Tabs`/`TabsList`/`TabsTrigger` from `@thinkwork/ui`, **not** TanStack Router `Link`s — these are in-page state, not route children. `TabsTrigger` calls `onTabChange(value)`.
- Search input: `data-testid="artifacts-search"`, placeholder "Search artifacts…".
- Kind dropdown: `data-testid="artifacts-kind"`, sentinel item value `ALL_KINDS` with label "All kinds".
- Toolbar root: `data-testid="artifacts-toolbar"`.

**Patterns to follow:** `apps/computer/src/components/customize/CustomizeToolbar.tsx` (same className strings, same centering trick).

**Test scenarios:** none directly — covered transitively in U4's `ArtifactsListBody` test (toolbar geometry assertions).

*Test expectation: none — pure presentational component, exercised through ArtifactsListBody integration tests in U4.*

**Verification:** Renders inside `ArtifactsListBody` once U4 lands. TypeScript compile clean.

---

### U3. Build `ArtifactsTable`

**Goal:** Render the artifact rows in a `DataTable` with the agreed columns.

**Dependencies:** U1

**Files:**
- create `apps/computer/src/components/artifacts/ArtifactsTable.tsx`

**Approach:**
- Mirror `CustomizeTable.tsx` structure: memoized `ColumnDef<ArtifactItem>[]`, `DataTable` with `scrollable`, `pageSize={50}`, `tableClassName="table-fixed"`, `onRowClick` prop.
- Columns:
  - **Name** (size 240, `accessorKey: "title"`): truncated `<span title={...}>{title}</span>`, font-medium text-sm. `data-row-id={row.original.id}` and `data-testid="artifacts-table-row"`.
  - **Kind** (size 100): `<Badge variant="outline" className="uppercase tracking-wide">{kind}</Badge>`.
  - **Model** (size 160): `shortModel(modelId)` rendered as plain text-sm; `—` when null. Extract `shortModel` into `artifacts-filtering.ts` (or a sibling `artifacts-format.ts`) so the table and any future card use the same logic.
  - **Stdlib** (size 100): plain text or `—`.
  - **Generated** (size 120): `formatDate(generatedAt)` (the same `Intl.DateTimeFormat`-style "May 9" format `AppPreviewCard` uses); `—` on null/invalid.
  - **Version** (size 80): `<Badge variant="outline">v{version}</Badge>` or "—" when null.
- Empty state: `data-testid="artifacts-table-empty"` div with `emptyMessage` prop.
- Outer container `data-testid="artifacts-table"`.

**Patterns to follow:** `apps/computer/src/components/customize/CustomizeTable.tsx`.

**Test scenarios:** none directly — covered in U4's `ArtifactsListBody` test which asserts row count, row content per column, and click forwarding.

*Test expectation: none — pure presentational component, exercised through ArtifactsListBody integration tests in U4.*

**Verification:** Component renders rows when populated and empty-state when not. TypeScript compile clean.

---

### U4. Compose `ArtifactsListBody` + replace `AppsGallery` on the index route

**Goal:** Wire toolbar + table + state + data hook + row navigation; switch the route to use it.

**Dependencies:** U1, U2, U3

**Files:**
- create `apps/computer/src/components/artifacts/ArtifactsListBody.tsx`
- create `apps/computer/src/components/artifacts/ArtifactsListBody.test.tsx`
- modify `apps/computer/src/routes/_authed/_shell/artifacts.index.tsx`

**Approach:**
- `ArtifactsListBody` accepts `items?: ArtifactItem[]` (test seam) and a `fetching`/`errorMessage` pair, identical to the `AppsGallery`/`AppsGalleryContent` split. Default path queries `AppletsQuery` via urql with `requestPolicy: "cache-and-network"` and maps `nodes` through `toAppletPreview` then `toArtifactItem`.
- Owns local state: `search`, `tab` (default `"all"`), `kind` (default `ALL_KINDS`), no sheet state (row click navigates).
- Memoized `kinds = uniqueKinds(items)`, `filtered = filterArtifactItems({ items, search, tab, kind }).sort((a, b) => a.title.localeCompare(b.title))`.
- Above-toolbar header strip preserves the existing copy ("Outputs generated by your Computer, including apps, charts, and documents.") and the "Create artifact" link button (`<Link to="/new">`). Visually align with Customize: the header sits in the same vertical space the Customize page uses for its (currently empty) header context. If Customize has no per-page header, drop the descriptive paragraph and keep only the "Create artifact" action aligned with `usePageHeaderActions`.
- Layout matches `CustomizeTabBody`: outer `flex h-full min-w-0 flex-col`, toolbar, then `flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4` containing the table.
- Row click: call `useNavigate({ from: "/artifacts" })` and navigate `to: "/artifacts/$id"` with the row's `id` param.
- Index route: `usePageHeaderActions({ title: "Artifacts" })` stays; replace `<AppsGallery />` with `<ArtifactsListBody />`. Drop the `AppsGallery` import.

**Patterns to follow:** `apps/computer/src/components/customize/CustomizeTabBody.tsx` for layout and state composition; `apps/computer/src/components/apps/AppsGallery.tsx#LiveAppsGallery` for the urql query shape.

**Test scenarios:**
- Renders empty-state copy (e.g., "No artifacts match your filters." or "Ask Computer to create an artifact and it will appear here.") when `items=[]` — preserve the existing empty-state intent from `AppsGallery.test.tsx`.
- Renders one row per item: `items.length === 3` produces three `[data-testid="artifacts-table-row"]` cells.
- Search by title: typing "drive" into `[data-testid="artifacts-search"]` reduces visible rows to those whose title matches.
- Search by model: typing the modelId substring filters rows accordingly (covers the search-on-non-title-column behavior).
- Tab switch: clicking the "Applets" tab while items contain a synthetic non-applet kind hides the non-applet rows.
- Kind dropdown: selecting a concrete kind narrows rows; selecting "All kinds" restores them.
- Toolbar geometry: `[data-testid="artifacts-toolbar"]` contains all of `artifacts-search`, `artifacts-tabs` (TabsList container), `artifacts-kind` Select trigger.
- Row click navigation: clicking a row invokes the router. Mock TanStack Router's `useNavigate` (via `vi.mock("@tanstack/react-router", ...)`) and assert it was called with `{ to: "/artifacts/$id", params: { id: <row id> } }`.
- Loading state: when `fetching=true` and `items=[]`, renders the loading text the existing AppsGallery shows ("Loading artifacts..."). When `fetching=true` and `items` already has rows, the table is shown (cache-and-network behavior).
- Error state: when `errorMessage="boom"` and `items=[]`, renders an error/empty surface containing "boom".

**Verification:** `pnpm --filter @thinkwork/computer test` passes including the new file. `pnpm --filter @thinkwork/computer typecheck` clean. Manually load `/artifacts` in admin (port 5174 or 5175) and confirm: header reads "Artifacts", toolbar layout matches Customize, table renders the user's existing artifacts with the six columns, clicking a row opens the existing artifact viewer.

---

### U5. Remove now-dead gallery code paths

**Goal:** Delete `AppsGallery` and its test once nothing references them; keep `AppPreviewCard` because other surfaces still consume it.

**Dependencies:** U4

**Files:**
- modify (delete) `apps/computer/src/components/apps/AppsGallery.tsx`
- modify (delete) `apps/computer/src/components/apps/AppsGallery.test.tsx`
- audit: `grep -rn "AppsGallery" apps/computer/src` should return zero hits before deletion. If references remain (e.g., a storybook story or another route), defer the deletion and capture in a follow-up note instead.

**Approach:**
- After U4 lands and tests pass, search for `AppsGallery` references.
- If only the index route used it (the expected case), delete the two files.
- `AppPreviewCard.tsx` stays — `apps/computer/src/components/threads/` and inline thread visualizations may still consume it; verify with grep before drawing conclusions.
- If `shortModel`/`formatDate` were extracted to `artifacts/` in U3, leave compatibility re-exports in `AppPreviewCard.tsx` only if it still uses them.

**Patterns to follow:** standard dead-code removal; no special pattern.

**Test scenarios:**
- `pnpm --filter @thinkwork/computer test` continues to pass — no test depends on `AppsGallery` after deletion.
- `pnpm --filter @thinkwork/computer typecheck` clean.

*Test expectation: none — deletion-only unit; behavioral coverage already lives in U4's tests.*

**Verification:** Grep returns zero `AppsGallery` references in `apps/computer/src`. Build + typecheck clean. `/artifacts` loads as in U4.

---

## Dependencies / Prerequisites

- `@thinkwork/ui` already exports `DataTable`, `Tabs`, `TabsList`, `TabsTrigger`, `Select*`, `Input`, `Badge`, `Button` — all consumed by Customize today, so no new package surface is needed.
- `AppletsQuery` and `toAppletPreview` are unchanged; this plan reuses them.
- TanStack Router `useNavigate` / typed routes are already in use throughout `apps/computer`.

No backend, schema, or terraform changes.

---

## Risks & Mitigations

- **Risk:** Tabs-as-state (not route children) drifts from the Customize precedent if a future contributor adds the second artifact kind via copy-paste from Customize.
  **Mitigation:** Comment in `ArtifactsListBody` calling out the deliberate divergence and the trigger ("when a second kind ships, consider promoting tabs to route children to mirror Customize"). One-line, no rot risk.
- **Risk:** `useNavigate` mocking in `ArtifactsListBody.test.tsx` is brittle if other tests in the directory mock the router differently.
  **Mitigation:** Scope the mock to the test file via `vi.mock` and verify in isolation. Customize tests do not need the router because the row click opens a sheet locally; mirror their pattern only up to the row-click step.
- **Risk:** Dead-code removal in U5 misses a non-obvious consumer (e.g., a dynamic import).
  **Mitigation:** U5's grep gate is explicit; if any reference exists, defer the deletion with a one-line follow-up rather than forcing it.
- **Risk:** Visual regression — operators are used to the gallery and may not immediately recognize the table.
  **Mitigation:** Match Customize chrome exactly so the visual language is consistent across the app; the change is intentional and parallels a precedent the user already accepted.

---

## System-Wide Impact

- **`apps/computer` only.** No `apps/admin`, `apps/mobile`, `packages/api`, `packages/database-pg`, or terraform changes.
- **No GraphQL schema changes** — same `AppletsQuery`, same fields. Codegen unaffected.
- **No new package surface.** All UI primitives already exist in `@thinkwork/ui`.
- **No data migration.** Pure presentation refactor.
- **Sidebar entry unchanged** — `ComputerSidebar.tsx` continues to link to `/artifacts` with no edits.

---

## Verification Strategy

1. **Unit tests** — `artifacts-filtering.test.ts` (U1), `ArtifactsListBody.test.tsx` (U4) cover the contract.
2. **Workspace gates** — `pnpm --filter @thinkwork/computer typecheck && pnpm --filter @thinkwork/computer test && pnpm --filter @thinkwork/computer lint` clean before merge.
3. **Manual smoke** — load `/artifacts` against a stage with existing applets; confirm rows render, search works, tab switch works, kind dropdown works, row click opens the artifact viewer at `/artifacts/$id`. Verify Customize and Artifacts toolbars line up visually side-by-side.
4. **Regression check** — visit `/customize/connectors` after the refactor to confirm shared dependencies (`@thinkwork/ui` `DataTable`, `Tabs`, `Select*`) are unaffected.
