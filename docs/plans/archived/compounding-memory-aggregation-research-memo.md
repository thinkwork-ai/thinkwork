# Compounding Memory aggregation failure memo

## Bottom line

ThinkWork's current pipeline is well-shaped for **safe page creation**, but it is still weak at **cross-record aggregation**. It has the mechanics to avoid junk, but not yet the mechanics to reliably turn many related memories into durable higher-order pages.

That is why you can plausibly end up with lots of leaf pages like individual restaurants, places, or one-off named entities, while failing to form stronger pages like:
- **Austin** as a durable city page
- **Paris** as more than isolated venue mentions
- **Mexico** as a trip/workstream/topic hub
- **restaurants** as a recurring preference/workflow/topic layer

In short: the system currently knows how to **store and patch pages**, but it does not yet know how to **induce, canonicalize, and maintain aggregates**.

## 1. Likely root causes

### A. The planner is batch-local, so aggregation opportunities are fragmented
The compiler reads records in pages (`RECORD_PAGE_SIZE = 50`) and asks the planner to act on the current batch plus a page catalog. That is good for bounded cost, but bad for topic induction.

Consequence:
- restaurant records from one Mexico trip may be split across many batches
- Austin mentions may appear across months, never co-present strongly enough in one batch
- the planner sees evidence in shards, so it creates/updates leaves more easily than it forms barrel pages

This is the biggest reason compounding can stall at leaf pages.

### B. Alias resolution is still too shallow to support real entity consolidation
Current matching is basically normalized alias matching (`normalizeAlias`), not true entity resolution.

That means the system is weak at recognizing that these may belong together:
- "CDMX", "Mexico City", "Mexico"
- "Austin", "Austin, TX", "downtown Austin"
- a restaurant, its neighborhood, and its city
- repeated venue mentions across different journal entries with slightly different wording

Without stronger canonicalization, aggregation never gets a stable target.

### C. Unresolved mentions are present, but too skinny to drive promotion well
The docs correctly treat unresolved mentions as load-bearing. But in the current repo shape, open mentions passed to the planner are mostly:
- alias
- normalized alias
- count
- suggested type

That is not enough context to promote intelligently.

Missing pieces:
- clustered evidence across records
- co-occurring entities
- parent place candidates
- section-ready summaries of why the mention matters
- disagreement/ambiguity state

So unresolved mentions act more like a holding pen than a true staging area for aggregate page formation.

### D. The pipeline has no explicit topic induction / clustering pass
Right now, planning is asked to decide update vs create vs unresolved, but there is no strong dedicated step that says:
- these 14 restaurant pages belong to a higher-order Mexico food cluster
- these 9 place mentions should roll up under Austin
- these Paris visits should reinforce one city page plus one trip topic page

Without an explicit clustering step, the model defaults to the most literal durable object in front of it, usually the leaf entity.

### E. The page taxonomy is right, but the incentives still favor entities over topics
In practice, entities are easy:
- they have names
- they slug cleanly
- they fit page templates
- they feel concrete

Topics are harder:
- their boundaries are fuzzy
- they compete with decisions and entities
- they need cross-record synthesis
- the planner is told to be conservative

So a cautious planner will overproduce entity pages and underproduce topic pages.

### F. Links are being treated as helpful structure, but not as aggregation pressure
The planner prompt now encourages page links, which is good. But linking alone does not create a real barrel page.

If the system creates:
- Taberna dos Mercadores
- Pujol
- Austin motel
- Paris cafe

and only links them loosely, you still get a graph of leaves, not a compiled second brain.

A strong aggregate pipeline must use links plus rollups plus hierarchy, not links alone.

### G. Section-level rewriting protects trust, but also slows synthesis unless paired with section-level rollups
Section-level patching is the right architecture. But if section updates only happen after a target page already exists, then aggregation is bottlenecked on page-target formation.

So the real weak point is not rewriting. It is **target induction**.

### H. The current pipeline lacks parent-child geography and collection semantics
Examples like Austin, Paris, Mexico, and restaurants all depend on containment or collection logic:
- restaurant -> neighborhood -> city -> country
- venue -> trip/journal -> broader travel topic
- place -> recurring preference category (restaurants, coffee, parks)

Right now those semantics are implied in metadata, but not strongly operationalized in planning or promotion.

## 2. What a strong compounding pipeline should do differently

A strong pipeline should not just ask, "what page does this record belong to?"
It should also ask:
- what **entity** does this refer to?
- what **collection** is this part of?
- what **parent page** should accumulate this?
- what **section** on an existing aggregate page should be reinforced?
- what should remain leaf-level vs rolled up?

The strong version has four extra muscles:

### 1. Canonicalization
Resolve aliases and near-duplicates into stable subjects.

### 2. Cluster induction
Periodically group records/pages/mentions into emergent topics or collections.

### 3. Hierarchical compilation
Maintain parent pages and barrel pages explicitly, not just leaf pages.

### 4. Section-level rollups
Compile not only entity pages, but aggregate sections like:
- "Notable restaurants in Mexico"
- "Austin patterns"
- "Paris visits"
- "Restaurant preferences"

## 3. Concrete refinement recommendations for ThinkWork

### Recommendation 1. Add a dedicated aggregation planner pass
Keep the current planner, but add a second pass that operates over:
- recently changed pages
- unresolved mentions
- link neighborhoods
- co-occurrence clusters
- journal/trip metadata

Its only job should be:
- propose parent pages
- propose merges
- propose rollup section updates
- propose topic promotions

This should be architecture, not prompt cleverness.

### Recommendation 2. Upgrade unresolved mentions into evidence-backed mention clusters
Instead of only storing alias + count, store:
- top supporting record ids
- representative contexts
- co-mentioned entities
- candidate parent pages
- candidate canonical titles
- cluster centroid or summary
- ambiguity notes

Then promotions can create good aggregate pages instead of just more leaves.

### Recommendation 3. Introduce explicit barrel-page patterns
Examples:
- **Austin** page with sections for overview, neighborhoods, food, notable visits
- **Mexico** page with sections for trips, cities, restaurants, memories
- **Restaurants** topic page with cuisine/location sub-sections
- **Portugal trip 2023** topic page that links and summarizes all restaurant entities

These should be first-class compile targets, not incidental outcomes.

### Recommendation 4. Use metadata to force aggregation candidates
The journal import already carries place/journal/tags metadata. Use it much harder.

Examples:
- same `journal_id` -> candidate trip topic page
- repeated `place_types=restaurant` -> candidate restaurant collection page
- repeated city/country metadata -> geographic barrel page
- tags like food/restaurant -> preference/topic accumulation

Right now this metadata helps grounding, but it is not doing enough target selection work.

### Recommendation 5. Add parent-child geography/entity rules before LLM planning
Some aggregation should be deterministic or heuristic first.

Examples:
- if records mention a venue with city metadata, reinforce city page candidate
- if a city page exists, route place records there as well as to leaf entity page
- if many restaurant entities share a trip/journal/city, queue an aggregate topic update

Do not make the model rediscover containment every time.

### Recommendation 6. Make topic creation easier once entity clusters are dense
The docs rightly say updating should be easier than creating. Keep that.

But topic creation currently seems too hard relative to entity creation. Add policy like:
- if 5+ linked entities share a city/journal/tag cluster, create/update a topic page
- if 3+ entities repeatedly co-occur, create a collection page
- if one parent page is cited by many recent records, rewrite its rollup sections automatically

### Recommendation 7. Split "entity page" from "aggregate entity page"
Some named things are leaves, some are hubs.

Austin, Paris, and Mexico are not just ordinary entities. They are likely **hub entities**. That means they need different section expectations and stronger promotion pressure than a single restaurant.

### Recommendation 8. Add merge review and duplicate pressure
A compounding system should periodically ask:
- which pages are near-duplicates?
- which pages should be aliases instead?
- which leaves should be merged under a stronger canonical page?
- which pages have backlinks but no summary role?

This is the same lesson entity-resolved knowledge graph systems emphasize: unresolved duplicates produce disconnected facts, not knowledge.

## 4. Recommended next experiments and instrumentation

### Instrumentation to add first
Track these per compile job:
- pages created vs pages updated
- entity/topic/decision ratio
- unresolved mention inflow vs promotion rate
- links per page
- orphan pages
- pages with zero inbound links
- duplicate-title / near-duplicate-title candidates
- cluster density by city/tag/journal
- % of records that update an existing aggregate page

### Experiments

#### Experiment A. Replay on Amy journal data with aggregation metrics
Measure:
- how many restaurant entities are created
- how many city/country/topic pages are created
- how many records touch only leaves vs also touch parents

If the output is mostly restaurant pages with weak city/topic rollups, the diagnosis is confirmed.

#### Experiment B. Add deterministic geographic rollups
Before planner call, attach parent candidates like city/country/journal topic.
Compare:
- baseline planner
- planner with parent candidates injected

#### Experiment C. Promote mention clusters, not raw mentions
Replace simple unresolved promotion with cluster promotion. Compare page quality and duplication.

#### Experiment D. Add a nightly aggregation pass
Run over changed pages and open mentions only, looking for:
- parent page opportunities
- merge opportunities
- topic page creation
- missing barrel pages

This is likely the highest-leverage improvement.

#### Experiment E. Score pages by "hubness"
Use simple metrics:
- inbound links
- distinct supporting records
- distinct co-mentioned entities
- temporal spread

If Austin/Paris/Mexico score high on hubness but remain thin pages, the pipeline is under-aggregating.

## 5. External references worth keeping

### Karpathy, llm-wiki
Best reminder that the goal is not retrieval, but a **persistent compiled artifact** that gets incrementally maintained. Strongly supports ThinkWork's warehouse -> compiler architecture. Also reinforces linting, cross-references, and filing query outputs back into the wiki.

### Hindsight docs / paper
Useful for retain, recall, reflect, observation consolidation, and evidence grounding. But it mostly helps with **memory substrate and observation formation**, not full compiled-page aggregation policy. In ThinkWork terms: it helps remember, but does not decide what should become Austin vs Mexico vs restaurants.

### Cloudflare Agents state model
Useful reminder that durable memory/state primitives are substrate, not compilation. Persistence and synchronization are necessary, but they do not by themselves produce higher-order knowledge organization.

### Entity-resolved knowledge graph literature / Senzing overview
Very relevant. Their central point maps directly here: if duplicates and missed links remain unresolved, you do not get knowledge, you get disconnected facts. ThinkWork needs the page-level equivalent of entity resolution plus graph consolidation.

## Opinionated recommendation

Do **not** try to fix this with a better single planner prompt.

The likely issue is structural:
- exact-match-ish resolution
- batch-local planning
- weak mention staging
- no explicit cluster induction
- no strong parent/barrel-page maintenance pass

The right move is to keep the current safe compiler shape, then add a dedicated **aggregation layer** between retention and section writing.

That layer should decide not just "what page changed," but "what knowledge unit is emerging here, and what parent page should get smarter because of it?"
