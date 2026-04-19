# Compounding Memory — Mobile Memories UI PRD

**Status:** Draft · 2026-04-18
**Owner:** Eric
**Related:**
- `.prds/compounding-memory-company-second-brain-prd.md`
- `.prds/compiled-memory-layer-engineering-prd.md`
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
- `.prds/compounding-memory-implementation-plan.md`
- `.prds/compounding-memory-visuals.md`
- `.prds/compounding-memory-review.md`

---

## 1. Problem & Context

The compounding memory pipeline (spec'd across the related PRDs) will produce a wiki-style knowledge layer on top of raw memory: an LLM compile pass collapses the 7-type warehouse (EventFact, PreferenceOrConstraint, Experience, Observation, EntityProfileFragment, DecisionRecord, UnresolvedMention) into **three reader-facing page types**:

| Type | Scope | Purpose |
|---|---|---|
| **Entity** | Tenant-shared (`owner_id IS NULL`) | People, companies, projects, repos — shared facts the tenant converges on |
| **Topic** | Per-user (`owner_id IS NOT NULL`) | Synthesized observations and patterns relevant to the individual |
| **Decision** | Per-user | Confirmed decisions with rationale |

Today, users have no way to see any of this from the mobile app. The Memories tab exists (`apps/mobile/app/(tabs)/index.tsx:219-559`) — Threads/Memories toggle, empty state, and "Add new memory…" composer — but nothing is wired to data.

**Why this matters:** the compile pipeline is net-new knowledge being produced for each user/agent pair. Without a browsing surface, the agent can cite it internally but the human can neither trust it nor correct it. The mobile Memories tab is the first human-readable window into the compiled memory layer.

---

## 2. Goals / Non-goals

### Goals
- Let a user **browse** the compounded memory that belongs to (or is visible to) the currently selected agent, grouped or filtered by Entity / Topic / Decision.
- Let a user **search** full-text across titles, summaries, and section bodies for a given agent.
- Let a user **read a single compiled page** wiki-style — summary, sections, aliases, backlinks, sources — in a mobile-appropriate layout.
- Let a user **see the relationships** between pages (inbound + outbound links) without leaving the detail view.
- Let a user **capture raw memory manually** via the existing footer composer; the input routes into the warehouse as an `UnresolvedMention`, which the compile pipeline can later promote.

### Non-goals (v1)
- **No editing.** Sections are managed by the compile Lambda; manual edits land post-v1.
- **No full graph explorer.** The relationship view is a compact, page-local visualization — not a navigable whole-tenant graph.
- **No admin / compile controls** on mobile. Triggering a recompile is admin-only and lives in the existing admin app.
- **No cross-agent memory merging.** The tab is agent-scoped; switching agents switches the list.
- **No push notifications** on new compiled pages.

---

## 3. User Stories

1. *As a user*, when I open the Memories tab for Marco, I see a list of everything Marco has compounded knowledge about — grouped by type — so I know what Marco actually "knows."
2. *As a user*, I can tap a segmented control to narrow the list to just Entities, Topics, or Decisions and see counts per type.
3. *As a user*, I can search "Acme" and get matching pages across all three types, ranked by relevance.
4. *As a user*, I can open an Entity page and see a wiki-style view: title, summary, sections, aliases the entity is known by, backlinks from other pages, and the source threads the content was drawn from.
5. *As a user*, on a detail page I can see at a glance which other pages this one links to and from, and tap to navigate.
6. *As a user*, when I remember something important that hasn't been captured, I type it into the "Add new memory…" footer and it becomes an `UnresolvedMention` — with a toast confirming that a future compile pass can promote it.
7. *As a user*, if the agent has pending unresolved mentions, I see a small callout at the top of the list inviting me to review them.

---

## 4. Information Architecture

```
Memories tab (in (tabs)/index.tsx)
├── Header (Marco ⌄, filter funnel, ⋯ menu)        [existing]
├── Threads / Memories segmented toggle             [existing]
├── UnresolvedMentionsCallout                       [new, conditional]
├── MemoryFilterBar  [All | Entities | Topics | Decisions]
├── FlatList<MemoryRow>
└── MessageInputFooter "Add new memory…"            [existing, re-wired]
          │
          ▼ tap row
Wiki detail page (app/wiki/[slug].tsx)
├── Title, TypeBadge, status, lastCompiledAt, aliases
├── Sections (markdown cards)
├── RelationshipChips   (inbound + outbound links)
├── [optional] RelationshipGraph (behind "Show graph" expander)
└── SourcesStrip        (provenance → thread refs)
```

The detail page route uses `/wiki/[slug]` — a new namespace — to avoid collision with the legacy `app/memory/*` routes that serve the old `memoryRecords` system.

---

## 5. Agent Scope — filter by agent, show all 3 types

### Requirement
The tab filters to items associated with the currently active agent (e.g. "Marco") but shows Entity + Topic + Decision together.

### Schema addendum (PRD gap)
`.prds/compiled-memory-layer-engineering-prd.md` does not currently carry an agent reference on `wiki_pages`. Agent association is derivable through `wiki_section_sources.source_ref → threads.agent_id`, but querying through that graph on every mobile list fetch is too slow.

**Proposed migration** (to land with or immediately after the `wiki_pages` migration):

```sql
ALTER TABLE wiki_pages
  ADD COLUMN primary_agent_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_touched_agent_id uuid NULL;

CREATE INDEX wiki_pages_agents_gin
  ON wiki_pages USING GIN (primary_agent_ids);
```

The compile Lambda populates `primary_agent_ids` by aggregating the `agent_id` of every thread referenced by the page's section sources. `last_touched_agent_id` is the most recent contributor and drives row ordering for recency filters.

Rejected alternatives:
- **Join table `wiki_page_agents`** — more normalized but adds a hot-write path for a read-side filter.
- **Pure derivation at query time** — acceptable for admin but too slow for scroll-heavy mobile lists.

### Multi-user wrinkle
Because Decision pages are per-user (`owner_id IS NOT NULL`), two users on the same tenant sharing Marco will each see their own Decisions. This is by design (the compile layer treats Decisions as personal). The UI surfaces an owner indicator on Decision rows to make this explicit; no cross-user merge in v1.

---

## 6. Screen Specs

### 6a. Memories list

**Layout:**
- Sticky `MemoryFilterBar` below the existing Threads/Memories toggle — segmented control with 4 segments: `All · Entities · Topics · Decisions`, each carrying a live count.
- Secondary filters (status: active/stale/archived; owner scope: mine/tenant/all; "only unresolved") live inside the existing header filter-funnel modal — same UX affordance as `components/threads/ThreadFilterBar.tsx`.
- `UnresolvedMentionsCallout` renders at the top of the FlatList as a non-sticky banner when `unresolvedMentionsCount > 0`: "N mentions waiting to be compiled → Review".
- `FlatList<MemoryRow>` backs the list with pull-to-refresh.

**MemoryRow:**
- Left: `TypeBadge` (colored pill: Entity = sky, Topic = amber, Decision = violet — exact tokens TBD by design)
- Center: title (1 line) · 2-line summary preview
- Right: `lastCompiledAt` relative timestamp · link-count chip (e.g. `↔ 4`)
- Tap → `router.push('/wiki/{slug}')`

**Data binding:**
```ts
useWikiPages({
  tenantId,
  agentId: activeAgent.id,
  pageType,         // undefined = all
  ownerScope,       // from secondary filter
  status,
});
```

**Empty states:** per filter ("No Entities yet", "No Decisions yet"), with a subtle hint that compile runs nightly.

### 6b. Detail page — `app/wiki/[slug].tsx`

1. **Header block** — title, `TypeBadge`, status pill, `lastCompiledAt` ("compiled 2h ago"), aliases as chip cluster. Owner indicator on Topic/Decision pages ("Yours" vs. owner avatar when surfaced by admin overrides).
2. **Sections** — each `wiki_page_sections.body_md` rendered with the mobile markdown renderer already used in chat. Section headings act as in-page anchors.
3. **RelationshipChips** — horizontal scroll strip of outbound links (`wiki_page_links` from this page), plus a vertical list of backlinks (via `wikiBacklinks` query). Each chip carries the target page's `TypeBadge`.
4. **RelationshipGraph (optional, v1.1)** — collapsible "Show graph" section rendering a small 1-hop diagram using `react-native-svg`. Nodes colored by type. Taps navigate to neighbor pages. Shipped behind an expander to keep the default view calm.
5. **SourcesStrip** — provenance footer: thread-ref chips that deep-link into `/thread/{id}`.

### 6c. Manual memory capture

The existing `MessageInputFooter` stays in place with placeholder "Add new memory…". `onSubmit` calls:

```ts
await captureManualMemory({
  tenantId,
  agentId: activeAgent.id,
  text,
  hintType,   // optional — user hasn't picked one in v1
});
```

Server inserts into `wiki_unresolved_mentions`. Success → toast "Saved to unresolved mentions" with a "Review" action that scrolls the list to the callout. Failure is surfaced inline (not fire-and-forget).

---

## 7. API Surface

### 7a. GraphQL — `packages/database-pg/graphql/types/wiki.graphql` (new)

```graphql
enum WikiPageType { ENTITY TOPIC DECISION }
enum WikiPageStatus { ACTIVE STALE ARCHIVED }
enum OwnerScope { ME TENANT ALL }

type WikiPage {
  id: ID!
  tenantId: ID!
  ownerId: ID
  pageType: WikiPageType!
  slug: String!
  title: String!
  summaryMd: String!
  status: WikiPageStatus!
  version: Int!
  lastCompiledAt: DateTime!
  lastTouchedAgentId: ID
  primaryAgentIds: [ID!]!
  sections: [WikiPageSection!]!
  aliases: [String!]!
  outboundLinks: [WikiPageLink!]!
}

type WikiPageSection {
  id: ID!
  sectionSlug: String!
  bodyMd: String!
  position: Int!
  sources: [WikiSectionSource!]!
}

type WikiPageLink {
  fromPageId: ID!
  toPageId: ID!
  sectionSlug: String
  contextExcerpt: String
  target: WikiPage!
}

type WikiSectionSource {
  sourceKind: String!   # e.g. "thread", "observation"
  sourceRef: String!
  firstSeenAt: DateTime!
}

type UnresolvedMention {
  id: ID!
  text: String!
  capturedAt: DateTime!
  candidateType: WikiPageType
  resolutionState: String!
}

type WikiPageConnection {
  edges: [WikiPage!]!
  nextCursor: String
  counts: WikiPageCounts!
}

type WikiPageCounts {
  entity: Int!
  topic: Int!
  decision: Int!
  unresolved: Int!
}

type WikiSearchResult {
  pages: [WikiPage!]!
  totalMatches: Int!
}

extend type Query {
  wikiPages(
    tenantId: ID!
    agentId: ID
    pageType: WikiPageType
    ownerScope: OwnerScope
    status: WikiPageStatus
    limit: Int = 50
    cursor: String
  ): WikiPageConnection!

  wikiPage(slug: String!, tenantId: ID!): WikiPage

  wikiBacklinks(pageId: ID!): [WikiPageLink!]!

  wikiSearch(
    tenantId: ID!
    query: String!
    agentId: ID
    pageType: WikiPageType
    limit: Int = 20
  ): WikiSearchResult!

  wikiUnresolvedMentions(
    tenantId: ID!
    agentId: ID
    ownerId: ID
    limit: Int = 25
  ): [UnresolvedMention!]!
}

extend type Mutation {
  captureManualMemory(
    tenantId: ID!
    agentId: ID!
    text: String!
    hintType: WikiPageType
  ): UnresolvedMention!
}
```

Resolvers under `packages/api/src/resolvers/wiki/` follow the pattern from `packages/api/src/resolvers/memory/`. `wikiSearch` uses the existing `search_tsv` GIN index on `wiki_pages`. Scope filtering applies tenant + optional agent + owner rules at the application layer per the existing ThinkWork pattern.

### 7b. SDK hooks — `@thinkwork/react-native-sdk`

New hooks under `packages/react-native-sdk/src/hooks/`:

- `useWikiPages({ agentId, pageType, ownerScope, status, search? })` — paginated list
- `useWikiPage(slug)` — detail
- `useWikiBacklinks(pageId)` — relationship view
- `useWikiSearch(query, { agentId, pageType })` — debounced FTS
- `useUnresolvedMentions({ agentId })` — count + list for the callout
- `useCaptureManualMemory()` — mutation hook for the footer

All follow the urql pattern from `use-threads.ts` / `use-messages.ts`. Exported from `packages/react-native-sdk/src/index.ts`. SDK version bumps to `0.3.0-beta.0` (new public hooks = minor per the `sdk-v*` publish convention from commit `e392434`).

---

## 8. Visual Language

- **Type colors** (tokens TBD with design): Entity = sky-500, Topic = amber-500, Decision = violet-500. Used consistently across `TypeBadge`, graph nodes, and chip borders.
- **Density:** MemoryRow is ~72px tall — slightly taller than `ThreadRow` to fit the 2-line summary, still scannable.
- **Motion:** subtle fade-in on list load; pull-to-refresh uses the existing RefreshControl pattern.
- **Dark mode:** inherits existing theme tokens from `lib/theme.ts`.
- **Iconography:** lucide-react-native (already the primary icon lib). Entity = `User`/`Building2`/`Folder` by subtype, Topic = `Lightbulb`, Decision = `CheckCircle2`.

---

## 9. Dependencies

| Dependency | Status | Blocker? |
|---|---|---|
| `wiki_pages` schema migration | Planned, not merged | Blocks PR 3+ |
| Compile Lambda producing rows | Planned, phase 4 of build plan | Blocks prod rollout, not mobile dev (mock adapter) |
| Agent-linkage schema addendum (§5) | This PRD proposes it | Must be merged before list API |
| `captureManualMemory` warehouse insert path | Exists as `UnresolvedMention` | None — warehouse accepts inserts today |
| TypeBadge color tokens | Needs design sign-off | Soft blocker on final polish |

---

## 10. Rollout Plan — 4 PRs

1. **Schema + GraphQL** — `wiki.graphql` + migration for agent linkage + resolver stubs returning empty data until compile produces rows.
2. **SDK hooks** — the six new hooks + exports + version bump + CHANGELOG entry.
3. **Mobile list + wiki detail** — `MemoryRow`, `TypeBadge`, `MemoryFilterBar`, list wiring in `(tabs)/index.tsx`, `app/wiki/[slug].tsx` with sections + `RelationshipChips`.
4. **Manual capture + graph view** — footer wired to `captureManualMemory`, `UnresolvedMentionsCallout`, optional `RelationshipGraph` behind expander.

Each PR ships from an isolated worktree under `.claude/worktrees/` per the project's worktree-isolation convention.

Feature flag `EXPO_PUBLIC_MEMORY_MOCK=1` lets mobile ship and iterate against fixture data while the compile Lambda catches up.

---

## 11. Verification / Acceptance

### Per PR
- **PR 1:** GraphQL schema compiles; resolvers return typed empty data; migration runs cleanly on seeded dev DB.
- **PR 2:** SDK hooks pass urql mock tests; SDK publishes as beta tag.
- **PR 3:** `bun ios`, select Marco, tap Memories → 3 types render from fixtures; tap a row → detail page; tap a backlink chip → navigates.
- **PR 4:** Submit footer text → toast confirms `UnresolvedMention` created; row appears in callout; graph view renders for a page with ≥3 links.

### End-to-end (post compile Lambda)
- Chat with Marco mentioning "Acme"; run compile; pull-to-refresh Memories → a new Entity row for Acme appears.
- Search "Acme" → FTS returns matches across all 3 types.
- Switch agent → list recomputes to the new agent's memory.

### Performance bar
- 200 fixture pages → 60fps scroll on iPhone 13.
- `wikiSearch` p95 ≤ 300ms on Postgres FTS (GIN) with tenant + agent filter.

---

## 12. Open Questions

1. Does the Compile Lambda author sign off on the `primary_agent_ids` / `last_touched_agent_id` denormalization, or prefer a join table?
2. For Decision pages (per-user), should admins ever see a "team rollup" view, or is strictly per-user the long-term model?
3. Should the footer composer offer a `hintType` picker, or let the compile pass infer purely from text?
4. What's the delete path? v1 has no user-facing delete; are admins expected to hit Hindsight APIs directly, or do we need a "Hide from this agent" affordance?
5. Should `RelationshipGraph` ship in v1 (alongside chips) or be deferred to a fast-follow?

---

## 13. Success Metrics

- **Adoption:** % of active mobile users who visit the Memories tab in week 1 post-ship.
- **Engagement:** avg. wiki detail pages opened per session on Memories tab.
- **Search usage:** queries per user per week against `wikiSearch`.
- **Manual capture:** manual mentions submitted per user per week, and promotion rate from unresolved → compiled page.
- **Trust signal:** qualitative — do users start referencing compiled pages when chatting with their agent ("the memory says X")?
