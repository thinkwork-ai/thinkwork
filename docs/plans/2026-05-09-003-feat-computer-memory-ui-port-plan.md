---
title: "feat(computer): port admin Memory UI (Brain + Pages + KBs) for the logged-in user"
type: feat
status: active
created: 2026-05-09
plan_id: 2026-05-09-003
related_plans:
  - docs/plans/2026-05-08-014-feat-thinkwork-computer-v1-consolidated-plan.md
  - docs/plans/2026-05-08-013-feat-computer-auth-and-threads-plan.md
  - docs/plans/2026-05-08-012-feat-apps-computer-scaffold-plan.md
supersedes:
  - "U10 + U11 of docs/plans/2026-05-08-014-feat-thinkwork-computer-v1-consolidated-plan.md (small read+forget MemoryPanel — replaced by full /memory route)"
---

## Summary

Port admin's Memory module (Brain + Pages + KBs tabs, with Table and 3D Graph views) over to `apps/computer`, scoped to **only the logged-in user**. Extract the 3D ForceGraph rendering into a new `@thinkwork/graph` workspace package so admin and computer share one source of truth for the visualization. Drop admin-only affordances (user-select dropdown, multi-user fan-out, edit-memory, KB CRUD, Search/context-engine tab) — these are operator surfaces; computer is the end-user surface.

This plan supersedes U10 + U11 of the v1 consolidated plan (which proposed a small in-thread MemoryPanel with read+forget). The fuller Brain/Pages/KBs surface is what an end user actually needs.

---

## Problem Frame

The Memory module already exists in `apps/admin` as four tabs (Brain, Pages, KBs, Search) with multi-user fan-out and operator-only affordances (edit memories, manage KBs, test context providers). End users on `apps/computer` currently have no surface to see what the Computer remembers about them, what compiled wiki pages it has produced, or what knowledge bases it can query.

The v1 consolidated plan (`docs/plans/2026-05-08-014`) anticipated this with a tiny `MemoryPanel.tsx` inside threads (U10 + U11) that exposed read + forget. That scope was right-sized for an in-chat panel but wrong-sized for what the user is asking for now: a first-class `/memory` route with the same Brain / Pages / KBs surface admin operators use, scoped to the logged-in user only.

The user-named outcome is: clone admin's Memory UI to apps/computer, restrict to the signed-in user, and put the ForceGraph rendering in a shared package so both apps stay in sync going forward.

---

## Requirements

- R1. apps/computer renders three Memory tabs — **Brain**, **Pages**, **KBs** — under a single `/memory` route, with the same Table / Graph toggle that admin has on Brain and Pages.
- R2. All Memory data is scoped to the **logged-in user only**. No user-picker dropdown. No "All Users" mode. No multi-user fan-out.
- R3. Brain supports **read + forget** (delete) only. No edit; no per-record `UpdateMemoryRecordMutation` wiring.
- R4. Pages is **read-only** with the existing Wiki page detail sheet (summary, sections, aliases, connected pages).
- R5. KBs is **read-only**: list the tenant's knowledge bases the user belongs to, click into a KB to see its document list. No create / upload / sync / delete.
- R6. The 3D ForceGraph rendering used by Brain and Pages lives in a new shared package (`@thinkwork/graph`); both `apps/admin` and `apps/computer` consume it. Visual + interaction parity with today's admin behavior — same colors, same camera, same in-place opacity-mute filter, same node-detail sheet flow.
- R7. apps/computer's Sidebar surfaces a **Memory** entry that lands on `/memory` (defaulting to Brain).
- R8. The port does not regress admin's Memory module — admin still works exactly as it does today, but its components import from `@thinkwork/graph` instead of duplicating the rendering code.

**Origin:** none. This plan is direct from the user's request (image shows the Brain | Pages | KBs | Search tab strip and the Table | Graph toggle on the right side of admin's Brain tab).

**Out-of-scope tabs (deferred):**
- **Search** (admin's `context-engine.tsx`, ~48 KB) — operator-debug surface (provider statuses, dev-only test agents). Not appropriate for an end-user shell.

---

## Scope Boundaries

### Deferred for later

- The fourth tab (Search / context-engine) — port if/when end users actually need cross-source semantic lookup. Today's surface is operator-debug shaped and would need a UX redesign before it lands here.
- Edit-memory parity in Brain. The v1 consolidated plan's R5 + D4 explicitly say "no edit"; revisit only after end users ask for it.
- KB create / upload / sync / delete from apps/computer. KBs are tenant-wide infrastructure; one user's destructive action would affect every other user. Belongs in admin per `feedback_user_opt_in_over_admin_config`.
- Pagination beyond 50 records in Brain. Defaults to `limit: 50` from the existing query shape; revisit if Hindsight retention growth makes the table feel truncated.
- Memory pinning / favoriting. Not in admin today; not adding it here.
- Wiki page editing. Not in admin today; not adding.

### Outside this product's identity

- A user-select dropdown on apps/computer's Memory pages. apps/computer is per-user by design; surfacing other users' memories would leak data.
- "All Users" graph mode. Same reason.
- Operator affordances such as Hindsight system-config toggles, eval scoring, or context-provider settings.

### Deferred to Follow-Up Work

- Mobile parity for `/memory` on `apps/mobile`. Mobile already has its own Wiki browse surface (`docs/plans/2026-04-19-005-refactor-mobile-memories-to-wiki-plan.md`); reconciliation with this port is a separate follow-up.
- Migrating `MemoryGraph` / `WikiGraph` test coverage that may exist in admin's test suite into `packages/graph`. Will inventory at U2 and decide per-test whether to move or duplicate.
- Renaming `apps/admin/src/lib/wiki-palette.ts` to live inside `@thinkwork/graph` once a second consumer (mobile) needs it. v1 keeps the palette in admin and the shared package re-exports it; the rename can wait.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (909 lines) — `MemoryPage`. Table + Graph toggle, user-scope select, Hindsight-gated edit/delete, graph-node detail sheet with re-anchoring history. Source for U5.
- `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` (549 lines) — `WikiPage`. Table + Graph toggle, user-scope select, `WikiPageSheet` for details. Source for U6.
- `apps/admin/src/routes/_authed/_tenant/knowledge-bases/index.tsx` (207 lines) — `KnowledgeBasesPage`. KB list, create dialog, click-through. Source for U7 (read-only port).
- `apps/admin/src/routes/_authed/_tenant/knowledge-bases/$kbId.tsx` (370 lines) — KB detail with file upload. Source for U7's read-only detail.
- `apps/admin/src/routes/_authed/_tenant/knowledge/{memory,wiki,knowledge-bases}.tsx` — thin wrappers around the underlying pages, passing `embedded=true` + breadcrumbs + `routeBase`. Pattern to mirror for apps/computer.
- `apps/admin/src/components/MemoryGraph.tsx` (498 lines) — 3D force graph for Hindsight memories + entities. Performance patterns (in-place opacity mute, one-shot camera init, stable `nodeThreeObject`) are load-bearing per the file's own header comment. Source for U2.
- `apps/admin/src/components/WikiGraph.tsx` (643 lines) — 3D force graph for compiled wiki pages with neighbor-ring outline. Same perf invariants. Source for U2.
- `apps/admin/src/components/WikiPageSheet.tsx` — page detail drawer, used by both list and graph modes. Source for U6.
- `apps/admin/src/lib/wiki-palette.ts` — single source of truth for wiki page-type colors / badges / force-graph swatches. Stays in `apps/admin/src/lib/` for v1; `@thinkwork/graph` re-exports it.
- `apps/admin/src/lib/graphql-queries.ts:2179-2580` — `MemoryRecordsQuery`, `DeleteMemoryRecordMutation`, `MemorySearchQuery`, `MemorySystemConfigQuery`, `MemoryGraphQuery`, `WikiGraphQuery`, `WikiPageQuery`, `WikiBacklinksQuery`, `RecentWikiPagesQuery`, `WikiSearchQuery`, `KnowledgeBasesListQuery`, `KnowledgeBaseDetailQuery`. Carry the queries (not the mutations apps/computer doesn't use) into `apps/computer/src/lib/graphql-queries.ts`.
- `packages/database-pg/graphql/types/core.graphql:218` — `Query.me: User`. Returns `{ id, tenantId, email, name, ... }` for the caller. apps/computer reads `me.id` once and threads it through every Memory query. No tenantMembers / agents wiring needed.
- `apps/computer/src/routes/_authed/_shell.tsx` — existing shell (Sidebar + AppTopBar + Outlet). New routes mount inside it.
- `apps/computer/src/components/ComputerSidebar.tsx:43-49` — `PERMANENT_NAV` array. Add `Memory` entry between `Apps` and `Automations` per the existing visual hierarchy.
- `apps/computer/src/lib/graphql-queries.ts` — plain `gql` template literals (no codegen pipeline). Memory queries land here in U3.
- `apps/computer/src/context/AuthContext.tsx` + `TenantContext.tsx` — auth + tenant resolution already wired. `me` query works through the existing GraphQL client.
- `packages/ui/src/index.ts` — shared shadcn primitives (Sheet, ToggleGroup, DataTable, Select, Badge, AlertDialog, Input, Textarea, etc.). All needed UI primitives are already available; no new primitives need to be added to `@thinkwork/ui`.
- `packages/ui/package.json` — pattern for a workspace package: peer-deps for React + shadcn extras, `exports` map pointing at `./src/index.ts`. `packages/graph` mirrors this shape.

### Institutional Learnings

- `feedback_hindsight_async_tools` — Hindsight tool wrappers (recall/reflect) stay async with fresh client + aclose + retry. Not directly touched by this UI port (we're consuming `memoryRecords`, not calling `recall`), but worth checking when wiring `MemorySystemConfigQuery` since the `hindsightEnabled` flag determines whether the per-record edit button shows in admin (we drop edit entirely, so this only affects which copy the apps/computer Brain page shows when records can't be modified).
- `feedback_user_opt_in_over_admin_config` — Integration settings belong in mobile self-serve, not admin; admin owns infra only. KBs are tenant-wide infra → keep KB management in admin. apps/computer gets read-only listing.
- `feedback_pnpm_in_workspace` — Always use pnpm; never npm. Applies to the new `packages/graph` package's install + workspace add.
- `feedback_worktree_isolation` — If multiple sessions are in flight, do this work in a worktree off `origin/main`.
- `project_v1_agent_architecture_progress` — 22 PRs shipped in plan 008; ship-inert pattern is the prevailing style. This plan does NOT need ship-inert because it's a self-contained UI port with no runtime dependency on agents.
- `feedback_ship_inert_pattern` — does not apply here; integration is pure within the apps/computer client.

### External References

External research is not warranted. The pattern (3D ForceGraph component shared between two React apps in a pnpm workspace) is well-trodden inside the codebase and the components already exist; this is mostly extraction + restriction, not novel design.

### Slack Context

Not requested. Skip.

---

## Key Technical Decisions

- **`@thinkwork/graph` is a new workspace package** (not a folder under `packages/ui`). Force-graph rendering pulls in `react-force-graph-3d`, `three`, and `d3-force` — heavy deps that should not be peer-deps of the design system. Separate package keeps `@thinkwork/ui` lean and gives a clean import boundary.
- **Identity source = `me { id }`** (already in the GraphQL schema). apps/computer already authenticates via Cognito and `useAuth().user.sub` exists; querying `me` returns the DB-backed `User.id` that the Memory queries expect. We do *not* reuse admin's `tenantMembers` / `agents` queries since those are operator-shaped (build a per-tenant list of users).
- **Brain is read + forget only**, matching the v1 consolidated plan (origin R5 + D4). Drop the edit-textarea + `UpdateMemoryRecordMutation` wiring entirely. The admin UI shows different copy when Hindsight is disabled ("AgentCore memory records are immutable in this deployment"); apps/computer shows nothing — the Forget action is always available.
- **KB scope = read-only listing + read-only detail.** Knowledge bases are tenant-wide; an end user must not be able to delete one. Port the list and detail components but strip the create dialog, file upload, sync button, and delete confirm. Show "Manage knowledge bases in your operator console" copy where appropriate.
- **Search tab is out** for v1. Revisit when end users need cross-source semantic lookup (it's operator-debug shaped today).
- **ForceGraph extraction strategy = move-and-parameterize, not rewrite.** The two graph components share ~80% of their structure. Move both into `@thinkwork/graph` as-is, parameterize away the small differences (palette, label fn, force tuning, sphere-size formula), and keep the perf invariants (in-place opacity mute, one-shot camera init, stable `nodeThreeObject`) byte-for-byte intact. Do not refactor for theoretical reuse — only for the two real consumers.
- **Admin migrates to `@thinkwork/graph` in the same PR as the package extraction (U2).** Single source of truth from day one; avoids a window where admin and the new package drift. apps/admin's component files become re-export shims (or get deleted in favor of direct package imports — decided at U2 implementation based on call-site count).
- **Routes use TanStack Router's flat-dot convention** that apps/computer already uses — `_authed/_shell/memory.tsx` (layout), `_authed/_shell/memory.brain.tsx`, `_authed/_shell/memory.pages.tsx`, `_authed/_shell/memory.kbs.tsx`, `_authed/_shell/memory.kbs.$kbId.tsx`. Mirrors the existing `tasks.index.tsx` + `tasks.$id.tsx` pattern. No new routing primitives needed.
- **The `@thinkwork/graph` MemoryForceGraph + WikiForceGraph wrappers keep their urql `useQuery` calls.** urql is already a dependency of both apps; the new package declares it as a peer-dep. Alternative — strip urql out and pass the data graph in as a prop — was considered and rejected: the data plumbing is part of the value the wrappers provide, and both apps use the same urql client config.

---

## Open Questions

### Resolved During Planning

- **Tabs in scope** → Brain + Pages + KBs (Search deferred). Confirmed by user.
- **Shared package home** → New `@thinkwork/graph` workspace package. Confirmed by user.
- **Brain edit parity** → Read + Forget only; no edit. Confirmed by user.
- **KB scope** → Read-only listing + per-KB detail. Confirmed by user.
- **Identity source** → `me { id }` (existing in core.graphql). Decided here.
- **Routing convention** → Flat-dot under `_authed/_shell/memory.*`. Decided here.

### Deferred to Implementation

- Whether `apps/admin/src/components/MemoryGraph.tsx` and `WikiGraph.tsx` survive at the package boundary as one-line re-export shims, or are deleted in favor of direct `@thinkwork/graph` imports at every admin call site. Decided at U2 by counting admin import sites — if there are ≤ 2, switch them directly; if more, ship a shim to keep the admin diff minimal.
- Whether `wiki-palette.ts` moves into `@thinkwork/graph` or stays in `apps/admin/src/lib/`. v1 default is "stay where it is, the package re-exports it"; revisit when mobile or another consumer needs the palette.
- Whether to introduce a thin `useMyUserId()` hook in apps/computer or inline `me`-query usage at each Memory route. Default to a hook (dries up the loading-fallback boilerplate) but only one route may need it after all — decide at U3 implementation.
- Whether `memorySystemConfig` is needed at all on apps/computer. Admin uses `hindsightEnabled` to gate the Graph toggle and the edit button. apps/computer drops edit anyway, but the Graph toggle still depends on whether the entity graph exists. Default is "yes, query it"; if at U5 the answer is always "true" in deployed environments, drop the query and always show the Graph toggle.
- Whether the existing admin tab strip (`Brain | Pages | KBs | Search`) renders inside the apps/computer layout, or apps/computer uses its own composition (e.g., a vertical list in the AppTopBar). Default: same horizontal toggle group admin uses, just without the Search entry. Revisit at U4 layout implementation.

---

## High-Level Technical Design

### Package + route layout

```
packages/
  graph/                          (NEW — @thinkwork/graph)
    package.json
    src/
      index.ts                    # public exports
      ForceGraph3DCanvas.tsx      # shared rendering primitive
      MemoryForceGraph.tsx        # ported from apps/admin/src/components/MemoryGraph.tsx
      WikiForceGraph.tsx          # ported from apps/admin/src/components/WikiGraph.tsx
      palettes/
        memory-palette.ts         # TYPE_COLORS + MEMORY_COLOR + ENTITY_COLOR
        wiki-palette.ts           # re-exports apps/admin/src/lib/wiki-palette.ts (or moved later)

apps/admin/                       (admin migrates to consume @thinkwork/graph)
  src/components/MemoryGraph.tsx  → either deleted or one-line re-export shim
  src/components/WikiGraph.tsx    → either deleted or one-line re-export shim

apps/computer/                    (NEW Memory module)
  src/routes/_authed/_shell/
    memory.tsx                    # layout: tab strip (Brain | Pages | KBs) + Outlet
    memory.index.tsx              # redirect to /memory/brain
    memory.brain.tsx              # Table + Graph for the user's memories
    memory.pages.tsx              # Table + Graph for the user's wiki pages
    memory.kbs.tsx                # KB list (read-only)
    memory.kbs.$kbId.tsx          # KB detail (read-only doc list)
  src/components/memory/          # apps-local components if any
    BrainPage.tsx                 # if extracted from the route file
    PagesPage.tsx
    KbsPage.tsx
  src/lib/graphql-queries.ts      # +Me, +MemoryRecords, +Delete, +Search, +Graph, +Wiki*, +Kb*
  src/components/ComputerSidebar.tsx  # +Memory entry in PERMANENT_NAV
```

### Data flow per route

```
me { id } ──┬──► memoryRecords(userId)         ──► Brain Table
            ├──► memorySearch(userId, query)   ──► Brain Table (search mode)
            ├──► memoryGraph(userId)           ──► Brain Graph
            ├──► recentWikiPages(userId)       ──► Pages Table
            ├──► wikiSearch(tenantId,userId,q) ──► Pages Table (search mode)
            ├──► wikiGraph(tenantId, userId)   ──► Pages Graph
            └──► wikiPage(tenantId,userId,...) ──► WikiPageSheet (drawer)

tenantId ──► knowledgeBases(tenantId)          ──► KBs list
         └──► knowledgeBase(id)                ──► KB detail (read-only docs)
```

*This illustrates the intended data flow and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not a script to reproduce.*

### Why not extend `@thinkwork/ui` instead of creating `@thinkwork/graph`?

| Concern                              | `@thinkwork/ui` extension          | New `@thinkwork/graph`                       |
|--------------------------------------|------------------------------------|----------------------------------------------|
| three / d3-force / react-force-graph | added as peer-deps to design system | scoped to the one package that needs them    |
| Bundle size for a UI-only consumer   | grows even if unused (peer-dep)    | unaffected                                   |
| Boundary clarity                     | "ui" becomes a heterogeneous bag   | "graph" is a single-purpose package          |
| Future graph types (e.g. 2D, treemap)| `@thinkwork/ui/graph/...`          | `@thinkwork/graph/graph2d`, `@thinkwork/graph/treemap` |

The new-package option wins on every axis except "one fewer package to wire", which the workspace already absorbs cheaply.

---

## Implementation Units

### U1. Scaffold `@thinkwork/graph` workspace package

**Goal:** Create the empty package skeleton — `package.json`, `tsconfig.json`, `src/index.ts` placeholder — so the workspace recognizes it before any code moves in. Land this as a standalone unit so U2's diff is purely the move + parameterization.

**Requirements:** R6.

**Dependencies:** none.

**Files:**
- `packages/graph/package.json`
- `packages/graph/tsconfig.json`
- `packages/graph/src/index.ts`
- `pnpm-workspace.yaml` (verify the existing `packages/*` glob picks up the new directory; no edit if it does)

**Approach:**
- Mirror `packages/ui/package.json` shape: `"name": "@thinkwork/graph"`, `"private": true`, `"type": "module"`, `"main": "./src/index.ts"`, `"types": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }`.
- Declare `peerDependencies`: `react >= 19`, `urql ^5`, `@urql/core ^6`. Declare regular `dependencies`: `react-force-graph-3d ^1.29.1`, `three ^0.183.2`, `d3-force ^3.0.0`. Declare `devDependencies`: `@types/three`, `@types/d3-force`, `typescript`, `vitest`.
- `tsconfig.json` extends the repo's base; include `src/`.
- `src/index.ts` exports nothing yet (just a comment placeholder). U2 fills it.

**Patterns to follow:** `packages/ui/package.json` for the workspace package shape; `packages/ui/tsconfig.json` for the TS config.

**Test scenarios:** `Test expectation: none — pure scaffolding, no behavior. The signal that this unit landed correctly is U2 being able to import from `@thinkwork/graph` after `pnpm install`.`

**Verification:**
- `pnpm install` resolves the new workspace member without warning.
- `pnpm -r --if-present typecheck` passes (the empty `src/index.ts` typechecks).
- `pnpm --filter @thinkwork/graph build` is a no-op (no build script declared).

---

### U2. Move ForceGraph rendering into `@thinkwork/graph`; admin migrates to consume it

**Goal:** Move `apps/admin/src/components/MemoryGraph.tsx` and `WikiGraph.tsx` into `@thinkwork/graph`, factor the small differences into props, and update admin's call sites to import from the new package. Visual + interaction parity with admin today.

**Requirements:** R6, R8.

**Dependencies:** U1.

**Files:**
- Create: `packages/graph/src/MemoryForceGraph.tsx` (port of `apps/admin/src/components/MemoryGraph.tsx`)
- Create: `packages/graph/src/WikiForceGraph.tsx` (port of `apps/admin/src/components/WikiGraph.tsx`)
- Create: `packages/graph/src/palettes/memory-palette.ts` (extract `MEMORY_COLOR`, `ENTITY_COLOR`, `AGENT_COLOR`, `TYPE_COLORS` from `MemoryGraph.tsx`)
- Create: `packages/graph/src/palettes/wiki-palette.ts` (re-export from `apps/admin/src/lib/wiki-palette.ts` for v1; full move deferred — see Open Questions)
- Modify: `packages/graph/src/index.ts` (export the three components + the two palettes + the `MemoryGraphHandle` / `WikiGraphHandle` / `MemoryGraphNode` / `WikiGraphNode` types)
- Modify: `apps/admin/package.json` (add `"@thinkwork/graph": "workspace:*"` dependency)
- Delete or shim: `apps/admin/src/components/MemoryGraph.tsx`, `apps/admin/src/components/WikiGraph.tsx` (decision per "Open Questions / Deferred to Implementation")
- Modify: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (update import path)
- Modify: `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` (update import path)
- Test: `packages/graph/src/MemoryForceGraph.test.tsx`
- Test: `packages/graph/src/WikiForceGraph.test.tsx`

**Approach:**
- Move the two component files verbatim into the new package, preserving the perf-invariant patterns called out in `WikiGraph.tsx`'s header comment (in-place opacity mute, one-shot camera init, stable `nodeThreeObject`). **Do not "clean up" those without measuring** — they exist to avoid camera resets and simulation restarts.
- The urql `useQuery` calls move with the components. The new package declares `urql` as a peer-dep (both apps already use it).
- Move the inline color tables (`TYPE_COLORS` for memory, the wiki page-type colors) into `packages/graph/src/palettes/`. Keep the wiki palette as a re-export of `apps/admin/src/lib/wiki-palette.ts` for v1 — moving it requires touching the admin Wiki list + sheet that read it for non-graph badges; not in scope for this PR.
- Update admin's two call sites (`memory/index.tsx`, `wiki/index.tsx`) to import from `@thinkwork/graph`.
- If the admin component files are kept as one-line re-export shims (because there are other admin imports we missed), document why in the file header. Otherwise delete them.
- Tests verify the public API (component renders given fake graph data, `getNodeWithEdges` returns the expected shape, `refetch` triggers the supplied query). Heavy WebGL paths are not in scope for unit tests; admin's existing dev-server smoke is the integration check.

**Execution note:** This unit is a **mechanical move + import-path rewrite**, not a redesign. Resist the temptation to refactor the in-place opacity mute or the camera-init logic. The header comments explicitly call out that those patterns are load-bearing for filter-keystroke responsiveness.

**Patterns to follow:**
- `packages/ui` for workspace-package shape and TS config.
- The existing admin component file structure stays the same; only the path changes.

**Test scenarios:**
- `MemoryForceGraph` renders without crash given a fixture `{ nodes: [], edges: [] }` — empty-graph branch returns the `<Sparkles>` empty state.
- `MemoryForceGraph` renders a single-node fixture and the `nodeLabel` callback returns a string containing the node's label.
- `MemoryForceGraph.getNodeWithEdges(nodeId)` returns `{ node, edges: [] }` for a node with no incident edges.
- `MemoryForceGraph.getNodeWithEdges(unknownId)` returns `null`.
- `WikiForceGraph` 3-state classification: given a fixture with one matched node and one neighbor, the classifier returns `matched` for the search hit and `neighbor` for the 1-hop. Edges with two unmatched endpoints get muted opacity.
- Re-import from admin: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` and `wiki/index.tsx` typecheck against the new package's exports without changes other than the import path.

**Verification:**
- `pnpm --filter @thinkwork/graph test` is green.
- `pnpm --filter @thinkwork/admin typecheck` passes after import-path rewrite.
- `pnpm --filter @thinkwork/admin dev` boots; `/knowledge/memory` and `/knowledge/wiki` graphs render visually identical to before. Camera, colors, hover label, click-to-open-sheet all work.
- Filter keystrokes do not reset the camera or restart the force simulation (manual smoke — type into the search box and confirm the camera stays put).

---

### U3. Add `me` + Memory + Wiki + KB GraphQL queries to apps/computer

**Goal:** Land the GraphQL operations the new Memory module needs in `apps/computer/src/lib/graphql-queries.ts`. Pure plumbing — no UI yet.

**Requirements:** R1–R5.

**Dependencies:** none (independent of U1/U2; can land in parallel).

**Files:**
- Modify: `apps/computer/src/lib/graphql-queries.ts`
- Test: `apps/computer/src/lib/graphql-queries.test.ts` (new — single test that the gql template literals parse and have the expected operation names)

**Approach:**
- Copy these operations from `apps/admin/src/lib/graphql-queries.ts` (verbatim or near-verbatim — keep the same field selections so the apps stay in lockstep):
  - `MeQuery` — `query Me { me { id email name tenantId } }` (new — not present in admin's file under that name; admin uses tenantMembers/agents instead)
  - `MemoryRecordsQuery`
  - `MemorySearchQuery`
  - `MemoryGraphQuery`
  - `MemorySystemConfigQuery`
  - `DeleteMemoryRecordMutation`
  - `RecentWikiPagesQuery`
  - `WikiSearchQuery`
  - `WikiGraphQuery`
  - `WikiPageQuery`
  - `WikiBacklinksQuery`
  - `KnowledgeBasesListQuery`
  - `KnowledgeBaseDetailQuery`
- Do **not** copy `UpdateMemoryRecordMutation`, KB create/update/delete/sync mutations, or wiki bootstrap mutations. apps/computer is read+forget on memory and read-only on wiki/KB.
- Use the same `gql` from `@urql/core` import that the existing file uses. No codegen pipeline (apps/computer hasn't introduced graphql-codegen yet — that's deferred to a future slice when query count grows further).

**Patterns to follow:** existing `apps/computer/src/lib/graphql-queries.ts` — plain `gql` template literals.

**Test scenarios:**
- Each new exported `gql` template literal parses to a `DocumentNode` whose `definitions[0].name.value` matches the expected operation name (`Me`, `MemoryRecords`, `MemorySearch`, etc.).
- `DeleteMemoryRecordMutation`'s `definitions[0].operation` is `mutation`; everything else is `query`.

**Verification:**
- `pnpm --filter @thinkwork/computer typecheck` passes.
- `pnpm --filter @thinkwork/computer test` passes.
- Manual smoke (deferred to U5/U6 — needs UI to exercise the queries).

---

### U4. apps/computer Memory route layout + tab strip

**Goal:** Land the `/memory` shell — the route layout that hosts the Brain | Pages | KBs tab strip and an `<Outlet>` for the active tab. Index redirects to `/memory/brain`. No data, no graph yet.

**Requirements:** R1, R7.

**Dependencies:** none on the new package; can land in parallel with U2 since this unit doesn't import from `@thinkwork/graph`.

**Files:**
- Create: `apps/computer/src/routes/_authed/_shell/memory.tsx` (layout)
- Create: `apps/computer/src/routes/_authed/_shell/memory.index.tsx` (redirect to /memory/brain)
- Create: `apps/computer/src/routes/_authed/_shell/memory.brain.tsx` (placeholder — `<div>Brain coming in U5</div>`)
- Create: `apps/computer/src/routes/_authed/_shell/memory.pages.tsx` (placeholder — `<div>Pages coming in U6</div>`)
- Create: `apps/computer/src/routes/_authed/_shell/memory.kbs.tsx` (placeholder — `<div>KBs coming in U7</div>`)
- Modify: `apps/computer/src/routeTree.gen.ts` will regenerate automatically via the TanStack Router plugin during `pnpm --filter @thinkwork/computer build` or `dev`. Do not hand-edit.

**Approach:**
- The layout component renders a horizontal `ToggleGroup` (from `@thinkwork/ui`) with three items — Brain, Pages, KBs — wired via `<Link>` from `@tanstack/react-router`. Active item highlights based on `useRouterState().location.pathname`.
- Layout below the toggle is a flex column with `<Outlet />` filling remaining height. Mirrors admin's `flex h-full min-w-0 flex-col` pattern.
- The placeholder route files exist so TanStack's file-router can build the tree; their bodies are filled in U5/U6/U7.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/knowledge/memory.tsx` for the embedded-page pattern.
- `apps/computer/src/routes/_authed/_shell.tsx` for the layout+Outlet shape.
- TanStack Router's flat-dot file convention already used by `tasks.index.tsx` + `tasks.$id.tsx`.

**Test scenarios:**
- `apps/computer/src/routes/_authed/_shell/memory.test.tsx`: mount the layout with a mock `Outlet`, confirm three tab links rendered with the correct `to` props.
- `memory.index.tsx`: confirms the `beforeLoad` returns a redirect to `/memory/brain`.

**Verification:**
- `pnpm --filter @thinkwork/computer dev` boots; navigating to `/memory` redirects to `/memory/brain` and the three tabs render.
- Clicking each tab updates the URL; placeholder content shows for the inactive units.

---

### U5. apps/computer `/memory/brain` — Table + Graph (read + forget, single user)

**Goal:** Port admin's MemoryPage to apps/computer's `/memory/brain` with read + forget for the logged-in user only. No user-select, no edit, no multi-user fan-out.

**Requirements:** R2, R3, R6.

**Dependencies:** U2 (consumes `@thinkwork/graph`'s `MemoryForceGraph`), U3 (GraphQL queries), U4 (route layout exists).

**Files:**
- Modify: `apps/computer/src/routes/_authed/_shell/memory.brain.tsx` (replace placeholder with full BrainPage)
- Create: `apps/computer/src/components/memory/MemoryDetailSheet.tsx` (the right-side drawer for a memory record — read + delete confirm; no edit. Adapted from admin lines 622–790 with the edit/save branch stripped.)
- Create: `apps/computer/src/components/memory/MemoryGraphNodeSheet.tsx` (the right-side drawer for a graph node — node detail + edge re-anchor history. Adapted from admin lines 792–893.)
- Test: `apps/computer/src/routes/_authed/_shell/memory.brain.test.tsx`

**Approach:**
- Top-level component fetches `me { id }`. While loading, render the existing `<Spinner>` from `@thinkwork/ui`. If `me` is null after settling, render an empty state — the user's session is not fully resolved (very rare; covered by `TenantContext`'s NotReadyError path).
- A search input + Table | Graph toggle in the header (no user-select dropdown).
- Table mode: `MemoryRecordsQuery` with `userId = me.id, namespace = "all"`. Search mode: `MemorySearchQuery` with the same userId. Drop the multi-user fan-out (`fetchAllAgentRecords`) entirely. Drop the `selectedAgentId === "all"` branches.
- Graph mode: `<MemoryForceGraph userId={me.id} />` from `@thinkwork/graph`.
- Detail sheet (`MemoryDetailSheet`): show all metadata (factType, strategy, confidence, accessCount, proofCount, context, eventDate, mentionedAt, occurredStart, occurredEnd, tags, threadId link). The only write action is **Forget** with a confirm dialog → calls `DeleteMemoryRecordMutation`. After forget, refetch the records list.
- Graph node sheet (`MemoryGraphNodeSheet`): node label + connected edges + thread-link. Edge click re-anchors the sheet (same history-stack pattern admin uses, lines 845–889).
- Drop the `MemorySystemConfigQuery` gate on the Graph toggle — always show it. (If at implementation it turns out the graph is empty for managed-only deployments, re-introduce the gate.) See Deferred to Implementation in Open Questions.
- The page slots into the U4 layout via `<Outlet>`; no breadcrumb context needed since apps/computer doesn't have one.

**Execution note:** Brain table mode uses `<DataTable>` from `@thinkwork/ui`. Drop the `agentName` column entirely — every row is the logged-in user. Keep `Date | Type | Memory` (3 columns).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` for the structure (Table/Graph toggle, search, sheet, AlertDialog confirm). Strip the user-select + multi-user fan-out + edit branch.
- `parseMemoryTopics` and `stripTopicTags` helpers from admin lines 86–110: copy verbatim into `MemoryDetailSheet.tsx` (not into a shared util — they're small and only used here).
- `STRATEGY_COLORS` map (admin lines 168–181): copy into the brain page or a tiny `apps/computer/src/lib/memory-strategy.ts` if reused by the graph node sheet.

**Test scenarios:**
- Renders Loading state when `me` query is fetching.
- Renders empty state when `memoryRecords` returns `[]`.
- Renders 3 columns (Date / Type / Memory) — no User column.
- Clicking a row opens the detail sheet with the row's text and metadata.
- Detail sheet has a **Forget** button (no Edit button).
- Clicking Forget → confirm → calls `DeleteMemoryRecordMutation` with `{ userId: me.id, memoryRecordId }` and refetches the records list.
- Search input + Enter triggers `MemorySearchQuery` with the typed query; `<X>` clears search.
- Toggle to Graph mode renders `<MemoryForceGraph>` with `userId={me.id}`. (Mock the imported component to avoid WebGL in jsdom.)
- Clicking a graph node opens `MemoryGraphNodeSheet` with the node's label and edges.
- Clicking an edge in the graph node sheet re-anchors via `getNodeWithEdges` and the back-arrow appears.
- Test expectation for full WebGL render: none — covered by manual dev-server smoke at U2 verification.

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes.
- `pnpm --filter @thinkwork/computer dev` boots; `/memory/brain` shows the user's memories from dev. Forget removes a row; refresh confirms it's gone server-side.
- Graph mode renders the same 3D scene as admin's Brain Graph (mod the user-select scope), using the same colors and camera.

---

### U6. apps/computer `/memory/pages` — Table + Graph (read-only)

**Goal:** Port admin's WikiPage to apps/computer's `/memory/pages` — read-only Pages list + 3D wiki graph for the logged-in user.

**Requirements:** R2, R4, R6.

**Dependencies:** U2, U3, U4.

**Files:**
- Modify: `apps/computer/src/routes/_authed/_shell/memory.pages.tsx`
- Create: `apps/computer/src/components/memory/WikiPageDetailSheet.tsx` (port of `apps/admin/src/components/WikiPageSheet.tsx`)
- Test: `apps/computer/src/routes/_authed/_shell/memory.pages.test.tsx`

**Approach:**
- Same shape as U5: fetch `me { id }`, search input + Table | Graph toggle, no user-select.
- Table mode: `RecentWikiPagesQuery` with `userId = me.id`. Search mode: `WikiSearchQuery` with `tenantId, userId, query`.
- Graph mode: `<WikiForceGraph tenantId={tenantId} userId={me.id} />` from `@thinkwork/graph`.
- Detail sheet (`WikiPageDetailSheet`): same as admin's `WikiPageSheet` — `WikiPageQuery` for full body + sections + aliases; connected-edges list when opened from a graph node click. Re-anchor history identical to admin.
- Drop the `agentName` table column. Keep `Date | Type | Title`.
- Use `tenantId` from `useTenant()`.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` for structure.
- `apps/admin/src/components/WikiPageSheet.tsx` verbatim for the sheet body.

**Test scenarios:**
- Loading / empty / list states — same shape as U5.
- Renders 3 columns (Date / Type / Title) — no User column.
- Clicking a row opens `WikiPageDetailSheet` with the page's title + summary + sections + aliases.
- Connected-pages list rows are clickable (when opened from graph mode) and re-anchor the sheet.
- Search → `WikiSearchQuery` with `tenantId, userId, query, limit: 50`.
- Toggle to Graph renders `<WikiForceGraph>` with both tenantId and userId.
- Graph node click opens the page sheet pre-populated from `getNodeWithEdges`.

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes.
- Dev-server smoke: `/memory/pages` shows compiled wiki pages for the logged-in user. Click → sheet shows summary + sections. Toggle to Graph → matches admin's Wiki Graph behavior.

---

### U7. apps/computer `/memory/kbs` index + `$kbId` detail (read-only)

**Goal:** Port admin's KnowledgeBasesPage + KB detail to apps/computer as read-only — list the tenant's KBs, click into one to see its document list. No upload, no sync, no delete.

**Requirements:** R2, R5.

**Dependencies:** U3, U4. (Independent of U1/U2 since KBs don't use ForceGraph.)

**Files:**
- Modify: `apps/computer/src/routes/_authed/_shell/memory.kbs.tsx` (KB index)
- Create: `apps/computer/src/routes/_authed/_shell/memory.kbs.$kbId.tsx` (KB detail)
- Create: `apps/computer/src/lib/kb-files-api.ts` (read-only `listDocuments(kbId)` — POST `/api/knowledge-bases/files` with `{ action: "list", kbId }`. Adapted from `apps/admin/src/lib/knowledge-base-api.ts`. Drop upload + delete helpers.)
- Test: `apps/computer/src/routes/_authed/_shell/memory.kbs.test.tsx`

**Approach:**
- KB index: `KnowledgeBasesListQuery` with `tenantId`. Render `<DataTable>` from `@thinkwork/ui` with columns Name, Status, Docs, Last Sync, Description (drop the `New KB` button). Click row → navigate to `/memory/kbs/$kbId`.
- KB detail: `KnowledgeBaseDetailQuery` for the KB record + `listDocuments(kbId)` for the file list. Show status badge, embedding model, chunk strategy, sync status, document count. Show a list of documents (name + size + last modified). **No upload area, no delete buttons, no Sync button, no Edit form.** Show a small "Manage in operator console" caption with no link (operator-only context).
- Use `apiFetch` from `apps/computer/src/lib/api-fetch.ts` for the REST call.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/knowledge-bases/index.tsx` and `$kbId.tsx` for layout and data wiring; strip every mutation/upload/delete branch.
- `apps/computer/src/lib/api-fetch.ts` for the auth-bearer pattern.

**Test scenarios:**
- KB index renders empty state when `knowledgeBases` returns `[]` ("No knowledge bases — ask your operator to create one.")
- KB index renders KB rows; click navigates to `/memory/kbs/$kbId`.
- KB detail renders KB metadata (status, embedding model, doc count).
- KB detail does **not** render Upload, Delete, Sync, or Edit controls.
- KB detail document list renders rows from `listDocuments(kbId)`.
- KB detail handles 403/404 from `listDocuments` gracefully (show "documents unavailable" copy, not a blank page).

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes.
- Dev-server smoke: `/memory/kbs` shows the tenant's KBs. Click one → detail shows docs but no write buttons. Manually try opening admin's `/knowledge/knowledge-bases/$kbId` for the same KB to confirm parity on the read side.

---

### U8. Add Memory entry to ComputerSidebar; final smoke

**Goal:** Wire the Memory tab into apps/computer's permanent sidebar nav, between Apps and Automations. Update the existing sidebar test. Manual smoke confirms the full Memory module from a cold dev-server boot.

**Requirements:** R7.

**Dependencies:** U4 (the route must exist before the link is valid).

**Files:**
- Modify: `apps/computer/src/components/ComputerSidebar.tsx`
- Modify: `apps/computer/src/components/ComputerSidebar.test.tsx` (if it exists; if not, add a small one for the new entry)
- Modify: `apps/computer/src/lib/computer-routes.ts` (add `COMPUTER_MEMORY_ROUTE = "/memory"` constant alongside the existing `COMPUTER_TASKS_ROUTE`, etc.)
- Modify: `apps/computer/src/lib/computer-routes.test.ts` (add a check for the new constant)

**Approach:**
- Add to `PERMANENT_NAV` (lines 43–49 of `ComputerSidebar.tsx`): `{ to: "/memory", icon: Brain, label: "Memory" }`. Position between `Apps` and `Automations` so the visual order is `Computer | Tasks | Apps | Memory | Automations | Inbox`.
- `import { Brain } from "lucide-react"`.
- Active state already comes from the existing `pathname.startsWith("${item.to}/")` check; no changes needed.

**Patterns to follow:** existing `PERMANENT_NAV` entries.

**Test scenarios:**
- Sidebar renders the Memory entry between Apps and Automations.
- Memory entry's `to` is `/memory`; clicking it navigates there (active highlight matches when at `/memory/brain`, `/memory/pages`, `/memory/kbs`).
- `COMPUTER_MEMORY_ROUTE` constant equals `"/memory"`.

**Verification (manual smoke covering the whole plan):**
- `pnpm --filter @thinkwork/computer dev` boots cleanly.
- Sidebar shows the new Memory entry; clicking it lands on `/memory/brain`.
- Brain table renders the user's memories; Forget removes one and the row disappears after the network round-trip.
- Brain Graph renders; clicking a node opens the detail sheet; edge click re-anchors.
- Pages tab: same end-to-end with Pages instead of Brain.
- KBs tab: list renders; detail page renders metadata + docs; no write controls visible.
- Cross-app smoke: open admin `/knowledge/memory` and `/knowledge/wiki` in another tab — graphs still render correctly via `@thinkwork/graph` (catches accidental regressions in U2).

---

## System-Wide Impact

| Surface affected                 | Change                                                                                  |
|----------------------------------|-----------------------------------------------------------------------------------------|
| `apps/admin` Memory + Wiki pages | Imports change from `@/components/{Memory,Wiki}Graph` → `@thinkwork/graph`. No behavior change. |
| `apps/admin/src/components/{Memory,Wiki}Graph.tsx` | Either deleted or shimmed (decision at U2 implementation).                |
| `apps/admin/src/lib/wiki-palette.ts` | Stays in place; re-exported by `@thinkwork/graph/palettes/wiki-palette.ts`. Full move deferred. |
| `apps/computer`                  | New `/memory` route module + 3 new tabs + sidebar entry + ~13 new GraphQL operations.   |
| `packages/graph` (new)           | New workspace package shipping `MemoryForceGraph`, `WikiForceGraph`, `ForceGraph3DCanvas`, palettes. |
| `pnpm-workspace.yaml`            | Untouched if the existing `packages/*` glob already includes the new directory (verify at U1). |
| GraphQL schema                   | **No schema changes.** All operations already exist; this plan only adds new client-side documents. |
| Lambda / Terraform               | **No backend changes.**                                                                 |
| Mobile (`apps/mobile`)           | No changes; reconciliation with mobile's existing wiki browse surface is deferred follow-up. |

---

## Risks and Mitigations

| Risk                                                                                                                       | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                          |
|----------------------------------------------------------------------------------------------------------------------------|-----------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| The ForceGraph extraction subtly breaks admin's Memory or Wiki graph (camera reset on filter, color drift, broken sheet).  | Medium    | High   | U2 is mechanical move + import-path rewrite, not a redesign. Manual smoke against admin in U2's verification step. Header comments in `MemoryGraph.tsx` / `WikiGraph.tsx` calling out perf invariants are preserved verbatim.                                       |
| `me { id }` returns null during the Cognito hydration window and the Memory pages render before the user is known.        | Low       | Medium | Existing pattern: render Loading state until `me` settles, just like `TenantContext` already does for tenantId. No new mechanism needed.                                                                                                                            |
| Hindsight is disabled in some deployments → `memoryGraph` returns empty + `memoryRecords` returns only managed-AgentCore items, surprising the user. | Low | Low    | At U5 implementation, query `MemorySystemConfigQuery` and gate the Graph toggle the same way admin does today (only show when `hindsightEnabled`). If at implementation we find Hindsight is on everywhere, drop the gate and always show the toggle.               |
| KB read-only detail page feels broken because the user expects to be able to upload (admin operators are used to it).      | Low       | Low    | Show a small "Knowledge bases are managed by your operator" caption near the top of the detail page so the read-only state is intentional rather than appearing buggy.                                                                                              |
| `react-force-graph-3d` + `three` add ~600 KB to apps/computer's bundle (currently lean — no graph deps).                   | Medium    | Medium | The Memory route is code-split by TanStack Router (each `_authed/_shell/memory.*.tsx` is a separate chunk). The graph deps only load when the user navigates to `/memory/brain` or `/memory/pages` Graph mode. Validate at U5 with `pnpm --filter @thinkwork/computer build` bundle report. |
| `me { id }` query is cached across tenant switches (rare for end users but possible during operator impersonation flows).  | Very low  | Medium | apps/computer is end-user-only; impersonation is operator-only and goes through admin. Out of scope for this plan.                                                                                                                                                  |
| Test coverage is browser-only paths (urql + WebGL) and difficult to exercise in jsdom.                                     | High      | Low    | Mock `MemoryForceGraph` / `WikiForceGraph` in jsdom tests; rely on dev-server manual smoke for the real WebGL paths. Same compromise admin already makes.                                                                                                            |

---

## Documentation Plan

- No `docs/` site updates needed for this plan — the Memory module is self-documenting via the UI.
- Add a one-paragraph note to `packages/graph/README.md` (new) describing what it is, who consumes it, and the perf invariants implementers must preserve. Link to the ce-doc-review header comments already in the source files.
- After merge, update memory entry `project_v1_agent_architecture_progress.md` to reflect that the Memory module landed in apps/computer.

---

## Operational Notes

- **No backend deploy required** — this is a pure client-side change. After merge, dev environment refreshes automatically; production rolls forward with the next admin/computer build.
- **Cache busting** — both apps emit hashed bundle filenames; no CDN purge needed.
- **Bundle size monitoring** — at U5 verification, capture `pnpm --filter @thinkwork/computer build`'s bundle report and compare against pre-plan baseline. Flag if Memory route's chunk exceeds 800 KB gzipped.
- **Pre-commit gate** — `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` runs in CI. Local pre-commit hooks should pass before push.
- **PR sequencing** — U1 and U2 should land in one PR (workspace package without a consumer is dead code). U3 can land independently. U4–U8 can land sequentially or as a single PR depending on review-load preference; default to a single PR since the surfaces are tightly coupled and a half-shipped Memory tab has poor UX.
