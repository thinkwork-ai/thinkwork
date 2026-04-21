---
title: "refactor: Rename mobile Memories tab + component cluster to Wiki"
type: refactor
status: active
date: 2026-04-19
---

# refactor: Rename mobile Memories tab + component cluster to Wiki

## Overview

The home-screen pill labeled **Memories** in `apps/mobile` actually renders compiled wiki pages (`useRecentWikiPages`, `useMobileMemorySearch` → `mobileWikiSearch` on the server). The "memory" label is a holdover from before the wiki compile pipeline shipped and now clashes with the raw long-term memory system (AgentCore semantic/summary records + Hindsight workspace files). This plan renames the user-facing tab to **Wiki** and relocates the supporting component cluster so devs stop confusing "memory" (raw AgentCore/Hindsight) with "wiki" (compiled, user-browsable pages).

Scope is strictly the mobile app surface that backs this pill. The memory-capture verb (`CaptureFooter`, `useCaptureMobileMemory`, GraphQL `captureMobileMemory`) and the `/memory/*` routes that expose raw AgentCore records and Hindsight workspace files remain named as memory — they are the memory system.

## Problem Frame

In `apps/mobile/app/(tabs)/index.tsx` the segmented control reads `Threads | Memories`, but the "Memories" branch renders `CapturesList` (wiki pages) and a `CaptureFooter` search/add bar whose results are wiki hits. Empty state copy (`No memories yet`), placeholder (`Search memories…`), state variable names (`activeTab = "memories"`, `memoryQuery`), and the component directory (`apps/mobile/components/memory/`) all inherit the old framing.

Elsewhere in the codebase:
- `apps/mobile/app/memory/list.tsx` shows raw AgentCore memory records (`useMemoryRecords`, semantic/summary strategies) — this IS the memory system and stays named memory.
- `apps/mobile/app/memory/[file].tsx` / `edit-file.tsx` view and edit Hindsight workspace files — also raw memory surface, stays named memory.
- SDK hooks `useMobileMemorySearch` / `useCaptureMobileMemory` and their GraphQL counterparts (`mobileWikiSearch`, `captureMobileMemory`) live in a published package and are deliberately out of scope. Renaming them touches backend resolvers, lambdas, and package consumers.

The display components in `apps/mobile/components/memory/` (`CapturesList`, `WikiResultRow`) already render wiki data; only their location + `CapturesList`'s name misrepresent what they do. The capture components in that same directory (`CaptureFooter`, `CaptureRow`, `FactTypeChip`, `FactTypePicker`) describe the act of capturing a fact into the memory system — their names stay correct, but they currently only render inside the Wiki tab, so they move with the cluster.

## Requirements Trace

- R1. Pill labeled "Wiki" replaces "Memories" in the home-screen segmented control.
- R2. All wiki-tab user-facing copy reflects wiki framing (placeholder, empty states, accessibility labels).
- R3. Component files that render wiki data live under `apps/mobile/components/wiki/` with names that match their job.
- R4. Internal variable + state naming in `(tabs)/index.tsx` no longer implies raw memory when the value refers to the wiki tab.
- R5. `/memory/*` routes, `use-memory.ts`, and SDK/GraphQL surfaces remain unchanged.
- R6. `apps/mobile` still typechecks, lints, and renders after the rename (no dangling imports, no orphaned files).

## Scope Boundaries

- Mobile app only (`apps/mobile/**`). No admin, API, SDK, or backend changes.
- SDK hook names (`useMobileMemorySearch`, `useCaptureMobileMemory`, `useMobileMemoryCaptures`, `useDeleteMobileMemoryCapture`) and their GraphQL mutations/queries are not renamed here. Call-sites keep using the SDK's current exported names.
- Memory-capture semantics stay as "capture a memory" — `CaptureFooter` still says "Add new memory…", the toast still reads `Saved to <agent>'s memory`, `FactType` values and the fact picker keep their current copy. The capture pipeline still feeds the memory system; only the tab label changes.
- `apps/mobile/app/memory/*` routes, their copy, and `useMemoryRecords` usage are untouched.
- Icon choice (`IconBrain` for the empty state) is not changed in this plan; flagged as a small follow-up if product wants a different symbol for the wiki framing.

### Deferred to Separate Tasks

- **Rename SDK hooks + GraphQL fields from `mobileMemorySearch` / `captureMobileMemory` to wiki-aligned names**: separate PR that must coordinate backend resolver rename, SDK version bump, and admin app migration. Significantly higher blast radius than this UI rename.
- **Revisit whether "capture a memory" remains the right verb inside a tab called Wiki**: a product / copy decision rather than a rename. Revisit after the tab lands.
- **Icon rework for the wiki empty state** (`IconBrain` → something book/wiki-shaped): small design follow-up.
- **Delete `CaptureRow.tsx` if confirmed dead** after the move: Phase-1 scan shows no imports outside the file itself. Delete in this plan (see Unit 2) unless a blocker surfaces.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/app/(tabs)/index.tsx` — hosts the segmented control, `activeTab` state, `memoryQuery` state, `CapturesList`/`CaptureFooter` mounts, and the "Memories"-tab empty toast host.
- `apps/mobile/components/memory/CapturesList.tsx` — renders wiki pages from `useRecentWikiPages` + `useMobileMemorySearch`; this is the component whose filename is most misleading.
- `apps/mobile/components/memory/WikiResultRow.tsx` — already correctly named, moves with the cluster.
- `apps/mobile/components/memory/CaptureFooter.tsx` / `CaptureRow.tsx` / `FactTypeChip.tsx` / `FactTypePicker.tsx` — capture UI; names stay, path moves.
- `apps/mobile/app/memory/list.tsx` — untouched; demonstrates the retained "Memory" framing for AgentCore records.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — already uses `/wiki/...` routing; navigation from `CapturesList` already points there.

### Institutional Learnings

- `docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md` (active) mirrors the same "memory label is stale, swap to wiki" framing on the admin side. Same terminology split (raw = memory, compiled = wiki) should be respected here.

### External References

- None needed — rename within the mobile app with no new framework or API surface.

## Key Technical Decisions

- **Keep capture components grouped with wiki display under `components/wiki/`**: the capture bar only lives inside the Wiki tab, so a single feature-scoped directory is cleaner than introducing a `memory-capture/` folder that would reintroduce the overloaded term the user wants disambiguated. The *component names* (`CaptureFooter`, `FactTypePicker`) stay as-is because the action they describe (capturing a fact into memory) is unchanged.
- **Do not rename SDK hooks in this PR**: `useMobileMemorySearch` / `useCaptureMobileMemory` are exported from `@thinkwork/react-native-sdk` and tied to GraphQL field names. A mobile-only UI rename does not justify that blast radius. Call-sites continue to import the existing names.
- **Rename state values, not just labels**: `activeTab` value becomes `"wiki"`, `memoryQuery` becomes `wikiQuery`. Keeps grep-based navigation honest — a dev searching for "memory" in `(tabs)/index.tsx` should only find the capture toast line that still refers to the memory system on purpose.
- **Delete `CaptureRow.tsx` during the move** unless an import surfaces. A repo-wide grep found zero importers; keeping dead code during a rename increases cognitive load for no benefit.

## Open Questions

### Resolved During Planning

- Should `/memory/*` routes also be renamed? — **No.** `memory/list.tsx` renders AgentCore semantic records and `memory/[file].tsx` renders Hindsight workspace files; both are the raw memory system the user wants to keep named memory.
- Should the verb "capture a memory" change to "capture a fact" or similar? — **No, not in this plan.** That is a copy/product decision, separable from the tab rename. Flagged as a follow-up.
- Should `CaptureRow.tsx` be deleted? — **Yes**, unless Phase-2 verification finds an importer. No importers found during planning.

### Deferred to Implementation

- Exact final grep of `apps/mobile` after the rename to confirm no stray `components/memory` path survives — run during verification rather than pre-resolving.

## Implementation Units

- [x] **Unit 1: Rename tab label, copy, and state in the home screen**

**Goal:** Replace the user-visible "Memories" label and the associated state-variable vocabulary in `apps/mobile/app/(tabs)/index.tsx` without moving any files yet.

**Requirements:** R1, R2, R4

**Dependencies:** None.

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

**Approach:**
- Pill label: `Memories` → `Wiki` (the second `<Pressable>` in the segmented control).
- State type + values: `useState<"threads" | "memories">("threads")` → `useState<"threads" | "wiki">("threads")`; every `activeTab === "memories"` comparison flips to `"wiki"`.
- Rename `memoryQuery` / `setMemoryQuery` → `wikiQuery` / `setWikiQuery`. Update the `CapturesList` `searchQuery={...}` prop and the `CaptureFooter` `onSearchQueryChange={...}` prop wiring.
- `ToastHost` guard (`activeTab === "memories" ? <ToastHost … /> : null`) flips to `"wiki"` — keep it since capture toasts still fire from the wiki tab.
- Leave the comment on lines ~232–237 that explains the segmented-control split; update it to read "Threads | Wiki" so the code comment matches the UI.
- Leave the AsyncStorage cleanup comment and key (`thinkwork:capture-queue:v1`) alone — it refers to the memory capture queue, which is still a memory concept.

**Patterns to follow:**
- Existing segmented-control styling in the same file (no visual change).
- Same file's thread-tab naming (`threads` stays `"threads"`) — pattern is "tab state value matches the user-facing label, lowercased."

**Test scenarios:**
- Happy path: launch the app, segmented control shows `Threads | Wiki`; tapping Wiki still renders `CapturesList` with wiki pages and the capture bar underneath.
- Happy path: typing in the search placeholder (now "Search wiki…") and pressing send still routes the query into `useMobileMemorySearch`.
- Edge case: switching Threads → Wiki → Threads still clears the draft text correctly (existing two-draft behavior unchanged).
- Integration: capturing a new fact from the Wiki tab still triggers the toast `Saved to <agent>'s memory` (memory-system framing preserved in that copy).

**Verification:**
- `grep -n "memories" apps/mobile/app/\(tabs\)/index.tsx` returns no matches outside comments that intentionally reference the memory system (e.g., the AsyncStorage cleanup).
- Typecheck passes; the file renders in a local dev build on iOS simulator.

- [x] **Unit 2: Move + rename the wiki tab component cluster**

**Goal:** Relocate `apps/mobile/components/memory/` to `apps/mobile/components/wiki/`, rename `CapturesList` → `WikiList`, update the placeholder/empty-state copy inside those components, and remove the dead `CaptureRow.tsx`.

**Requirements:** R2, R3, R6

**Dependencies:** Unit 1 (call-site import path and `searchQuery`/state rename are already flipped).

**Files:**
- Create: `apps/mobile/components/wiki/WikiList.tsx` (renamed + relocated from `CapturesList.tsx`)
- Create: `apps/mobile/components/wiki/WikiResultRow.tsx` (moved)
- Create: `apps/mobile/components/wiki/CaptureFooter.tsx` (moved, name unchanged)
- Create: `apps/mobile/components/wiki/FactTypeChip.tsx` (moved)
- Create: `apps/mobile/components/wiki/FactTypePicker.tsx` (moved)
- Delete: `apps/mobile/components/memory/CapturesList.tsx`
- Delete: `apps/mobile/components/memory/WikiResultRow.tsx`
- Delete: `apps/mobile/components/memory/CaptureFooter.tsx`
- Delete: `apps/mobile/components/memory/FactTypeChip.tsx`
- Delete: `apps/mobile/components/memory/FactTypePicker.tsx`
- Delete: `apps/mobile/components/memory/CaptureRow.tsx` (unused; verify one more time at implementation time)
- Modify: `apps/mobile/app/(tabs)/index.tsx` (import paths only)

**Approach:**
- Inside the new `WikiList.tsx`:
  - Export `WikiList` (not `CapturesList`).
  - Interface rename `CapturesListProps` → `WikiListProps`.
  - Empty state copy: `No memories yet` → `No wiki pages yet`; `Loading memories...` → `Loading wiki…`; `No memories matching "…"` → `No wiki pages matching "…"`. Keep the `IconBrain` for now (see deferred icon rework).
  - Internal `console.warn` prefix: `[CapturesList]` → `[WikiList]`.
  - Internal `listKey`/remount logic stays as-is.
  - Import `WikiResultRow` from the new relative path (`./WikiResultRow`).
- Inside the moved `CaptureFooter.tsx`:
  - Placeholder copy: `Search memories...` → `Search wiki...` when `mode === "search"`. Keep `Add new memory...` when `mode === "add"` (the capture verb still refers to the memory system).
  - Accessibility labels: `Switch to add memory` → `Switch to add` or similar UI-neutral string (optional polish); `Choose memory type` → `Choose fact type` (matches `FactType` domain without re-adding "memory"). Keep `Saved to <agent>'s memory` toast.
- `CaptureRow.tsx`: verify no importers with a final grep (`grep -rn "CaptureRow" apps/mobile`), then delete. If an importer surfaces, stop and surface it for discussion rather than deleting blindly.
- Update `(tabs)/index.tsx` imports:
  - `CapturesList` from `@/components/memory/CapturesList` → `WikiList` from `@/components/wiki/WikiList`.
  - `CaptureFooter` from `@/components/memory/CaptureFooter` → from `@/components/wiki/CaptureFooter`.
  - Rename the JSX usage `<CapturesList … />` → `<WikiList … />`.
- Leave `apps/mobile/components/memory/` empty → delete the directory as part of the commit so it doesn't linger as a stale path.

**Patterns to follow:**
- Other feature-scoped component directories in `apps/mobile/components/` (e.g., `threads/`, `chat/`, `input/`, `layout/`) — each owns the components for a single tab or surface.

**Test scenarios:**
- Happy path: Wiki tab renders a list of recent wiki pages on cold load (same data as before).
- Happy path: entering a search query in the footer (`Search wiki...` placeholder) and submitting returns wiki hits.
- Edge case: empty search result → new copy reads `No wiki pages matching "<query>"`.
- Edge case: first-load empty wiki → new copy reads `No wiki pages yet` under the brain icon.
- Integration: adding a fact from the capture bar (`mode === "add"`) still calls `useCaptureMobileMemory` with the same arguments and produces the same toast `Saved to <agent>'s memory`.
- Regression guard: Threads tab untouched — still lists threads, still filterable, still archives.

**Verification:**
- `grep -rn "components/memory" apps/mobile` returns no matches.
- `grep -rn "CapturesList" apps/mobile` returns no matches.
- `apps/mobile/components/memory/` directory no longer exists.
- Typecheck + lint pass for `apps/mobile`.
- Local dev build on iOS simulator: Wiki tab loads, search works, capture works end-to-end.

- [x] **Unit 3: Final sweep + regression guard**

**Goal:** Catch stray references the first two units missed and leave a clean terminology boundary between "wiki tab surface" and "raw memory system".

**Requirements:** R5, R6

**Dependencies:** Units 1 and 2.

**Files:**
- No new files. Verification-only unit; any edits are opportunistic fixes of stragglers surfaced by the sweep.

**Approach:**
- Run `grep -rn -i "memor" apps/mobile --include="*.ts" --include="*.tsx"` and manually audit each remaining match. Expected keepers:
  - `apps/mobile/app/memory/**` (routes — intentional).
  - `apps/mobile/lib/hooks/use-memory.ts` (AgentCore memory records — intentional).
  - `apps/mobile/app/_layout.tsx` `Stack.Screen name="memory/..."` entries (route registration — intentional).
  - `apps/mobile/app/settings/agent-config.tsx` `router.push("/memory")` (links into the raw memory surface — intentional).
  - `apps/mobile/app/agents/[id]/profile.tsx` `router.push(\`/memory/${...}\`)` (workspace file link — intentional).
  - `CaptureFooter` toast + placeholder + `captureMobileMemory` call (intentional — capture verb still points at memory system).
  - SDK imports (`useMobileMemorySearch`, `useCaptureMobileMemory`, `MobileMemoryCapture`) — intentional, SDK rename deferred.
  - Wiki-page "This memory couldn't be loaded." copy inside `apps/mobile/app/wiki/[type]/[slug].tsx` — change to `This wiki page couldn't be loaded.` for consistency with the new framing. (Small opportunistic fix.)
- Unexpected matches (e.g., a `memories` string hiding in a test snapshot, a forgotten comment inside the moved components) → fix or delete case-by-case.
- Confirm iOS + Android simulator smoke: home screen → Wiki pill → tap a wiki result → detail page loads via existing `/wiki/[type]/[slug]` route.

**Test scenarios:**
- Regression: Threads tab unaffected — unread badge, filter bar, archive flow unchanged.
- Regression: `/memory` routes still reachable from `agent-config` and the agent profile and still render AgentCore records / Hindsight workspace files.
- Happy path: opening the app in dark mode and light mode both render the new "Wiki" pill with correct active/inactive styling (no styling regressions from the label swap).

**Verification:**
- Clean `grep` sweep — only the intentional memory references above remain.
- `pnpm --filter mobile typecheck` (or repo equivalent) passes.
- Manual smoke pass on iOS simulator covering: home tab switch, wiki search, wiki result tap, capture add, /memory/list navigation from settings.

## System-Wide Impact

- **Interaction graph:** Only `apps/mobile/app/(tabs)/index.tsx` and the component cluster under `components/memory/` are touched. Navigation into `/wiki/[type]/[slug]` still works because `CapturesList` / `WikiList` already routes to `/wiki/${type}/${slug}`.
- **Error propagation:** Unchanged — SDK error surfaces still flow to the same `toast.show` / `console.warn` calls, just inside renamed files.
- **State lifecycle risks:** None new. The `listKey` remount logic inside `WikiList` is preserved verbatim; the tab-switch draft isolation in `(tabs)/index.tsx` is preserved.
- **API surface parity:** No server, GraphQL, or SDK surface changes. Published SDK names stay the same.
- **Integration coverage:** The manual smoke in Unit 3 covers the cross-layer behavior (capture → memory system → wiki rerender) that unit-level rename tests cannot prove.
- **Unchanged invariants:**
  - `/memory/index`, `/memory/list`, `/memory/[file]`, `/memory/edit-file` routes and their copy ("Memory" titles, `No memory records yet` empty state).
  - `useMemoryRecords` / `useDeleteMemoryRecord` / `useUpdateMemoryRecord` hook names and call-sites.
  - SDK exports `useMobileMemorySearch`, `useCaptureMobileMemory`, `useMobileMemoryCaptures`, `useDeleteMobileMemoryCapture`, type `MobileMemoryCapture`, input `CaptureMobileMemoryInput`.
  - GraphQL field names (`mobileWikiSearch`, `captureMobileMemory`, etc.).
  - Capture toast copy `Saved to <agent>'s memory` — intentional; capture still means "write into the memory system."

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Missed import of `CaptureRow` surfaces after deletion | Run the final repo-wide grep during Unit 2; if any importer exists, preserve the component and note it for a follow-up rather than silently re-adding. |
| Stray test snapshot or Storybook-style fixture still references `CapturesList` or `components/memory` path | Unit 3 grep sweep catches these; fix inline. |
| Terminology drift if a future PR assumes the SDK rename happened | Scope Boundaries + System-Wide Impact section above documents the deferred rename explicitly so future authors know the asymmetry is intentional. |
| User confusion about captures being "memories" inside a tab called "Wiki" | Documented as a deferred product/copy question; the toast + `Add new memory…` placeholder still describe the action accurately because captures do flow into the memory system. |

## Documentation / Operational Notes

- No runtime behavior change, no feature flag, no schema migration, no rollout plan needed. Ship as a normal mobile release train item.
- If the app is built and shipped mid-rename, the screenshots in any external docs referencing the "Memories" pill will go stale. No known external doc in this repo references that pill by name (sweep before merge if concerned).

## Sources & References

- Related code: `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/components/memory/*`, `apps/mobile/app/memory/*`, `apps/mobile/app/wiki/[type]/[slug].tsx`, `packages/react-native-sdk/src/hooks/use-mobile-memory-search.ts`, `packages/react-native-sdk/src/hooks/use-capture-mobile-memory.ts`.
- Related plans: `docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md` (same wiki-vs-memory disambiguation on admin).
- Mobile test harness: local iOS simulator build + existing EAS TestFlight pipeline.
