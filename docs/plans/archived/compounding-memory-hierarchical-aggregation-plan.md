# Compounding Memory — Hierarchical Aggregation Plan

## Purpose

This plan refines the current Compounding Memory pipeline so it produces real aggregation, not just a growing graph of leaf pages.

The core shift is:

- memories should not only create or update leaf pages
- related memories should accumulate into **sections on hub pages**
- when a section becomes large and coherent enough, it should **promote into its own page**
- that new page can then grow its own sections and promote again over time

This is the compounding behavior we actually want.

## Context

This plan builds on the existing Compounding Memory package and the aggregation research memo.

Key inputs:
- `.prds/compounding-memory-agent-brief.md`
- `.prds/compounding-memory-review.md`
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
- `.prds/compiled-memory-layer-engineering-prd.md`
- `.prds/compounding-memory-scoping.md`
- `.prds/compounding-memory-aggregation-research-memo.md`
- `.prds/compounding-memory-v1-build-plan.md`

## Core idea

The system should behave like this:

1. a memory reinforces a concrete page when appropriate
2. that same memory may also reinforce a **section** on a parent or hub page
3. when a section becomes dense enough, it is promoted into a **topic page**
4. the parent page keeps a summary and link to the promoted page
5. the promoted page can then grow sub-sections that may later promote again

This gives us recursive compounding without inventing a huge new page taxonomy.

## Keep the v1 page taxonomy

Do **not** add new formal page types yet.

Keep:
- `entity`
- `topic`
- `decision`

Hierarchy should emerge from:
- page links
- parent-child relationships
- section promotion
- hub/page role

So:
- **Austin** is an `entity`
- **Austin Restaurants** is a `topic`
- **Austin Mexican Restaurants** is a `topic`

## Example lifecycle

### Stage 1: leaf creation

Individual restaurant memories create or reinforce restaurant entity pages:
- Franklin Barbecue
- Uchi
- Suerte
- Nixta

### Stage 2: hub section accumulation

Those same memories also reinforce a section on the **Austin** page:
- `Restaurants`

That section contains:
- short summary
- notable patterns
- links/backlinks to the restaurant pages

### Stage 3: section promotion

When the `Restaurants` section on Austin becomes dense and coherent enough, the system promotes it into:
- **Austin Restaurants** (`topic`)

The Austin page should then keep:
- a short restaurants summary
- top highlights
- a link to `Austin Restaurants`

### Stage 4: recursive promotion

As `Austin Restaurants` grows, one of its sections may become large enough to promote:
- `Mexican`
- `BBQ`
- `Coffee`

That can produce:
- **Austin Mexican Restaurants** (`topic`)

This is the recursive compounding loop.

## What should change in the pipeline

## Current weak shape

The current pipeline behaves too much like:

`record -> page`

That overproduces leaf pages and underproduces hub/collection pages.

## New target shape

The pipeline should behave more like:

`record -> leaf candidate + parent section candidate + collection candidate`

That means a single memory may trigger:
- a leaf page update
- a parent page section update
- a collection/topic promotion check

## Proposed staged pipeline

### Stage A. Normalize memory inputs

No major conceptual change here.

For each retained memory record, extract or preserve:
- canonical entities
- aliases
- place hierarchy if known
- tags/categories if known
- journal/trip/container ids if known
- related entities
- timestamps / recency

### Stage B. Resolve leaf targets

Determine whether the memory should create or update a concrete page.

Examples:
- restaurant page
- city page
- person page
- project page

This stage should stay conservative and safe.

### Stage C. Expand aggregation candidates

For each memory and leaf target, derive candidate hub/rollup targets.

Examples:
- restaurant in Austin -> candidate parent `Austin`
- restaurant tagged `food` -> candidate collection `Restaurants` / `Food`
- restaurants tied to the same journal/trip -> candidate trip topic
- repeated Mexico restaurant memories -> candidate `Mexico Restaurants`

This is where the current pipeline is too weak.

### Stage D. Update parent sections

Instead of only updating leaf pages, the compiler should also update sections on existing parent pages.

Examples:
- `Austin` page, `Restaurants` section
- `Mexico` page, `Restaurants` section
- `Restaurant Preferences` page, `Mexican` section

These section updates should:
- add links to child pages
- summarize the cluster briefly
- keep provenance
- track supporting records and linked child pages

### Stage E. Evaluate promotion

After section updates, evaluate whether a section should stay a section or become its own page.

Promotion should create a new page when the section is:
- dense enough
- coherent enough
- persistent enough
- useful enough to stand alone

### Stage F. Promote section to page

When promotion happens:
- create the new topic page
- move the detailed rollup there
- leave a summary on the parent page
- link parent <-> child explicitly
- keep provenance and supporting evidence references

### Stage G. Recursive continuation

Promoted pages can now accumulate their own sections and promote again later.

## Promotion model

## Promotion unit

The promotion unit is:
- **a section on an existing page**

not:
- a single raw memory
- a single mention
- a single link count threshold alone

## Promotion signals

A section should be a promotion candidate when multiple signals line up.

### Strong signals
- linked child page count
- distinct supporting memory record count
- temporal spread
- repeated reinforcement across compile runs
- coherent shared tags/categories
- coherent parent relationship
- section body size / readability pressure
- inbound/outbound link density

### Example heuristic

A section may promote when it has something like:
- `linked_pages >= 20`
- `supporting_records >= 30`
- `temporal_spread >= 30 days`
- `coherence_score >= threshold`

These numbers are placeholders. They should be tuned experimentally.

## Do not promote on link count alone

A burst of 20 links from one short period is not the same as a durable cluster.

Promotion should consider:
- density
- persistence
- coherence
- readability value

## Hysteresis rule

Once a section is promoted, do not flap back and forth.

Promotion should be sticky unless an operator explicitly merges or archives the result.

## Parent page behavior after promotion

When a section is promoted into its own page, the parent page should **not** lose the concept entirely.

Parent keeps:
- summary paragraph
- top highlights
- maybe top 3-5 children
- explicit link to promoted child page

This should be:
- **extract + summarize**

not:
- **move + hollow out**

## Tags as soft guidance

Yes, the processor should lean more on tags, but only as hints.

## Tag philosophy

Do not build a giant ontology.

Do allow lightweight, high-level, tenant-definable tags that help the processor with:
- clustering
- rollup candidate selection
- section naming
- page title suggestions
- promotion confidence

Examples:
- `restaurant`
- `food`
- `travel`
- `coffee`
- `project`
- `customer`
- `meeting`
- `family`

## How tags should be used

Tags should influence:
- candidate collection pages
- section grouping
- hub page reinforcement
- promotion confidence
- cluster coherence scoring

Tags should **not**:
- force a page into existence
- override evidence
- become a rigid ontology layer

Best framing:
- tags are **processor hints**
- not truth
- not schema law

## Recommended data/model additions

To support hierarchical aggregation better, add or strengthen these concepts.

### 1. Section aggregation metadata

For each compiled section, track:
- linked child pages
- supporting record count
- first_seen_at / last_seen_at
- promotion status
- promotion candidate score
- tags observed in the section
- parent page id

### 2. Mention clusters, not just unresolved mentions

Upgrade unresolved mentions into richer clusters that can support aggregate promotion:
- representative contexts
- top supporting records
- co-mentioned entities
- candidate parents
- candidate tags
- ambiguity notes

### 3. Parent-child page relationships

Make parent/child relationships first-class enough that the system can reason about:
- Austin -> Austin Restaurants
- Austin Restaurants -> Austin Mexican Restaurants

### 4. Hubness signals

Track whether a page is functioning like a hub.

Examples:
- inbound links
- number of promoted child pages
- section density
- number of distinct referenced entities

## Recommended compiler behavior changes

## 1. Stop treating each record as a one-page decision

For each record, the planner should return something more like:
- leaf updates
- parent section updates
- collection/topic candidates
- unresolved clusters
- promotion checks

## 2. Add an aggregation pass after leaf updates

This is probably the most important change.

Keep the current safe page compiler, but add a second aggregation-oriented pass that:
- looks across changed pages
- looks across section density
- looks across mention clusters
- looks across co-occurrence patterns
- proposes section promotions and parent rollups

This should not rely on a single prompt trying to do everything at once.

## 3. Use deterministic parent expansion before LLM planning

Do not make the model rediscover obvious relationships every time.

Examples:
- restaurant with city metadata -> reinforce city page candidate
- repeated restaurant tags in one city -> reinforce city restaurants section
- repeated pages tied to one journal/trip -> reinforce trip topic candidate

## 4. Serialized commit, aggregated planning

The best architecture is probably:
- aggregated planning across clusters/sections
- serialized target resolution and commit

That means:
- broader context for deciding what should roll up
- safer writes when creating or promoting pages
- fewer duplicate competing pages

## Experiments to run next

### Experiment 1. Austin replay test

Use a scoped replay over Austin-related restaurant records.

Measure:
- restaurant pages created/updated
- Austin page section growth
- whether an `Austin Restaurants` page is proposed/promoted
- whether Mexican/BBQ/etc. sub-sections emerge

### Experiment 2. Promotion thresholds

Try several promotion policies, for example:
- low threshold
- medium threshold
- high threshold

Measure:
- page usefulness
- duplicate rate
- page sprawl
- readability improvement

### Experiment 3. Tag-assisted clustering

Compare:
- no tag hints
- high-level tag hints only

Measure whether topic promotion and parent-page quality improve.

### Experiment 4. Aggregation-pass only

Run a nightly pass that only:
- updates parent sections
- proposes promotions
- proposes merges

This will tell us whether we can improve compounding without destabilizing the existing leaf compiler.

## Success criteria

The refined pipeline is working when outputs start to feel like:
- leaf pages for concrete entities
- hub pages that actually summarize clusters
- promoted topic pages when sections get too dense
- recursive topic growth over time

Using the Austin example, success looks like:
- restaurant entity pages exist
- `Austin` has a meaningful `Restaurants` section
- `Austin Restaurants` eventually emerges as a topic page
- `Austin Mexican Restaurants` may emerge later if density justifies it
- parent pages keep summaries instead of becoming empty routers

## Implementation order

1. define section aggregation metadata
2. add parent-section update logic
3. add promotion scoring for sections
4. add explicit parent-child page links
5. add optional tenant tag hints
6. add aggregation pass after leaf compilation
7. run replay tests on real seeded data
8. tune thresholds before broad rollout

## Bottom line

The right refinement is not "make the planner smarter."

The right refinement is:
- let memories accumulate into sections on hub pages
- let dense sections promote into topic pages
- let the hierarchy continue recursively
- use tags as hints, not ontology law

That is how the system starts to feel like **compounding memory** instead of just **page creation with links**.
