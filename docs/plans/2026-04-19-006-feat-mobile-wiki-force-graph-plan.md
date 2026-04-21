---
title: "feat: Mobile Wiki force-graph viewer (Skia + d3-force + temporal scrub)"
type: feat
status: shipped-with-divergence
date: 2026-04-19
deepened: 2026-04-19
shipped: 2026-04-20
origin: docs/plans/archived/compounding-memory-mobile-memories-force-graph.md
---

# feat: Mobile Wiki force-graph viewer (Skia + d3-force + temporal scrub)

## Post-Implementation Status (2026-04-20)

**v1 shipped on TestFlight branch.** The plan body below captures the design we set out to build; what actually shipped diverges in important ways. This section is the authoritative "what's true now" summary. Read this first; the body is preserved for historical context.

> **v2 refinements shipped same day** as `docs/plans/2026-04-20-015-feat-mobile-graph-refinements-plan.md`: fit-to-view camera, centered-modal preview on tap (replacing the bottom sheet), 40/60 split embedded subgraph on the detail screen, icon unification with Tabler `IconTopologyStar3`, state persistence across navigation, and long-press-back → dismiss-all. Read that plan's Post-Implementation block alongside this one for the current state of the graph surface.

### What shipped
- **Pages-tab integration with toggle.** Graph view lives inside the Pages segment of the home tab (`apps/mobile/app/(tabs)/index.tsx`), not as a standalone route. Toggle button (Network / List icon) sits left of the filter funnel. Only visible when Pages tab is active.
- **All-pages default view.** Graph shows *every* active page in the active agent's scope via `wikiGraph` resolver (the same one admin's `/wiki` route uses). Wired through new `useWikiGraph` SDK hook.
- **Tap → bottom-sheet detail.** `NodeDetailSheet` opens with summary + sections from `useWikiPage`. Actions: "View full page" navigates to `/wiki/[type]/[slug]`; "Focus here" is a no-op for now (kept for future drill-down).
- **Search filter.** The shared "Search wiki…" composer dims non-matching nodes to 15% opacity in graph mode.
- **Skia 2.2.12 + d3-force 3.0 + Reanimated 4.1.1 camera** sustaining UI 60fps + JS 60fps on iPhone 17 Pro sim. New-arch worklets validated via Unit 0 spike.
- **`@expo-google-fonts/inter`** for canvas labels (Inter not previously bundled — corrected the PRD's wrong assumption). Labels later removed entirely; package retained for future LOD.
- **Three-shade type tokens** added to `apps/mobile/lib/theme.ts`: `wikiEntity` (sky), `wikiTopic` (amber), `wikiDecision` (violet) for both light + dark.
- **Force-layout tuning** for dense agent graphs: link distance 40, charge -80, collide 18, plus `forceX/Y(0).strength(0.08)` to keep stragglers near center (was a real issue — disconnected components drifted off-canvas).

### What diverged from the plan
- **Focal+depth model dropped.** The plan's headline interaction was focus on a page → expand k hops. Validation showed most focals were single-node lonely views. Swapped to all-pages default. `useFocusMode`, `GraphHeader`, `app/wiki/graph.tsx`, `app/wiki/[type]/[slug]/graph.tsx` all deleted in #281.
- **`wikiSubgraph` resolver + `useWikiSubgraph` hook deleted.** Built in PR #278 with the array-binding fix in #279, then made obsolete by the swap. Removed in #281. Git history retains for future drill-down work.
- **No `primary_agent_ids` migration.** The schema's `owner_id NOT NULL` invariant means every page is single-agent; `primary_agent_ids` would have been redundant. Resolver filters with `WHERE owner_id = $agentId` directly. (Saved a migration the plan called for.)
- **No Skia config plugin in `app.json`.** Skia v2 autolinks; the PRD's plugin requirement is outdated.
- **Inter font path:** used `@expo-google-fonts/inter` instead of manually bundling `Inter-Regular.ttf`. Same outcome, more idiomatic Expo.
- **Plan's "Units 1+2 can land in parallel" was wrong.** Unit 2 modifies files Unit 1 creates; they had to stack. PR #276 (the original Unit 3) was orphaned because of stacked-PR mechanics — re-opened as #278 against main.
- **Labels removed entirely** (after user feedback). PRD §F7 LOD logic never landed; page title shows in detail sheet on tap.

### Parked indefinitely (not done, may never be)
- **Unit 4: Label LOD + edge tap.** Edge detail sheet not built; labels off entirely. Revisit if user feedback says edges need first-class interaction.
- **Unit 5: Temporal scrub + schema migration.** `first_seen_at` / `last_seen_at` / `is_current` columns not added. The headline differentiator from the original PRD did not ship.
- **Unit 6: Layout stability + k-hop expansion.** Moot under the all-pages model — there's nothing to expand into.
- **Unit 7: `wiki_pinned_positions` + node drag.** Not built. Layout regenerates on every reload.
- **Unit 8: Hide branches, "Show all," accessibility pass, perf-budget verification.** Search-as-dim is the only "view organization" feature shipped. Accessibility labels exist on the toggle button but no comprehensive VoiceOver pass was done.

### Compile-side observation (load-bearing for any future graph work)
The graph viewer is bound by what `wiki_page_links` contains. As of 2026-04-20:

| Agent | Pages | With ≥1 link | % linked | Avg degree |
|---|---|---|---|---|
| Marco | 261 | 183 | **70%** | 2.97 |
| GiGi  | 849 | 392 | **46%** | 1.49 |
| Cruz  | 10  | 9   | 90%      | 3.40 |

**30–54% of pages are floating islands.** Sample of GiGi's unlinked entities: "Harmon Guest House," "Piazza Marina," "Bruges Beer Experience" — all leaf entities (restaurants, hotels). Compile is creating the entity page but not writing any `wiki_page_links` row connecting it to anything else. This is a **compile-pipeline ticket**, not a graph viewer one. Without denser linking, the visual story stays sparse no matter how the viewer is tuned.

### Shipped PRs
- #273 — Unit 1 scaffold + camera + theme + Skia + Inter
- #274 — Unit 2 d3-force sim + node tap + selection
- #278 — Unit 3 (re-do of orphaned #276): wikiSubgraph resolver + SDK hook + focal/detail
- #279 — fix: wikiSubgraph edges UUID array binding
- #280 — all-pages swap + label removal + force tuning
- #281 — chore: drop unused wikiSubgraph hook + resolver + GraphQL types

### Things to investigate before doing more graph work
1. Compile pipeline: why aren't entity-to-entity (or entity-to-User) links being written for leaf-entity restaurants, hotels, etc.? Possibly the planner's link-emission heuristics under-cover entities only mentioned in a single source.
2. TestFlight feedback before iterating further — real-device touch precision and pinch feel may surface things the simulator hides.

---

## Overview

Build a full-screen, GPU-rendered force-directed graph viewer for the mobile Wiki tab. Nodes are `wiki_pages` rows (Entity / Topic / Decision); edges are `wiki_page_links` rows. Render with `@shopify/react-native-skia`, lay out with `d3-force` on the JS thread, drive the camera via Reanimated shared values on the UI thread. Scope every read to the active agent. Headline differentiator is a **temporal scrub slider** that replays which links and pages held as-of any time in the past — backed by new `first_seen_at` / `last_seen_at` / `is_current` columns that this plan adds and the compile Lambda must populate.

V1 is a viewer/explorer, not an editor. Compile is the only author. The 8 implementation units below correspond 1:1 to PRs 5–12 in the origin PRD §8.

## Problem Frame

The compounding-memory pipeline now produces a usable knowledge graph (`wiki_pages` + `wiki_page_links`), but on mobile the user can only see flat lists and per-page detail surfaces. Plan `2026-04-19-003-refactor-admin-wiki-graph-plan.md` already replaced the admin force-graph data source with the same `wiki_pages` substrate (`packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts`), proving the wire shape works. Mobile needs the same browsing surface, but with three wrinkles desktop did not have:

1. **Touch-first interaction** at 60fps on phones — admin's `react-force-graph-3d` + `three` stack is too heavy to bring native.
2. **Focal + expand** as the interaction model (admin renders the full agent scope; mobile cannot).
3. **Temporal scrubbing** — the headline differentiator. The PRD (§5) carves a minimum schema addendum (`first_seen_at`, `last_seen_at`, `is_current` on `wiki_page_links`; `first_compiled_at` on `wiki_pages`) so a slider can replay the graph state as-of any past moment without losing history.

The PRD is detailed and largely correct, but several assumptions need reconciling:

- Component path in PRD §3.2 (`apps/mobile/components/memory/graph/`) is stale — the in-flight rename plan `2026-04-19-005-refactor-mobile-memories-to-wiki-plan.md` moves the cluster to `apps/mobile/components/wiki/`. New code lands at `apps/mobile/components/wiki/graph/`.
- Resolver path in PRD §3.3 (`packages/api/src/resolvers/wiki/`) is incorrect — actual path is `packages/api/src/graphql/resolvers/wiki/`, with a `.query.ts` / `.mutation.ts` suffix per the existing wiki resolver convention.
- PRD §2 claims "the app already ships Inter for chat; reuse it." No `.ttf`/`.otf` font asset exists under `apps/mobile/assets/`. Skia text rendering needs a real font file; this plan adds Inter via `expo-font` in Unit 1.
- PRD §F1 references "the sibling PRD's `TypeBadge` tokens" (sky / amber / violet). The sibling Memories UI PRD has not been turned into a plan yet, and `apps/mobile/lib/theme.ts` has no Entity/Topic/Decision tokens. This plan extends `theme.ts` with the three tokens itself in Unit 1; the sibling can adopt them when it lands.
- PRD §5 schema addendum overlaps with the sibling Memories UI PRD's `primary_agent_ids` migration. Whichever lands first owns the migration sequencing; this plan ships its temporal columns in their own migration that does not depend on `primary_agent_ids` — the `wikiSubgraph` resolver's `agentId` filter is conditional and degrades to "no agent filter" if the column is missing on first deploy.

## Requirements Trace

- **R1.** A user opens the Wiki tab → "Graph view" header action → graph mounts centered on a sensible default focal page within 500ms of data arrival (PRD §1 goal 1, §F5).
- **R2.** Pinch / pan / tap on iPhone 13 hold a 60fps frame budget across the supported zoom range `[0.2, 5]` (PRD §F2, §7.1).
- **R3.** Time slider scrubs `temporalCursor`; loaded edges/nodes restyle live to reflect link/page visibility as-of that moment (PRD §1 goal 3, §F8, §5).
- **R4.** Long-press / "Focus here" reseats the focal page; expand neighborhoods (Unit 6); pin nodes via drag (Unit 7); hide branches (Unit 8). Pin positions persist per `(tenant, agent, focal_page)`. "Collapse" in this v1 maps to "Hide branch," not a separate operation — true collapse-as-inverse-of-expand is deferred (PRD §1 goal 4, §F6, §F10, §F11).
- **R5.** Default focal resolution follows the deterministic priority list in PRD §F5 (route param > last-focused > highest-inbound entity > most recently compiled).
- **R6.** Every read and write is filtered by the active agent surfaced in the Wiki tab header (PRD §1 non-goal 7, §6 throughout). No cross-agent merge.
- **R7.** Read-only viewer. Compile is the only author of pages and links. No drag-to-connect, no inline edit (PRD §1 non-goals, §9).
- **R8.** New columns `wiki_pages.first_compiled_at`, `wiki_page_links.first_seen_at`, `wiki_page_links.last_seen_at`, `wiki_page_links.is_current` land in a backwards-compatible migration AND the compile Lambda is updated to populate them (PRD §5).
- **R9.** New `wiki_pinned_positions` table persists per-(`tenant`, `agent`, `focal_page`, `page`) layout positions (PRD §F10, §4.2).
- **R10.** Loading / empty / error / partial-failure states match PRD §F12 acceptance criteria.

## Scope Boundaries

- **Mobile (`apps/mobile`) + react-native-sdk + GraphQL/Postgres surfaces only.** No admin app changes; admin force graph is owned by plan 003.
- No authoring of pages, links, or properties. Compile owns authorship.
- No full-tenant graph render — focus + expand is the interaction model, with subgraph payload capped at 500 nodes per the open-question default in PRD §10.
- No non-force layouts (dagre, ELK, hierarchical). Single d3-force config in v1.
- No desktop / `react-native-web` rendering. Components should not actively prevent it but are not designed for it.
- No real-time collaborative cursors, no offline editing, no cross-agent graph merging.
- No per-node Reanimated shared values. Camera transform is the only shared-value path. Layout sim mutates plain JS node objects and triggers throttled React renders. Only escalate to per-node shared values if measured frame-budget problems on iPhone 13 force it (PRD §3.1).
- No graph-to-image export, no mini-map, no search-within-graph (`wikiSearch` already covers search on the list surface).

### Deferred to Separate Tasks

- **Sibling Memories UI PRD as a plan**: the list / detail / capture / `RelationshipChips` / `RelationshipGraph` surfaces in `docs/plans/archived/compounding-memory-mobile-memories-ui-prd.md` are a prerequisite for the "Graph view" header entry point. Until that plan lands, the graph is reachable from a temporary placeholder route (see Unit 3). The sibling plan also adds `primary_agent_ids` on `wiki_pages`; this plan tolerates its absence (see Unit 3 approach).
- **Android polish + perf tuning**: this plan targets iPhone 13 first per PRD §7.1. Android validation is a follow-up.
- **Removing the legacy `wikiGraph` resolver**: plan 003 already ships `wikiGraph` and is the active admin surface; not deprecated by this plan.
- **Subtype glyphs (person / building / folder / repo) for Entity nodes**: depends on the compile Lambda tagging `EntityProfileFragment` subtype on the warehouse record (PRD §10 question 6). Render no glyph until that lands.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/app/_layout.tsx` — already wraps the tree in `GestureHandlerRootView` + `BottomSheetModalProvider`. No additional setup needed for gestures or bottom sheets.
- `apps/mobile/babel.config.js` — `react-native-reanimated/plugin` is registered. Reanimated `~4.1.1` is in `package.json`. Verify Skia v2.x compatibility with Reanimated 4's worklet system in Unit 1; v4 changed the worklet runtime and a Skia bump may be required.
- `apps/mobile/app.json` — current `plugins` block lists `expo-router`, `expo-web-browser`, `expo-speech-recognition`, `expo-notifications`. The Skia Expo plugin must be appended.
- `apps/mobile/lib/theme.ts` — current `COLORS.dark`: `background "#000000"`, `card "#171717"`, `secondary "#262626"`, `mutedForeground "#a3a3a3"`. No `sky` / `amber` / `violet` tokens — extend in Unit 1.
- `apps/mobile/components/PromptTemplateSheet.tsx` — pattern source for `@gorhom/bottom-sheet` usage (`BottomSheet`, `BottomSheetScrollView`, `BottomSheetBackdrop`). Detail sheet in Units 3–4 mirrors this shape.
- `apps/mobile/components/threads/ThreadRow.tsx` — local example of `Gesture.Pan()` + `GestureDetector` driving Reanimated shared values; structurally similar to the camera gesture flow in Unit 1.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — wiki detail page using `useWikiPage`. Detail-sheet body in Unit 3 should reuse the same `useWikiPage` hook so wiki-page rendering stays single-sourced.
- `apps/mobile/app/memory/index.tsx:27-31` — current "active agent" resolution pattern (`useAgents(tenantId)` → filter non-local → prefer team role → fallback to first). The Wiki tab will use the same resolver; pass `activeAgent.id` into `useWikiSubgraph`.
- `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts` — load-bearing reference for the new `wikiSubgraph` resolver. Same Drizzle `sql\`\`` raw-SQL pattern, same `assertCanReadWikiScope(ctx, { tenantId, ownerId })` auth shim, same shape for endpoint counting.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — canonical pattern for `resolveCallerTenantId(ctx)` fallback when `ctx.auth.tenantId` is null for Google-OAuth users (load-bearing — see institutional learning below).
- `packages/api/src/graphql/resolvers/wiki/auth.ts` — `assertCanReadWikiScope` helper to reuse across all new resolvers.
- `packages/api/src/graphql/resolvers/wiki/mappers.ts` — `toGraphQLPage` / `toGraphQLType` mappers to reuse for shaping `WikiSubgraph.nodes`.
- `packages/database-pg/src/schema/wiki.ts` — Drizzle schema for `wiki_pages` (currently has `last_compiled_at`, no `first_compiled_at`) and `wiki_page_links` (currently has `id`, `from_page_id`, `to_page_id`, `kind`, `context`, `created_at`; no temporal columns).
- `packages/database-pg/graphql/types/wiki.graphql` — extend here, do not create a parallel schema file. Already houses `WikiPage`, `WikiPageType`, `WikiSearchResult`, `WikiGraph`, `WikiGraphNode`, `WikiGraphEdge`.
- `packages/api/src/lib/wiki/compiler.ts` + `packages/api/src/handlers/wiki-compile.ts` — compile Lambda entry point and orchestration. The temporal write-seam (`upsertPageLink` and friends) lives under `packages/api/src/lib/wiki/` repository functions; Unit 5 modifies these.
- `packages/react-native-sdk/src/hooks/use-wiki-page.ts` — canonical hook shape: `useQuery` from `urql`, `pause: !arg`, `requestPolicy: "cache-and-network"`, returns `{ page, loading, error, refetch }` (note the SDK-level rename of `fetching` → `loading` — PRD §4.3 specifies `fetching` but actual hooks expose `loading`; new hooks must follow the existing convention, not the PRD draft).
- `packages/react-native-sdk/src/index.ts` — manual barrel re-exports per hook; new hooks must be added explicitly. Current SDK version is `0.2.0-beta.2`; this plan publishes `0.4.0-beta.0` per the PRD's `sdk-v*` convention (jumping over `0.3.0-beta.0` which the sibling Memories UI PRD claims).
- `docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md` — companion admin work; pattern source for `(tenant, owner)` scoping and `kind`-deduped link counting.
- `docs/plans/2026-04-19-005-refactor-mobile-memories-to-wiki-plan.md` — in-flight mobile rename. This plan inherits its `apps/mobile/components/wiki/` directory.

### Institutional Learnings

- **OAuth tenantId resolver** (memory: `feedback_oauth_tenant_resolver`): `ctx.auth.tenantId` is null for Google-federated users like Eric. Every new resolver scoped by tenant must call `resolveCallerTenantId(ctx)` as a fallback. Mirror `recentWikiPages.query.ts:30`. Cognito pre-token trigger has not landed yet.
- **Worktree isolation** (memory: `feedback_worktree_isolation`): land each unit's PR in its own `.claude/worktrees/<name>/` off `origin/main`. Main checkout has multiple in-flight streams and switching branches in it loses other contributors' work.
- **Diff stale main-tree changes vs origin** (memory: `feedback_diff_against_origin_before_patching`): before resuming any in-progress unit, fetch and diff each touched file vs `origin/main`. Another session may have already merged it.
- **Verify wire format empirically** (memory: `feedback_verify_wire_format_empirically`): before committing client code that depends on `wikiSubgraph`'s field casing, curl the dev endpoint and confirm each field name round-trips. Schema files alone have lied to us before.
- **GraphQL Lambda deploys via PR** (memory: `feedback_graphql_deploy_via_pr`): never `aws lambda update-function-code graphql-http` directly. Merge to `main` and let the pipeline ship.
- **Read diagnostic logs literally** (memory: `feedback_read_diagnostic_logs_literally`): when temporal-scrub re-fetches misbehave, treat any unexpected timestamp width or off-by-one in the logged `atTime` as the bug, not noise.
- **Avoid fire-and-forget Lambda invokes** (memory: `feedback_avoid_fire_and_forget_lambda_invokes`): the compile-Lambda update in Unit 5 is a re-deploy of an existing async pipeline, not a new fire-and-forget call from the user path. Position-pin upserts in Unit 7 are user-driven; use `RequestResponse` so failures surface immediately.

### External References

- PRD origin: `docs/plans/archived/compounding-memory-mobile-memories-force-graph.md` — primary source of truth for feature acceptance criteria; section references `(see origin: docs/plans/archived/compounding-memory-mobile-memories-force-graph.md §F1)` are used throughout this plan.
- Sibling PRD (not yet a plan): `docs/plans/archived/compounding-memory-mobile-memories-ui-prd.md` — defines `primary_agent_ids` migration and `TypeBadge` tokens.

## Key Technical Decisions

- **Three-thread architecture** (PRD §3.1): Skia GPU rendering, d3-force layout on JS thread, camera transform on UI thread via Reanimated shared values. Layout mutates plain `node.x` / `node.y` objects and bumps a `setTick` counter at 30Hz to throttle React renders. Do not promote per-node positions to Reanimated shared values unless an iPhone 13 frame-budget violation is measured. Rationale: shared values are expensive to allocate per frame at scale; the cheap-by-default architecture works for ≤500-node payloads.
- **Component root is `apps/mobile/components/wiki/graph/`**, not `components/memory/graph/` as PRD §3.2 says. The in-flight rename in plan 005 moves the parent cluster. Coordinating with plan 005 avoids creating a stale `components/memory/` re-introduction.
- **Resolver path is `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.ts`** (with `.query.ts` / `.mutation.ts` suffix), not `packages/api/src/resolvers/wiki/wikiSubgraph.ts` as PRD §3.3 says. The existing wiki resolver directory uses the suffix convention; the PRD draft predates that convention.
- **SDK hook return shape stays `{ data, loading, error, refetch }`**, not `{ data, fetching, error, refetch }` as PRD §4.3 specifies. The existing SDK hooks expose `loading` (renamed from urql's `fetching`); breaking that convention for three new hooks would orphan them. Hook-level rename happens at the hook boundary.
- **SDK version jump**: this plan publishes `@thinkwork/react-native-sdk@0.4.0-beta.0`. Sibling Memories UI PRD claims `0.3.0-beta.0`; this plan reserves the next minor regardless of which lands first. Both are minor bumps because each adds new public hooks (per the `sdk-v*` publish convention).
- **`primary_agent_ids` is a hard prerequisite — no silent-degrade**: the agent filter is the tenant-isolation primitive in this plan (R6). If the column is missing at deploy time, the resolver hard-fails when `agentId` is supplied; it does NOT silently widen scope. Unit 3 ships the `primary_agent_ids` migration itself (additive, idempotent — uses `IF NOT EXISTS`) so this plan is not gated on the sibling Memories UI PRD landing first. If the sibling already shipped the column, Unit 3's migration is a no-op and the resolver uses what's there. Rationale: "log a warning and degrade" was tempting but fails the "no cross-agent merge" invariant in the PRD's own §1 non-goal 7.
- **Inter-Regular.ttf is bundled via `expo-font`**: PRD assumption that Inter already ships is wrong. Add the `.ttf` to `apps/mobile/assets/fonts/Inter-Regular.ttf`, register via `expo-font`'s `useFonts` hook, and pass the loaded `SkFont` into Skia's `<Text>` blocks. Falls back to the system font if loading fails so the canvas still renders.
- **Theme tokens added in `apps/mobile/lib/theme.ts`**: extend `COLORS.dark` with `wikiEntity: "#38bdf8"` (sky-400), `wikiTopic: "#fbbf24"` (amber-400), `wikiDecision: "#a78bfa"` (violet-400), plus light-mode equivalents. Tokens live in `theme.ts` so the sibling Memories UI PRD can reuse them for `TypeBadge`.
- **Subgraph payload ceiling = 500 nodes — graceful degradation, not hard error** (PRD §10 question 2 default). When the unfiltered subgraph would exceed 500 nodes, the resolver returns the top-500 prioritized by `(inbound_link_count DESC, last_compiled_at DESC)` and sets `hasMore[focalId] = true` so the client renders an "expand" affordance. Hard-erroring on hub focals like the user's own Entity page would make the most useful focals unreachable.
- **Edge id is the existing `wiki_page_links.id` UUID** (PRD §10 question 3 default). Resolver fails loudly if any link row has a null id; no derived/surrogate ids.
- **Temporal slider range = `[earliest first_seen_at across loaded edges, min(now, latest last_seen_at + 1h)]`** (PRD §10 question 4 default). The `+ 1h` right-pad avoids a dead zone at "now."
- **Hidden branch UX = de-emphasize at 10% opacity** (PRD §10 question 5 default). Removing nodes from the layout would collapse spatial context the user relies on.
- **Position persistence keying = `(tenant_id, agent_id, focal_page_id, page_id)`** (PRD §F10). Auto-save the full layout once the sim quiesces (alpha < 0.01 for 2s) on first load of a focal page, so subsequent opens don't relayout. User-pinned positions are tracked with `pinned = true` so future "auto-relayout" features can preserve them while clearing seed positions.
- **Worktree per unit**: each of the 8 units below ships in its own PR from a dedicated worktree (`.claude/worktrees/wiki-force-graph-<unit-name>/`). Units 1–2 can land in parallel; Unit 3 depends on Units 1–2; Units 4–8 each depend on the previous landing.

## Open Questions

### Resolved During Planning

- **Component path** — `apps/mobile/components/wiki/graph/` per plan 005's rename, not the PRD's stale `components/memory/graph/`.
- **Resolver path** — `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.ts` per existing convention, not the PRD's `packages/api/src/resolvers/wiki/wikiSubgraph.ts`.
- **Hook return shape** — `{ data, loading, error, refetch }` per existing SDK convention, not PRD's `fetching`.
- **OAuth tenant resolution** — every new resolver uses `resolveCallerTenantId(ctx)` fallback. Memory `feedback_oauth_tenant_resolver` has bitten us multiple times.
- **Default focal resolution priority** — simplified from PRD §F5 to: (1) route param, (2) last-focused from AsyncStorage, (3) most recently compiled Entity for this agent. The PRD's priority-2 ("highest-inbound Entity") is dropped — building it requires either a denormalized `inbound_link_count` column or a `GROUP BY to_page_id` query that doesn't yet exist; not worth the Unit 3 scope expansion. Reinstate as follow-up if priority-3 picks badly in practice.
- **Subgraph payload ceiling** — 500 nodes; expand to grow.
- **Edge id stability** — require `wiki_page_links.id`; fail loudly if missing.
- **Temporal slider range bounds** — `min(now, latest last_seen_at + 1h)` to avoid right-edge dead zone.
- **Hidden branch UX** — de-emphasize at 10% opacity (preserve spatial context).
- **Entity subtype glyph source** — render no glyph in v1; depends on compile Lambda tagging subtype, which is a separate ask.
- **Cross-agent graph views** — explicitly v1.1+, not now.
- **Inter font shipping** — bundle `Inter-Regular.ttf` via `expo-font` in Unit 1; PRD assumption that it already ships is wrong.
- **Reanimated 4 + Skia compatibility** — promoted to Unit 0 precondition (binary outcome gates everything else). No silent fallback; red outcome escalates to Eric.

### Deferred to Implementation

- **Exact d3-force tuning constants** (alpha decay, link distance multiplier, charge strength, collide radius). Will tune against synthetic 10/100/500-node fixtures in Unit 2 and re-tune against real subgraphs in Unit 6.
- **Skia node rendering primitive choice** — `<Circle>` vs filled `<Path>` vs `<Group>` with sub-glyphs. Decide based on Unit 1 perf measurement.
- **Whether `edgeCount` on a node should drive node radius** — start uniform; add weighting in Unit 6 if visual hierarchy is unclear.
- **Whether the auto-save-on-quiesce in Unit 7 should be opt-in** (toggle in graph header) — gather feedback after first internal use; default to on.
- **Whether to ship a "Reset layout" header action** alongside "Show all" / "Now" — flagged as polish in Unit 8 if user testing surfaces a need.
- **Final kind-aware semantics for `wiki_page_links.kind`** in the subgraph (currently `reference` / `parent_of` / `child_of`) — Unit 3 starts by treating all `kind` values uniformly with the existing `DISTINCT (from_page_id, to_page_id)` dedupe pattern from `wikiGraph.query.ts`. Per-kind styling can layer on later.
- **Migration backfill window for `first_seen_at`** on existing `wiki_page_links` rows — Unit 5 uses `DEFAULT now()` which loses pre-deploy history. If product wants pre-deploy history reconstructed from `wiki_section_sources.first_seen_at`, that's a separate backfill script.

## Output Structure

```
apps/mobile/
├── app/
│   └── wiki/
│       ├── graph.tsx                               (new)
│       └── [type]/
│           └── [slug]/
│               └── graph.tsx                       (new)
├── assets/
│   └── fonts/
│       └── Inter-Regular.ttf                       (new)
├── components/
│   └── wiki/                                       (post plan 005)
│       └── graph/                                  (new)
│           ├── KnowledgeGraph.tsx
│           ├── GraphCanvas.tsx
│           ├── GraphHeader.tsx
│           ├── TemporalControl.tsx
│           ├── EdgeDetailSheet.tsx
│           ├── NodeDetailSheet.tsx
│           ├── types.ts
│           ├── hooks/
│           │   ├── useForceSimulation.ts
│           │   ├── useGraphCamera.ts
│           │   ├── useFocusMode.ts
│           │   ├── useTemporalCursor.ts
│           │   └── useViewOrganization.ts
│           ├── layout/
│           │   ├── hitTest.ts
│           │   ├── transitions.ts
│           │   └── typeStyle.ts
│           └── index.ts
└── lib/
    └── theme.ts                                    (modify — add wiki* tokens)

packages/
├── database-pg/
│   ├── graphql/types/
│   │   └── wiki.graphql                            (modify — add WikiSubgraph etc.)
│   ├── migrations/
│   │   ├── XXXX_wiki_temporal_columns.sql          (new)
│   │   └── YYYY_wiki_pinned_positions.sql          (new)
│   └── src/schema/
│       └── wiki.ts                                 (modify)
├── api/src/
│   ├── graphql/resolvers/wiki/
│   │   ├── wikiSubgraph.query.ts                   (new)
│   │   ├── wikiPinnedPositions.query.ts            (new)
│   │   ├── upsertWikiPinnedPositions.mutation.ts   (new)
│   │   └── index.ts                                (modify — register)
│   └── lib/wiki/
│       ├── compiler.ts                             (modify — temporal writes)
│       └── repo/                                   (modify — link upsert)
└── react-native-sdk/
    ├── src/
    │   ├── hooks/
    │   │   ├── use-wiki-subgraph.ts                (new)
    │   │   ├── use-wiki-pinned-positions.ts        (new)
    │   │   └── use-wiki-update-pin.ts              (new)
    │   ├── graphql/queries/
    │   │   └── wiki-subgraph.ts                    (new — query+mutation docs)
    │   └── index.ts                                (modify — barrel re-export)
    └── package.json                                (modify — version bump 0.4.0-beta.0)
```

This is a scope declaration; the implementer may collapse files (e.g., merge `EdgeDetailSheet` + `NodeDetailSheet`) if a tighter shape emerges.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Three-thread responsibility split

```
┌───────────────────────────── UI thread (Reanimated worklets) ─────────────────────────────┐
│  Gesture.Pan / Gesture.Pinch  ──→  shared values { tx, ty, scale }                        │
│                                                                                            │
│  ⟶ Skia <Group transform={ useDerivedValue(tx,ty,scale) }> reads SVs each frame           │
│    (camera = 60fps regardless of JS-thread cost)                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                              ▲                                  ▲
                              │ tap (x,y) → runOnJS              │ paint
                              ▼                                  │
┌─────────────────────────── JS thread (React + d3-force) ──────────────────────────────────┐
│  useWikiSubgraph(focalPageId, depth, atTime, agentId)  ─→  WikiSubgraph payload           │
│                                                                                            │
│  useForceSimulation(nodes, edges)                                                          │
│    ├─ d3-force tick → mutates node.x, node.y in place                                     │
│    └─ throttled setTick (30Hz) → triggers React re-render                                 │
│                                                                                            │
│  hitTest.screenToWorld(camera, x, y) → nearestNode | nearestEdge                           │
│  layout/transitions.ts → applyDataUpdate(prev, next) → preserve positions                  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ data
                              ▼
┌──────────────────────────── Server (GraphQL + Postgres) ──────────────────────────────────┐
│  wikiSubgraph(tenantId, focalPageId, depth, atTime, agentId)                              │
│    ├─ assertCanReadWikiScope(ctx, …)                                                       │
│    ├─ recursive CTE walks wiki_page_links from focalPageId up to depth hops               │
│    ├─ filters by primary_agent_ids @> ARRAY[agentId]::uuid[] (when column exists)         │
│    ├─ filters by first_seen_at ≤ atTime (when atTime supplied)                            │
│    └─ returns nodes + edges + hasMore[pageId]                                              │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### Temporal filter semantics (Unit 5)

| `atTime` cursor relative to row | Edge render               | Node render                |
|---------------------------------|---------------------------|----------------------------|
| `cursor < firstSeenAt`          | not rendered (didn't exist)| not rendered if `cursor < firstCompiledAt` |
| `firstSeenAt ≤ cursor ≤ lastSeenAt` AND `is_current` | full opacity solid line | full opacity |
| `firstSeenAt ≤ cursor < lastSeenAt` AND NOT `is_current` | dashed, 30% opacity (past-invalidated) | n/a |
| `cursor > lastSeenAt` AND NOT `is_current` | dashed, 30% opacity | 40% opacity if `status=ARCHIVED && lastCompiledAt < cursor` |

## Implementation Units

- [x] **Unit 0: Reanimated 4 + Skia v2 worklet compatibility spike (precondition) — GREEN ✓ (2026-04-19)**

**Outcome:** Skia `2.2.12` + `react-native-reanimated@~4.1.1` + `react-native-worklets@0.5.1` build, link, and run cleanly on Expo SDK 54 / RN 0.81.5 / new arch. Spike screen renders 30 nodes + edges in a ring; `useDerivedValue` reading shared values writes correctly into Skia's `<Group transform>`; `Gesture.Pan` + `Gesture.Pinch` (Simultaneous) sustain **UI thread 60fps + JS thread 60fps** on iPhone 17 Pro simulator (iOS 26.2) with continuous fling/pinch. Pinch-around-focal-point math holds. Scale clamping to `[0.2, 5]` works. **Units 1–8 cleared to proceed.** Spike code: `apps/mobile/app/spike-skia.tsx` in worktree `.claude/worktrees/wiki-force-graph-spike/` (throwaway — not merging).

**Goal:** Confirm the PRD's three-thread architecture (camera transform on UI thread via Reanimated shared values fed into Skia's `<Group transform>`) actually works with the project's pinned `react-native-reanimated@~4.1.1` before sinking effort into Units 1–8. Outcome is binary: green → proceed; red → escalate to Eric (pin Reanimated 3.x or revisit architecture; lower-fidelity fallback violates R2 and is not acceptable).

**Requirements:** R2 (load-bearing precondition).

**Dependencies:** None.

**Files:**
- Throwaway spike branch in `.claude/worktrees/wiki-force-graph-spike/`. No files merged into `main`.

**Approach:**
- Stand up a minimal Expo dev-client build with `@shopify/react-native-skia` (latest 2.x compatible with React Native 0.76+ / new arch enabled per `apps/mobile/app.json:9`).
- Render a single Skia `<Canvas>` with a `<Group transform={ useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }]) }>` and a `<Circle>` inside. Drive `tx`/`ty`/`scale` from `Gesture.Pan` and `Gesture.Pinch` via worklets.
- Run on iPhone 13 simulator + physical device. Sample frame rate during 10s of continuous gesture in React Native Perf Monitor.
- If the camera lags (frame drops, transform doesn't read shared values), confirm whether the issue is Skia version, Reanimated 4 worklet runtime change, or a known issue tracked in the Skia GitHub issues. Try Skia 2.0+ versions known to support Reanimated 4 worklets.

**Test scenarios:**
- Happy path: Skia `<Group>` reads shared values via `useDerivedValue`; pan and pinch sustain 60fps for 10s.
- Edge case: kill the JS thread (busy-loop in `setTimeout`) — camera should still respond at 60fps because the gesture path is on the UI thread.
- Edge case: pinch-to-zoom with the focal-point math (write `tx`/`ty` to keep the focal under the user's fingers) — confirm the worklet writes don't desync.

**Verification:**
- Spike report (a paragraph in the PR description for Unit 1, or a short doc) capturing: Skia version, Reanimated version, observed frame rate, whether `useDerivedValue` → Skia `<Group transform>` round-trips correctly, any blocker.
- Decision documented: green → Units 1–8 proceed as planned; red → escalate.

---

- [ ] **Unit 1: Static render scaffold + camera + theme tokens + Skia plugin + Inter font**

**Goal:** Mount a Skia canvas that renders a hardcoded 10-node synthetic `WikiSubgraph` with hand-placed `(x, y)` positions, zoomable/pannable at 60fps. Land all infra prerequisites (deps, plugin, font, theme tokens) in this PR so subsequent units don't re-do this work.

**Requirements:** R2, R7 (no authoring path even in scaffolding).

**Dependencies:** Unit 0 (Reanimated/Skia spike must be green). Lands in parallel with Unit 2 if a different worktree picks it up.

**Files:**
- Create: `apps/mobile/assets/fonts/Inter-Regular.ttf`
- Modify: `apps/mobile/app.json` (append Skia plugin to `plugins` block)
- Modify: `apps/mobile/package.json` (add `@shopify/react-native-skia`, `d3-force`, `d3-quadtree`, `@types/d3-force`, `@types/d3-quadtree`, `expo-font`)
- Modify: `apps/mobile/lib/theme.ts` (add `wikiEntity` / `wikiTopic` / `wikiDecision` to `COLORS.dark` and `COLORS.light`)
- Create: `apps/mobile/components/wiki/graph/types.ts`
- Create: `apps/mobile/components/wiki/graph/GraphCanvas.tsx`
- Create: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx`
- Create: `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts`
- Create: `apps/mobile/components/wiki/graph/layout/typeStyle.ts`
- Create: `apps/mobile/components/wiki/graph/layout/hitTest.ts` (screen↔world helpers only; node/edge hit lands in Unit 2)
- Create: `apps/mobile/components/wiki/graph/index.ts`
- Create: `apps/mobile/app/wiki/graph.tsx` (placeholder route mounting `<KnowledgeGraph data={hardcodedFixture} />`)
- Test: `apps/mobile/components/wiki/graph/layout/hitTest.test.ts`
- Test: `apps/mobile/components/wiki/graph/hooks/useGraphCamera.test.ts`

**Approach:**
- Reanimated 4 + Skia compat is already validated by Unit 0; proceed with the version pinned there.
- `useGraphCamera` exposes `{ tx, ty, scale, gesture }`. `tx`, `ty`, `scale` are Reanimated `useSharedValue`s. `gesture` is a `Gesture.Simultaneous(pan, pinch)`. `pan.onStart` captures `startTx`/`startTy`; `pan.onUpdate` writes `tx = startTx + e.translationX`. `pinch.onStart` captures `startScale`/`focalX`/`focalY`; `pinch.onUpdate` writes `scale = clamp(startScale * e.scale, 0.2, 5)` and adjusts `tx`/`ty` to keep the focal point under the user's fingers.
- `GraphCanvas` is a Skia `<Canvas>` with a `<Group transform={ useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }]) }>`. Inside the group: `<Line>` for each edge, `<Circle>` for each node, `<Text>` for labels (always rendered in Unit 1; LOD gating ships in Unit 4).
- `typeStyle.ts` exports `getNodeColor(pageType: WikiPageType): string` reading from `COLORS.dark.wikiEntity` / `wikiTopic` / `wikiDecision`. Edges drawn in `COLORS.dark.mutedForeground`.
- Inter loaded via `expo-font` `useFonts({ Inter: require('../../../assets/fonts/Inter-Regular.ttf') })`. Pass the resolved Skia font (`useFont(require(...), size)`) into `<Text font={...} />`. Fall back to `null` font (system default) if loading fails so the canvas still renders.
- `app/wiki/graph.tsx` mounts `<KnowledgeGraph fixture />` for now. Real data wiring lands in Unit 3.
- Throttle: in Unit 1 there's no sim, so no throttling needed. Just ensure the canvas mounts with the hardcoded payload and gestures move the camera at 60fps.

**Patterns to follow:**
- Camera gesture flow mirrors `apps/mobile/components/threads/ThreadRow.tsx` for `Gesture.Pan` + shared-value writes inside worklets.
- Bottom-sheet-host pattern from `apps/mobile/components/PromptTemplateSheet.tsx` (relevant in Units 3–4 but the file structure should anticipate it).
- Theme token extension mirrors existing `COLORS.dark.primary` style.

**Test scenarios:**
- Happy path: dev build on iOS simulator mounts `app/wiki/graph.tsx`, renders 10 nodes + edges in correct type colors against the dark background, no console errors.
- Happy path: single-finger drag pans the canvas; two-finger pinch zooms around the pinch midpoint (visual smoke).
- Edge case (`useGraphCamera`): pinching from `scale=1` with magnitude 100 clamps to `scale=5` (test the worklet's clamp expression in isolation against the spec).
- Edge case (`useGraphCamera`): pinching from `scale=1` with magnitude 0.001 clamps to `scale=0.2`.
- Edge case (`hitTest.screenToWorld`): given `camera={ tx:50, ty:50, scale:2 }` and screen point `(100, 100)`, returns world point `(25, 25)` (deterministic algebra).
- Edge case (`hitTest.worldToScreen`): inverse round-trip of the above returns `(100, 100)` ±0.01.
- Integration: theme tokens — Storybook-style render the `KnowledgeGraph` fixture in light mode and dark mode, confirm node colors swap accordingly.

**Verification:**
- `pnpm -C apps/mobile typecheck` passes.
- `pnpm -C apps/mobile lint` passes.
- Hardcoded fixture renders on a physical or simulated iPhone 13; pan + pinch hold 60fps in React Native Perf Monitor for at least 10s of continuous interaction.
- `apps/mobile/lib/theme.ts` contains `wikiEntity`, `wikiTopic`, `wikiDecision` in both `COLORS.light` and `COLORS.dark`.
- `apps/mobile/app.json` `plugins` block includes the Skia entry.

---

- [ ] **Unit 2: d3-force simulation + node tap selection + selection visual**

**Goal:** Replace Unit 1's hand-placed coordinates with a real d3-force simulation. Tap a node → select it (no detail sheet yet — Unit 3 wires the sheet). Throttle render to 30Hz, stop simulation when `alpha < 0.01`.

**Requirements:** R2 (60fps preserved), R7.

**Dependencies:** Unit 1.

**Files:**
- Create: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts`
- Modify: `apps/mobile/components/wiki/graph/layout/hitTest.ts` (add `nearestNode(camera, x, y, nodes)`)
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (selection ring rendering)
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (wire sim + tap → selection state)
- Test: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.test.ts`
- Test: `apps/mobile/components/wiki/graph/layout/hitTest.test.ts` (extend with `nearestNode` cases)

**Approach:**
- `useForceSimulation` receives `{ nodes, edges }` and exposes `{ tick, restart, stop }`. Internally instantiates `forceSimulation(nodes).force('link', forceLink(edges).id(d => d.id)).force('charge', forceManyBody().strength(-30)).force('center', forceCenter(0, 0)).force('collide', forceCollide(20))`. On each tick callback, increments a `setTick` counter (`useState<number>(0)`). The hook owns simulation lifecycle: `restart(alpha)` calls `simulation.alpha(alpha).restart()`; `stop()` halts the timer.
- Throttle the `setTick` writes to ~30Hz using a `requestAnimationFrame` gate or a `setTimeout` debouncer so React doesn't re-render every tick (which can run faster).
- Stop the simulation when `simulation.alpha() < 0.01` for two consecutive checks (auto-quiesce).
- `nearestNode`: linear scan when `nodes.length ≤ 500`; promote to a `d3-quadtree` indexed lookup above 500. Both behind the same `nearestNode(camera, screenX, screenY, nodes): { node, distance } | null` signature. Tap tolerance is `28 / camera.scale` world-units (PRD §F3).
- Tap gesture: `Gesture.Tap().onEnd(e => runOnJS(handleTap)(e.x, e.y))`. `handleTap` calls `nearestNode`; if hit, sets `selectedNodeId`; otherwise clears.
- Selection visual: render an extra `<Circle>` at radius+4 with `style="stroke"` for the selected node.

**Patterns to follow:**
- `useForceSimulation` lifecycle mirrors typical d3-force usage in React Native (no specific repo precedent — see best-practices research in PRD §3.1).
- Hit-test scaling rule comes from PRD §F3 ("Tap within `28 / scale` px of a node's center selects it").

**Test scenarios:**
- Happy path: synthetic 10-node fixture self-organizes — assert all node positions are non-default (`x !== 0 || y !== 0`) within 30 ticks.
- Happy path: tap on a node's screen coordinate selects it (`selectedNodeId` updates) and renders the +4 stroke ring.
- Happy path: tap on empty space clears selection.
- Edge case: simulation `alpha` starts at 1.0, decays per default schedule, and `stop()` fires when alpha drops below 0.01 (assert via spying on the `tick` callback).
- Edge case (`nearestNode`): tap at `(50, 50)` with camera `scale=1` and a node at world `(60, 60)`, distance = √200 ≈ 14.14, tolerance = 28 → returns the node.
- Edge case (`nearestNode`): same setup but `scale=2` → tolerance = 14, distance > tolerance → returns null.
- Edge case (`nearestNode`): two nodes within tolerance, returns the closer one.
- Edge case (`nearestNode`): empty nodes array → returns null without throwing.
- Integration: 100-node and 500-node synthetic fixtures both converge within reasonable time (assert sim quiesces in <5s on iPhone 13). Above 500 nodes the quadtree path is exercised by `nearestNode` (assert 500-node tap latency <16ms).

**Verification:**
- Synthetic 10/100/500-node fixtures all render and accept taps without dropped frames in dev build.
- Manual smoke: drag camera while sim is running — camera holds 60fps despite 30Hz JS-thread re-renders.
- Selection visual is visible against `COLORS.dark.background` for all three node types.

---

- [ ] **Unit 3: `wikiSubgraph` GraphQL resolver + `useWikiSubgraph` SDK hook + focus mode + node detail sheet**

**Goal:** Replace the synthetic fixture with a real subgraph fetch. `wikiSubgraph(tenantId, focalPageId, depth=1, agentId, atTime?)` returns the focal page's 1-hop neighborhood. Focus mode resolves a default focal page; tapping a node opens a detail sheet sourced from `useWikiPage`.

**Requirements:** R1, R5, R6.

**Dependencies:** Unit 2. Independent of plan 005's UI rename — the temporary route at `app/wiki/graph.tsx` from Unit 1 is the entry point until the sibling Memories UI PRD wires a "Graph view" header action.

**Files:**
- Create: `packages/database-pg/migrations/<next-seq>_wiki_pages_primary_agent_ids.sql` (idempotent — `ADD COLUMN IF NOT EXISTS primary_agent_ids uuid[] NOT NULL DEFAULT '{}'`, `last_touched_agent_id uuid NULL`, GIN index on `primary_agent_ids`). No-op if sibling Memories UI PRD already shipped this.
- Modify: `packages/database-pg/src/schema/wiki.ts` (add the two columns to Drizzle definitions; safe to add even if migration is a no-op at runtime)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (populate `primary_agent_ids` and `last_touched_agent_id` on page upsert if not already done by sibling)
- Create: `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.ts`
- Modify: `packages/api/src/graphql/resolvers/wiki/index.ts` (register resolver)
- Modify: `packages/database-pg/graphql/types/wiki.graphql` (add `WikiSubgraph`, `WikiHasMoreEntry` types and `wikiSubgraph` Query field; reuse existing `WikiPage` and add a new `WikiPageLink` type if not present)
- Create: `packages/react-native-sdk/src/hooks/use-wiki-subgraph.ts`
- Create: `packages/react-native-sdk/src/graphql/queries/wiki-subgraph.ts`
- Modify: `packages/react-native-sdk/src/index.ts` (barrel export `useWikiSubgraph` and types)
- Modify: `packages/react-native-sdk/package.json` (bump to `0.4.0-beta.0`)
- Create: `apps/mobile/components/wiki/graph/hooks/useFocusMode.ts`
- Create: `apps/mobile/components/wiki/graph/NodeDetailSheet.tsx`
- Create: `apps/mobile/components/wiki/graph/GraphHeader.tsx` (focal badge + depth control + temporary "Focus here" action)
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (wire subgraph + focus + detail sheet)
- Modify: `apps/mobile/app/wiki/graph.tsx` (resolve active agent, pass to `<KnowledgeGraph agentId>`)
- Create: `apps/mobile/app/wiki/[type]/[slug]/graph.tsx` (focal-from-route entry point)
- Test: migration up/down with idempotency check (apply twice, verify no-op the second time)
- Test: `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.test.ts`
- Test: `apps/mobile/components/wiki/graph/hooks/useFocusMode.test.ts`

**Approach:**
- **Migration first**: ship the `primary_agent_ids` migration via `ADD COLUMN IF NOT EXISTS`. This is idempotent so it harmlessly no-ops if the sibling Memories UI PRD already added the column. Confirm during PR review whether sibling has merged; either way the migration is safe.
- **Resolver** (`wikiSubgraph.query.ts`): mirror `wikiGraph.query.ts` patterns. Auth: `await assertCanReadWikiScope(ctx, { tenantId, ownerId: focalPageId-derived-or-args.ownerId })`; tenant fallback: `args.tenantId ?? resolveCallerTenantId(ctx)` (memory: `feedback_oauth_tenant_resolver`). Then a single recursive CTE walks `wiki_page_links` from `focalPageId` up to `depth` hops. **Always** filter by `primary_agent_ids @> ARRAY[args.agentId]::uuid[]` when `args.agentId` is supplied — no silent-degrade fallback. The migration above guarantees the column exists; if the column is somehow missing at runtime, hard-fail with a structured `"primary_agent_ids column missing — apply pending migration"` error rather than widening scope (R6 guard).
- Return `{ focalPageId, depth, atTime: args.atTime ?? now(), nodes, edges, hasMore: [{ pageId, hasMore }] }`. `hasMore[pageId]` is true when the page has outbound links not included in the depth window OR when the 500-cap truncated its neighbors.
- **500-node graceful degradation**: when the unfiltered walk would exceed 500 nodes, order the candidates by `(degree DESC, last_compiled_at DESC)` and return the top 500. Set `hasMore[focalPageId] = true` and surface the truncation count in the response (`truncatedNodeCount` field). Do NOT hard-error — hub focals like the user's own Entity page must remain reachable.
- **GraphQL schema**: add `WikiSubgraph`, `WikiHasMoreEntry`, and `WikiPageLink` (the existing `wikiGraph` resolver returns its own `GraphQLWikiGraphEdge` shape; this plan adds a proper `WikiPageLink` type that mirrors the DB row). Field casing per existing wiki schema (camelCase `firstSeenAt` etc., `AWSDateTime` scalar).
- **SDK hook** (`useWikiSubgraph`): follows `useWikiPage` shape. Args: `{ tenantId, focalPageId, depth = 1, atTime?, agentId, pageType? }`. Pause when `tenantId || focalPageId || agentId` missing. Return `{ subgraph: data?.wikiSubgraph ?? null, loading, error, refetch }`. Request policy `cache-and-network`; refetch with `network-only`.
- **Focus mode** (`useFocusMode`): resolves the focal page deterministically. Returns `{ focalPageId, depth, setFocus, setDepth }`. Priority: (1) route param if launched from `/wiki/[type]/[slug]/graph`; (2) last-focused from AsyncStorage key `thinkwork:wiki-graph:last-focal:<agentId>`; (3) most recently compiled Entity for this agent via `useRecentWikiPages({ agentId, type: 'ENTITY', limit: 1 })`. The PRD's priority-2 ("highest-inbound Entity") is dropped from v1 because it requires either a denormalized `inbound_link_count` column or a `GROUP BY to_page_id` query that doesn't exist yet — out of scope for this unit. Reinstate as a follow-up if priority-3 picks badly in practice.
- **NodeDetailSheet**: bottom-sheet presentation of `useWikiPage(pageId-derived-slug)` content. Reuse the same section / backlinks / sources rendering as `apps/mobile/app/wiki/[type]/[slug].tsx` but in `BottomSheetScrollView` instead of full-screen scroll. "View full page" action navigates to `/wiki/[type]/[slug]`. "Focus here" action calls `setFocus(node.id)`.
- **Active agent threading**: `app/wiki/graph.tsx` calls `useAgents(tenantId)` → resolve active agent per the pattern at `apps/mobile/app/memory/index.tsx:27-31`, pass `activeAgent.id` as `agentId` prop. `app/wiki/[type]/[slug]/graph.tsx` does the same but seeds `focalPageId` from the route params (resolves `(type, slug)` to `pageId` via `useWikiPage` first, then mounts `<KnowledgeGraph focalPageId={resolved.id} />`).
- **Camera auto-center on focal change**: 300ms `withTiming` on `tx`/`ty` shared values to recenter on the focal node's `(x, y)`.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts` — Drizzle `sql\`\`` raw-SQL pattern, `assertCanReadWikiScope` auth, `DISTINCT (from_page_id, to_page_id)` link dedupe.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts:30` — `resolveCallerTenantId(ctx)` fallback for OAuth users.
- `packages/api/src/graphql/resolvers/wiki/auth.ts` — `assertCanReadWikiScope` reuse.
- `packages/api/src/graphql/resolvers/wiki/mappers.ts` — `toGraphQLPage` / `toGraphQLType` reuse.
- `packages/react-native-sdk/src/hooks/use-wiki-page.ts` — hook shape (urql, pause, cache-and-network, return shape with `loading` not `fetching`).
- `apps/mobile/components/PromptTemplateSheet.tsx` — bottom-sheet host pattern.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — wiki detail layout to mirror inside the sheet.

**Test scenarios:**
- Happy path: scope has 5 pages, depth=1 from focal → resolver returns the focal + its 4 1-hop neighbors and 4 edges; `hasMore` is empty.
- Happy path (graceful degradation): focal has 600 reachable neighbors at depth=1 → resolver returns top-500 by `(degree DESC, last_compiled_at DESC)`, `hasMore[focal]=true`, `truncatedNodeCount=100`. Verifies hub focals stay reachable rather than hard-erroring.
- Happy path (`useFocusMode`): first-load on a fresh agent with no last-focal picks the most recently compiled Entity for that agent (priority 3).
- Happy path (`useFocusMode`): second-load reads last-focal from AsyncStorage and returns it without re-querying.
- Happy path (`useFocusMode`): launched via `/wiki/[type]/[slug]/graph` → route param wins over AsyncStorage history.
- Happy path: tapping a node opens the NodeDetailSheet with `useWikiPage` content (title, sections, backlinks). "View full page" navigates to `/wiki/{type}/{slug}`. "Focus here" calls `setFocus(nodeId)` and the camera recenters.
- Edge case (resolver): focal page has zero outbound and zero inbound links → returns `{ nodes: [focal], edges: [], hasMore: { focal: false } }` (the focal itself is always included).
- Edge case (resolver): focal page is archived → resolver returns the focal anyway (so the user can scrub time and see the archived state) but excludes archived neighbors from the depth walk by default.
- Edge case (migration idempotency): apply the `primary_agent_ids` migration twice → second run is a no-op (column exists, GIN index exists). Verify by inspecting `pg_indexes` and `information_schema.columns`.
- Edge case (resolver): `agentId` is provided AND `primary_agent_ids` column is somehow missing at runtime → hard-fails with `"primary_agent_ids column missing — apply pending migration"`. Does NOT silently widen scope. Asserts the R6 invariant.
- Edge case (resolver): depth=0 → returns just the focal page.
- Edge case (resolver): depth=3 → resolver clamps to depth=2 (PRD §F5 caps depth at 2 for sim cost reasons) and logs a warning.
- Error path (resolver): caller's tenant doesn't own the agent → `assertCanReadWikiScope` throws.
- Error path (resolver): `ctx.auth.tenantId` is null AND `resolveCallerTenantId(ctx)` returns null → throws `"Tenant context required"`.
- Integration: end-to-end mobile flow — `app/wiki/graph.tsx` resolves active agent via `useAgents`, calls `useWikiSubgraph` with that `agentId`, renders the subgraph, taps focal node, sheet opens, "View full page" navigates correctly.

**Verification:**
- `pnpm -C packages/api test` passes the new resolver test.
- Curl the dev `wikiSubgraph` endpoint with a real Google-OAuth user token (memory: `feedback_verify_wire_format_empirically`) and confirm `firstSeenAt` / `lastSeenAt` casing round-trips.
- Mobile dev build: opening `/wiki/graph` with a real agent loads a real subgraph within the 500ms target measured against React Native Perf Monitor.
- Detail sheet "Focus here" action successfully triggers a new subgraph fetch with the new focal.

---

- [ ] **Unit 4: Label level-of-detail + edge tap + edge detail sheet**

**Goal:** Labels reveal/hide based on zoom per PRD §F7. Tapping an edge (when no node is closer) selects it and opens a compact edge detail sheet.

**Requirements:** R2 (LOD keeps perf under load), R7.

**Dependencies:** Unit 3.

**Files:**
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (LOD-gated label rendering, edge selection visual)
- Modify: `apps/mobile/components/wiki/graph/layout/hitTest.ts` (add `nearestEdge(camera, x, y, edges, nodes, tolerance=12)`)
- Create: `apps/mobile/components/wiki/graph/EdgeDetailSheet.tsx`
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (edge selection state + sheet wiring; node hit wins over edge hit)
- Test: `apps/mobile/components/wiki/graph/layout/hitTest.test.ts` (extend with `nearestEdge` cases)

**Approach:**
- LOD gating: in `GraphCanvas`, gate label rendering by `useDerivedValue(() => scale.value)`. Per PRD §F7: `scale < 0.5` → no labels; `0.5 ≤ scale < 1.0` → labels for focal node, selected node, and direct neighbors only; `scale ≥ 1.0` → all labels. Selected node always shows full label. Use `useDerivedValue` so the parent does not re-render when scale changes — only the per-node `<Text>` opacity/visibility flips at the worklet level.
- Label truncation: at medium zoom (`0.5 ≤ scale < 1.0`), truncate labels >24 chars with `…`. Full text at high zoom.
- `nearestEdge`: for each visible edge, compute point-to-line-segment distance from `screenToWorld(x, y)` to the edge's `(source.x, source.y) → (target.x, target.y)` segment. Return `{ edge, distance }` with the smallest distance within `tolerance` (default 12 world-units, scale-adjusted similarly to nodes).
- Tap priority: node first (Unit 2's `nearestNode`), edge second (`nearestEdge`). If a node is within its tolerance, the edge hit is ignored.
- `EdgeDetailSheet`: small bottom sheet showing source page title, target page title, `sectionSlug`, `contextExcerpt`, `firstSeenAt`, `lastSeenAt`, `isCurrent`, and `weight` rendered as "mentioned N times". "Jump to source section" action navigates to `/wiki/{source.type}/{source.slug}#{sectionSlug}`.
- Edge selection visual: +1px stroke width and highlight color (use `COLORS.dark.primary`).

**Patterns to follow:**
- Bottom-sheet host pattern same as Unit 3's `NodeDetailSheet` — both share the BottomSheetModal provider already mounted at `apps/mobile/app/_layout.tsx`.

**Test scenarios:**
- Happy path: zoom from `scale=2` to `scale=0.3` — labels fade out at 0.5 threshold and at 1.0 threshold (snap is acceptable per PRD §F7).
- Happy path: tap on an edge between two nodes (with no node closer) opens the edge sheet with correct source/target titles and `firstSeenAt`/`lastSeenAt` values.
- Happy path: "Jump to source section" navigates to `/wiki/{type}/{slug}#section-slug` and the wiki detail page scrolls to that section anchor.
- Edge case (LOD): selected node always shows full label even at `scale=0.3`.
- Edge case (LOD): label >24 chars at `scale=0.7` truncates with `…`; same label at `scale=1.5` shows full text.
- Edge case (`nearestEdge`): tap at world-point `(50, 50)` with edge from `(0, 0)` to `(100, 100)` (perfect diagonal) — perpendicular distance is 0 → returns this edge.
- Edge case (`nearestEdge`): tap is on the source node itself — `nearestNode` returns the node first; `nearestEdge` is not consulted.
- Edge case (`nearestEdge`): tap is between two parallel edges — returns the closer one.
- Edge case (`nearestEdge`): tap is beyond the segment endpoints (perpendicular drop falls outside `[source, target]`) — distance computed to nearest endpoint, returned only if within tolerance.
- Error path: `EdgeDetailSheet` opens with an edge whose `sectionSlug` is null (some edges may not carry one) — sheet renders without the "Jump to source section" action and does not throw.
- Integration: tap an edge, sheet opens, swipe down to dismiss, sheet closes, edge selection clears, edge stroke returns to default width.

**Verification:**
- Manual smoke: pinch through the three LOD bands and visually confirm label transitions are not flickery (snap is OK).
- Edge selection works in the dense regions of a real subgraph.

---

- [ ] **Unit 5: Schema migration (`first_compiled_at`, `first_seen_at`, `last_seen_at`, `is_current`) + compile Lambda updates + temporal control**

**Goal:** Land the temporal-columns migration. Update the compile Lambda (specifically the `wiki_page_links` upsert path in `packages/api/src/lib/wiki/`) to populate the columns. Wire a `TemporalControl` slider that scrubs `temporalCursor`; loaded edges restyle live; debounced re-fetch fills in older context on pause/release.

**Requirements:** R3, R8.

**Dependencies:** Unit 4. Migration must land and be deployed before the resolver in this unit returns the new fields.

**Files:**
- Create: `packages/database-pg/migrations/<next-seq>_wiki_temporal_columns.sql`
- Modify: `packages/database-pg/src/schema/wiki.ts` (add `firstCompiledAt`, `firstSeenAt`, `lastSeenAt`, `isCurrent` columns to Drizzle definitions)
- Modify: `packages/database-pg/graphql/types/wiki.graphql` (extend `WikiPage` and `WikiPageLink` with the new fields)
- Modify: `packages/api/src/graphql/resolvers/wiki/mappers.ts` (surface new fields)
- Modify: `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.ts` (apply temporal filter when `atTime` provided; include new fields in returned shape)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (set `first_compiled_at` on first page upsert)
- Modify: `packages/api/src/lib/wiki/repo/<links repository file>` (set `first_seen_at` on insert; bump `last_seen_at` and set `is_current=true` on re-observation; set `is_current=false` on compile-without-re-observation)
- Create: `apps/mobile/components/wiki/graph/hooks/useTemporalCursor.ts`
- Create: `apps/mobile/components/wiki/graph/TemporalControl.tsx`
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (apply temporal filter styling)
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (mount `TemporalControl`)
- Test: migration up/down test (or equivalent in the existing migration harness)
- Test: `packages/api/src/graphql/resolvers/wiki/wikiSubgraph.query.test.ts` (extend with temporal filter cases)
- Test: `packages/api/src/lib/wiki/compiler.test.ts` (or repo-level test for the link upsert temporal semantics)
- Test: `apps/mobile/components/wiki/graph/hooks/useTemporalCursor.test.ts`

**Approach:**
- **Migration** (additive; columns + backfill + indexes split across statements; index creation is CONCURRENTLY to avoid blocking compile-Lambda writes):
  - Step 1 (column adds — online-safe via `pg_attribute.attmissingval` for non-volatile defaults):
    - `ALTER TABLE wiki_pages ADD COLUMN first_compiled_at timestamptz NOT NULL DEFAULT now();`
    - `ALTER TABLE wiki_page_links ADD COLUMN first_seen_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN is_current boolean NOT NULL DEFAULT true;`
  - Step 2 (backfill — use existing timestamps where available so day-1 doesn't have a dead-zone in temporal scrub):
    - `UPDATE wiki_pages SET first_compiled_at = created_at WHERE first_compiled_at = now()` (or whatever sentinel `attmissingval` produced — implementer verifies the actual reference value).
    - `UPDATE wiki_page_links l SET first_seen_at = COALESCE((SELECT MIN(s.first_seen_at) FROM wiki_section_sources s JOIN wiki_page_sections sec ON sec.id = s.section_id WHERE sec.page_id = l.from_page_id), l.created_at)` — best-effort backfill from the underlying source observations; falls back to the link's `created_at` when no section source ties.
    - `UPDATE wiki_page_links SET last_seen_at = first_seen_at` to start the two timestamps in agreement; the next compile pass will diverge them naturally.
  - Step 3 (indexes — CONCURRENTLY, must be in their own transaction; ship as separate migration files if the migration runner doesn't support per-statement transactions):
    - `CREATE INDEX CONCURRENTLY wiki_page_links_first_seen_idx ON wiki_page_links (first_seen_at);`
    - `CREATE INDEX CONCURRENTLY wiki_page_links_last_seen_idx ON wiki_page_links (last_seen_at);`
  - Confirm against prod row counts before applying. Document `EXPLAIN ANALYZE` for a temporal-filtered `wikiSubgraph` query in the PR.
- **Compile Lambda updates** — per-pass ordering invariant matters because partial passes must NOT mark active links not-current:
  - Per page processed: on link first-insert, set `first_seen_at = COALESCE(min(wiki_section_sources.first_seen_at across contributing sources), now())`. On link re-observation, `UPDATE wiki_page_links SET last_seen_at = now(), is_current = true WHERE id = $1`.
  - End-of-pass sweep: track every page id visited during the pass. Only after all pages process AND a complete-pass sentinel is written, run `UPDATE wiki_page_links SET is_current = false WHERE from_page_id = ANY($visited_pages) AND last_seen_at < $pass_start`. This scopes the sweep to pages actually processed and only runs on a complete pass — a crashed or partial pass leaves `is_current` flags untouched and the next successful pass heals them.
  - Never DELETE — deletion loses history and breaks temporal scrub.
  - On `wiki_pages` first-insert: `first_compiled_at` defaults to `now()` (immutable). Subsequent compiles only update `last_compiled_at`.
- **Resolver temporal filter** (PRD §5) — server pre-filters existence; client handles styling:
  - Server: when `args.atTime` is supplied, `WHERE l.first_seen_at <= args.atTime AND p.first_compiled_at <= args.atTime`. The server returns ALL rows that pass this gate, **including past-invalidated rows** (`is_current = false` with `last_seen_at < atTime`). The client decides whether to render them dashed/dimmed based on the returned `is_current` and `lastSeenAt` fields.
  - When `args.atTime` is null: defaults to `now()`; resolver returns rows as currently shipped.
  - Rationale: keeping past-invalidated rows in the payload lets the client temporal-scrub locally without a network round-trip on every cursor move.
- **`useTemporalCursor`**: exposes `{ cursor, setCursor, debouncedRefetch }`. Slider range = `[earliest first_seen_at across loaded edges, min(now, max last_seen_at + 1h)]`. Live filter is a pure function `applyTemporalFilter(subgraph, cursor) → { visibleNodes, visibleEdges, dimmedNodes, dashedEdges }` that runs in render on the JS thread. Debounced re-fetch (leading-edge + trailing-edge, 800ms per PRD §F8) calls `useWikiSubgraph.refetch({ atTime: cursor })`.
- **`TemporalControl`**: slider thumb is a Reanimated shared value driven by gesture; the cursor written into React state happens at gesture-end or at debounced intervals (don't write every frame). "Now" button resets `cursor = new Date().toISOString()`. Slider element styled per `apps/mobile/lib/theme.ts` muted/foreground tokens.
- **Render filter** (in `GraphCanvas`): per PRD §5 table — past-invalidated edges render dashed at 30% opacity; pre-compile / archived nodes render at 40% opacity with no label.

**Patterns to follow:**
- Migration shape mirrors existing `wiki.ts` schema additions (look at how `parent_page_id` was added).
- Repository write seam follows the `upsertPageLink` pattern already used in compiler orchestration.
- Slider component follows the shared Reanimated worklet pattern from Unit 1's camera (gesture writes shared value; debounced JS state write).

**Test scenarios:**
- Happy path (migration): apply migration to a fresh DB → all four columns present, indexes present, defaults populated.
- Happy path (migration): apply to a DB with existing `wiki_pages` and `wiki_page_links` rows → rows backfill to `now()`; query `SELECT first_compiled_at FROM wiki_pages LIMIT 1` returns a recent timestamp.
- Happy path (compile Lambda): first-time link insert → `first_seen_at = now()`, `last_seen_at = now()`, `is_current = true`.
- Happy path (compile Lambda): re-observe an existing link in a later compile pass → `first_seen_at` unchanged, `last_seen_at` updated, `is_current = true`.
- Happy path (compile Lambda): compile pass doesn't re-observe a link that previously existed → `is_current = false`, `last_seen_at` unchanged, row NOT deleted.
- Happy path (resolver): `atTime = T` filters out links where `first_seen_at > T`.
- Happy path (resolver): `atTime` filter returns historical state — link that was current at T but is_current=false now still renders at T.
- Happy path (`useTemporalCursor`): scrubbing the slider updates cursor live; debounced refetch fires 800ms after the last gesture event.
- Edge case (`useTemporalCursor`): slider range adapts when new data arrives — earliest `first_seen_at` shifts left.
- Edge case (`useTemporalCursor`): "Now" button snaps cursor to current ISO timestamp and triggers refetch with `atTime = undefined`.
- Edge case (compile Lambda): two compile passes within the same second — `last_seen_at` updates on both; `is_current` stays true (don't flap).
- Edge case (rendering): edge with `is_current = false` AND `last_seen_at < cursor` → renders dashed at 30% opacity.
- Edge case (rendering): node with `first_compiled_at > cursor` → renders at 40% opacity with no label.
- Error path (resolver): `atTime` in the future (after now) — resolver clamps to `now()` and logs a warning rather than returning an empty subgraph.
- Integration: end-to-end — scrub slider back 7 days, `is_current=false` edges that were current 7 days ago render solid; today's `is_current=true` edges that didn't exist 7 days ago drop off the canvas.

**Verification:**
- `pnpm -C packages/api test` passes the new resolver and compiler tests.
- Migration applied to dev DB; schema dump shows the new columns + indexes.
- Compile Lambda re-deployed via PR-to-main (memory: `feedback_graphql_deploy_via_pr`) — never `aws lambda update-function-code` directly. Confirm a fresh compile pass populates the new columns on real data.
- Curl `wikiSubgraph(atTime: "2026-04-01T00:00:00Z")` — returned edges include `firstSeenAt`, `lastSeenAt`, `isCurrent` fields with correct casing and values consistent with the cursor (memory: `feedback_verify_wire_format_empirically`).
- Mobile dev build: scrubbing the slider visibly dims past-invalidated edges in real time at 60fps; releasing scroll triggers exactly one refetch (no thrash).

---

- [ ] **Unit 6: Layout stability + k-hop expansion**

**Goal:** Existing nodes don't jump when data changes (expansion, temporal re-fetch, focus change). Tapping a `hasMore` node expands its 1-hop neighborhood; new nodes fade in at the parent's position.

**Requirements:** R4 (expansion), R2 (no scrambling preserves perceived perf).

**Dependencies:** Unit 5.

**Files:**
- Create: `apps/mobile/components/wiki/graph/layout/transitions.ts`
- Modify: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` (apply previous-position snapshot before reseating data; reheat at `alpha=0.2` not 1.0)
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (fade-in for added nodes, fade-out for removed)
- Modify: `apps/mobile/components/wiki/graph/NodeDetailSheet.tsx` (add "Expand" action when `hasMore[node.id] = true`)
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (render "+" badge on `hasMore` nodes)
- Test: `apps/mobile/components/wiki/graph/layout/transitions.test.ts`

**Approach:**
- `transitions.ts` exports `applyDataUpdate(prevNodes, prevEdges, nextNodes, nextEdges) → { nodes, edges, removingNodes, removingEdges }`. For each node in `nextNodes` whose `id` matches a `prevNodes[i]`, copy `prev.x` / `prev.y` / `prev.vx` / `prev.vy` / `prev.fx` / `prev.fy`. For new nodes that have a parent in `nextNodes` (e.g., from k-hop expansion), initialize at the parent's `(x, y)`. For nodes in `prevNodes` not in `nextNodes`, retain them in `removingNodes` for fade-out animation; the caller drops them after animation completes.
- Sim reheats at `alpha=0.2` (gentle nudge), not `1.0` (full relayout). PRD §F9.
- Expansion: NodeDetailSheet adds an "Expand" action visible only when `hasMore[node.id] = true`. Action calls `useWikiSubgraph` with `focalPageId=node.id, depth=1` and merges the result into the current subgraph. Merge dedupes by `node.id` / `edge.id`.
- Fade-in: new nodes start at opacity 0 and `scale=0.5`, animate to opacity 1 and `scale=1` over 250ms.
- Fade-out: removed nodes animate from current opacity to 0 over 200ms before dropping.
- "+" badge: small `<Circle>` at the top-right corner of the node's bounding box, only when `hasMore[node.id] = true`.

**Patterns to follow:**
- The merge-and-preserve pattern is unique to this feature; no existing repo precedent. Test scenarios cover the contract.

**Test scenarios:**
- Happy path (`applyDataUpdate`): prev has nodes A, B, C with positions; next has A, B, C, D (D is new from expansion of A) → A, B, C keep positions; D starts at A's position.
- Happy path (`applyDataUpdate`): prev has A, B, C; next has A, B (C removed) → A, B keep positions; C in `removingNodes`.
- Happy path (`applyDataUpdate`): prev has node A with `fx=100, fy=200` (pinned); next still has A → A's `fx`/`fy` preserved.
- Happy path (sim reheat): expansion triggers `simulation.alpha(0.2).restart()`, NOT `alpha(1).restart()` (assert via spy).
- Happy path (expansion): tapping "Expand" on a `hasMore` node fetches its 1-hop neighborhood, merges, and the new nodes fade in over 250ms at the parent's `(x, y)`, radiating outward as the sim runs.
- Happy path ("+" badge): node with `hasMore[id] = true` renders the "+" badge; node without it does not.
- Edge case (merge): expansion returns nodes that overlap with already-loaded nodes → merge dedupes; existing nodes keep their positions.
- Edge case (merge): expansion returns zero new nodes (the focal had no unexplored neighbors) → no fade-in animation, no sim reheat noise, sheet shows a "No more to expand" hint.
- Edge case (focus change while sim is running): switching focal triggers a new fetch; existing nodes in the new subgraph keep positions; new nodes initialize at the new focal's `(x, y)`.
- Edge case (temporal re-fetch): scrubbing back in time and triggering a re-fetch returns a different node set; nodes that exist in both keep positions; nodes only in the new set fade in; nodes only in the old set fade out.
- Error path: expansion fetch errors → sheet shows error toast, no sim disturbance.
- Integration: expansion → sim reheats → quiesces within ~3s on iPhone 13 → sheet's "Expand" button becomes disabled because `hasMore[id]` is now false.

**Verification:**
- `pnpm -C apps/mobile test` passes `transitions.test.ts`.
- Manual smoke on a real subgraph: focus change does NOT scramble the existing nodes' positions.
- Expansion animation visibly fades-in at the parent's position rather than at a random origin.

---

- [ ] **Unit 7: `wiki_pinned_positions` migration + persistence resolvers + SDK hooks + node-drag mode**

**Goal:** User-pinned positions persist per `(tenant, agent, focal_page, page)`. Drag a node to pin it. Auto-save the full layout once the sim quiesces on first load of a focal page so subsequent opens skip the relayout.

**Requirements:** R4, R9.

**Dependencies:** Unit 6.

**Files:**
- Create: `packages/database-pg/migrations/<next-seq>_wiki_pinned_positions.sql`
- Modify: `packages/database-pg/src/schema/wiki.ts` (add `wikiPinnedPositions` table)
- Create: `packages/api/src/graphql/resolvers/wiki/wikiPinnedPositions.query.ts`
- Create: `packages/api/src/graphql/resolvers/wiki/upsertWikiPinnedPositions.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/wiki/index.ts` (register both)
- Modify: `packages/database-pg/graphql/types/wiki.graphql` (add `WikiPinnedPosition`, `WikiPinnedPositionInput`, query, mutation)
- Create: `packages/react-native-sdk/src/hooks/use-wiki-pinned-positions.ts`
- Create: `packages/react-native-sdk/src/hooks/use-wiki-update-pin.ts`
- Modify: `packages/react-native-sdk/src/index.ts` (barrel export)
- Modify: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` (seed positions from `useWikiPinnedPositions` data)
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (route pan-on-node into drag-mode; auto-save on quiesce)
- Modify: `apps/mobile/components/wiki/graph/NodeDetailSheet.tsx` (add "Unpin" action)
- Test: `packages/api/src/graphql/resolvers/wiki/wikiPinnedPositions.query.test.ts`
- Test: `packages/api/src/graphql/resolvers/wiki/upsertWikiPinnedPositions.mutation.test.ts`

**Approach:**
- **Migration**:
  ```sql
  CREATE TABLE wiki_pinned_positions (
    tenant_id     uuid        NOT NULL,
    agent_id      uuid        NOT NULL,
    focal_page_id uuid        NOT NULL,
    page_id       uuid        NOT NULL,
    x             float8      NOT NULL,
    y             float8      NOT NULL,
    pinned        boolean     NOT NULL DEFAULT false,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, agent_id, focal_page_id, page_id),
    FOREIGN KEY (page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE,
    FOREIGN KEY (focal_page_id) REFERENCES wiki_pages(id) ON DELETE CASCADE
  );
  CREATE INDEX wiki_pinned_positions_lookup
    ON wiki_pinned_positions (tenant_id, agent_id, focal_page_id);
  ```
- **`wikiPinnedPositions` resolver**: same auth pattern as `wikiSubgraph`. Returns rows for `(tenantId, agentId, focalPageId)`. No pagination (caps at the 500-node ceiling).
- **`upsertWikiPinnedPositions` mutation**: takes a `mode` arg. When `mode = 'pin'` (user-explicit drag/pin): `ON CONFLICT (tenant_id, agent_id, focal_page_id, page_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, pinned = EXCLUDED.pinned, updated_at = now()`. When `mode = 'seed'` (auto-save on quiesce): `ON CONFLICT (tenant_id, agent_id, focal_page_id, page_id) DO NOTHING` so first-quiesce-wins per agent+focal. Returns `Boolean`.
- **`useWikiPinnedPositions`**: standard urql hook; `pause` when args missing.
- **`useWikiUpdatePin`**: returns `(input) => Promise<void>`. Use `RequestResponse` semantics — surface errors immediately (memory: `feedback_avoid_fire_and_forget_lambda_invokes`); position-pin upserts are user-driven and silent failure would degrade trust in the persistence story.
- **Seeding**: `useForceSimulation` reads `useWikiPinnedPositions` data and applies `(x, y)` to matching node ids before the first tick. Pinned positions also set `node.fx = x, node.fy = y` so d3-force treats them as fixed.
- **Drag-on-node**:
  - Replace single `Gesture.Pan` (camera) with `Gesture.Pan().onBegin(hitTestNode)` that decides on `onBegin` whether the touch is on a node:
    - If on a node: switch to drag-mode. `onUpdate` writes `node.fx = world(touchX), node.fy = world(touchY)`; sim reheats at `alpha=0.3`; throttled re-render keeps the canvas updated.
    - Else: camera-pan mode (existing behavior).
  - On `onEnd` of a node-drag: keep `fx`/`fy` set (node stays pinned), mark `node.pinned = true`, and call `useWikiUpdatePin` debounced 500ms after gesture end (avoids spamming during quick adjusts).
- **Auto-save on quiesce** (PRD §F10): on first load of a `focalPageId` for which `useWikiPinnedPositions` returned empty, wait for `simulation.alpha() < 0.01` for 2s, then add 0–2000ms of random jitter (avoid thundering-herd when many devices open the same focal simultaneously), then call `upsertWikiPinnedPositions` with the full current layout. Auto-saves use `pinned = false` AND mutation-side `ON CONFLICT DO NOTHING` semantics so that if another session got there first, we don't clobber their positions; user-explicit pin upserts (`pinned = true`) keep the `DO UPDATE` path. This makes seed positions effectively first-write-wins per `(tenant, agent, focal, page)`, which is the desired semantic — once a stable layout exists for an agent's focal, all sessions get the same one.
- **"Unpin" action**: `NodeDetailSheet` exposes "Unpin" only when `node.pinned === true`. Action clears `node.fx = null, node.fy = null` and upserts with `pinned=false` and the current `(x, y)` (so the seed position survives).

**Patterns to follow:**
- Resolver pattern: `wikiSubgraph.query.ts` from Unit 3 (auth, tenant fallback).
- SDK mutation hook: there's no existing template under `packages/react-native-sdk/src/hooks/` (most hooks are queries). Check `useCaptureMobileMemory` for the canonical mutation hook shape.
- Drag-vs-pan racing pattern: use `Gesture.Pan().onBegin(routeByHitTest)` rather than `Gesture.Race(panNode, panCamera)` — single pan with internal routing keeps state ownership in one place.

**Test scenarios:**
- Happy path (migration): apply migration → table exists with PK and FKs; FK cascades on `wiki_pages` deletion verified.
- Happy path (resolver): query returns rows for `(tenant, agent, focal)` scope.
- Happy path (mutation): upsert 5 positions → all 5 written; re-upsert 3 with new `(x, y)` → 3 updated, other 2 unchanged.
- Happy path (drag): drag a node → during gesture, node follows finger; on release, `useWikiUpdatePin` fires with the new `(x, y)` and `pinned=true` (debounced 500ms).
- Happy path (seed): `useWikiPinnedPositions` returns data → sim seeds those positions; pinned nodes have `fx`/`fy` set; non-pinned nodes have just `x`/`y`.
- Happy path (auto-save): first load of a fresh focal → after sim quiesces (alpha<0.01 for 2s), `upsertWikiPinnedPositions` fires once with the full layout; on next app open, the same focal mounts in the same layout without animation.
- Happy path ("Unpin"): node sheet "Unpin" action clears `fx`/`fy`; sim reheats to `alpha=0.2` and the node drifts back into the layout.
- Edge case (drag): `onBegin` hit-tests; if the touch is on empty space, gesture routes to camera-pan mode (existing behavior). Nodes are not accidentally dragged.
- Edge case (drag): rapid drag-and-release on multiple nodes within 500ms — debounced upserts batch by node id (latest position wins per node).
- Edge case (auto-save): if the user switches focal before sim quiesces, the auto-save for the abandoned focal does NOT fire (cancel on unmount).
- Edge case (auto-save): if `useWikiPinnedPositions` returned non-empty data, auto-save does NOT fire on quiesce (positions already persisted).
- Edge case (resolver): rows for an `agent_id` that no longer exists in `agents` — resolver still returns them (no FK on agent_id; rows are scoped by tenant + focal). If product wants cleanup, separate task.
- Error path (mutation): upsert with a `page_id` that doesn't exist in `wiki_pages` → FK error surfaces to client; toast "Couldn't save layout — will retry" per PRD §F12 partial-failure handling, then silent retry x3, then surface error.
- Error path (auth): caller's tenant doesn't own the `agentId` → mutation throws.
- Integration: drag two nodes → kill the app → reopen `/wiki/graph` → both nodes are in the saved positions; one is `pinned`, the other was auto-saved, and "Unpin" appears only on the pinned one.

**Verification:**
- Migration applied to dev DB; row counts and PK/FK verified.
- `pnpm -C packages/api test` passes resolver + mutation tests.
- Mobile dev build: drag a node, kill the app, reopen — node is in the same place. Curl the dev `wikiPinnedPositions` endpoint and confirm the row exists with `pinned=true` for the dragged node.

---

- [ ] **Unit 8: View organization (hide branches, show all) + accessibility + perf measurement pass**

**Goal:** Hide-branch / unpin / show-all actions. Loading / empty / error states polished. Accessibility labels + VoiceOver pass. Perf measurement against PRD §7.1 budget table.

**Requirements:** R4, R10, plus PRD §7.2 accessibility.

**Dependencies:** Unit 7.

**Files:**
- Create: `apps/mobile/components/wiki/graph/hooks/useViewOrganization.ts`
- Modify: `apps/mobile/components/wiki/graph/NodeDetailSheet.tsx` (add "Hide this branch" action)
- Modify: `apps/mobile/components/wiki/graph/GraphHeader.tsx` (add "Show all" action)
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (loading/empty/error states; accessibility props)
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx` (10% opacity rendering for hidden nodes; accessibility props on nodes/edges)
- Modify: `apps/mobile/components/wiki/graph/TemporalControl.tsx` (accessibility props)
- Test: `apps/mobile/components/wiki/graph/hooks/useViewOrganization.test.ts`

**Approach:**
- **`useViewOrganization`**: exposes `{ hiddenNodeIds, hideBranch(nodeId), showAll(), pinnedNodeIds, unpin(nodeId) }`. `hideBranch` performs a transitive walk: starts with `nodeId`, walks outbound edges in the current loaded subgraph, adds any node reachable ONLY through `nodeId` (i.e., would become an orphan if `nodeId` were removed) to `hiddenNodeIds`. Does NOT actually remove nodes from sim — they render at 10% opacity per PRD §F11.
- **Loading state**: centered `<ActivityIndicator />` over the canvas; gestures disabled until `loading === false`.
- **Empty state**: no nodes returned → centered "Nothing compounded here yet" + "Back to list" link (navigates to the Wiki tab list).
- **Error state**: centered error message + "Retry" button calling `useWikiSubgraph.refetch()`.
- **Partial failure**: position-pin write fails → silent retry x3, then `toast.show("Couldn't save layout — will retry")`. Subgraph fetch failure surfaces immediately (existing urql error path).
- **Accessibility**:
  - `<Canvas>` carries `accessibilityRole="image"` with a `accessibilityLabel` summarizing the focal node title and node count.
  - Each header button (`Focus here`, `Show all`, `Now`, `+/- depth`) has a clear `accessibilityLabel` and `accessibilityRole="button"`.
  - Temporal slider: `accessibilityRole="adjustable"`, `accessibilityValue={{ now: cursorIso }}`.
  - Touch targets minimum 44×44 pt — the existing button sizing in the app meets this; verify by inspection.
  - VoiceOver on mount: focal node title + immediate neighbor titles read aloud (use an `AccessibilityInfo.announceForAccessibility(...)` call after first paint).
  - Dark-mode contrast for `wikiEntity` / `wikiTopic` / `wikiDecision` against `COLORS.dark.background` (`#000`) — verify all three meet WCAG AA (sky-400, amber-400, violet-400 against black all pass; document in tokens).
- **Perf measurement** against PRD §7.1 budget table:
  - Pan/pinch: 60fps measured by React Native Perf Monitor across 10s of continuous gesture.
  - Sim re-render: <8ms per frame at ≤200 nodes; <16ms at 200–500 nodes.
  - Focus change: <500ms from tap to first paint.
  - Expansion: <500ms from tap to fade-in.
  - Temporal scrub: <16ms per restyle pass.
  - Cold start: <1s from `app/wiki/graph.tsx` mount to first canvas paint (excluding network).
  - Document numbers in the PR description; if any miss budget by >25%, surface as a follow-up rather than blocking the PR.

**Patterns to follow:**
- Loading/empty/error pattern from existing `apps/mobile/components/wiki/WikiList.tsx` (post plan 005).
- Accessibility patterns from `apps/mobile/components/threads/` components.

**Test scenarios:**
- Happy path (`useViewOrganization`): hide a node with no other path to its only outbound neighbor → both go into `hiddenNodeIds`.
- Happy path (`useViewOrganization`): hide a node with a neighbor that's also reachable through another path → only the hidden node is added.
- Happy path: hidden nodes render at 10% opacity with no label; sim continues to lay them out (they preserve spatial context).
- Happy path: "Show all" clears `hiddenNodeIds`; opacity restores.
- Happy path: "Unpin" clears `fx`/`fy` and removes node from `pinnedNodeIds`; mutation persists `pinned=false`.
- Happy path (loading): subgraph fetch in flight → spinner visible, gestures disabled (tap on node does nothing).
- Happy path (empty): subgraph returns zero nodes → "Nothing compounded here yet" message visible; "Back to list" link navigates correctly.
- Happy path (error): subgraph errors → error message visible; "Retry" button refetches.
- Happy path (accessibility): VoiceOver mounted → announces focal title + neighbors after first paint.
- Edge case (`hideBranch`): hiding the focal node itself — disallowed (focal must always be visible per PRD §F5). Action greyed out in the sheet.
- Edge case (`hideBranch`): hide a node whose entire branch is already hidden — no-op.
- Edge case (partial failure): pin upsert fails 3 times → toast appears once, not three times.
- Edge case (perf): 500-node payload + simultaneous temporal scrub — frame rate measured, document any regression vs. 100-node baseline.
- Integration: hide a branch, kill the app, reopen — `hiddenNodeIds` are NOT persisted across sessions (PRD doesn't require it; explicit non-feature). Show all clears live state only.
- Regression: temporal scrub still works at 60fps after view-organization features land (no new JS-thread cost from the opacity overlay).

**Verification:**
- `pnpm -C apps/mobile test` passes `useViewOrganization.test.ts`.
- Manual smoke: hide a branch, scrub temporal, focus elsewhere, return — opacity behavior matches expectations throughout.
- VoiceOver pass: rotate through every interactive element on the screen and confirm clear audible labels.
- Perf measurements documented in PR description; any budget violations >25% noted as follow-up tickets.

## System-Wide Impact

- **Interaction graph:** This plan adds a new GraphQL surface (`wikiSubgraph`, `wikiPinnedPositions`, `upsertWikiPinnedPositions`), three new SDK hooks, two new DB tables/columns, and a write-seam in the compile Lambda. The existing `wikiGraph` resolver (admin-side, plan 003) is not touched. The existing wiki read surface (`wikiPage`, `wikiSearch`, `wikiBacklinks`, `recentWikiPages`) is not modified — only extended on `WikiPage` and a new `WikiPageLink` type is introduced.
- **Error propagation:** Resolver errors propagate as urql errors; SDK hooks expose them via `error`. Position-pin write failures use silent-retry x3 then toast (PRD §F12 partial-failure semantics). Compile Lambda failures during temporal-column population fail the compile job loudly — the PR-to-main deploy path will halt rollout.
- **State lifecycle risks:**
  - **Stale `is_current` flags** if a compile pass crashes mid-pass: the resolver shows the link as still current until the next successful compile. Acceptable; the eventual recompile heals it.
  - **Orphaned `wiki_pinned_positions` rows** if an agent is deleted but pages remain: cleaned up by the `wiki_pages` FK cascade only when pages are also deleted. If an agent is soft-deleted but pages survive, rows linger. Acceptable for v1; not a memory leak.
  - **Auto-save races**: if the user backgrounds the app while sim is quiescing, the auto-save may or may not fire. Cancel on unmount; tolerate the missed save (next open re-runs sim).
  - **Migration rollback**: the temporal-columns migration is forward-only. Rolling back requires a separate DOWN migration; document in the PR.
- **API surface parity:**
  - SDK adds `useWikiSubgraph`, `useWikiPinnedPositions`, `useWikiUpdatePin`, plus `WikiSubgraph`, `WikiPageLink`, `WikiPinnedPosition` types.
  - SDK version goes `0.2.0-beta.2 → 0.4.0-beta.0` (skips `0.3.0-beta.0` which sibling Memories UI PRD claims).
  - GraphQL adds `WikiSubgraph`, `WikiHasMoreEntry`, `WikiPinnedPosition`, `WikiPinnedPositionInput`, `WikiPageLink` types and the corresponding queries/mutations. New `WikiPage` fields (`firstCompiledAt`) are additive; existing consumers ignore them.
  - DB schema adds 4 columns to existing tables and 1 new table. All additive, no destructive changes.
- **Integration coverage:**
  - End-to-end on iPhone 13: Wiki tab → Graph view → tap node → sheet → expand → temporal scrub → drag node → kill app → reopen → confirm layout persisted.
  - Concurrent compile pass while a user is scrubbing temporal: client-side filter keeps showing the last-fetched data; debounced refetch picks up the new state.
  - Multi-agent: switching the active agent in the Wiki tab header re-mounts the graph with a different `agentId`; `wikiPinnedPositions` are scoped per-agent, so the new agent loads its own layout (or auto-layouts on first open).
- **Unchanged invariants:**
  - The `memory/*` route family on mobile (raw AgentCore + Hindsight workspace files) is untouched.
  - Compile pipeline behavior for everything other than `first_seen_at` / `last_seen_at` / `is_current` / `first_compiled_at` is unchanged.
  - Existing wiki read endpoints (`wikiPage`, `wikiSearch`, `wikiBacklinks`, `recentWikiPages`, `wikiGraph`) keep their wire shapes.
  - Plan 005's wiki tab rename and component restructure proceed independently.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Reanimated 4 + Skia v2 worklet incompatibility breaks the camera-on-UI-thread architecture | Medium | High (PRD §3.1 is load-bearing) | Unit 0 spike validates this before any other unit opens a PR. If red, escalate to Eric — there is no acceptable lower-fidelity fallback that meets R2's 60fps requirement. |
| `d3-force` JS-thread cost exceeds 16ms/frame above 200 nodes on iPhone 13 | Medium | Medium | Throttle render to 30Hz (Unit 2); enforce 500-node cap server-side (Unit 3); promote to per-node shared values only if measured (PRD §3.1). |
| `Inter-Regular.ttf` not bundling correctly via `expo-font` for Skia text | Medium | Low | Fallback to `null` Skia font (system default) if loading fails; canvas still renders. Document in the PR. |
| Temporal-columns migration locks `wiki_page_links` on prod-sized tables | Low (current row counts modest) | High if hit | Confirm row counts before applying; `ALTER TABLE … ADD COLUMN … DEFAULT now()` is online-safe in modern Postgres but verify on dev with a representative dataset first. |
| Compile Lambda update lands but doesn't deploy because of the PR-only deploy convention (memory: `feedback_graphql_deploy_via_pr`) — temporal columns stay at default-now forever | Medium | High | Treat the PR-to-main merge as the deploy gate; confirm a fresh compile run actually populates the columns on dev before opening the migration PR for prod. |
| `useWikiPinnedPositions` cache thrash when scrubbing temporal triggers refetch | Low | Low | Pinned positions are scoped by `(tenant, agent, focal)`; temporal cursor doesn't enter the cache key. Refetches on scrub do not invalidate position cache. |
| Sibling Memories UI PRD does not land before this plan, leaving no `primary_agent_ids` column to filter by | High | Medium | Unit 3 ships its own idempotent `ADD COLUMN IF NOT EXISTS primary_agent_ids` migration so this plan is not gated on the sibling. Resolver hard-fails (no silent-degrade) if column is somehow missing at runtime, preserving R6 tenant-isolation invariant. |
| Plan 005's `components/wiki/` directory does not exist when this plan starts | Low (plan 005 is in flight) | Low | If `components/wiki/` doesn't exist yet, this plan creates the directory; plan 005 then merges into it without conflict. |
| Worktree isolation drift — landing in main checkout collides with concurrent compounding-memory work | High if ignored | High | Ship each unit's PR from a dedicated worktree per memory `feedback_worktree_isolation`. Diff stale files vs `origin/main` before resuming any in-progress unit (memory: `feedback_diff_against_origin_before_patching`). |
| Curling the new `wikiSubgraph` returns `firstSeenAt` snake-cased (or vice versa) | Medium | Medium | Wire-format empirical check before merging Unit 3 (memory: `feedback_verify_wire_format_empirically`). |
| Auto-save on quiesce fires for every focal the user merely visits, bloating `wiki_pinned_positions` | Medium | Low | Auto-save only on first load (when `useWikiPinnedPositions` returned empty). Subsequent visits to a focal that already has saved positions do NOT re-save. |
| Thundering-herd write storm if many users open the same focal simultaneously and all auto-save | Medium | Medium | Auto-save adds 0–2s random jitter after quiesce, AND the mutation uses `ON CONFLICT DO NOTHING` for `mode='seed'` upserts. First-write-wins per `(tenant, agent, focal, page)`; later sessions silently no-op. |
| Day-1 temporal scrub dead-zone if `first_seen_at` defaults to migration time on existing rows | Medium | Medium | Unit 5 backfills `first_seen_at` from `wiki_section_sources.first_seen_at` (best-effort) and `first_compiled_at` from `wiki_pages.created_at`. Documented in Unit 5 verification — confirm slider range spans real history, not a single point at migration time. |
| `is_current = false` sweep marks active links not-current on a partial compile pass | Medium | High | Sweep runs only after a complete-pass sentinel is written, AND is scoped to pages actually visited in the pass. Crashed/partial passes leave `is_current` flags untouched; next successful pass heals them. |
| `CREATE INDEX` on `wiki_page_links` blocks compile-Lambda writes during build | Medium | Medium | Use `CREATE INDEX CONCURRENTLY` and ship indexes in their own migration transaction. |
| 500-node hard-error makes hub focals (e.g., user's own Entity page) unreachable | High if hard-error retained | High | Cap is graceful: top-500 by `(degree, last_compiled_at)` + `hasMore[focalId]=true` + `truncatedNodeCount`. User can drill in via expansion. No hard-error path on the cap. |
| Detail sheet for an edge with null `sectionSlug` shows broken UI | Low | Low | Conditional rendering covered in Unit 4 test scenarios. |

## Documentation / Operational Notes

- Document the temporal-columns migration in the migration PR description, including `EXPLAIN ANALYZE` output for a representative `wikiSubgraph(atTime: …)` query against dev data so reviewers can sanity-check the new index choice.
- Document the SDK version jump (`0.2.0-beta.2 → 0.4.0-beta.0`) in the SDK PR description so consumers understand the asymmetry with the sibling Memories UI PRD's `0.3.0-beta.0` claim.
- Add a one-line entry to `apps/mobile`'s release notes when each unit ships, per the existing convention for mobile releases.
- No Terraform changes (the `wikiSubgraph` resolver runs in the existing `graphql-http` Lambda; no new Lambda or queue).
- No feature flag — graph view ships behind the simple "Graph view" header action, which can be removed in code if it ships broken.
- Compile Lambda redeploy happens automatically via PR-to-main merge (memory: `feedback_graphql_deploy_via_pr`); confirm a real compile pass populates the new columns on dev before merging the migration PR.

## Phased Delivery

Units map to the origin PRD §8 phases plus a Unit 0 spike that this plan adds in front. Land in order:

- **Unit 0** — Reanimated 4 + Skia worklet compatibility spike. Throwaway branch, no merge. Outcome gates everything else.
- **Unit 1 (PR 5)** — Static render scaffold + camera + theme tokens + Skia plugin + Inter font.
- **Unit 2 (PR 6)** — d3-force sim + node tap + selection.
- **Unit 3 (PR 7)** — `primary_agent_ids` migration + `wikiSubgraph` resolver + SDK hook + focus mode + node detail sheet.
- **Unit 4 (PR 8)** — Label LOD + edge tap + edge detail sheet.
- **Unit 5 (PR 9)** — Temporal columns migration (with backfill + CONCURRENTLY indexes) + compile Lambda + temporal control.
- **Unit 6 (PR 10)** — Layout stability + k-hop expansion.
- **Unit 7 (PR 11)** — `wiki_pinned_positions` + persistence + node drag.
- **Unit 8 (PR 12)** — View organization + accessibility + perf pass.

Unit 0 must complete green before any of Unit 1–8 opens a PR. Units 1 and 2 can then land in parallel (different worktrees). Units 3–8 must land in order because each depends on the previous unit's surface.

## Sources & References

- **Origin PRD:** `docs/plans/archived/compounding-memory-mobile-memories-force-graph.md` — primary source of truth for feature acceptance criteria.
- **Sibling PRD (deferred to its own plan):** `docs/plans/archived/compounding-memory-mobile-memories-ui-prd.md` — defines `primary_agent_ids` migration and `TypeBadge` tokens.
- **Companion plan:** `docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md` — admin-side `wikiGraph` resolver pattern source.
- **In-flight rename:** `docs/plans/2026-04-19-005-refactor-mobile-memories-to-wiki-plan.md` — owns the `apps/mobile/components/memory/ → components/wiki/` move that this plan inherits.
- **Code touchpoints:**
  - `apps/mobile/app/_layout.tsx`, `apps/mobile/app.json`, `apps/mobile/lib/theme.ts`, `apps/mobile/babel.config.js`, `apps/mobile/package.json`
  - `apps/mobile/components/PromptTemplateSheet.tsx`, `apps/mobile/components/threads/ThreadRow.tsx`
  - `apps/mobile/app/wiki/[type]/[slug].tsx`, `apps/mobile/app/memory/index.tsx`
  - `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts`, `auth.ts`, `mappers.ts`, `index.ts`
  - `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts`
  - `packages/api/src/lib/wiki/compiler.ts`, `packages/api/src/handlers/wiki-compile.ts`
  - `packages/database-pg/src/schema/wiki.ts`, `packages/database-pg/graphql/types/wiki.graphql`
  - `packages/react-native-sdk/src/hooks/use-wiki-page.ts`, `packages/react-native-sdk/src/index.ts`
- **Institutional learnings (memory):**
  - `feedback_oauth_tenant_resolver` — `resolveCallerTenantId(ctx)` in every new resolver.
  - `feedback_worktree_isolation` — one worktree per unit.
  - `feedback_diff_against_origin_before_patching` — diff stale files before resuming.
  - `feedback_verify_wire_format_empirically` — curl new endpoints before client work.
  - `feedback_graphql_deploy_via_pr` — never `aws lambda update-function-code` directly.
  - `feedback_avoid_fire_and_forget_lambda_invokes` — user-driven mutations use `RequestResponse`.
  - `feedback_read_diagnostic_logs_literally` — off-by-one in timestamp logs is the bug.
