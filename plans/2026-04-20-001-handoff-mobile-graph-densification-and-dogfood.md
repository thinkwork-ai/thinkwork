---
title: "Handoff: mobile wiki graph — dogfood + compile-pipeline densification"
type: handoff
status: open
date: 2026-04-20
parent_plan: plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md
---

# Handoff: mobile wiki graph — dogfood + compile-pipeline densification

## Read this first

The mobile wiki force-graph viewer **shipped** to TestFlight on 2026-04-19 (UTC 2026-04-20). All 8 PRs in the original effort are in main. Authoritative summary of what shipped + what diverged from the plan is at the top of [`plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md`](2026-04-19-006-feat-mobile-wiki-force-graph-plan.md) under **"Post-Implementation Status (2026-04-20)"** — read that section before doing anything else.

This handoff covers two follow-ups that **were not built** during the initial effort:

1. **Dogfood observation pass** (passive — capture what real device usage surfaces)
2. **Compile-pipeline link-density investigation** (active — figure out why 30–54% of pages have zero `wiki_page_links` rows and propose a fix)

Each section below is self-contained — paste it into a fresh session as a prompt, or work it interactively.

---

## #1 — Dogfood observation pass

### Why this matters
We shipped the all-pages graph view based on validation against Marco's compiled pages in a simulator. Real-device usage will surface things we didn't anticipate: touch precision, pinch feel, performance on cold start, perceived density at thumb-distance, what happens when you actually try to *find* something.

The viewer is a **viewer/explorer**, not a workflow tool. The bar for "useful" is whether you'd reach for it instead of (or in addition to) the Wiki list view when looking for something. If the answer is "never," that's signal — and we should know that before investing more graph-side work.

### What to capture
Open the Wiki tab → toggle to graph view at least once per real-work session over the next 1–3 days. Capture observations in the categories below. Brevity is fine — single sentences, even bullet fragments.

**Discoverability**
- Did you find the toggle button without thinking? Or did you forget it was there?
- Did anyone else (if you show it to someone) figure out the toggle on their own?

**Density / legibility**
- At default zoom, can you tell which nodes are which? (Labels are off — only colors)
- Is the lack of labels a relief or a frustration? Try searching ("Search wiki…") and see if dim-on-non-match is enough to find a known page.
- Are the disconnected-component clusters intelligible or just noise?

**Interaction feel**
- Pinch + pan on a real device: smooth? Janky? Any frame drops you didn't see in the sim?
- Tap precision: how often does the wrong node get selected, or no node?
- Bottom sheet: useful content? Right size? Does "Focus here" feel pointless (it's a no-op) or missed?

**Workflow fit**
- Did you ever reach for the graph view without thinking "let me try the graph view"? (i.e., habitual use, not deliberate testing)
- When you tapped a node and saw the sheet, did you usually then want to "View full page" — or was the sheet enough?

**Bugs / surprises**
- Anything visibly wrong, slow, or weird

### Where to put the findings
Append a `## Dogfood observations (YYYY-MM-DD)` section to **this handoff doc** with the bullet observations + a one-line takeaway at the bottom: "Worth more graph work? Yes / No / Unclear because X."

If observations are extensive, spawn a separate PR-comment-style doc and link it.

### What NOT to do
- Don't fix things you notice during dogfood. Capture, don't fix. The point is to accumulate signal across multiple sessions before deciding what's worth building.
- Don't compare to the admin `/wiki` graph — different surface, different audience.

---

## #2 — Compile-pipeline link-density investigation

### Problem statement (with data)

The mobile graph viewer renders what's in `wiki_page_links`. As of 2026-04-20 on dev, link density per agent is:

| Agent | Pages | With ≥1 link | % linked | Avg degree | Max |
|---|---|---|---|---|---|
| GiGi  | 849 | 392 | **46%** | 1.49 | 164 |
| Marco | 261 | 183 | **70%** | 2.97 | 69  |
| Cruz  | 10  | 9   | 90%      | 3.40 | 8   |

**30–54% of pages are floating islands** — entity pages that exist in `wiki_pages` but have zero rows in `wiki_page_links` connecting them to anything.

Sample of GiGi's unlinked entities:

```
title                          | type   | agent
Harmon Guest House             | entity | GiGi
Bruges Beer Experience         | entity | GiGi
Piazza Marina                  | entity | GiGi
Flatiron's Christmas Market    | entity | GiGi
Chez Boulay-bistro boréal      | entity | GiGi
La Ciambella                   | entity | GiGi
Rock Lobster                   | entity | GiGi
Des gâteaux et du pain         | entity | GiGi
Rochelle Canteen               | entity | GiGi
Sisters                        | entity | GiGi
Lutie's Garden Restaurant      | entity | GiGi
il Sereno Hotel                | entity | GiGi
```

Pattern: **leaf entities** (specific restaurants, hotels, single-mention places) — pages that probably came from a single source where they were mentioned once, not co-mentioned with another entity that already has a wiki page.

### What "fixing this" would change

The mobile graph view (and the admin `/wiki` graph) get visually denser and more story-like — instead of a sparse cluster + dozens of floating dots, you see a more interconnected web that conveys "what this agent knows about." It's a real product win, not just a vanity metric.

### Hypotheses for why it's sparse

1. **Single-source mention rule.** Compile only writes a link when an entity is mentioned alongside another entity in the same source. Single-source entities never co-occur with anything → no links written. (Most likely.)
2. **Topic↔Entity links missing.** Topics like "France Restaurants" *aggregate* entities, but the compile may not be writing `parent_of` / `child_of` links from Topic to Entity even when the relationship is implicit in the topic's body.
3. **User↔Entity links absent.** If a User node exists (Marco's graph clearly has one — it was the dominant hub), the compile should probably auto-link any entity the user has interacted with to that User. May or may not be happening.
4. **Body-text mentions don't trigger links.** If page A's `body_md` contains a `[[B]]`-style reference but the compile didn't promote that to a `wiki_page_links` row, the user-visible link exists in markdown but not in the graph.

### Where to look in code

- **Compile orchestration:** `packages/api/src/lib/wiki/compiler.ts`
- **Repository layer (where links get written):** likely under `packages/api/src/lib/wiki/repo/` or via an `upsertPageLink` function. Grep for `wiki_page_links` writes.
- **Planner output → repo writes:** the LLM-driven planner emits some structured output that gets translated into page + link upserts. Find where that translation happens.
- **Existing link-write trigger:** look at where any existing `wiki_page_links` row gets inserted to understand the current heuristic.
- **`[[Page]]`-style markdown:** if body_md has bracketed references, `wiki-iter-13-linkify-leaf` (#264) recently shipped "linkify bolded entity mentions in leaf-planner bodies." That might be relevant — it could be writing markdown links without writing `wiki_page_links` rows. Check that PR's diff.

### Investigation script (run first to refine hypotheses)

```bash
export DATABASE_URL="postgresql://thinkwork_admin:%3CDEV_DB_PASSWORD_ROTATED_2026_05_05%3E@thinkwork-dev-db.cluster-cmfgkg8u8sgf.us-east-1.rds.amazonaws.com:5432/thinkwork?sslmode=require"

# 1. How many sections does each unlinked page have? (Single-source vs. multi-source pattern)
psql "$DATABASE_URL" -c "
WITH unlinked AS (
  SELECT p.id, p.title FROM wiki_pages p
  WHERE p.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM wiki_page_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id)
  LIMIT 50
)
SELECT u.title,
       (SELECT COUNT(*) FROM wiki_page_sections s WHERE s.page_id = u.id) AS sections,
       (SELECT COUNT(*) FROM wiki_section_sources ss
        JOIN wiki_page_sections s2 ON s2.id = ss.section_id WHERE s2.page_id = u.id) AS source_count
FROM unlinked u
ORDER BY source_count DESC;
"

# 2. How many [[Page]]-style references appear in the body_md of unlinked pages?
#    (If body_md has them but wiki_page_links doesn't, that's the gap.)
psql "$DATABASE_URL" -c "
SELECT p.title,
       (SELECT COUNT(*) FROM regexp_matches(s.body_md, '\\[\\[[^\\]]+\\]\\]', 'g')) AS bracket_refs
FROM wiki_pages p
JOIN wiki_page_sections s ON s.page_id = p.id
WHERE p.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM wiki_page_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id)
LIMIT 30;
"

# 3. Distribution of link counts across all pages
psql "$DATABASE_URL" -c "
SELECT
  COUNT(*) FILTER (WHERE link_count = 0) AS zero,
  COUNT(*) FILTER (WHERE link_count BETWEEN 1 AND 2) AS one_two,
  COUNT(*) FILTER (WHERE link_count BETWEEN 3 AND 5) AS three_five,
  COUNT(*) FILTER (WHERE link_count BETWEEN 6 AND 10) AS six_ten,
  COUNT(*) FILTER (WHERE link_count > 10) AS over_ten
FROM (
  SELECT (SELECT COUNT(*) FROM wiki_page_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id) AS link_count
  FROM wiki_pages p WHERE p.status = 'active'
) t;
"
```

### Proposed work (do NOT implement until scoped)

This handoff is **investigation + framing**, not a build. After running the queries above and reading the relevant compile code, write a short follow-up plan that captures:

1. **Confirmed hypothesis** — which of the 4 above is the actual root cause? Could be more than one.
2. **Proposed denser linking heuristic** — concrete rule(s) the compile should add. Examples:
   - "Auto-link any entity in a topic page's `linked_page_ids` aggregation to that topic via `parent_of`."
   - "When promoting an alias to a page, write a link from the source page to the new page."
   - "Backfill links from existing `[[bracketed]]` refs in body_md."
3. **Migration / backfill plan** — a one-time script to populate links from existing data, OR accept that historical pages stay sparse and only future compiles densify.
4. **Risk** — any way denser linking could create wrong links (false positives)? How would we know?

Then open the plan doc, get review, **then** ship.

### Out of scope for this investigation
- Don't touch the graph viewer code. The viewer is correct given current data; this is upstream.
- Don't add new GraphQL endpoints for compile observability — existing queries (above) are enough.
- Don't redesign the compile pipeline architecture. Look for the smallest change that increases density safely.

### Open questions to flag if blocked
- Is link sparsity actually a known issue, or has nobody noticed? (Check Slack / GitHub issues.)
- Is there a planned "linkify v2" or similar work already in flight that this overlaps with?
- Is the User node a special case (always present, special semantics) or just an emergent hub?

---

## References

**Plans / docs**
- Parent plan (post-impl status): [`plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md`](2026-04-19-006-feat-mobile-wiki-force-graph-plan.md)
- Original PRD: [`plans/compounding-memory-mobile-memories-force-graph.md`](compounding-memory-mobile-memories-force-graph.md)
- Sibling: [`plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md`](2026-04-19-003-refactor-admin-wiki-graph-plan.md)
- Hierarchical aggregation (related compile work): [`plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`](2026-04-19-002-feat-hierarchical-aggregation-plan.md)

**Shipped PRs (mobile graph effort)**
- #273 Unit 1 — scaffold + camera + theme + Skia + Inter
- #274 Unit 2 — d3-force sim + node tap + selection
- #278 Unit 3 (re-do of #276) — wikiSubgraph resolver + SDK hook + focal/detail
- #279 fix — wikiSubgraph edges UUID array binding
- #280 — all-pages swap + label removal + force layout tuning
- #281 — chore: drop unused wikiSubgraph hook + resolver + GraphQL types
- #282 — chore: plan-doc annotated with what shipped
- #283 — chore: rename Pages tab back to Wiki

**Possibly relevant compile-side PR**
- #264 — `feat(memory): linkify bolded entity mentions in leaf-planner bodies` (recent — check whether this changed link-emission behavior)

**Code surfaces for #2**
- `packages/api/src/lib/wiki/compiler.ts` — orchestration
- `packages/api/src/lib/wiki/` — repo layer + planner glue
- `packages/database-pg/src/schema/wiki.ts` — `wiki_page_links` schema (note: the unique index is `(from_page_id, to_page_id, kind)` so multiple `kind` values can coexist between the same pair)

**Memory worth re-reading before compile work**
- `feedback_graphql_deploy_via_pr` — never `aws lambda update-function-code` directly
- `feedback_avoid_fire_and_forget_lambda_invokes` — user-driven mutations need RequestResponse
- `feedback_pr_target_main` — never stack PRs against another feature branch

**Database connection (for ad-hoc queries)**
```
DATABASE_URL="postgresql://thinkwork_admin:%3CDEV_DB_PASSWORD_ROTATED_2026_05_05%3E@thinkwork-dev-db.cluster-cmfgkg8u8sgf.us-east-1.rds.amazonaws.com:5432/thinkwork?sslmode=require"
```
Marco's agent id: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c`
