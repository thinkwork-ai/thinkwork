---
title: "feat: Space breadcrumb on thread-detail header"
type: feat
status: active
date: 2026-06-01
app: apps/spaces
---

# feat: Space breadcrumb on thread-detail header

## Summary

The thread-detail header in `apps/spaces` currently shows only the thread title (with an
inline-rename affordance and a `…`/copy/info trailing cluster). It gives no indication of which
**Space** the thread belongs to and no one-click way back to that Space's thread list. This plan
adds a clickable space crumb — `Chats › <thread title>` or `Customer › <thread title>` — reusing the
**existing** `breadcrumbs` mechanism that Settings → MCP Servers → [Detail] already uses
(`MCP Servers › LastMile Tasks`). Clicking the space crumb navigates to the scoped thread list
(`/threads` with `spaceId` + `spaceName`), which renders the `"Chats · Threads"` / `"Customer · Threads"`
page the user already has.

The one non-trivial wrinkle: the breadcrumb renderer **replaces** `titleContent`, and the thread
header uses `titleContent` for inline rename. The plan makes the **last crumb host `titleContent`** so
rename is preserved while the space crumb is added — a small, reusable change to both header renderers.

**Depth:** Lightweight · 4 implementation units.

---

## Problem Frame

- **Where:** `apps/spaces` desktop SPA (the operator console; `apps/desktop` is shell-only).
- **Current state:** `SpacesThreadDetailRoute` sets the page header via `usePageHeaderActions({ title, titleContent: <ThreadTitleInlineRename>, titleTrailing: <ThreadDetailActions>, … })`. No space context is surfaced. The thread GraphQL query (`ComputerThreadQuery`) fetches `spaceId` but **not** `space { name slug }`.
- **Reference pattern (what the user pointed at):** `SettingsMcpServerDetail` calls `usePageHeaderActions({ breadcrumbs: [{ label: "MCP Servers", href: "/settings/mcp-servers" }, { label: server.name }] })`. Both header renderers already render this trail with a `ChevronRight` separator, a clickable parent `<Link>`, and a plain-text last crumb.
- **Gap:** Reusing `breadcrumbs` as-is on the thread header would (a) drop the inline-rename input (breadcrumb branch wins over the `titleContent` branch), and (b) cannot carry TanStack search params, which the scoped-thread-list back target requires (`/threads` + `search: { spaceId, spaceName }`).

## Requirements

- **R1** — Thread-detail header shows the thread's Space as a leading crumb, followed by the thread title, separated by the same chevron used elsewhere. (origin: user request + Image #3 parity)
- **R2** — Clicking the space crumb navigates to the **scoped thread list** for that space (`/threads` with `spaceId` + `spaceName`), matching the sidebar's existing "Thread list" action and the `"<Space> · Threads"` list page (Image #1).
- **R3** — Inline thread rename (`ThreadTitleInlineRename`) and the trailing `…`/copy/info actions (`ThreadDetailActions`) remain fully functional after the change.
- **R4** — Default-space threads ("Chats") and named-space threads ("Customer") both label correctly; a thread whose space is missing/not-yet-loaded degrades to the current title-only header (no broken or empty crumb).
- **R5** — The reference breadcrumb consumer (`SettingsMcpServerDetail`) is visually and behaviorally unchanged.

---

## Key Technical Decisions

- **KTD1 — Reuse `breadcrumbs`, host `titleContent` in the last crumb.** Rather than inventing a parallel "parent crumb" field, extend the existing breadcrumb renderers so the **last** crumb renders `titleContent` when provided, falling back to the plain `label` otherwise. This keeps one breadcrumb concept across the app (the user's "we have this on other pages" intent), preserves inline rename, and leaves `SettingsMcpServerDetail` (no `titleContent`) rendering exactly as today.
- **KTD2 — Extend the crumb model with optional `search`.** The crumb type becomes `{ label: string; href?: string; search?: Record<string, unknown> }`. TanStack Router's `<Link to>` does not parse a query string embedded in `to`; search must be passed via the `search` prop. The scoped-thread-list target needs `search: { spaceId, spaceName }`, so the crumb must carry it. `href`-only crumbs (MCP detail) are unaffected.
- **KTD3 — Fetch `space { id name slug }` on the thread query.** The schema already exposes `Thread.space: Space` (`packages/database-pg/graphql/types/threads.graphql:46`) and other spaces queries already select it. Add the sub-selection to `ComputerThreadQuery` so the header can label the crumb without a second round-trip.
- **KTD4 — Centralize the "default space → Chats" label rule.** `isDefaultSpace` is currently duplicated (`ChatSidebar.tsx:1906`, `SpacesWorkbench.tsx:482`). Extract a shared helper plus a `spaceCrumbLabel(space)` that returns `"Chats"` for default/missing spaces and `space.name ?? space.slug` otherwise, so the crumb label stays consistent with the sidebar grouping.
- **KTD5 — Back target is the scoped thread list, not the Space workroom.** (user-confirmed) `/threads` + `search: { spaceId, spaceName }` mirrors the sidebar's "Thread list" menu item and renders the `"<Space> · Threads"` page. The Space workroom (`/spaces/$spaceId`) is rejected because default-space "Chats" threads have no workroom route.

---

## High-Level Technical Design

Header renderer crumb logic, after this change (both `AppTopBar` and `DesktopApplicationHeader` share
identical breadcrumb blocks):

```text
for each crumb at index i (isLast = i === breadcrumbs.length - 1):
  if i > 0: render <ChevronRight/>
  if isLast:
      if titleContent present: render titleContent      // ← NEW: hosts inline rename
      else:                    render <span>{label}</span> (current text)
  else if crumb.href:
      render <Link to={crumb.href} search={crumb.search}>{label}</Link>   // ← search NEW
  else:
      render <span>{label}</span>
```

Thread-detail header inputs (built in `SpacesThreadDetailRoute`):

```text
space = thread.space            // newly fetched
hasSpace = Boolean(thread.spaceId)

breadcrumbs = hasSpace
  ? [ { label: spaceCrumbLabel(space),
        href: "/threads",
        search: { spaceId: thread.spaceId, spaceName: spaceCrumbLabel(space) } },
      { label: threadTitle } ]          // last crumb → titleContent (rename) hosts here
  : undefined                            // degrade to title-only header (R4)

usePageHeaderActions({
  ...existing,
  breadcrumbs,                           // NEW
  titleContent: <ThreadTitleInlineRename .../>,   // unchanged; now surfaces in last crumb
  titleTrailing: <ThreadDetailActions .../>,      // unchanged
})
```

> Directional guidance for reviewers, not implementation specification.

---

## Implementation Units

### U1. Extend the breadcrumb model and both header renderers

**Goal:** Let a breadcrumb crumb carry TanStack `search` params, and let the final crumb host
`titleContent` when provided. (R1, R2, R3, R5; KTD1, KTD2)

**Dependencies:** none.

**Files:**
- `apps/spaces/src/context/PageHeaderContext.tsx` — widen the `breadcrumbs` item type to `{ label: string; href?: string; search?: Record<string, unknown> }`; include `search` in the `breadcrumbsKey` serialization inside `usePageHeaderActions` so the header refreshes when search changes.
- `apps/spaces/src/components/DesktopApplicationHeader.tsx` — breadcrumb block (~lines 161-199): pass `search={crumb.search}` to the parent `<Link>`; in the `isLast` branch render `headerActions.titleContent` when present, else the existing label span.
- `apps/spaces/src/components/AppTopBar.tsx` — breadcrumb block (~lines 61-97): same two edits, reading `actions.titleContent`.
- `apps/spaces/src/components/DesktopApplicationHeader.test.tsx` — tests (see below).

**Approach:** Both renderers already special-case `isLast`; the change is additive. Preserve existing
truncate/overflow classes so a long title still ellipsizes. The `titleTrailing` cluster
(`ThreadDetailActions`) is rendered *after* the breadcrumb `<nav>` and is untouched.

**Patterns to follow:** existing `isLast || !crumb.href` ternary in both files; the existing
`titleContent ? <div className="min-w-0">{titleContent}</div> : <h1>` fallback branch.

**Test scenarios** (`apps/spaces/src/components/DesktopApplicationHeader.test.tsx`):
- Happy path: breadcrumbs `[{label:"Chats", href:"/threads", search:{spaceId:"s1", spaceName:"Chats"}}, {label:"My thread"}]` with no `titleContent` → renders "Chats" as a link and "My thread" as plain last crumb, chevron between.
- Last-crumb titleContent: same breadcrumbs **plus** `titleContent: <input data-testid="rename"/>` → the last crumb renders the `rename` element, not the plain "My thread" text; the parent "Chats" link still renders.
- Search wiring: the parent crumb `<Link>` receives `search` (assert the rendered href/router state includes `spaceId=s1&spaceName=Chats`, or assert via the Link mock that `search` was passed).
- Regression (R5): a crumb trail with `href` only and **no** `titleContent` (MCP-style) → last crumb is plain text, parent is a link with no search — unchanged from today.
- `titleTrailing` coexistence: breadcrumbs + `titleTrailing` → trailing cluster still renders after the nav.

### U2. Fetch the thread's Space on the detail query

**Goal:** Make `space { id name slug }` available to the thread-detail header. (R1, R4; KTD3)

**Dependencies:** none (parallel with U1).

**Files:**
- `apps/spaces/src/lib/graphql-queries.ts` — add `space { id name slug }` to `ComputerThreadQuery` (next to the existing `spaceId` selection, ~line 468).
- `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx` — extend the `ThreadResult.thread` interface (~line 98) with `space?: { id: string; name?: string | null; slug?: string | null } | null`.
- Regenerate codegen: `pnpm --filter @thinkwork/spaces codegen` (per CLAUDE.md, every GraphQL consumer with a `codegen` script must regenerate).

**Approach:** Purely additive selection; the schema already supports `Thread.space`. No resolver work —
this is a client query change only.

**Patterns to follow:** existing `space { … }` sub-selections in the same file
(`graphql-queries.ts:42`, `:84`, `:193`).

**Test scenarios:** `Test expectation: none — additive GraphQL field selection + type widening; behavior is exercised through U4's header tests.` Verification is `pnpm --filter @thinkwork/spaces codegen` succeeding and `typecheck` passing.

### U3. Shared `isDefaultSpace` + `spaceCrumbLabel` helper

**Goal:** One source of truth for "is this the default space?" and the crumb label string. (R4; KTD4)

**Dependencies:** none (parallel with U1/U2).

**Files:**
- `apps/spaces/src/components/spaces/space-types.ts` (or a sibling `space-utils.ts` if a pure-helper home is preferred) — export `isDefaultSpace(space)` and `spaceCrumbLabel(space)`.
- `apps/spaces/src/components/shell/ChatSidebar.tsx` — replace the local `isDefaultSpace` (line 1906) with the shared import.
- `apps/spaces/src/components/workbench/SpacesWorkbench.tsx` — replace the local `isDefaultSpace` (line 482) with the shared import.
- Test file: `apps/spaces/src/components/spaces/space-utils.test.ts` (new).

**Approach:** Lift the existing predicate verbatim: `slug`/`name` lowercased equals `"default"` or
`"general"`. `spaceCrumbLabel(space)` → `"Chats"` when `space` is null/undefined or `isDefaultSpace`,
else `space.name ?? space.slug ?? "Space"`. Keep both call sites behaviorally identical to avoid
sidebar/workbench regressions.

**Patterns to follow:** the current `isDefaultSpace` bodies in `ChatSidebar.tsx` and `SpacesWorkbench.tsx` (identical logic).

**Test scenarios** (`space-utils.test.ts`):
- `isDefaultSpace`: returns true for `{slug:"default"}`, `{slug:"general"}`, `{name:"Default"}`, `{name:"GENERAL"}` (case-insensitive); false for `{name:"Customer", slug:"customer"}`.
- `spaceCrumbLabel`: `null` → `"Chats"`; default space → `"Chats"`; `{name:"Customer"}` → `"Customer"`; `{slug:"acme", name:null}` → `"acme"`; empty `{}` → `"Space"`.

### U4. Wire the space breadcrumb into the thread-detail header

**Goal:** Build the `breadcrumbs` array on the thread header and degrade gracefully when space is absent. (R1, R2, R3, R4; KTD1, KTD2, KTD5)

**Dependencies:** U1, U2, U3.

**Files:**
- `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx` — in the `usePageHeaderActions({...})` call (~line 965), compute `spaceLabel = spaceCrumbLabel(thread.space)` and add `breadcrumbs` per the HTD sketch when `thread.spaceId` is present; otherwise omit `breadcrumbs` (current behavior). Keep `title`, `documentTitle`, `titleContent`, `titleTrailing`, and `action` as they are.
- Test: extend an existing `SpacesThreadDetailRoute` test if present, else cover the breadcrumb-building logic via U3 + U1 unit tests (the header wiring is a thin composition).

**Approach:** The `backHref` prop stays available but is **not** the space-crumb mechanism — the crumb's
`href` + `search` drives navigation (KTD2/KTD5). `spaceName` passed in `search` uses the same
`spaceCrumbLabel` output so the destination list header reads `"Chats · Threads"` / `"Customer · Threads"`.
When `thread.space` is still loading, `spaceCrumbLabel(null)` → `"Chats"`; gate on `thread.spaceId`
presence (R4) so we never render a crumb pointing at an unknown space.

**Patterns to follow:** `SettingsMcpServerDetail.tsx:49-55` breadcrumb shape; the sidebar's
`navigate({ to: "/threads", search: { spaceId, spaceName } })` at `ChatSidebar.tsx:1116`.

**Test scenarios:**
- Covers R2. Named space: thread with `spaceId:"s2"`, `space:{name:"Customer"}` → header breadcrumbs are `[{label:"Customer", href:"/threads", search:{spaceId:"s2", spaceName:"Customer"}}, {label:<thread title>}]`; clicking "Customer" routes to `/threads?spaceId=s2&spaceName=Customer`.
- Covers R1/R3. Default space: thread with `spaceId:"s1"`, `space:{slug:"general"}` → leading crumb label "Chats"; last crumb hosts the inline-rename input; `…` actions still present.
- Covers R4. Missing space: thread with `spaceId` null/undefined → no `breadcrumbs` set; header falls back to the title-only (`titleContent`) layout.
- Edge: very long thread title → last crumb truncates without pushing the trailing actions off-screen.

---

## Scope Boundaries

**In scope:** the thread-detail header in `apps/spaces`, the two shared header renderers, the thread
GraphQL query field, and the shared space-label helper.

**Out of scope:**
- The threads **list** page (`threads.index.tsx`) and the `"Chats · Threads"` title — unchanged; it is the breadcrumb's *destination*, already correct.
- The sidebar grouping logic — only the `isDefaultSpace` extraction touches it (behavior-preserving).
- `apps/mobile` and `apps/admin` — this is a spaces-desktop header affordance.
- Any server/resolver change — `Thread.space` already exists in the schema.

### Deferred to Follow-Up Work
- Optional: a matching space crumb on other workbench surfaces (artifact/file fullscreen views) if they later gain their own headers — not requested.

---

## Risks & Dependencies

- **Breadcrumb-replaces-titleContent regression (primary risk):** if U1's last-crumb `titleContent`
  hosting is wrong, inline rename silently disappears. Mitigated by the explicit U1 test asserting the
  rename element renders inside the last crumb, and the U4 default-space test.
- **TanStack `Link search` typing:** `/threads` search is validated by `threads.index.tsx`'s
  `validateSearch` (`spaceId?`, `spaceName?`). Passing `search` as `Record<string, unknown>` through the
  generic crumb model may need a cast at the `<Link>` site; confirm typecheck passes.
- **Codegen drift (U2):** forgetting `pnpm --filter @thinkwork/spaces codegen` after the query edit
  surfaces as a typecheck failure — caught by the standard pre-commit gate (`lint && typecheck && test && format:check`).
- **Two renderers must stay in sync:** `AppTopBar` (web) and `DesktopApplicationHeader` (desktop) carry
  duplicate breadcrumb blocks; both must receive the U1 edits or web/desktop diverge. The screenshots are
  the desktop header — verify there first, but change both.

## Verification

- `pnpm --filter @thinkwork/spaces codegen && pnpm -r --if-present typecheck && pnpm --filter @thinkwork/spaces test` all green.
- Manual (Eric's checkout, dev stage — visual UI per project convention): open a thread under "Chats"
  and one under a named space ("Customer"); confirm the crumb reads `Chats › …` / `Customer › …`, the
  parent crumb click lands on the matching `"<Space> · Threads"` list, inline rename still works, and the
  `…`/copy/info cluster is intact.
- Confirm `SettingsMcpServerDetail` breadcrumb is visually unchanged.

---

## Sources & Research

- Reference breadcrumb consumer: `apps/spaces/src/components/settings/SettingsMcpServerDetail.tsx:49-55`.
- Header model + hook: `apps/spaces/src/context/PageHeaderContext.tsx` (`PageHeaderActions`, `usePageHeaderActions` key at lines 87-94).
- Renderers: `apps/spaces/src/components/DesktopApplicationHeader.tsx:161-199`, `apps/spaces/src/components/AppTopBar.tsx:61-97`.
- Thread header wiring: `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx:965-994` (and `ThreadResult` at ~line 98).
- Thread query: `apps/spaces/src/lib/graphql-queries.ts:458` (`ComputerThreadQuery`); schema field `Thread.space: Space` at `packages/database-pg/graphql/types/threads.graphql:46`.
- Space grouping + default detection: `apps/spaces/src/components/shell/ChatSidebar.tsx:985-1013` (grouping), `:1906` (`isDefaultSpace`), `:1116` (`/threads` scoped nav); duplicate predicate at `apps/spaces/src/components/workbench/SpacesWorkbench.tsx:482`.
- List page destination: `apps/spaces/src/routes/_authed/_shell/threads.index.tsx:188-194` (`"<spaceName> · Threads"`, `spaceId`/`spaceName` search params).
