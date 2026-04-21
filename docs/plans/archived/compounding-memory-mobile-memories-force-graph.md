# Compounding Memory — Mobile Memories Force Graph PRD

**Status:** Draft · 2026-04-18
**Owner:** Eric
**Audience:** Coding agent (implementation spec)
**Platform:** React Native / Expo iOS first, Android later
**Sibling:** `.prds/compounding-memory-mobile-memories-ui-prd.md`
**Related:**
- `.prds/compounding-memory-company-second-brain-prd.md`
- `.prds/compiled-memory-layer-engineering-prd.md`
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
- `.prds/compounding-memory-visuals.md`

---

## 1. Overview

This PRD specifies the **full-screen force-directed graph viewer** for the ThinkWork mobile Memories module. It is the deep-dive visualization complement to the list/detail surfaces specified in the sibling `compounding-memory-mobile-memories-ui-prd.md`.

### Role inside the Memories module

The Memories module has three visualization surfaces, from lightest to heaviest:

1. **`RelationshipChips`** (sibling PRD §6b) — always-on compact chip strip of inbound/outbound links on each wiki detail page.
2. **`RelationshipGraph`** (sibling PRD §6b, v1.1) — inline 1-hop diagram on a wiki detail page, behind a "Show graph" expander.
3. **Force Graph Viewer** (this PRD) — a dedicated full-screen explorer reached via a "Graph view" toggle in the Memories list header, or via an "Explore in graph" action on any wiki detail page.

V1 is a **viewer/explorer**, not an editor. Compile is the only author. Users navigate, organize, and scrub through the compounded memory state.

### Product differentiator

Rendering the compounded memory's temporal state — *what relationships between Entity/Topic/Decision pages held as of date X* — as a first-class interaction. No commodity graph library supports this out of the box, and the compiled memory layer produces exactly the temporal metadata needed (source `first_seen_at`, page `last_compiled_at`, status transitions) to make scrubbing meaningful.

### Goals

1. A user can tap "Graph view" on the Memories tab and see the active agent's compounded knowledge graph, centered on a sensible default focal page, within 500ms of data arrival.
2. A user can pinch, pan, and tap nodes/edges smoothly at 60fps on iPhone 13 across the supported zoom range.
3. A user can scrub a time slider and watch the graph update to reflect link and page visibility at that moment.
4. A user can expand/collapse neighborhoods and pin nodes, with those organizational choices persisting per-agent, per-focal-page.
5. A coding agent can implement this spec without product-level clarifying questions.

### Non-goals

- Authoring pages, links, or properties (this is explicitly a viewer — compile owns authorship).
- Rendering the full tenant graph at once (focus + expand is the interaction model).
- Supporting non-force layouts (dagre, ELK, hierarchical) in V1.
- Desktop/web rendering (components should not actively prevent future `react-native-web` use but are not designed for it).
- Real-time collaborative cursors or presence.
- Offline editing (online-only for V1).
- Cross-agent graph merging — graph is agent-scoped like the rest of the Memories module.

---

## 2. Stack and dependencies

```
@shopify/react-native-skia              # GPU rendering
react-native-reanimated                 # already present in apps/mobile
react-native-gesture-handler            # already present in apps/mobile
d3-force                                # layout simulation (new dep)
d3-quadtree                             # spatial index for hit testing (new dep)
```

Peer setup (verify before starting):
- Expo dev client required (Skia is not compatible with Expo Go) — already how the ThinkWork mobile app ships.
- `GestureHandlerRootView` wrapping the app root — already present.
- Reanimated babel plugin configured — already present.
- Skia Expo plugin to be registered in `apps/mobile/app.json`.
- A bundled sans-serif font (Inter-Regular.ttf) shipped in `apps/mobile/assets/fonts/`. The app already ships Inter for chat; reuse it.

---

## 3. Architecture

### 3.1 Thread model

Three concerns on three execution contexts:

| Concern                | Runs on        | Mechanism                                        |
|------------------------|----------------|--------------------------------------------------|
| Camera transform       | UI thread      | Reanimated shared values, mutated by gestures    |
| Layout simulation      | JS thread      | d3-force, mutates node x/y in place              |
| Rendering              | GPU (via Skia) | Skia reads shared values + React props           |

The camera must not depend on JS thread state. Gestures drive shared values directly (via worklets in `Gesture.Pan()` and `Gesture.Pinch()`), and the Skia `<Group transform={...}>` reads those shared values via `useDerivedValue`. This guarantees 60fps camera interaction regardless of simulation cost or React render pressure.

Layout runs on the JS thread because d3-force is not worklet-compatible. On each tick, the simulation mutates node `x`/`y` in place; a `setTick` counter in the hook triggers React re-renders at a throttled rate (target: 30Hz). Do not upgrade to per-node shared values unless measured frame budget problems appear on iPhone 13.

### 3.2 File structure

All graph-viewer code lives under `apps/mobile/components/memory/graph/` to keep it colocated with the rest of the Memories module.

```
apps/mobile/components/memory/graph/
├── types.ts                    # WikiGraphNode, WikiGraphEdge, WikiSubgraph, etc.
├── KnowledgeGraph.tsx          # top-level component
├── GraphCanvas.tsx             # Skia rendering
├── TemporalControl.tsx         # time slider UI
├── GraphHeader.tsx             # focal badge, depth control, "now" button
├── hooks/
│   ├── useForceSimulation.ts   # d3-force lifecycle
│   ├── useGraphCamera.ts       # pan/pinch → shared {tx, ty, scale}
│   ├── useFocusMode.ts         # focal page, depth, expand/collapse
│   ├── useTemporalCursor.ts    # current time filter
│   └── useViewOrganization.ts  # pinned nodes, hidden subtrees
├── layout/
│   ├── hitTest.ts              # screen↔world, nearest node, nearest edge
│   ├── transitions.ts          # layout-shock mitigation
│   └── typeStyle.ts            # colors + radii per WikiPageType + subtype
└── index.ts                    # barrel re-export
```

The screen route that hosts this component is:

```
apps/mobile/app/wiki/graph.tsx               # default focal = agent's pinned page
apps/mobile/app/wiki/[slug]/graph.tsx        # focal = this slug (via "Explore in graph")
```

Data access is via new SDK hooks in `packages/react-native-sdk/src/hooks/`:

```
use-wiki-subgraph.ts         # replaces the generic api/subgraph.ts in the source spec
use-wiki-pinned-positions.ts # replaces api/preferences.ts
use-wiki-update-pin.ts       # mutation hook for persisting a pinned node
```

### 3.3 Data flow

```
┌──────────────────────────────────────────────────────────────────┐
│  GraphQL (packages/api/src/resolvers/wiki/*)                      │
│  - wikiSubgraph: shapes subgraph by focal page + depth + at-time  │
│  - wikiPinnedPositions: read/write user pins                      │
│  - All filtered by tenantId + agentId per Memories module spec    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  @thinkwork/react-native-sdk                                      │
│  - useWikiSubgraph({ focalPageId, depth, atTime, agentId })       │
│  - useWikiPinnedPositions({ focalPageId })                        │
│  - useWikiUpdatePin()                                             │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  KnowledgeGraph (React)                                           │
│  - useFocusMode, useTemporalCursor, useForceSimulation            │
│  - useGraphCamera, useViewOrganization                            │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  GraphCanvas (Skia)                                               │
│  - Draws edges (dashed for invalidated), nodes (type-colored),    │
│    labels (LOD gated)                                             │
│  - Applies camera transform via <Group>                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Data contracts

### 4.1 Client-side types

Types live in `apps/mobile/components/memory/graph/types.ts` and are shaped directly from the `WikiPage` / `WikiPageLink` types defined in the sibling PRD's GraphQL schema.

```ts
// Mirrors WikiPageType from wiki.graphql
export type WikiPageType = 'ENTITY' | 'TOPIC' | 'DECISION';

// Entity subtypes (Entity is the tenant-shared macro type; the compile pass tags it)
export type EntitySubtype =
  | 'person'
  | 'company'
  | 'project'
  | 'repo'
  | 'product'
  | string; // extensible

export interface WikiGraphNode {
  id: string;                    // WikiPage.id
  slug: string;                  // WikiPage.slug
  label: string;                 // WikiPage.title
  pageType: WikiPageType;
  subtype?: EntitySubtype;       // populated for Entity pages
  ownerId?: string | null;       // null for Entity, non-null for Topic/Decision
  summaryPreview?: string;       // first 120 chars of summaryMd for detail sheet

  // Temporal (from schema addendum in §5)
  firstCompiledAt?: string;      // ISO 8601; immutable
  lastCompiledAt: string;        // ISO 8601; updated each compile pass
  status: 'ACTIVE' | 'STALE' | 'ARCHIVED';

  // Provenance
  primaryAgentIds: string[];     // from wiki_pages.primary_agent_ids (sibling PRD §5)
  lastTouchedAgentId?: string | null;

  // Layout
  initialX?: number;             // server-provided from pinned positions, if any
  initialY?: number;
  pinned?: boolean;              // user-pinned; sim treats fx/fy as fixed

  // d3-force mutates these during simulation:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface WikiGraphEdge {
  id: string;                    // stable edge id; WikiPageLink.id or derived
  source: string | WikiGraphNode;
  target: string | WikiGraphNode;

  sectionSlug?: string;          // which section of the source page carries this link
  contextExcerpt?: string;       // excerpt shown in detail sheet

  // Temporal (from schema addendum in §5)
  firstSeenAt: string;           // earliest firstSeenAt across contributing sources
  lastSeenAt: string;            // latest firstSeenAt across contributing sources
  isCurrent: boolean;            // true if the link was still present in the most recent compile

  // Render hints
  weight?: number;               // occurrence count; drives forceLink distance + stroke width
}

export interface WikiSubgraph {
  focalPageId: string;
  depth: number;
  atTime: string;                // ISO 8601; the "as of" time the server used
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  hasMore: {                     // for expansion affordance
    [pageId: string]: boolean;
  };
}

export interface ViewState {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  pinnedNodeIds: Set<string>;
  hiddenNodeIds: Set<string>;
  temporalCursor: string;        // ISO 8601
  focalPageId: string;
  focalDepth: number;
  agentId: string;               // from active agent in Memories tab
}

export interface CameraState {
  tx: number;
  ty: number;
  scale: number;
}
```

### 4.2 GraphQL surface — extends sibling PRD schema

Add to `packages/database-pg/graphql/types/wiki.graphql` (defined by sibling PRD §7a):

```graphql
type WikiSubgraph {
  focalPageId: ID!
  depth: Int!
  atTime: DateTime!
  nodes: [WikiPage!]!
  edges: [WikiPageLink!]!
  hasMore: [WikiHasMoreEntry!]!
}

type WikiHasMoreEntry {
  pageId: ID!
  hasMore: Boolean!
}

input WikiPinnedPositionInput {
  pageId: ID!
  x: Float!
  y: Float!
}

type WikiPinnedPosition {
  pageId: ID!
  x: Float!
  y: Float!
}

extend type Query {
  wikiSubgraph(
    tenantId: ID!
    focalPageId: ID!
    depth: Int = 1
    atTime: DateTime          # defaults to now
    agentId: ID               # if set, restricts to nodes with matching primary_agent_ids
    pageType: WikiPageType    # optional filter
  ): WikiSubgraph!

  wikiPinnedPositions(
    tenantId: ID!
    agentId: ID!
    focalPageId: ID!
  ): [WikiPinnedPosition!]!
}

extend type Mutation {
  upsertWikiPinnedPositions(
    tenantId: ID!
    agentId: ID!
    focalPageId: ID!
    positions: [WikiPinnedPositionInput!]!
  ): Boolean!
}
```

Resolver location: `packages/api/src/resolvers/wiki/{wikiSubgraph,wikiPinnedPositions,upsertWikiPinnedPositions}.ts`.

The `wikiSubgraph` resolver expands from `focalPageId` by traversing `wiki_page_links` up to `depth` hops, filtered by `primary_agent_ids @> ARRAY[agentId]` when `agentId` is set. `hasMore` is true for any node whose outbound-link count exceeds what was returned within the depth window.

### 4.3 SDK hooks

New hooks added in `packages/react-native-sdk/src/hooks/`, exported from `packages/react-native-sdk/src/index.ts`:

```ts
useWikiSubgraph({
  focalPageId, depth, atTime, agentId, pageType
}): { data: WikiSubgraph | null; fetching: boolean; error?: Error; refetch: () => void };

useWikiPinnedPositions({
  agentId, focalPageId
}): { data: WikiPinnedPosition[]; fetching: boolean };

useWikiUpdatePin(): (input: {
  agentId: string;
  focalPageId: string;
  positions: WikiPinnedPositionInput[];
}) => Promise<void>;
```

This pushes the SDK minor version further: sibling PRD claimed `0.3.0-beta.0`; this PRD lands on `0.4.0-beta.0` (new public hooks per the `sdk-v*` publish convention).

---

## 5. Schema addendum — temporal columns (PRD gap)

The compiled memory layer as currently specified (`compiled-memory-layer-engineering-prd.md`) does **not** carry the temporal metadata the force graph's temporal scrub feature needs. This PRD proposes the minimum addendum to make §6 F8 shippable.

**Proposed migration** (lands with the sibling PRD's schema migration, or immediately after):

```sql
-- Page-level temporal
ALTER TABLE wiki_pages
  ADD COLUMN first_compiled_at timestamptz NOT NULL DEFAULT now();

-- Link-level temporal
ALTER TABLE wiki_page_links
  ADD COLUMN first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN is_current    boolean     NOT NULL DEFAULT true;

CREATE INDEX wiki_page_links_first_seen_idx ON wiki_page_links (first_seen_at);
CREATE INDEX wiki_page_links_last_seen_idx  ON wiki_page_links (last_seen_at);
```

**Compile Lambda responsibility:**
- On a link's first insert: set `first_seen_at = now()` (or the earliest `wiki_section_sources.first_seen_at` across contributing sources).
- On re-observation: update `last_seen_at = now()` and set `is_current = true`.
- On compile with no re-observation: set `is_current = false` but retain the row (do not delete — delete loses history).

**Temporal filter semantics:**
- `firstSeenAt ≤ cursor ≤ lastSeenAt` → edge renders current.
- `firstSeenAt ≤ cursor < lastSeenAt` AND `is_current = false` at cursor point → edge renders dashed + dimmed (past-invalidated).
- `firstSeenAt > cursor` → edge does not render (didn't exist yet).

**Node temporal:**
- `firstCompiledAt > cursor` → node at 40% opacity, no label (existed but not yet known at cursor time).
- `status = ARCHIVED` AND `lastCompiledAt < cursor` → node at 40% opacity (was known, now stale).

Rejected alternatives:
- Full bi-temporal with `valid_from` / `valid_to` / `tx_time` per the generic graph viewer source spec — too much schema surface for V1. `is_current` + timestamps is sufficient for scrub semantics.
- Pure derivation from `wiki_section_sources.first_seen_at` — requires a join-heavy query for every edge render, and link uniqueness isn't tied 1:1 to a single source.

---

## 6. Feature specifications

Each feature has an ID, acceptance criteria, and implementation notes.

### F1. Graph rendering

Render nodes as circles, edges as lines, labels as text, inside a Skia `<Canvas>` with a `<Group>` that applies the camera transform.

**Acceptance:**
- Given a `WikiSubgraph` payload, every node renders as a circle at `(x, y)`.
- Node color follows `pageType` first, `subtype` second: Entity = sky, Topic = amber, Decision = violet (reusing the sibling PRD's `TypeBadge` tokens). For Entity, subtype adds a small inner glyph (person/building/folder/repo) rather than changing color.
- Every edge renders as a line from source to target node center.
- Labels render next to nodes per the LOD rules in F7.
- Past-invalidated edges (per §5 temporal filter) render as dashed lines at 30% opacity.
- Invalidated / pre-compile / archived nodes render at 40% opacity with no label.

**Implementation notes:**
- Color mapping lives in `layout/typeStyle.ts`, sourced from the shared theme tokens in `apps/mobile/lib/theme.ts`.
- Edge stroke width is proportional to `weight` (clamped 1–3 px).
- Draw edges before nodes so nodes paint on top.

### F2. Camera (pan, pinch, zoom clamps)

Single-finger drag pans. Two-finger pinch zooms around the pinch focal point. Scale is clamped to `[0.2, 5]`.

**Acceptance:**
- Pan and pinch execute at 60fps with no frame drops on iPhone 13.
- Pinch zooms around the two-finger midpoint, not the view origin.
- Scale cannot exceed clamps regardless of gesture magnitude.
- Pan and pinch can compose (two-finger drag zooms + translates).

**Implementation notes:**
- `tx`, `ty`, `scale` are all Reanimated `useSharedValue`.
- Store `startTx`/`startTy`/`startScale` + `focalX`/`focalY` onStart for relative math in onUpdate.
- `Gesture.Simultaneous(pan, pinch)`.

### F3. Node tap → selection + detail sheet

Tapping a node selects it and opens a detail sheet sourced from the existing `useWikiPage(slug)` hook.

**Acceptance:**
- Tap within `28 / scale` px of a node's center selects it.
- Selected node renders with a colored ring (stroke) at radius +4.
- Detail sheet uses the sibling PRD's detail components (sections, backlinks, sources) but in a bottom-sheet presentation rather than full screen.
- Tapping empty space clears selection.
- A "View full page" action in the sheet navigates to `app/wiki/[slug].tsx`.

**Implementation notes:**
- `Gesture.Tap().onEnd(e => runOnJS(handleTap)(e.x, e.y))`.
- `handleTap` → `screenToWorld` → `nearestNode` → node hit; if none, `nearestEdge` (see F4).
- Use `d3-quadtree` once `visibleNodes > 500`; linear scan below. Both behind a single `nearestNode` function.

### F4. Edge tap → selection + detail sheet

Tapping an edge (when no node is closer) selects it and shows a compact edge detail sheet.

**Acceptance:**
- Tap within 12px of an edge segment selects it when no node is within its tolerance.
- Selected edge renders with +1px stroke width and highlight color.
- Edge detail sheet shows: source page title, target page title, `sectionSlug`, `contextExcerpt`, `firstSeenAt`, `lastSeenAt`, `isCurrent`, weight (as "mentioned N times").
- From the sheet, a "Jump to source section" action navigates to `app/wiki/{source.slug}` at the `#{sectionSlug}` anchor.

**Implementation notes:**
- Compute point-to-line-segment distance per visible edge; return closest within tolerance.
- Nodes win over edges in hit priority.

### F5. Focus mode

The graph always has a focal page. Opening `app/wiki/graph.tsx` resolves the focal as follows:

1. If the route was reached from a wiki detail page via "Explore in graph", focal = that page's id.
2. Otherwise, `useFocusMode` resolves a default via this priority:
   - The user's last-focused page for this agent (from `useWikiPinnedPositions` history, or a separate `wikiLastFocalPage` preference — sibling PRD can own this persistence).
   - The Entity page with the highest inbound-link count for the active agent (via a `wikiPages` query sorted by link count).
   - The most recently compiled Entity/Topic/Decision for the active agent.

**Acceptance:**
- First open resolves a focal page deterministically per the priority above.
- The focal node is always rendered and camera auto-centers on it on focal change (300ms `withTiming`).
- Focus depth defaults to 1; user can set depth = 2 via the `GraphHeader` control (not higher — sim cost grows fast).
- Changing focus triggers a new `useWikiSubgraph` fetch.

**Implementation notes:**
- `useFocusMode` exposes `{ focalPageId, depth, setFocus, setDepth }`.
- Long-press on a node (or "Focus here" action in the detail sheet) calls `setFocus(nodeId)`.

### F6. k-hop expansion

When a node marked `hasMore[id] = true` is tapped via an "Expand" affordance in its detail sheet (or long-pressed with a specific gesture in Phase 6+), fetch its 1-hop neighborhood and merge it into the current subgraph.

**Acceptance:**
- Nodes with `hasMore` render with a small "+" badge at the top-right corner.
- Expansion fetches the node's 1-hop neighborhood (`wikiSubgraph(focalPageId=nodeId, depth=1, agentId)`) and merges new nodes/edges into the current view.
- New nodes fade-in + scale-up over 250ms.
- Existing nodes retain positions (see F9).
- Sim reheats to `alpha = 0.3`.

**Implementation notes:**
- Merge dedupes by `node.id` / `edge.id`.
- New nodes initialize at the expanded node's `(x, y)`; they radiate outward as sim runs.
- Pre-merge `{id → x,y}` snapshot passes to `transitions.ts`.

### F7. Label level-of-detail

- `scale < 0.5`: no labels.
- `0.5 ≤ scale < 1.0`: labels only for the focal node, selected node, and direct neighbors.
- `scale ≥ 1.0`: all labels.
- The selected node always shows its full label regardless of scale.

**Acceptance:**
- Zooming in/out reveals/hides labels per the rules above.
- Transitions without flicker (snap at thresholds is acceptable).
- Labels > 24 chars truncate with ellipsis at medium zoom; full text at high zoom.

**Implementation notes:**
- Gate label rendering by a per-node boolean from `useDerivedValue(scale)` so parent doesn't re-render on scale change.

### F8. Temporal control

A `TemporalControl` slider at the bottom of the screen scrubs the "as of" time. Default is now. Past times cause past-invalidated edges/nodes to render per §5 semantics.

**Acceptance:**
- Slider ranges from the min `first_seen_at` across all currently loaded edges to now.
- Scrubbing updates `temporalCursor` in view state.
- Edges/nodes restyle per §5 filter semantics live at 60fps (client-side filter; no network).
- A "Now" button resets the cursor to current time.
- When the user pauses scrubbing for >800ms or releases the slider, `useWikiSubgraph` re-fetches with the new `atTime` so the server can return nodes/edges that existed at that time but aren't currently loaded.

**Implementation notes:**
- Live temporal filter is a pure function of loaded subgraph + cursor; runs on JS thread in render.
- Debounce re-fetch with leading-edge + trailing-edge pattern.
- The slider itself is a Reanimated-driven component; its thumb position is a shared value.

### F9. Layout stability

When graph data changes (expansion, filter change, temporal re-fetch), existing nodes must not jump to new positions.

**Acceptance:**
- Before any sim update with new data, snapshot current `{id → x, y}`.
- After update, restore those positions as initial conditions for existing nodes.
- New nodes initialize at their parent/expansion point.
- Removed nodes fade out over 200ms before being dropped.
- Sim reheats at `alpha = 0.2` (gentle), not `1.0` (full relayout).

**Implementation notes:**
- `layout/transitions.ts` exports `applyDataUpdate(prevNodes, prevEdges, nextNodes, nextEdges) → { nodes, edges, removingNodes, removingEdges }`.
- Callers remove `removingNodes`/`removingEdges` from state after the fade animation completes.

### F10. Position persistence (per-agent, per-focal)

Initial node positions come from the server when available. User-pinned positions persist back, scoped by `(tenant_id, agent_id, focal_page_id, page_id)`.

**Acceptance:**
- If `useWikiPinnedPositions({ agentId, focalPageId })` returns data, seed the sim with those `(x, y)` on matching node ids.
- Dragging a node (F11) sets its `fx`/`fy`, marks it `pinned`, and calls `useWikiUpdatePin` debounced 500ms after gesture end.
- On next app open, the same focal page + agent loads with the persisted positions.

**Implementation notes:**
- Backing table: `wiki_pinned_positions(tenant_id, agent_id, focal_page_id, page_id, x, y, updated_at, PRIMARY KEY (tenant_id, agent_id, focal_page_id, page_id))`.
- On first open for a focal page with no saved positions, sim runs normally; after `alpha < 0.01` holds for 2s, auto-save all current positions (not just user-pinned) as seed positions.

### F11. View organization (pin, hide)

Drag a node to pin it. Hide subtrees via detail sheet.

**Acceptance:**
- Pan gesture `onBegin` hit-tests. If a node is hit → node-drag mode (`fx`/`fy` follow finger; sim reheats `alpha = 0.3`). Else → camera-pan mode.
- On drag end, `fx`/`fy` stay set, node becomes `pinned`, and position persists (F10).
- Detail sheet "Unpin" action clears `fx`/`fy`.
- Detail sheet "Hide this branch" action adds the node + all nodes reachable only through it to `hiddenNodeIds`.
- Hidden nodes render at 10% opacity with no label (**de-emphasize, don't remove** — so the user retains spatial context and can unhide).
- Header "Show all" action clears `hiddenNodeIds`.

**Implementation notes:**
- Use `Gesture.Pan().onBegin(hitTestWithRef).onUpdate(routeByMode).onEnd(finalize)`, or two separate pans in `Gesture.Race()`.

### F12. Loading, empty, and error states

**Acceptance:**
- Loading: centered spinner over Skia canvas; camera disabled.
- Empty (no nodes): centered message "Nothing compounded here yet" + "Back to list" link.
- Error: centered error message + "Retry" button.
- Partial failure (subgraph loaded but pin write fails): silent retry x3, then toast "Couldn't save layout — will retry".

---

## 7. Non-functional requirements

### 7.1 Performance budget

| Interaction                        | Target                |
|------------------------------------|-----------------------|
| Pan/pinch gesture                  | 60fps, no drops       |
| Sim re-render (≤200 nodes)         | 30Hz, <8ms per frame  |
| Sim re-render (200–500)            | 30Hz, <16ms per frame |
| Tap → selection visual feedback    | <16ms                 |
| Tap → detail sheet open            | <100ms                |
| Focus change → new subgraph render | <500ms (network-dependent) |
| Expansion → new nodes visible      | <500ms                |
| Temporal scrub → edge restyle      | <16ms                 |
| App cold start → first paint       | <1s (excluding network) |

Measure on iPhone 13. Older devices are best-effort.

### 7.2 Accessibility

- Nodes, edges, header buttons, and the temporal slider carry `accessibilityLabel` and `accessibilityRole`.
- VoiceOver reads the focal node title and its immediate neighbors on mount.
- Type-color mapping (Entity sky / Topic amber / Decision violet) meets WCAG AA contrast against the dark-mode background. For colorblind users, Entity subtype glyphs (person / building / folder / repo) carry the signal redundantly, not just color.
- Touch targets are minimum 44×44 pt.

### 7.3 Testing

- Unit tests for `hitTest.ts` (screen↔world, nearestNode, nearestEdge).
- Unit tests for `layout/transitions.ts` (position preservation, diff).
- Component tests for `KnowledgeGraph` with a mocked `useWikiSubgraph` returning a synthetic 10-node subgraph.
- Manual test matrix:
  - 10-node, 100-node, 500-node synthetic subgraphs
  - All gesture combinations (pan, pinch, tap, simultaneous pan+pinch, drag-on-node)
  - Temporal scrub across the fixture range
  - Focus change / expansion / hide / unpin cycle
  - Offline → online transition during load
- Fixture support behind `EXPO_PUBLIC_MEMORY_MOCK=1` (the sibling PRD's flag) so the graph can be exercised before the compile Lambda produces real data.

---

## 8. Implementation phases

Each phase lands as its own PR in a worktree under `.claude/worktrees/` per the project's worktree-isolation convention. This PRD follows (and builds on) the sibling PRD's 4 PRs:

- PR 1–4: sibling PRD (schema, SDK hooks, list + detail, manual capture).
- **PR 5–12 below: this PRD.**

### Phase 1 (PR 5) — Static render + camera

- `types.ts`, `typeStyle.ts`, `GraphCanvas.tsx` skeleton.
- Hardcoded 10-node synthetic `WikiSubgraph` with hand-placed `(x, y)`.
- `useGraphCamera` + `Gesture.Pan` + `Gesture.Pinch`; pinch around focal point; clamps enforced.

**Done when:** hardcoded graph renders and can be panned/pinched at 60fps on iPhone 13.

### Phase 2 (PR 6) — Force sim + node tap

- `useForceSimulation` integrates d3-force.
- Tap + `hitTest.ts` (node hit only).
- Selection state + ring visual.
- Throttle sim re-renders to 30Hz; stop when `alpha < 0.01`.

**Done when:** synthetic graph self-organizes and tapping nodes selects them.

### Phase 3 (PR 7) — GraphQL `wikiSubgraph` + SDK hook + focus mode

- Schema addendum in `wiki.graphql`; resolver in `packages/api/src/resolvers/wiki/wikiSubgraph.ts`.
- `useWikiSubgraph` hook added to `@thinkwork/react-native-sdk`.
- `useFocusMode` hook; default focal resolution per F5.
- Focus change triggers subgraph fetch + camera auto-center.
- Temporary "Focus here" button on the detail sheet for switching focal.

**Done when:** opening `app/wiki/graph.tsx` loads the active agent's graph; changing focal fetches a new subgraph.

### Phase 4 (PR 8) — Label LOD + edge tap

- Labels gated by zoom per F7.
- `nearestEdge` in `hitTest.ts`.
- Edge selection + compact edge detail sheet (source/target/sectionSlug/contextExcerpt/temporal).
- Node hit wins over edge hit.

**Done when:** tapping edges works; labels reveal sensibly with zoom.

### Phase 5 (PR 9) — Temporal schema + control

- Schema migration adds `first_compiled_at`, `first_seen_at`, `last_seen_at`, `is_current`.
- Compile Lambda updated to populate them.
- `useTemporalCursor` hook; `TemporalControl` component.
- Live filter (no network); debounced re-fetch on pause/release.

**Done when:** scrubbing the slider visibly dims past-invalidated edges in real time, and re-fetch fills in older context.

### Phase 6 (PR 10) — Layout stability + expansion

- `layout/transitions.ts` position preservation.
- `hasMore` "+" badge; expansion fetch + merge.
- New nodes fade in; removed nodes fade out.
- Sim reheats at `alpha = 0.2`.

**Done when:** expansion doesn't scramble the graph; existing nodes stay put.

### Phase 7 (PR 11) — Position persistence + node drag

- `wiki_pinned_positions` table migration.
- `wikiPinnedPositions` query + `upsertWikiPinnedPositions` mutation resolvers.
- `useWikiPinnedPositions` + `useWikiUpdatePin` SDK hooks.
- Pan-on-node drag mode per F11.

**Done when:** dragging pins a node; reopening shows the graph in the same layout, per-agent-per-focal.

### Phase 8 (PR 12) — View organization + polish

- Hide branch / unpin / show-all actions.
- Loading, empty, error states.
- Accessibility labels + VoiceOver pass.
- Perf measurement + optimization pass against the budget table.

**Done when:** F12 and §7 acceptance criteria are met.

---

## 9. Out of scope (explicit)

These are *not* V1 features. Do not implement; if product pressure emerges mid-build, escalate to Eric rather than absorbing.

- Authoring pages, links, or properties (compile owns authorship).
- Inline editing of labels or properties.
- Drag-to-connect (creating edges by gesture).
- Box select / multi-select.
- Undo/redo.
- Keyboard shortcuts or gestures.
- 3D layouts.
- Non-force layouts (dagre, ELK, hierarchical).
- Clustering / bundling.
- Mini-map overview.
- Search-within-graph (sibling PRD's `wikiSearch` is the search surface).
- Graph-to-image export.
- Real-time collaborative cursors.
- Offline editing with conflict resolution.
- Per-node shared values architecture (only adopt if measured perf requires it).
- Pluggable layout strategy interface (simple d3-force config is V1).
- Cross-agent graph views (agent-scoped per Memories module).

---

## 10. Open questions

Flag these explicitly if they become blockers; otherwise, use the default noted.

1. **Default focal resolution.** §F5 proposes a priority list. If product prefers always-start-on-a-fixed-page (e.g., the user's own Entity page), confirm.
   Default: priority list as specified.

2. **Subgraph payload ceiling.** What's the max nodes/edges the server returns in one shape? Default: ≤500 nodes; paginate via expansion.

3. **Edge id stability.** Do `wiki_page_links` rows have stable ids? (Sibling PRD defines a surrogate `id`.) Default: require it; fail loudly if missing.

4. **Temporal slider range bounds.** Slider max = "now" or latest `last_seen_at` in the dataset? Default: `min(now, latest last_seen_at + 1 hour)` to avoid a dead zone at the right edge.

5. **Hidden branch UX.** De-emphasize at 10% opacity vs. fully remove from render. Default: **de-emphasize** (user retains spatial context, can unhide without losing position).

6. **Entity subtype glyph source.** Does the compile pass tag `EntityProfileFragment` with a subtype (person/company/project/repo/product), or do we infer? Default: require the compile Lambda to tag subtype on the warehouse record; if absent, render no glyph.

7. **Full graph vs agent-scoped default.** Sibling PRD commits to agent-scoping across Memories. This PRD inherits. If product wants a "tenant-wide graph" mode later, that's v1.1 — not now.

---

## 11. Success metrics

- **Adoption:** % of users who opened the Memories tab that also open the graph view in week 1.
- **Engagement:** avg. time in graph view per session; avg. focus changes per session.
- **Temporal feature usage:** % of graph sessions in which the user scrubs the temporal slider. Low usage = re-evaluate whether the feature earns its complexity.
- **Layout retention:** % of returning users whose graph loads with persisted pinned positions.
- **Expansion rate:** avg. `hasMore` expansions per session.
- **Perf regression:** 60fps frame budget violations per session (from Flipper / React Native Perf Monitor sampling).

---

## 12. Summary for the coding agent

Build a native React Native Expo force graph viewer for the ThinkWork Memories module. Entities are `WikiPage` rows (Entity / Topic / Decision); edges are `WikiPageLink` rows. Render with Skia, layout with d3-force on the JS thread, camera via Reanimated shared values on the UI thread. Integrate with the sibling Memories module's GraphQL schema, extending it with `wikiSubgraph` and `wikiPinnedPositions`. Always filter by the active agent from the Memories tab header. Temporal scrub is the headline differentiator — design for it from Phase 1, build it in Phase 5, and ensure the schema addendum in §5 lands before the temporal Lambda work begins. Do not build authoring. Escalate scope ambiguity to Eric rather than guessing.
