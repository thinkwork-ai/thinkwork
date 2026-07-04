---
title: "refactor: ThinkWork Brain UI and docs rename"
type: refactor
status: active
date: 2026-04-30
origin:
  - docs/brainstorms/2026-04-29-brain-v0-requirements.md
  - docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
---

# refactor: ThinkWork Brain UI and docs rename

## Overview

This pass makes **ThinkWork Brain** the product-facing name for the admin surface that was previously exposed as Knowledge and for the user-visible Context Engine copy. The underlying `/knowledge` route family and Context Engine API/service names stay stable in this PR because they are internal contracts and route paths, not the visible product name.

The work is intentionally copy/navigation/docs focused:

1. Rename admin nav/module labels from **Knowledge** to **ThinkWork Brain**.
2. Rename visible **Context Engine** UI copy to **ThinkWork Brain**, **ThinkWork Brain sources**, or **ThinkWork Brain settings** depending on context.
3. Move ThinkWork Brain directly below Threads in the tenant navigation.
4. Replace the Memory-centered docs section with a full ThinkWork Brain section.
5. Audit remaining "Context Engine" mentions and classify each as user-facing, internal architecture, or stale docs.

## Requirements Trace

- R1. Admin primary navigation shows **ThinkWork Brain**, not Knowledge.
- R2. ThinkWork Brain sits directly below Threads in the tenant navigation so it stays near the live work it enriches.
- R3. The unified admin module header says **ThinkWork Brain**.
- R4. The Context Engine tab label and operator copy no longer expose Context Engine as the user-facing product name. Where the page controls providers or query diagnostics, use "ThinkWork Brain sources", "ThinkWork Brain provider settings", or "ThinkWork Brain query test".
- R5. Existing child surfaces remain available: memory records, compiled wiki/pages, Bedrock knowledge bases, and provider/query verification.
- R6. The docs sidebar changes from **Memory** to **ThinkWork Brain** and leads with ThinkWork Brain concepts rather than memory-only framing.
- R7. Admin docs describe the ThinkWork Brain module as the umbrella for memory, compiled pages, knowledge bases, and source/provider verification.
- R8. Existing Memory pages are replaced or reframed under ThinkWork Brain; stale standalone Memory documentation should not remain the primary conceptual story.
- R9. API/reference docs may still use "Context Engine" only when describing the internal `query_context` contract or code-level service boundary.
- R10. Historical brainstorms/plans are not rewritten except for new audit notes; archived records can keep the old language.

## Scope Boundaries

### In Scope

- Admin user-facing labels/copy in `apps/admin`.
- Docs pages and Starlight sidebar entries in `docs`.
- Tests for tab selection, visible labels, sidebar ordering, and docs build/link validity.
- A new audit section in this plan documenting what remains.

### Out of Scope

- Renaming `/knowledge` routes, route filenames, or TanStack route IDs.
- Renaming GraphQL fields, database tables, Lambda names, package names, or the `query_context` MCP contract.
- Renaming `packages/api/src/lib/context-engine/*` or `packages/database-pg/graphql/types/context-engine.graphql`.
- Reworking ThinkWork Brain v0 backend features from `docs/plans/2026-04-29-004-feat-brain-v0-plan.md`.

## Context and Research

### Product Requirements

- `docs/brainstorms/2026-04-29-brain-v0-requirements.md` reframes Context Engine as ThinkWork Brain: an agent-feeding substrate first and browseable view second.
- `docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md` shipped the prior Knowledge umbrella with Memory, Wiki, Knowledge Bases, and Context Engine tabs. This PR supersedes the user-facing name while preserving the shape.
- `docs/brainstorms/2026-04-28-context-engine-requirements.md` still defines the internal shared `query_context` primitive. That internal architecture vocabulary remains valid unless it leaks into user-facing UI/docs.

### Relevant Code and Docs

- `apps/admin/src/components/Sidebar.tsx` — primary tenant navigation labels and order. Today Knowledge lives in the Agents group after Templates and Capabilities.
- `apps/admin/src/routes/_authed/_tenant/knowledge.tsx` — unified module header and tabs. Today header is Knowledge and tabs are Memory, Wiki, Knowledge Bases, Context Engine.
- `apps/admin/src/routes/_authed/_tenant/knowledge/index.tsx` — default child route redirect, currently `/knowledge/memory`.
- `apps/admin/src/routes/_authed/_tenant/knowledge/-knowledge-tabs.test.ts` — current tab selection behavior.
- `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx` — visible Context Engine test/provider UI copy.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — agent/template configuration card and dialog that currently say Context Engine.
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx` — built-in tool operator copy that may expose Context Engine.
- `docs/astro.config.mjs` — docs sidebar. Components section currently labels the concept group Memory; Admin docs put Memory and Knowledge Bases under Manage.
- `docs/src/content/docs/applications/admin/knowledge.mdx` — current admin Knowledge page.
- `docs/src/content/docs/applications/admin/memory.mdx` — standalone Memory admin page to replace/reframe.
- `docs/src/content/docs/concepts/knowledge.mdx` and `docs/src/content/docs/concepts/knowledge/*.mdx` — current Memory/knowledge concept section.
- `docs/src/content/docs/api/context-engine.mdx` — keep as an internal API reference or retitle around the ThinkWork Brain `query_context` contract while preserving exact tool/API names.
- `docs/src/content/docs/api/compounding-memory.mdx` and `docs/src/content/docs/guides/compounding-memory-operations.mdx` — update cross-links and naming where they present product concepts.

## Key Decisions

1. **Keep routes stable.** `/knowledge` remains the admin route in this PR. Changing URLs is separate migration work with router aliases, redirects, generated route updates, and docs redirects.
2. **Rename the product, not the primitive.** "ThinkWork Brain" is the product-facing umbrella. "Context Engine" remains acceptable for code/service references and API contracts, especially `query_context`.
3. **Move the nav item, not the route.** ThinkWork Brain appears directly below Threads in the tenant sidebar. The route still resolves to `/knowledge`.
4. **Docs paths remain stable where possible.** The section can continue using `concepts/knowledge/*` slugs for now to avoid breaking links, but titles/sidebar labels become ThinkWork Brain.
5. **Memory becomes a facet, not the module.** Memory docs stay only where they explain the memory facet/records/backends inside ThinkWork Brain.

## Implementation Units

### Unit 1: Admin navigation and module labels

**Goal:** Make ThinkWork Brain sit directly below Threads in tenant navigation and become the primary module title.

**Files**

- Modify: `apps/admin/src/components/Sidebar.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/-knowledge-tabs.test.ts`

**Changes**

- Move `{ to: "/knowledge", icon: Brain, label: "ThinkWork Brain" }` directly below Threads.
- Rename the Knowledge header to ThinkWork Brain.
- Rename the tab labels:
  - Memory -> Memory
  - Wiki -> Pages
  - Knowledge Bases -> Knowledge Bases
  - Context Engine -> Sources
- Keep route paths and `KnowledgeTab` internal names as-is.
- Add or update tests asserting ThinkWork Brain is selected via `/knowledge/*`, default child route still maps to memory, and tab labels include Sources.

**Acceptance**

- Sidebar renders ThinkWork Brain directly after Threads.
- `/knowledge/memory` shows the ThinkWork Brain header.
- The former Context Engine tab reads Sources.
- No TanStack route rename is required.

### Unit 2: ThinkWork Brain provider/source UI copy

**Goal:** Remove user-facing Context Engine wording from admin UI while preserving internal variable names.

**Files**

- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx`

**Changes**

- Rewrite page/card/dialog titles from Context Engine to ThinkWork Brain sources/settings/query test.
- Keep exact tool/API names such as `query_context` when shown as code.
- Rename explanatory copy that says agents are injected with Context Engine to say agents use ThinkWork Brain context.
- Do not rename `contextEngine*` local state or API payload keys unless a user-visible string is directly tied to them.

**Acceptance**

- `rg -n "Context Engine" apps/admin/src` only returns internal identifiers, comments, tests that intentionally reference API names, or no results.
- User-visible strings use ThinkWork Brain language.

### Unit 3: Docs sidebar and ThinkWork Brain concept section

**Goal:** Replace Memory-first docs with ThinkWork Brain-first docs.

**Files**

- Modify: `docs/astro.config.mjs`
- Modify: `docs/src/content/docs/concepts/knowledge.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/memory.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/document-knowledge.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/retrieval-and-context.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/compounding-memory-pages.mdx`
- Modify: `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx`

**Changes**

- Rename Components sidebar group label from Memory to ThinkWork Brain.
- Reframe the overview page as the full ThinkWork Brain hub.
- Reframe Memory as one facet/backend inside ThinkWork Brain.
- Reframe document knowledge/knowledge bases as sources.
- Reframe retrieval/context as source routing and `query_context`.
- Keep Compounding Memory pages but explain them as compiled ThinkWork Brain pages/facets.
- Update titles/descriptions/cross-links to avoid presenting Memory as the top-level module.

**Acceptance**

- Docs Components sidebar leads with ThinkWork Brain.
- Concept overview explains what ThinkWork Brain is, how it is built from sources/facets, how agents use it, and how operators inspect it.
- Memory is no longer the top-level conceptual identity.

### Unit 4: Admin and API docs refresh

**Goal:** Make application docs match the admin product surface.

**Files**

- Modify: `docs/src/content/docs/applications/admin/knowledge.mdx`
- Modify: `docs/src/content/docs/applications/admin/memory.mdx`
- Modify: `docs/src/content/docs/applications/admin/knowledge-bases.mdx`
- Modify: `docs/src/content/docs/applications/admin/index.mdx`
- Modify: `docs/src/content/docs/applications/admin/agents.mdx`
- Modify: `docs/src/content/docs/api/context-engine.mdx`
- Modify: `docs/src/content/docs/api/compounding-memory.mdx`
- Modify: `docs/src/content/docs/guides/compounding-memory-operations.mdx`

**Changes**

- Rename "Admin — Knowledge" to "Admin — ThinkWork Brain".
- Replace old tab list with Memory, Pages, Knowledge Bases, Sources.
- Update Admin overview links and summaries.
- Keep `api/context-engine.mdx` as a low-level API reference, but introduce it as the internal context routing contract behind ThinkWork Brain and preserve exact names such as `query_context`.
- Update Compounding Memory docs to link to ThinkWork Brain concept pages.

**Acceptance**

- `rg -n "Knowledge →|Knowledge tab|Context Engine tab|Admin — Knowledge|Memory pages" docs/src/content/docs` returns no stale product-facing strings.
- API reference still documents `query_context` without pretending the code contract was renamed.

### Unit 5: Audit and classify remaining mentions

**Goal:** Leave a durable audit so future work knows what was intentionally kept.

**Files**

- Modify: `docs/plans/2026-04-30-001-refactor-brain-nav-docs-plan.md`

**Changes**

- Add an "Audit Results" section after implementation with categories:
  - User-facing renamed now.
  - Internal architecture intentionally kept.
  - Stale docs deleted/replaced.
  - Historical docs left unchanged.
- Include representative file paths and rationale.

**Acceptance**

- `rg -n "Context Engine|Knowledge|Memory" apps/admin/src docs/src/content/docs packages/workspace-defaults/src/index.ts` has been reviewed.
- Remaining "Context Engine" mentions are explainable as internal architecture/API references or historical artifacts.

## Test Plan

- `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/knowledge/-knowledge-tabs.test.ts`
- Add targeted admin tests if a sidebar test harness exists; otherwise cover via browser verification.
- `pnpm --filter @thinkwork/docs build`
- `pnpm --filter @thinkwork/admin build`
- Browser verification:
  - Copy admin env from main checkout if missing: `cp /Users/ericodom/Projects/thinkwork/apps/admin/.env apps/admin/.env`
  - Start admin dev server on an available port: `pnpm --filter @thinkwork/admin dev -- --host 127.0.0.1 --port 5175`
  - Open the admin app and verify ThinkWork Brain sits directly below Threads in the sidebar, `/knowledge/memory` renders the ThinkWork Brain header, and the Sources tab replaces Context Engine.
  - Start docs dev or preview if needed and verify the ThinkWork Brain sidebar/doc page renders.

## Risks

- **Route/name mismatch confusion:** code and URLs will still say `knowledge`. Mitigation: this is documented as intentional; route migration can be a follow-up.
- **Over-renaming API docs:** `query_context` and Context Engine internals should not be hidden from developers. Mitigation: API docs frame Context Engine as the internal ThinkWork Brain context contract.
- **Docs link drift:** Starlight links may break during copy replacement. Mitigation: run docs build before PR.
- **Broad product terms:** "ThinkWork Brain" can become vague if every facet is renamed. Mitigation: keep precise facet labels: Memory, Pages, Knowledge Bases, Sources.

## Audit Results

### User-Facing Renamed Now

- `apps/admin/src/components/Sidebar.tsx` — sidebar label changed from Knowledge to ThinkWork Brain and moved directly below Threads.
- `apps/admin/src/routes/_authed/_tenant/knowledge.tsx` — module header changed to ThinkWork Brain; visible tabs are now Memory, Pages, Knowledge Bases, Sources.
- `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx` — visible adapter/query copy changed to ThinkWork Brain sources/query/result language.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` — template built-in tool card/dialog now says ThinkWork Brain / ThinkWork Brain Sources while preserving `query_context`.
- `apps/admin/src/routes/_authed/_tenant/capabilities/{builtin-tools,mcp-servers}.tsx` and `apps/admin/src/components/agents/AgentContextPolicyBadge.tsx` — visible policy/tooling labels now say ThinkWork Brain.
- `packages/api/src/handlers/mcp-context-engine.ts` — MCP tool descriptions and policy summaries now say ThinkWork Brain because agents and external callers can see those descriptions.
- `packages/workspace-defaults/src/index.ts` — generated agent-facing workspace docs now present ThinkWork Brain as the context layer.
- `docs/src/content/docs/**` and `docs/astro.config.mjs` — Memory-first docs and sidebars replaced with ThinkWork Brain-first concept, admin, API, and guide docs.

### Internal Architecture Kept

- `apps/admin/src/lib/context-engine-api.ts`, `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`, and related state names keep `contextEngine*` identifiers because they map to existing API payload keys and route paths.
- `packages/api/src/lib/context-engine/**` and `packages/api/src/handlers/mcp-context-engine.ts` keep package/path/function names because Context Engine is still the internal service boundary behind ThinkWork Brain source routing.
- `packages/database-pg/graphql/types/agent-templates.graphql` keeps `contextEngine` field names and comments for now. Renaming the GraphQL contract would require schema/codegen/API migration and is out of scope for this product-label pass.
- `docs/src/content/docs/api/context-engine.mdx` intentionally uses Context Engine where it documents the exact developer contract behind ThinkWork Brain, especially `query_context`.

### Stale Docs Replaced

- `docs/src/content/docs/applications/admin/knowledge.mdx` was rewritten from Admin — Knowledge to Admin — ThinkWork Brain.
- `docs/src/content/docs/applications/admin/memory.mdx` was reframed as the ThinkWork Brain Memory facet instead of a standalone module.
- `docs/src/content/docs/concepts/knowledge.mdx` was rewritten as the ThinkWork Brain hub.
- `docs/src/content/docs/concepts/knowledge/{document-knowledge,memory,retrieval-and-context,compounding-memory,compounding-memory-pipeline,compounding-memory-pages,knowledge-graph}.mdx` were retitled/reframed under ThinkWork Brain.
- High-level docs (`docs/src/content/docs/index.mdx`, `architecture.mdx`, selected agent concept/admin pages) now identify ThinkWork Brain as the harness context component.

### Historical Docs Left Unchanged

- `docs/brainstorms/**`, older `docs/plans/**`, and `docs/solutions/**` intentionally keep original terminology so historical decisions remain readable.
