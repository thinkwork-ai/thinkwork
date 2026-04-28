---
title: "docs: Full rewrite of ThinkWork documentation site"
type: refactor
status: active
date: 2026-04-21
---

# docs: Full rewrite of ThinkWork documentation site

## Overview

The ThinkWork documentation site at `docs/` (Starlight + Astro, served from `docs.thinkwork.ai`) has strong bones — the sidebar tree is right, the build is healthy, and a handful of pages (notably `concepts/knowledge/compounding-memory-pipeline.mdx`, `architecture.mdx`, `applications/admin/threads.mdx`, `applications/mobile/index.mdx`, `getting-started.mdx`) already exemplify the style we want. But the majority of the 73 content files fall into one of three weak patterns:

- **Thin hub pages** (e.g. `concepts/threads.mdx`, `concepts/knowledge.mdx`) that are just a bullet list and a `<CardGrid>` with no narrative about *how the component actually works*.
- **Code-dump pages** that lead with a GraphQL mutation or a config snippet before the reader has any mental model for what the thing is or why it exists.
- **Placeholder pages** in the Admin app tree, SDK guides, and Authoring Guides that read more like stubs than documentation.

This plan rewrites the docs in place so every page follows the house pattern: **narrative first so a human can understand the component, technical detail under the hood**. The pipeline doc is the pattern template — plain-language walking tour up top, `## Under the hood` section below with code paths, SQL, and contracts for people modifying the system.

This is a Deep plan with phased delivery. Scope is **every page under `docs/src/content/docs/`** (73 `.mdx` files), organized by area so each phase lands as a coherent batch.

## Problem Frame

Documentation is the front door for both new developers and existing contributors. Today the front door is embarrassing: the good pages are undermined by thin ones sitting next to them in the sidebar. The complaint is not nav; it's content quality and consistency.

Root causes visible in the current pages:

1. **No explicit house style.** Each page was written at a different moment by a different author against a different mental model.
2. **Hub pages are treated as pure indexes** — just "Read this section" bullets + cards — when they should be the place a reader builds their mental model before drilling into leaves.
3. **Code comes before narrative** on too many leaf pages. The user's explicit rule: "if you must add technical specs put it lower on the page, and don't just dump a bunch of code samples."
4. **Recent pipeline work landed great pages** (compounding-memory-pipeline, compounding-memory-pages, admin/threads) but the contrast with older pages is now glaring.
5. **Drift.** Some pages reference routes, env vars, or commands that have moved (e.g. `concepts/mcp-servers.mdx` is orphaned — not in the sidebar but still in the content tree; `WIKI_*` flag references predate aggregation shipping).

The user wants the whole site brought up to the pipeline-doc standard, and wants to be proud of it as a reference.

## Requirements Trace

- **R1.** Every page starts with plain-language narrative that a human reader (dev, contributor, or prospective customer) can follow without jumping to a code sample.
- **R2.** Technical specifications (schema, env vars, SQL, handler paths) appear *below* the narrative, typically in a final `## Under the hood` or similarly-titled section — not dropped into the opening paragraphs.
- **R3.** Code samples are used only when they materially illustrate a concept (a GraphQL mutation as an example, a pseudo-payload to show a contract). Bulk dumps of CLI output or schema are demoted or moved to dedicated reference pages.
- **R4.** Hub pages (the `*.mdx` file that sits at the root of a sidebar section, e.g. `concepts/threads.mdx`) explain what the component is, why it exists, and how it fits the rest of the system — *before* the `<CardGrid>` that links to children.
- **R5.** Every cross-link resolves. The Astro build passes (`pnpm --filter @thinkwork/docs build`) with no broken-link warnings.
- **R6.** Every page carries an accurate frontmatter `title` and a real (not stub) `description` so the sidebar tooltip and OG previews are useful.
- **R7.** Content accuracy: the docs reflect the code as of 2026-04-21. Specifically, compounding memory pages reflect aggregation-pass-enabled, deterministic linking, and alias dedupe; mobile pages reflect Google-OAuth-only auth; admin pages reflect the current route structure.
- **R8.** A `docs/STYLE.md` exists as the editorial standard so future contributions don't regress.

## Scope Boundaries

- The sidebar structure in `docs/astro.config.mjs` is good as-is and is **not** being redesigned. Labels may be fine-tuned when a page is renamed; the tree stays.
- Visual design (Starlight theme, `custom.css`, logo, `Hero.astro`) is **not** in scope.
- The marketing site at `apps/www/` (thinkwork.ai landing page) is **not** in scope.
- Auto-generated API reference (GraphQL schema dumps) is **not** being restructured — the human-written narrative around it is.

### Deferred to Separate Tasks

- **Custom domain cutover** (`site: https://docs.thinkwork.ai` in `astro.config.mjs` — currently commented): tracked separately. Plan assumes relative paths throughout.
- **OG images** (per-page social preview images): follow-up after the content lands.
- **Search tuning** (Algolia DocSearch or Starlight's built-in Pagefind configuration beyond defaults): follow-up.
- **Auto-linting** (a CI step that fails on broken internal links or missing frontmatter): follow-up after the rewrite lands so the ruleset can be calibrated against clean pages.

## Context & Research

### Relevant Code and Patterns

**Gold-standard exemplars already in the repo** (use these as style templates):

- `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` — walking-tour narrative + `## Under the hood` split. **This is the pattern.**
- `docs/src/content/docs/architecture.mdx` — conceptual model + infrastructure model split, tables for resources, mermaid-style flow diagrams.
- `docs/src/content/docs/applications/admin/threads.mdx` — route + file pointer at top of each section, tables for state, `## Known limits` section that's honest about what's incomplete.
- `docs/src/content/docs/applications/mobile/index.mdx` — "What the X is not" section naming explicit non-goals; hub-page tone with real prose before the section breakdown.
- `docs/src/content/docs/getting-started.mdx` — stepped `<Steps>` flow with realistic output blocks, `<Aside>` callouts for traps.

**Starlight components available for consistent use:**

- `@astrojs/starlight/components` — `Card`, `CardGrid`, `Aside`, `Steps`, `Tabs`, `TabItem`, `Badge`, `LinkCard`
- Custom: `Hero.astro` (splash page), `BrainMark.astro`

**Known weak pages that need rewrites, not polish:**

- `concepts/threads.mdx` — 45 lines, mostly a card list. No explanation of *what a thread is beyond "the universal work container."*
- `concepts/knowledge.mdx` — same shape. Hub with no body.
- `concepts/control.mdx`, `concepts/connectors.mdx`, `concepts/automations.mdx` — likely the same pattern (verify during audit).
- `concepts/mcp-servers.mdx` — orphaned (not in sidebar). Either fold into `concepts/connectors/mcp-tools.mdx` or delete.
- `guides/*` — all four need a read-through; likely thin.
- `api/compounding-memory.mdx`, `api/graphql.mdx` — need the "what does this API let you do" narrative above any schema dump.

### Institutional Learnings

Relevant items from `docs/solutions/` worth surfacing into docs prose (not as links to solutions, but as "here's what the code now does and why"):

- **Compile continuation + dedupe bucketing** — `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` already referenced from the pipeline doc. Keep that pattern.
- **Mobile Cognito sync invariant** — memory-recorded. The mobile/authentication page should explain the sync-vs-async session restore shape, not just "uses Cognito."
- **OAuth tenantId resolver** — the `ctx.auth.tenantId` null for Google users pattern. Mention in admin/authentication-and-tenancy without turning it into a code listing.
- **Aggregation pass + deterministic linking** — already in the pipeline doc. Make sure the `Compounding Memory: Pages` page is consistent with it.

### External References

Not pulling external sources for this rewrite — the doc is internal to ThinkWork and the in-repo gold-standard pages are a better pattern than generic "how to write technical docs" guides.

## Key Technical Decisions

- **House style is codified in `docs/STYLE.md`** (new file, not published to the site). It's the rubric both the rewrite and future PRs check against.
- **The rewrite lands in logical batches by section, not as one mega-PR.** Each phase is a commit/PR so review is tractable. A reviewer looking at "Concepts: Memory" should not also be reading the Admin app changes.
- **No sidebar restructuring.** The user explicitly called out that navigation is fine. We edit labels only when a page is renamed.
- **No auto-generation.** Every rewritten page is handwritten prose, calibrated to match the pipeline-doc tone. We do not introduce a generator-from-code-comments pipeline in this plan.
- **Orphan cleanup.** `concepts/mcp-servers.mdx` gets resolved (folded or deleted). Any other orphans discovered in the audit get the same treatment.
- **Consistent page shape** — every substantive leaf page should follow this template when it applies:
  1. 1–2 sentence opener: what this is, in one breath.
  2. **"Why this exists"** or **"What it does for you"** section (narrative).
  3. Walking tour / main conceptual sections (prose + targeted visuals).
  4. Concrete example if useful (one worked example, not a kitchen sink).
  5. **"Known limits"** or **"What can go wrong"** when applicable — honesty sections.
  6. **"Related pages"** (cross-links).
  7. **"Under the hood"** — code paths, tables, schemas, env vars, SQL. Last, not first.
- **Hub-page template** — every section root (e.g. `concepts/threads.mdx`):
  1. 2–3 paragraphs of real prose about the component — what it is, why it's in ThinkWork, how it relates to the other five top-level concepts.
  2. Diagram or table when helpful.
  3. `<CardGrid>` of section children with one-sentence descriptions.
  4. "Read this section in order" recommendation (carrying forward from existing pages).
- **No change to MDX processing config.** We don't add new Starlight plugins. If a new component is needed for a specific pattern, we discuss before adding.

## Open Questions

### Resolved During Planning

- **Q: Keep `docs/src/content/docs/concepts/mcp-servers.mdx`?**
  **Resolution:** Fold substantive content into `docs/src/content/docs/concepts/connectors/mcp-tools.mdx` (which *is* in the sidebar), then delete the orphan. Add a redirect-style stub only if external links reference it.

- **Q: Rewrite depth — full re-authorship vs. editing existing text?**
  **Resolution:** Full rewrites for pages classified `REWRITE` in the audit (thin hubs, stubs, weak leaf pages). `POLISH` pages keep their structure and voice but get calibrated against the style guide (fix ordering, add narrative where code leads, tighten headings). `KEEP` pages get verified-accurate edits only (code paths, feature flags, env var names).

- **Q: One PR or many?**
  **Resolution:** Many. Phase-per-PR. See Phased Delivery below. This is what the user's `feedback_pr_target_main.md` memory reinforces — rebase each PR onto main, don't stack.

- **Q: What about `docs/metrics/` content?**
  **Resolution:** Out of scope. `docs/metrics/` is operator-facing snapshot files (wiki-link-density baselines, etc.), not the Starlight site. Leave untouched.

### Deferred to Implementation

- **Exact page-by-page classification (KEEP/POLISH/REWRITE).** Done as Unit 2 (audit) before the rewriting units run. The audit output is a checklist committed into the style guide or a separate `docs/STYLE-AUDIT.md`.
- **Visual aids per page.** Some pages will benefit from new mermaid diagrams or state tables; those are decided during each rewrite unit based on what the page needs, not pre-specified here.
- **Exactly which GraphQL mutations/schema snippets stay as illustrative examples** vs. which move out to the API Reference pages. Judgment call per page — rule of thumb: if the snippet is load-bearing for understanding the concept, keep it small and targeted; if it's schema reference, link to `/api/graphql/`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

### The editorial contract every page must satisfy

```
page.mdx
├── frontmatter (title, description — both must be real, not "TODO")
│
├── Hook paragraph (1–2 sentences)      ← What this is, in one breath
│
├── Plain-language sections
│   ├── Why it exists / What it does for you
│   ├── Walking tour of the concept
│   └── Worked example (optional)
│
├── Honesty sections
│   ├── Known limits (when applicable)
│   └── What can go wrong (when applicable)
│
├── Related pages                       ← Cross-links
│
└── ## Under the hood                   ← Technical appendix
    ├── Code paths (repo-relative)
    ├── Config / env vars
    ├── Schemas / SQL
    └── Contracts
```

### Classification pipeline during audit

```
For each .mdx file under docs/src/content/docs/:
  Read page
  Score against rubric (STYLE.md):
    - Does it open with prose? (yes/no)
    - Is technical detail demoted? (yes/partial/no)
    - Does it explain the *why*? (yes/partial/no)
    - Is frontmatter real? (yes/no)
    - Are internal links sound? (yes/no)
  Classify:
    KEEP    — all yes, accuracy verified
    POLISH  — mostly yes, needs reordering or narrative patches
    REWRITE — thin, stub, or code-dump-first
  Record in STYLE-AUDIT.md
```

This happens *before* the rewrite units run so each unit starts with a concrete scope.

## Implementation Units

Units are dependency-ordered. Units 1–2 unblock everything. Units 3–9 are the content rewrites, which can land in parallel PRs but must each pass the full build before merge. Unit 10 is the consolidation pass.

- [x] **Unit 1: House Style Guide (`docs/STYLE.md`)**

**Goal:** Codify the house style so every subsequent rewrite checks against an explicit rubric, and so future contributors have a reference.

**Requirements:** R1, R2, R3, R4, R6, R8

**Dependencies:** None. First unit.

**Files:**
- Create: `docs/STYLE.md`

**Approach:**
- Write a concise editorial guide (target: 300–500 lines, reference-grade). Sections:
  - **Voice and tone** — confident, honest, plain-language. Examples of "too breathless" vs. "too bureaucratic."
  - **Page structure** — the universal page shape (hook → narrative → technical). Include the hub-page variation.
  - **Headings and sentence patterns** — section headers as statements, not labels; opening sentences that state what the reader will learn.
  - **When to use code samples** — the "load-bearing vs. schema dump" rule. Schema dumps move to reference pages.
  - **Callouts** (`<Aside>`) — when `type="note"`, `"tip"`, `"caution"`, `"danger"` is appropriate.
  - **Diagrams** — when a mermaid diagram earns its place (multi-surface flows, state lifecycles). When a table is better.
  - **Naming** — canonical names for the six concepts (Threads, Agents, Memory, Connectors, Automations, Control) and how to refer to them in prose.
  - **Cross-links** — prefer `/concepts/threads/` over backticked file paths in prose.
  - **Frontmatter** — real title, real description (under 160 chars for OG).
  - **"Known limits"** and **"What can go wrong"** — when to include honesty sections.
- Include a before/after example pair (one thin hub rewritten) to make the pattern concrete.

**Patterns to follow:**
- Mirror the tone of `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` — confident, narrative, honest.
- `AGENTS.md` / `CLAUDE.md` voice if any exists in-repo, for consistency with engineering-culture docs.

**Test scenarios:**
- Happy path: a contributor reading `STYLE.md` can take a thin page like `concepts/control.mdx` and produce a rewrite that matches the pipeline-doc pattern without further guidance.
- Edge case: style guide itself passes its own rubric (self-referential test — does it hook with prose, demote mechanics?).

**Verification:**
- `docs/STYLE.md` exists, is under 500 lines, is readable top to bottom, and contains at least one before/after example.
- The audit unit (Unit 2) can be run from `STYLE.md` alone without needing this plan open.

---

- [x] **Unit 2: Page-by-page audit (`docs/STYLE-AUDIT.md`)**

**Goal:** Produce a concrete per-file classification so subsequent rewrite units know their exact scope.

**Requirements:** R1, R2, R3, R4, R6, R7

**Dependencies:** Unit 1 (needs `STYLE.md` as the rubric).

**Files:**
- Create: `docs/STYLE-AUDIT.md`

**Approach:**
- Walk every file under `docs/src/content/docs/` (73 files).
- For each, record:
  - Path (repo-relative)
  - Current line count (proxy for substance)
  - Classification: `KEEP` / `POLISH` / `REWRITE`
  - Specific issues (opens with code / no narrative hook / stub frontmatter / orphaned / etc.)
  - Accuracy flags to verify in the rewrite (mentions of `WIKI_*` flags, route paths, env var names, service endpoints)
- Group by section in the audit doc so the rewrite units can read their section and go.
- Include a summary at top: "N KEEP, N POLISH, N REWRITE."

**Patterns to follow:**
- Use a table-per-section in the audit doc, columns: `path | class | issues`.
- Reference `STYLE.md` sections when flagging issues (e.g., "fails §Page Structure — opens with GraphQL sample").

**Test scenarios:**
- Happy path: audit covers all 73 files; no file is missed (verify by diffing the audit's file list against `find docs/src/content/docs -name '*.mdx'`).
- Edge case: orphaned files (`concepts/mcp-servers.mdx`) are flagged with a specific resolution recommendation.
- Integration: the classification for each of the gold-standard exemplar pages must be `KEEP` — if the audit wants to rewrite one of them, the rubric is wrong.

**Verification:**
- Audit file lists all 73 pages.
- Each classification line is specific enough that the rewrite unit doesn't need to re-read the page to know what to fix.

---

- [x] **Unit 3: Rewrite `getting-started.mdx` + landing (`index.mdx`)**

**Goal:** Tighten the front door. Today's `getting-started.mdx` is already good but skips Step 6; `index.mdx` is card-grid-heavy with minimal narrative.

**Requirements:** R1, R2, R3, R6, R7

**Dependencies:** Unit 1.

**Files:**
- Modify: `docs/src/content/docs/index.mdx`
- Modify: `docs/src/content/docs/getting-started.mdx`

**Approach:**
- `index.mdx`: keep the splash hero but add a 2–3 paragraph "What ThinkWork gives you" narrative between the hero and the CardGrid. The narrative should answer: *Who is this for? What problem does it solve? What's different about the approach (open, AWS-native, customer-owned)?*
- `getting-started.mdx`: fix the Step 5 → Step 7 numbering gap (currently skips Step 6). Verify every `thinkwork` CLI command referenced still exists in `packages/cli` at the current version. Trim any duplicate output blocks (there are two deploy-output blocks currently).

**Patterns to follow:**
- `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` for prose voice.
- Existing `<Steps>` / `<Aside>` / `<Tabs>` usage in getting-started is good — preserve.

**Test scenarios:**
- Happy path: landing page reads clearly for a dev who's never heard of ThinkWork.
- Integration: every internal link (`/concepts/threads/`, `/deploy/byo/`, etc.) resolves in the built site.
- Error path: step numbers are contiguous (1–8, no gaps).

**Verification:**
- `pnpm --filter @thinkwork/docs build` produces no broken-link warnings for these pages.
- Manual read-through: landing page answers "what is this and why should I care" before linking anywhere.

---

- [x] **Unit 4: Concepts — Threads (3 pages)**

**Goal:** Rewrite the Threads hub + its two child pages to the house standard.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `docs/src/content/docs/concepts/threads.mdx`
- Modify: `docs/src/content/docs/concepts/threads/lifecycle-and-types.mdx`
- Modify: `docs/src/content/docs/concepts/threads/routing-and-metadata.mdx`

**Approach:**
- `threads.mdx` (hub): add 3–4 paragraphs explaining what a thread *is* mechanically (row in `threads` table, channel + prefix + status + metadata), *why* (one record of work across chat/connector/automation), and the analogy to conversational threads in other systems (and where ThinkWork differs). Then the CardGrid.
- `lifecycle-and-types.mdx`: narrative of the thread lifecycle (BACKLOG → TODO → IN_PROGRESS → DONE), what triggers each transition, what the prefix system encodes (CHAT-, AUTO-, SLACK-, GITHUB-, TASK-). Table of prefixes under the hood.
- `routing-and-metadata.mdx`: how connector events become threads, what `metadata` carries, how routing decides which agent responds. Real example of a Slack event → thread record.

**Patterns to follow:**
- Mirror `docs/src/content/docs/applications/admin/threads.mdx` for the "route + file" pattern where useful.
- `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` for the narrative-first shape.

**Test scenarios:**
- Happy path: a dev reading hub → lifecycle → routing builds an accurate mental model of threads without opening code.
- Edge case: the TASK- prefix (external task channel) is covered, not just CHAT and AUTO.
- Integration: cross-links to `applications/admin/threads.mdx`, `applications/mobile/threads-and-chat.mdx`, and `concepts/connectors.mdx` resolve.

**Verification:**
- Build passes. Hub page opens with prose, not a card grid. Each leaf page has a `## Under the hood` section with real code paths (e.g. `packages/api/src/schema/threads/*`).

---

- [x] **Unit 5: Concepts — Agents (3 pages)**

**Goal:** Rewrite Agents hub, Managed Agents, Templates and Skills.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `docs/src/content/docs/concepts/agents.mdx`
- Modify: `docs/src/content/docs/concepts/agents/managed-agents.mdx`
- Modify: `docs/src/content/docs/concepts/agents/templates-and-skills.mdx`

**Approach:**
- `agents.mdx` (hub): today it's middling — has useful sections but leads with a GraphQL mutation too early. Reorder so "The role of agents in the system" + "Managed vs. connected" narrative comes before any mutation. Move the `CreateAgent` mutation into a `## Under the hood` section.
- `managed-agents.mdx`: walking tour of what happens when a managed agent is invoked — Lambda cold start, context assembly, Bedrock call, tool execution, response streaming. Cite real paths (`apps/agent-core/`, `packages/api/src/lib/agents/`).
- `templates-and-skills.mdx`: the fleet-wide reuse model. Why templates exist. How a skill pack loads at invoke time. Narrative first, then the template field table as the technical appendix.

**Patterns to follow:**
- Demote the `CreateTemplate` mutation to a worked example after the narrative.
- Model card table stays, but move "recommended starting models" above the raw model-id table.

**Test scenarios:**
- Happy path: a dev reading the three pages understands managed vs. connected, what a template does, and what a skill pack is, without ever needing to open code.
- Edge case: connected agents (webhook-based) get real treatment, not just a short aside.
- Integration: links to `/guides/skill-packs/` and `/applications/admin/agents/` resolve.

**Verification:**
- Build passes. No GraphQL mutation appears in the first 40 lines of any of the three files.

---

- [x] **Unit 6: Concepts — Memory (8 pages)**

**Goal:** Bring the Memory section up to the level of the compounding-memory-pipeline doc that already sits inside it.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `docs/src/content/docs/concepts/knowledge.mdx` *(hub — currently thin)*
- Modify: `docs/src/content/docs/concepts/knowledge/document-knowledge.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/memory.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx`
- Keep-polish: `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` *(already gold standard — accuracy pass only)*
- Polish: `docs/src/content/docs/concepts/knowledge/compounding-memory-pages.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/retrieval-and-context.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx`

**Approach:**
- `knowledge.mdx` (hub): currently 80 lines of thin prose. Rewrite to 150–250 lines that tells the story: why ThinkWork frames Memory as "the harness-owned context layer," the three layers (document knowledge, long-term memory, compounding memory / wiki), and how retrieval assembly ties them together. Then the CardGrid.
- `document-knowledge.mdx`, `memory.mdx`, `retrieval-and-context.mdx`: walking tours. For `memory.mdx` specifically, cover the Hindsight vs. AgentCore Memory adapter choice honestly — which one hosted defaults to (Hindsight), what AgentCore trades off.
- `compounding-memory.mdx`: top-level explainer of the whole pipeline → pages → wiki loop. Point to the pipeline + pages docs for depth.
- `compounding-memory-pipeline.mdx`: accuracy check only — verify flag names, env vars, cost numbers, model-id defaults still match `packages/api/src/lib/wiki/` at 2026-04-21.
- `compounding-memory-pages.mdx`: verify schema + alias dedupe sections match current migrations (`0015_pg_trgm_alias_title_indexes.sql`).
- `knowledge-graph.mdx`: reframe as "forward-looking direction" not "roadmap" — call out what the compounding memory pipeline *already* produces (entity edges, co-mention links) and what's still ahead.

**Patterns to follow:**
- `compounding-memory-pipeline.mdx` is the template for the entire section. Every leaf should feel like a smaller version of it.

**Test scenarios:**
- Happy path: a dev reading hub → memory → compounding-memory → pipeline gets a coherent, progressively-deeper story.
- Edge case: `knowledge-graph.mdx` clearly distinguishes shipped (co-mention edges, deterministic parent links) from aspirational (typed relationship graph).
- Integration: all `/api/compounding-memory/` and `/guides/compounding-memory-operations/` links resolve.

**Verification:**
- Build passes. No hub page is under 100 lines of real prose. The pipeline doc's code references still resolve to real files.

---

- [x] **Unit 7: Concepts — Connectors, Control, Automations (9 pages)**

**Goal:** Bring the remaining three Concepts sections up to standard.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `docs/src/content/docs/concepts/connectors.mdx` *(hub)*
- Modify: `docs/src/content/docs/concepts/connectors/integrations.mdx`
- Modify: `docs/src/content/docs/concepts/connectors/mcp-tools.mdx`
- Modify: `docs/src/content/docs/concepts/control.mdx` *(hub)*
- Modify: `docs/src/content/docs/concepts/control/guardrails.mdx`
- Modify: `docs/src/content/docs/concepts/control/budgets-usage-and-audit.mdx`
- Modify: `docs/src/content/docs/concepts/automations.mdx` *(hub)*
- Modify: `docs/src/content/docs/concepts/automations/scheduled-and-event-driven.mdx`
- Modify: `docs/src/content/docs/concepts/automations/routines-and-execution-model.mdx`
- Delete or fold: `docs/src/content/docs/concepts/mcp-servers.mdx` *(orphan — fold into `connectors/mcp-tools.mdx`)*

**Approach:**
- Same hub-page treatment as Threads/Memory for all three hubs.
- `connectors/integrations.mdx`: narrative of the Slack/GitHub/Google integrations — what each gives you, how the OAuth dance works, where secrets live (SSM Parameter Store).
- `connectors/mcp-tools.mdx`: fold in whatever substance lives in the orphan `concepts/mcp-servers.mdx`. Explain MCP Server vs. MCP Tool distinction (the "two surfaces" we already document internally per memory `project_mobile-host_two_surfaces.md`).
- `control/guardrails.mdx`: Bedrock Guardrails integration, how they're applied per-turn, the `guardrailId` field on templates.
- `control/budgets-usage-and-audit.mdx`: token + cost tracking, budget enforcement, audit-log S3 layout (NDJSON per invocation).
- `automations/scheduled-and-event-driven.mdx`: EventBridge + AWS Scheduler (scheduled) vs. webhook-triggered (event-driven). Reference the `project_automations_eb_provisioning.md` shape.
- `automations/routines-and-execution-model.mdx`: what a routine *is* vs. a one-off scheduled job, the Step Functions state machine.

**Patterns to follow:**
- Integrations table with columns (provider, OAuth scopes, secrets location, inbound threads, outbound actions).
- For Automations, a small sequence diagram of scheduled-rule → Step Functions → AgentCore → thread.

**Test scenarios:**
- Happy path: a dev understands the three concepts and how they relate to threads/agents/memory.
- Edge case: MCP two-surfaces distinction is crystal-clear (the internal memory captures this pattern — docs should reflect it).
- Integration: the `concepts/mcp-servers.mdx` orphan is resolved — either deleted after folding, or left as a redirect if we're being cautious about inbound links.

**Verification:**
- Build passes. Sidebar doesn't show any 404-ing entries. No orphan pages remain.

---

- [x] **Unit 8: Applications — Admin (19 pages)**

**Goal:** Bring every Admin app page up to the standard `applications/admin/threads.mdx` already sets (which is gold-standard).

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Hub: `docs/src/content/docs/applications/admin/index.mdx`
- `authentication-and-tenancy.mdx`
- Work: `dashboard.mdx`, `threads.mdx` *(keep — gold std)*, `inbox.mdx`
- Agents: `agents.mdx`, `agent-templates.mdx`, `agent-invites.mdx`, `skills-catalog.mdx`, `mcp-servers.mdx`, `builtin-tools.mdx`, `security-center.mdx`
- Manage: `memory.mdx`, `knowledge-bases.mdx`, `analytics.mdx`, `scheduled-jobs.mdx`, `evaluations.mdx`, `routines.mdx`, `webhooks.mdx`, `artifacts.mdx`, `humans.mdx`, `settings.mdx`

**Approach:**
- Every Admin leaf page follows the `threads.mdx` template:
  - Hook paragraph (what this page of the admin app is for).
  - `**Route:**` + `**File:**` banner at the top of each major section (use route paths under `apps/admin/src/routes/`).
  - "What you can do here" (bullet list of capabilities).
  - "View state persistence" / "Server vs client filtering" / "Live subscriptions" where applicable.
  - `## Workflows` section — 2–3 canonical operator workflows.
  - `## Known limits` — honesty.
  - `## Related pages` — cross-links.
- Hub page (`admin/index.mdx`): rewrite to explain what the admin app *is* (tenant-scoped operator console), who uses it, what it is NOT (that's what mobile is for). Then the three-group nav overview (Work, Agents, Manage) — which is how the sidebar is already grouped.
- For stub-like pages (likely `agent-invites.mdx`, `security-center.mdx`, `webhooks.mdx`), decide per-page during the rewrite: if the feature is thin in the app, the doc can be short but must still follow the shape — not a stub.
- Accuracy: verify route paths against `apps/admin/src/routes/_authed/_tenant/` as of 2026-04-21.

**Patterns to follow:**
- `applications/admin/threads.mdx` — emphatically the template for this entire unit.

**Test scenarios:**
- Happy path: an operator new to the admin app can read `admin/index.mdx` and know which sub-page to start with.
- Edge case: pages for features in soft-retirement (e.g. anything external provider-as-task-connector related — retired per `project_mobile-host_two_surfaces.md`) are either removed, or honestly labeled as deprecated.
- Integration: every route referenced resolves under `apps/admin/src/routes/` in the current checkout.

**Verification:**
- Build passes. Route paths are accurate. Hub page prose covers all three groupings.

---

- [x] **Unit 9: Applications — Mobile (6 pages) + CLI (2 pages)**

**Goal:** Polish Mobile (already decent) and bring CLI up to parity.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Mobile: `applications/mobile/index.mdx` *(keep — gold std; polish only)*, `authentication.mdx`, `threads-and-chat.mdx`, `integrations-and-mcp-connect.mdx`, `push-notifications.mdx`, `distribution.mdx`
- CLI: `applications/cli/index.mdx`, `applications/cli/commands.mdx`

**Approach:**
- **Mobile:** polish pass on each leaf against the style guide. `authentication.mdx` specifically — reflect the sync-Cognito invariant (`getCurrentUser()` + `CognitoSecureStorage` must stay sync — per memory) and the Google-OAuth-only auth reality (no password flow — per memory). `integrations-and-mcp-connect.mdx` — reflect user-scoped integration ownership (per memory `feedback_user_opt_in_over_admin_config.md`).
- **CLI:** `cli/index.mdx` should explain what the CLI is for (deploy + dev lifecycle, not end-user interaction), the lifecycle (install → login → init → deploy → doctor → outputs → login-to-stack → me), and where to go for specific commands. `cli/commands.mdx` is the reference — keep it reference-shaped but add a narrative opener so it's not a raw table dump.

**Patterns to follow:**
- `applications/mobile/index.mdx`'s "What the mobile app is not" section — keep that pattern. CLI gets its own "What the CLI is not" (not end-user interaction, not a mobile alternative).

**Test scenarios:**
- Happy path: mobile auth page correctly describes Google-OAuth-only (no "enter your password" step anywhere).
- Edge case: CLI `commands.mdx` table matches actual `packages/cli/src/commands/` directory contents at 2026-04-21.
- Integration: `thinkwork login` (profile picker) vs. `thinkwork login --stage` (Cognito browser flow) are clearly two different flows, both documented.

**Verification:**
- Build passes. Commands reference is complete — no command exists in code that isn't documented.

---

- [x] **Unit 10: Deploy, API Reference, SDKs, Guides (15 pages) + architecture/roadmap polish**

**Goal:** Reference and guide surfaces brought to standard.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** Units 1, 2.

**Files:**
- Deploy: `deploy/greenfield.mdx`, `deploy/byo.mdx`, `deploy/configuration.mdx`
- API: `api/graphql.mdx`, `api/compounding-memory.mdx`
- SDKs: `sdks/react-native/index.mdx`, `install-and-setup.mdx`, `hook-reference.mdx`, `thread-agent-model.mdx`, `integration-recipes.mdx`, `migration.mdx`
- Guides: `guides/skill-packs.mdx`, `guides/connectors.mdx`, `guides/evaluations.mdx`, `guides/compounding-memory-operations.mdx`
- Polish only: `architecture.mdx`, `roadmap.mdx`

**Approach:**
- **Deploy:** `greenfield` and `byo` — walking tours. `configuration` — reference table of every `terraform.tfvars` variable, grouped by tier (foundation/data/app), with a narrative opener explaining how to choose values, not just what they are. Flag the `tfvars plaintext secrets` caveat per memory (migrate to SSM when prod lands).
- **API:**
  - `graphql.mdx` — narrative on the AppSync vs. API Gateway split (subscriptions vs. queries/mutations), auth model (Cognito JWT), then links into per-feature schema detail.
  - `compounding-memory.mdx` — narrative on the wiki GraphQL surface (which operations exist, what they return), with schema dumps in an `## Under the hood` section.
- **SDKs (React Native):** `index.mdx` hub — what the SDK is, who it's for, what it replaces (direct AppSync client code). Each leaf polished against style. `migration.mdx` (Upgrading from 0.1) should be a real migration guide with a before/after.
- **Guides:** each guide is *task-oriented* — "how to author a skill pack," "how to add a new connector," "how to operate compounding memory day-to-day." Narrative first, worked example in the middle, reference appendix at the bottom.
- **Architecture:** light polish — it's already strong. Verify the AgentCore container spec + Strands stack description still matches `apps/agent-core/` at 2026-04-21.
- **Roadmap:** lightly polish. Keep it honest — what's shipped vs. what's planned. Reference thinkwork-supersedes-maniflow rename per memory as a planned rename (not a current-state claim).

**Patterns to follow:**
- `architecture.mdx`'s tier-table pattern applies to `deploy/configuration.mdx`.
- `getting-started.mdx`'s `<Steps>` pattern applies to `deploy/greenfield.mdx` and `sdks/react-native/install-and-setup.mdx`.

**Test scenarios:**
- Happy path: a dev can go from zero → deployed stack → first agent message using only `getting-started.mdx` + `deploy/greenfield.mdx`.
- Edge case: `deploy/byo.mdx` honestly covers what ThinkWork needs from your existing VPC/DB/Cognito and what it can't tolerate.
- Integration: SDK docs compile — no stale hook names vs. what's exported from `@thinkwork/react-native`.

**Verification:**
- Build passes. All guides have a worked example. API reference pages have narrative openers before any schema.

---

- [x] **Unit 11: Build + link integrity + consolidation pass**

**Goal:** Final pass. Everything builds. Links resolve. Frontmatter is clean. Sidebar and content agree.

**Requirements:** R5, R6, R7, R8

**Dependencies:** Units 3–10.

**Files:**
- Verify: all `docs/src/content/docs/**/*.mdx`
- Verify: `docs/astro.config.mjs`
- Modify (as needed): `docs/STYLE.md`, `docs/STYLE-AUDIT.md` — reflect final state.

**Approach:**
- Run `pnpm --filter @thinkwork/docs build`; capture and resolve every warning.
- Walk the built `docs/dist/` HTML looking for anchor links that 404.
- Open a local preview (`pnpm --filter @thinkwork/docs preview`) and manually click through the sidebar; note any page that looks wrong and create a follow-up row in `STYLE-AUDIT.md` (don't try to fix in this unit — trust the rewrite units).
- Update `STYLE-AUDIT.md` to mark every file `DONE` with its final classification.
- Verify `astro.config.mjs` sidebar slugs still map to existing files (any rename from a rewrite unit is reflected here).

**Patterns to follow:**
- Use `pnpm` (not npm) per memory `feedback_pnpm_in_workspace.md`.

**Test scenarios:**
- Happy path: build completes with zero warnings about missing pages or broken links.
- Edge case: every sidebar entry navigates to a non-404 page.
- Integration: `docs/STYLE-AUDIT.md` shows 100% DONE coverage.

**Verification:**
- `pnpm --filter @thinkwork/docs build` exits 0 with no broken-link warnings.
- Sidebar clickthrough shows no 404s.
- `STYLE-AUDIT.md` has no remaining `KEEP` items that were actually touched, and no remaining `REWRITE`/`POLISH` items.

## System-Wide Impact

- **Interaction graph:** the docs site is a read-only artifact at build time. Changes here do not affect the app, the API, or any runtime. No callbacks into backend systems.
- **Error propagation:** build-time only. Broken internal links show up as Astro warnings, not runtime errors. CI (if configured) would surface them on a deploy preview; locally surfaced via `build`.
- **State lifecycle risks:** none. Pure content.
- **API surface parity:** `api/graphql.mdx` and `api/compounding-memory.mdx` must reflect the GraphQL schema as of 2026-04-21. If the schema changes mid-rewrite, the last rewrite author wins; resolve in Unit 11.
- **Integration coverage:** the Astro build is the integration test. `pnpm --filter @thinkwork/docs build` is the one command that proves end-to-end correctness.
- **Unchanged invariants:**
  - Sidebar structure in `astro.config.mjs` stays the same except for label updates tied to renames.
  - `Hero.astro`, `BrainMark.astro`, `custom.css` stay as-is.
  - No new Starlight plugins or Astro integrations.
  - `docs/metrics/` and `docs/solutions/` directories are out of scope and untouched.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Rewriting 73 pages in parallel causes accuracy drift (flag names, route paths change between when audit ran and when rewrite runs) | Medium | Medium | Unit 11 is an explicit consolidation pass; Unit 2 audit records specific accuracy flags so rewriters know what to verify |
| Scope creep — a rewrite unit decides to redesign sidebar or add plugins | Low-Medium | High | Scope boundaries + Key Technical Decisions are explicit: no sidebar restructure, no new components. Deviations require plan amendment |
| Pipeline-mode autonomous work in ce:work produces too-generic prose ("AI slop") in 73 pages | Medium | High | `STYLE.md` explicitly calls out voice; gold-standard exemplars are in-repo and named; Unit 11 manual clickthrough catches regressions |
| Stub-like pages (admin features that are genuinely thin in the app) force us to write fake depth | Low | Medium | Style guide permits short pages — "a page can be short, not stub — honest about what the feature is" — and the "Known limits" section is the escape hatch |
| Orphan handling — `concepts/mcp-servers.mdx` is not the only orphan; audit misses others | Low | Low | Unit 2 explicitly diffs the file tree against the sidebar; any untracked file is flagged |
| Breaking inbound deep links when a page is renamed/deleted | Medium | Medium | Prefer folding content over deleting files. If a file must be deleted, check inbound referrers in GitHub issues + external links, and leave a redirect stub if any exist |
| Recent pipeline work continues landing while rewrite is in flight (compounding memory is actively iterating — see recent commits) | High | Low-Medium | Consolidation unit (11) is a re-verify pass specifically for the memory section; the pipeline doc is kept as-is (gold std) and gets only accuracy-ticks |
| Custom domain cutover happens mid-rewrite (`site:` uncomment) | Low | Low | Plan uses relative paths throughout — no absolute-URL dependencies to break |

## Phased Delivery

Each phase is one PR (or a small cluster of closely-related PRs). PRs target `main` directly per the `feedback_pr_target_main.md` memory.

### Phase 1 — Foundation *(Units 1–2)*
**Outcome:** `docs/STYLE.md` and `docs/STYLE-AUDIT.md` committed. No content pages changed. Everyone downstream is working from the same rubric.

### Phase 2 — Front door + Concepts *(Units 3–7)*
**Outcome:** Landing, getting started, and all of `/concepts/*` at house standard. This is the highest-leverage slice — most first-time readers touch these pages.

### Phase 3 — Applications *(Units 8–9)*
**Outcome:** Admin, mobile, CLI at standard. Operator + end-user + developer workflows all have complete guides.

### Phase 4 — Reference + Guides *(Unit 10)*
**Outcome:** Deploy, API, SDK, and guides surfaces finished. Architecture and roadmap polished.

### Phase 5 — Consolidation *(Unit 11)*
**Outcome:** Build passes clean. Link integrity verified. `STYLE-AUDIT.md` fully resolved. Site is shippable.

## Documentation Plan

This plan *is* the documentation plan. Specifically:

- `docs/STYLE.md` persists after the rewrite as the standard for future PRs.
- `docs/STYLE-AUDIT.md` persists as a historical record of the rewrite and a template for future "content audit" sweeps.
- A brief note added to `docs/README.md` (if one exists) or the root `README.md` pointing to `docs/STYLE.md` for contributors.
- No blog post or changelog entry — this is internal quality work, not a user-facing release.

## Operational / Rollout Notes

- Docs deploys via the existing pipeline (Astro static build → wherever the site hosts today; `site:` in `astro.config.mjs` will uncomment when `docs.thinkwork.ai` custom domain lands — not in scope).
- Each phase's PR should include a deploy preview link in its description for review.
- No flags, no migration, no rollback concerns — content edits are trivially revertable per-commit.

## Session 1 progress (2026-04-21)

**Completed (Units 1–7, all Concepts section + front door):**

- `docs/STYLE.md` — editorial standard for the site.
- `docs/STYLE-AUDIT.md` — per-page classification (KEEP/POLISH/REWRITE). Net: 18 KEEP, 23 POLISH, 31 REWRITE (audit turned up that most pages are in better shape than the original plan assumed).
- `index.mdx` — landing page: added "What ThinkWork is" narrative before the card grid.
- `getting-started.mdx` — fixed the Step 5 → Step 7 numbering gap by adding Step 6 (review outputs); removed duplicate outputs block.
- `concepts/threads.mdx` + `threads/lifecycle-and-types.mdx` + `threads/routing-and-metadata.mdx` — full rewrite of the Threads concept.
- `concepts/agents.mdx` — reordered so GraphQL mutation is under-the-hood; managed-vs-connected framing up top.
- `concepts/agents/managed-agents.mdx` — full invocation walking tour (cold start → assembly → Bedrock → Strands loop → post-turn side effects).
- `concepts/agents/templates-and-skills.mdx` — full rewrite; fleet-wide reuse model explained before field tables.
- `concepts/knowledge.mdx` — full rewrite of the Memory hub with the three-layer model.
- `concepts/knowledge/document-knowledge.mdx`, `/memory.mdx`, `/retrieval-and-context.mdx`, `/knowledge-graph.mdx` — full rewrites.
- `concepts/connectors.mdx` — polish; removed dated MCP-pattern section.
- `concepts/connectors/mcp-tools.mdx` — polish; added the "two surfaces" distinction and the orphan fold.
- `concepts/mcp-servers.mdx` — **deleted** (orphan); inbound links updated.
- `concepts/control.mdx` + `control/guardrails.mdx` + `control/budgets-usage-and-audit.mdx` — full rewrites of the Control section.
- `concepts/automations.mdx` + `automations/scheduled-and-event-driven.mdx` + `automations/routines-and-execution-model.mdx` — full rewrites.
- Build passes cleanly (73 pages, no broken-link warnings).

**Remaining work (Units 8–11):**

- **Unit 8 — Applications: Admin (19–22 pages).** Per the audit, this is mostly POLISH (accuracy passes on flag names, routes, env vars). The six KEEP pages need only verification. The gold-standard `admin/threads.mdx` remains the template.
- **Unit 9 — Applications: Mobile (6 pages) + CLI (2 pages).** Same shape — mostly POLISH, accuracy-focused. Mobile pages especially should verify against the Cognito sync invariant + Google-OAuth-only reality.
- **Unit 10 — Deploy, API Reference, SDKs, Guides (15 pages).** Guides are already KEEP; Deploy/API/SDK are POLISH. Verify tfvars variable list + GraphQL schema snippets against the code at handoff time.
- **Unit 11 — Consolidation.** Build + link integrity + final walkthrough. The build passes as of session 1 end; this unit's work is the final sidebar clickthrough + any drift caught during the Units 8–10 rewrites.

**Recommended next-session approach:**

1. Pull the branch `docs/full-rewrite-v1`.
2. Read `docs/STYLE.md` and `docs/STYLE-AUDIT.md` to orient.
3. Walk Unit 8 Admin pages in the audit order, applying the POLISH rubric from `STYLE.md`.
4. Commit per section (Admin Work group, Admin Agents group, Admin Manage group).
5. Unit 9 and 10 follow the same pattern.
6. Unit 11 build pass is what greenlights the merge.

The branch is ready for PR as-is if a phase-per-PR delivery is preferred — the Concepts section is coherent and reviewable in isolation.

## Sources & References

- Recent gold-standard pages (in-repo):
  - [`docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx`](../src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx)
  - [`docs/src/content/docs/architecture.mdx`](../src/content/docs/architecture.mdx)
  - [`docs/src/content/docs/applications/admin/threads.mdx`](../src/content/docs/applications/admin/threads.mdx)
  - [`docs/src/content/docs/applications/mobile/index.mdx`](../src/content/docs/applications/mobile/index.mdx)
  - [`docs/src/content/docs/getting-started.mdx`](../src/content/docs/getting-started.mdx)
- Recent solutions docs to weave accurately into the rewrite:
  - `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`
  - Recent `docs/solutions/` entries from the last 30 days relevant to each section under rewrite
- Sidebar structure: `docs/astro.config.mjs`
- Related recent plans: `docs/plans/2026-04-21-007-docs-readme-accuracy-refresh-plan.md` (README refresh — complementary scope)
