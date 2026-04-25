---
title: Restructuring an Astro Starlight sidebar without breaking URLs
date: 2026-04-25
category: conventions
module: docs
problem_type: convention
component: documentation
severity: low
applies_when:
  - Restructuring an Astro Starlight sidebar into top-level branches (e.g. Architecture / Components / Configure / Reference)
  - Reorganizing doc nav without moving or renaming any content files
  - Adding a CardGrid landing-page nav above an existing concept grid
  - Verifying a Starlight build preserves all existing page slugs after sidebar changes
related_components:
  - tooling
tags:
  - starlight
  - astro
  - sidebar
  - docs-site
  - slug-preservation
  - navigation
  - convention
---

# Restructuring an Astro Starlight sidebar without breaking URLs

## Context

You've inherited a deployed Starlight docs site with accumulated content and need to reorganize the sidebar into a proper information architecture — without breaking existing URLs that may already be linked from README files, blog posts, support tickets, search-engine indexes, and Slack archives. The trigger is usually a messaging rebrand (the old flat list no longer reflects the product's conceptual structure) or growth past ~20 pages where a flat top-level sidebar stops being scannable.

This pattern was distilled from U14 of plan `docs/plans/2026-04-24-009-feat-reground-agent-harness-for-business-messaging-plan.md` — an agent-harness messaging rebrand on a 79-page Starlight site. The work restructured the sidebar into four top-level branches (Architecture / Components / Configure / Reference) and added a four-card nav grid to the landing page. Zero `.mdx` files moved; all 76 existing slugs preserved.

## Guidance

### Core principle

**URL = file path. Sidebar = display tree.** In Starlight, a page's URL derives from its location under `src/content/docs/` unless the frontmatter sets a `slug:` override. The sidebar in `astro.config.mjs` is pure display configuration — it controls what the nav tree shows and how it's labeled, but has zero effect on routes. A sidebar restructure that only rewrites `astro.config.mjs` entries is zero-risk to URL stability.

### Procedure

1. **Audit current slugs first.** List every `slug:` value in the existing sidebar and confirm each maps to a real file under `src/content/docs/`. A mismatch here means the existing tree already has dead entries — find them now, before you restructure.

2. **Design the new IA on paper before touching config.** Lock branch labels and what belongs where. The four-branch shape that worked for a harness-product site:
   - **Architecture** — orientation and mechanics; expanded by default (no `collapsed: true`)
   - **Components** — the conceptual sub-trees; `collapsed: true`
   - **Configure** — runbooks (deploy + authoring guides); `collapsed: true`
   - **Reference** — API, SDKs, operator apps; `collapsed: true`

3. **Edit only `astro.config.mjs` and the landing page** (`index.mdx`). Do not rename, move, or add `.mdx` files in the same PR — that conflates IA restructure with content work and makes the diff unreadable.

4. **Do not add `slug:` frontmatter to "fix" URLs.** If a page's desired URL already matches its file path, leave the frontmatter alone. Adding `slug:` overrides is unnecessary and creates a maintenance burden — the path is the canonical source.

5. **Build to validate.** The docs workspace has no test suite; `pnpm --filter @thinkwork/docs build` is the de facto regression gate. Watch for:
   - Build error: Starlight validates sidebar `slug:` references at build time and fails loudly on any miss.
   - Page count: should match the pre-restructure baseline (79 pages / 78 pagefind-indexed in this run).
   - Pagefind index size: significant change signals pages were lost or duplicated.

6. **Verify in-content links manually.** `astro build` does NOT validate plain Markdown links inside `<Card>`, `<CardGrid>`, or prose blocks. A link like `[Read more →](/concepts/threads/)` baked into a card grid can ship as a 404 with a green build. Verify these with a dev server + curl or a browser check after build.

### Verification checklist

```
[ ] pnpm --filter @thinkwork/docs build  → clean exit, page count matches baseline
[ ] grep dev-server rendered HTML for new section heading (proves new content rendered)
[ ] curl the four nav-card target slugs (200 on all)
[ ] browser: sidebar branches expand/collapse; current-page branch auto-expands
[ ] browser: deep links resolve (pick one from each branch)
[ ] browser: landing-page card grid renders all cards with correct links
```

### Curl one-liner for card-link spot-check

```bash
PORT=4324  # replace with the actual port from the Astro dev-server log
for url in "concepts/threads/" "deploy/greenfield/" "api/graphql/" "architecture/"; do
  curl -s -o /dev/null -w "%{http_code} /$url\n" --max-time 5 "http://localhost:$PORT/$url"
done
```

### Multi-worktree dev-server hygiene (session history)

When the repo has multiple worktrees with concurrent dev servers, the Astro dev server you start may collide with siblings on common ports. In this session the new server cascaded through ports 4324–4334 (all bound by other worktrees' Astro processes) before landing on 4335. The first `curl` against a "running" docs server on `:4321` returned content from a *different* worktree's build — verifying the restructure visually would have been a false-positive pass.

Workflow that avoids this:

```bash
# Start the dev server with an explicit port; capture what Astro actually picked
pnpm --filter @thinkwork/docs dev -- --port 4324 2>&1 | tee /tmp/docs-dev.log

# Confirm it's serving THIS worktree's build by grep'ing for new content
curl -s --max-time 3 "http://localhost:<actual-port>/" | grep -c "<your-new-section-heading>"
```

If the grep returns 0, the port is serving a different worktree's build — find the actual port from the dev-server log, not from the port you requested.

## Why This Matters

**Link rot is silent and cumulative.** Documentation URLs get embedded in README files, support tickets, blog posts, search-engine indexes, and Slack archives. Moving an `.mdx` file to "better reflect" the new IA breaks every one of those references with no warning. A restructure that leaves file paths alone preserves every inbound link automatically.

**Sidebar-only restructures are also reversible.** If the new IA turns out to be wrong, reverting `astro.config.mjs` is a one-file change. Undoing file moves after they've shipped is an N-file operation that may require redirect config to keep old URLs alive.

**`astro build` is not a full link validator.** Teams often assume a green build means no broken links. That's true for `slug:` sidebar references, but not for in-content Markdown links — including the nav grid on the landing page. This gap is not a bug; it's how static-site builds work. Document it so the next person doesn't ship a 404.

## When to Apply

Apply this pattern whenever:

- A Starlight site's top-level sidebar has grown beyond ~7–10 items with no coherent grouping.
- A product rebrand requires renaming or regrouping sections (new audience frame, new product name, IA audit).
- The docs are live and linked from external sources, so URL stability is a hard constraint.
- You want to add a nav-grid entry point to the landing page that mirrors the sidebar structure.

Do **not** apply if the restructure requires moving content to a new URL (merging two pages, splitting a page, renaming a slug). That's a content refactor, not a sidebar restructure, and needs a separate redirect strategy.

## Examples

### Before: flat 9-item top-level list with implicit nesting

```js
sidebar: [
  { label: "Getting Started", slug: "getting-started" },
  {
    label: "Concepts",
    collapsed: true,
    items: [ /* Threads, Agents, Memory, Connectors, Control, Automations */ ],
  },
  {
    label: "Applications",
    collapsed: true,
    items: [ /* Admin, Mobile, CLI */ ],
  },
  { label: "Deploy",          collapsed: true, items: [ /* greenfield, byo, config */ ] },
  { label: "API Reference",   collapsed: true, items: [ /* graphql, compounding-memory */ ] },
  { label: "SDKs",            collapsed: true, items: [ /* react-native */ ] },
  { label: "Authoring Guides",collapsed: true, items: [ /* skill-packs, connectors, … */ ] },
  { label: "Architecture", slug: "architecture" },
  { label: "Roadmap",      slug: "roadmap" },
]
```

"Concepts" and "Applications" were catch-all buckets that mixed conceptual, operational, and reference content. Deploy guides lived next to API reference; Architecture and Roadmap dangled at the bottom as orphan leaves.

### After: four-branch IA in `docs/astro.config.mjs`

```js
sidebar: [
  {
    label: "Architecture",
    // no `collapsed: true` — expanded by default as the orientation entry point
    items: [
      { label: "Getting Started", slug: "getting-started" },
      { label: "Architecture",    slug: "architecture" },
      { label: "Roadmap",         slug: "roadmap" },
    ],
  },
  {
    label: "Components",
    collapsed: true,
    items: [
      /* Threads / Agents / Memory / Connectors / Control / Automations sub-trees */
    ],
  },
  {
    label: "Configure",
    collapsed: true,
    items: [
      { label: "Deploy",          collapsed: true, items: [ /* greenfield, byo, config */ ] },
      { label: "Authoring Guides",collapsed: true, items: [ /* skill-packs, connectors, evals, compounding-memory-ops */ ] },
    ],
  },
  {
    label: "Reference",
    collapsed: true,
    items: [
      { label: "API Reference", collapsed: true, items: [ /* graphql, compounding-memory */ ] },
      { label: "SDKs",          collapsed: true, items: [ /* react-native tree */ ] },
      { label: "Applications",  collapsed: true, items: [ /* Admin, Mobile, CLI trees */ ] },
    ],
  },
]
```

Zero `.mdx` file moves. All 76 slugs preserved. 79 pages built, 78 pagefind-indexed — identical to the pre-restructure baseline.

### Four-card nav grid in `docs/src/content/docs/index.mdx`

Added above the existing six-component grid, under a "Where to go from here" heading:

```mdx
## Where to go from here

These docs are organized into four branches, each answering a different question:

<CardGrid>
  <Card title="Architecture" icon="rocket">
    Start here. The harness mechanics — PPAF agent loop, the four operating
    guarantees, deployment topology, and how the six components fit together.
    [Read more →](/architecture/)
  </Card>
  <Card title="Components" icon="puzzle">
    The six components of the harness — Threads, Agents, Memory, Connectors,
    Automations, and Control. Each page follows the same skeleton: why, what,
    how to configure, common patterns. [Read more →](/concepts/threads/)
  </Card>
  <Card title="Configure" icon="setting">
    Runbooks for standing the harness up and tuning it — deploy paths and
    authoring guides for skill packs, connectors, evaluations, and compounding
    memory operations. [Read more →](/deploy/greenfield/)
  </Card>
  <Card title="Reference" icon="open-book">
    The technical reference surface — GraphQL API, the React Native SDK, and
    the operator-facing applications (Admin, Mobile, CLI).
    [Read more →](/api/graphql/)
  </Card>
</CardGrid>
```

The new card grid was added as a **supplement** to the existing six-component grid, not a replacement — direct links to each concept page stay on the landing.

### Residual stylistic risks (flagged, not fixed)

Code review surfaced four advisory P3 findings during this restructure that are worth knowing about but were not blockers:

- **Branch labels mix grammatical forms.** Architecture / Components / Reference (nouns) sit alongside Configure (verb). Long-term scannability concern; revisit if usage analytics show friction in the Configure branch.
- **Architecture branch lacks `collapsed: true` while siblings set it.** Intentional ("entry point, always open") but undocumented — next editor will reflex-add it or remove it from the others.
- **Applications nests four levels deep** inside Reference > Applications > Admin > Work > leaf. Within Starlight bounds; bordering on hard-to-scan for new readers.
- **Two card grids on the landing page partially overlap.** The Components card in the new grid and the existing six-component grid both frame the same concepts. Acceptable as a supplement; if it becomes redundant, drop one.

These were suppressed in autofix mode (testing/maintainability + P3 + advisory) — captured here so future editors don't spend cycles re-discovering them.

## Related

- Plan: [`docs/plans/2026-04-24-009-feat-reground-agent-harness-for-business-messaging-plan.md`](../../plans/2026-04-24-009-feat-reground-agent-harness-for-business-messaging-plan.md), unit U14
- Starlight sidebar API: [https://starlight.astro.build/reference/configuration/#sidebar](https://starlight.astro.build/reference/configuration/#sidebar)
- Starlight slug behavior: [https://starlight.astro.build/guides/pages/](https://starlight.astro.build/guides/pages/)
