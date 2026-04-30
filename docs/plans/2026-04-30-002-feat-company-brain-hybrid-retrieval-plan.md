---
title: "feat: Company Brain hybrid retrieval and source agents"
type: feat
status: active
date: 2026-04-30
origin:
  - docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
  - docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
  - docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
---

# feat: Company Brain hybrid retrieval and source agents

## Overview

Company Brain search must behave like a first-class retrieval system, not a thin fan-out that happens to call Hindsight and the compiled wiki. This plan fixes the immediate failure mode: a typo like "restarant" should not hide compiled wiki pages about Paris restaurants, and Hindsight memory hits should pull forward the compiled pages that cite those memory units.

The work has three connected parts:

1. Make compiled wiki retrieval hybrid lexical: full-text search over `search_tsv`, prefix matching, alias matching, and typo-tolerant trigram/token fallback with clear ranking.
2. Add Hindsight-to-wiki citation bridging: when Hindsight returns a memory unit, follow `wiki_section_sources.source_ref = memory_unit_id` and return/boost compiled pages that cite that memory.
3. Make the source-agent idea demonstrable: keep indexed retrieval as the reliable substrate, but expose at least one live, bounded source-agent adapter that runs in the normal parallel Context Engine fan-out and proves it invoked source-specific retrieval logic.

This is intentionally narrower than the full Company Brain v0 plan. It strengthens retrieval quality and the source-agent seam without adding embeddings, a unified vector index, or write-capable operational adapters.

## Problem Frame

The current Company Brain operator test can make the product look broken even when useful knowledge exists. Hindsight may return a single memory, while the compiled wiki either misses or under-ranks the relevant pages. Worse, a simple misspelling can drop wiki results entirely even though semantic/compiled retrieval should absorb that kind of user input.

The product concern is also valid: if "agents doing the search" only means a standard search provider listed beside inert sub-agent stubs, the implementation does not match the Scout-style brainstorm. The right v0 shape is not to abandon deterministic search. It is to make source agents orchestrate source-specific retrieval tools, ranking, follow-up, and diagnostics while the underlying sources use the strongest practical retrieval primitive available.

## Requirements Trace

- R1. Compiled wiki search uses a hybrid lexical strategy over compiled page data: `search_tsv`, prefix terms, aliases, and typo-tolerant trigram/token fallback.
- R2. Misspelled user queries such as "favorite restarant in Paris" still return relevant compiled wiki pages when those pages contain "restaurant" or equivalent aliases.
- R3. Wiki ranking prefers high-signal compiled pages and exposes enough score metadata or test coverage to prove full-text, prefix, alias, and fuzzy branches are active.
- R4. Hindsight memory hits are not dead ends. If a returned memory unit is cited by compiled wiki sections, the Context Engine also returns the citing wiki page as a boosted hit.
- R5. The Hindsight-to-wiki bridge is tenant/user scoped and follows existing citation tables instead of guessing page relationships from text.
- R6. Context Engine fan-out continues to run providers in parallel and report provider-level status, latency, hit count, skipped/degraded state, and sub-agent metadata.
- R7. At least one source-agent adapter is live enough to demonstrate the seam: it has a source-specific prompt/strategy descriptor, a bounded tool surface, a depth or pass cap, normalized hits, status output, and tests proving the source-specific retrieval function was invoked.
- R8. Inert ERP/CRM/support/catalog adapters remain inert unless explicitly wired; this plan does not fake agentic behavior for sources without data.
- R9. Local and live E2E coverage validates exact query behavior, typo behavior where branch code is deployed, Hindsight-to-wiki bridging, and source-agent seam behavior.

## Scope Boundaries

### In Scope

- `packages/api` wiki retrieval, Context Engine provider behavior, ranking metadata, and tests.
- A bounded source-agent adapter demonstration in the Context Engine provider layer.
- Admin/provider metadata needed to show whether a source agent is inert or live.
- E2E and integration coverage for Company Brain query quality.

### Out of Scope

- Adding embeddings/vector search for wiki pages in this PR.
- Building a unified vector index across Hindsight, wiki, files, and KBs.
- Backfilling the wiki unless tests reveal missing `wiki_section_sources` rows for already-compiled pages in the target dev data.
- Making ERP, CRM, support, catalog, or Bedrock KB source agents live.
- Renaming internal `context-engine` package paths or the `query_context` MCP contract.
- Replacing deterministic wiki retrieval with an LLM-only search agent.

## Context and Research

### Existing Product and Architecture

- `docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md` defines Company Brain as an agent-augmentation substrate and explicitly calls out sub-agent provider shape, source citations, provider statuses, and operator verification.
- The same plan says v0 sub-agent providers are mostly inert, which explains the current mismatch between the product story and observable behavior.
- `docs/brainstorms/2026-04-29-admin-memory-knowledge-center-requirements.md` requires the operator test surface to show provider statuses and top hits without requiring a full agent chat.
- `docs/brainstorms/2026-04-28-context-engine-requirements.md` keeps `query_context` as the normalized source fan-out contract.

### Relevant Code

- `packages/api/src/lib/wiki/search.ts` owns compiled wiki search and should remain the single shared helper for admin/mobile/API search behavior.
- `packages/api/src/lib/context-engine/providers/wiki.ts` adapts wiki search rows into `ContextHit` objects.
- `packages/api/src/lib/context-engine/providers/memory.ts` adapts Hindsight/AgentCore memory results into `ContextHit` objects and already sets `provenance.sourceId = hit.record.id`.
- `packages/api/src/lib/context-engine/router.ts` runs providers with `Promise.all`, merges results, and applies ranking/dedupe.
- `packages/api/src/lib/wiki/repository.ts` already has wiki-side source traversal helpers such as `findMemoryUnitPageSources`.
- `packages/api/src/lib/brain/repository.ts` has `findPageSourcesAcrossSurfaces`, a union helper that can find pages citing a source ref across personal wiki and tenant entity surfaces.
- `packages/api/src/lib/context-engine/providers/sub-agent-base.ts` defines the sub-agent provider seam and metadata shape, but the default invocation path does not yet prove source-specific tool orchestration.
- `packages/api/src/handlers/mcp-context-engine.ts` returns provider descriptors for the operator UI.
- `apps/admin/src/components/ContextEngineSubAgentPanel.tsx` and `apps/admin/src/lib/context-engine-api.ts` are the admin surfaces for sub-agent metadata.

### Institutional Learnings

- `docs/solutions/logic-errors/mobile-wiki-search-tsv-tokenization-2026-04-27.md` is directly applicable: wiki search must use separator-aware `search_tsv`, safe prefix queries, and a shared helper instead of UI-local filtering.
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md` requires every adapter to report hit count, latency, skipped/degraded state, and target binding so operators can distinguish "no data" from "wrong target."
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` supports making a live source-agent seam demonstrable while keeping unwired adapters inert.
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md` requires source agents to have narrow tool surfaces and explicit allowlists.

### External References

- The user cited `https://github.com/agno-agi/scout` as the product inspiration for agentic source search. This plan treats Scout as a product-pattern reference: agents coordinate source-specific retrieval and follow-up; deterministic indexes still provide the reliable substrate for sources like Postgres wiki pages.

## Key Decisions

1. **Hybrid lexical first, embeddings later.** For compiled wiki pages, Postgres full-text, prefix, alias, and trigram retrieval are the right immediate fix. They are explainable, tenant-scoped, testable, and already match the current data model. Embeddings may become useful for paraphrase-heavy retrieval, but they add model/provider cost, backfill complexity, drift handling, and ranking fusion work that is not needed to fix typo and citation bridging failures.
2. **Source agents orchestrate retrieval; they do not replace indexes.** The point of a source agent is source-specific strategy: choosing tools, running follow-up queries, inspecting citations, handling source quirks, and returning diagnostics. The compiled wiki source should still use strong lexical retrieval underneath because that is the fastest and most reliable way to query compiled pages.
3. **Bridge Hindsight hits to wiki citations using source tables, not fuzzy text.** Memory hit IDs already flow through `provenance.sourceId`. The bridge should look up rows where `source_kind = 'memory_unit'` and `source_ref = memoryUnitId`, returning the pages that cite that memory. This preserves provenance and avoids false associations.
4. **Bridge hits should appear as wiki-family hits.** Even if the enrichment happens while processing memory results, the user should see compiled pages returned as compiled wiki/Company Brain pages, with metadata showing that the page was boosted because Hindsight recalled a cited memory.
5. **Make one live source-agent adapter observable.** The existing inert provider metadata is useful, but it does not answer the user's concern. This PR should include a bounded Company Brain wiki source-agent adapter or source-agent seam test that proves source-specific retrieval logic was invoked and normalized into Context Engine hits.
6. **Keep provider failure isolation.** A failing source agent, MCP tool, or optional provider must not suppress successful memory/wiki results. Tests should select required providers explicitly when asserting live E2E quality.

## Implementation Units

### Unit 1: Hybrid compiled wiki search

**Goal:** Make `searchWikiForUser` reliably return compiled pages for exact, prefix, alias, and typo queries.

**Files**

- Modify: `packages/api/src/lib/wiki/search.ts`
- Modify: `packages/api/src/__tests__/wiki-search.test.ts`

**Approach**

- Normalize user terms into safe alphanumeric tokens and drop low-signal stopwords.
- Build safe prefix `to_tsquery` terms for user input.
- Keep `search_tsv` as the primary indexed path.
- Add or harden alias matching and token-level trigram fallback using `pg_trgm` similarity for misspellings such as `restarant`.
- Rank results with a blended score that prefers direct FTS matches, then prefix/alias, then fuzzy fallback.
- Preserve tenant/user scoping and status filters in every branch.

**Test Scenarios**

- Query `favorite restaurant in paris` returns restaurant pages.
- Query `favorite restarant in paris` returns the same class of restaurant pages via fuzzy fallback.
- Query terms split by punctuation still match independent lexemes.
- Prefix input matches longer compiled-page terms.
- Alias-only matches are included and ranked.
- Empty or stopword-only queries do not produce broad unscoped scans.

### Unit 2: Hindsight memory hit to compiled wiki page bridge

**Goal:** When memory returns a Hindsight hit, also return the compiled wiki pages that cite that memory unit.

**Files**

- Modify: `packages/api/src/lib/context-engine/providers/memory.ts`
- Modify or add: `packages/api/src/lib/context-engine/providers/memory.test.ts`
- Modify if needed: `packages/api/src/lib/brain/repository.ts`

**Approach**

- Collect memory hit IDs from `ThinkWorkMemoryRecord.id`.
- Look up citing pages with existing source traversal helpers, preferably the cross-surface helper in `packages/api/src/lib/brain/repository.ts`.
- Emit additional `ContextHit` objects with `family: "wiki"` and provenance metadata tying the page back to the recalled memory unit.
- Boost bridge hits enough that citing compiled pages are visible near the memory hit, while still allowing direct wiki search results to dedupe or outrank duplicates.
- Avoid widening tenant/user scope. Personal wiki pages require the calling `userId`; tenant entity pages require the authenticated tenant.

**Test Scenarios**

- A mocked Hindsight memory hit with ID `mem-1` plus a wiki section source `memory_unit/mem-1` returns both the memory hit and a wiki-family bridge hit.
- Bridge hits include provenance metadata with the memory unit ID and page identity.
- Duplicate direct wiki hits and bridge hits dedupe to the stronger result.
- No bridge hits are emitted when no source rows cite the memory.
- The bridge does not return pages from another tenant or another user's personal wiki.

### Unit 3: Demonstrable source-agent adapter seam

**Goal:** Make "agents doing the search" observable without pretending all source adapters are live.

**Files**

- Modify: `packages/api/src/lib/context-engine/providers/sub-agent-base.ts`
- Modify: `packages/api/src/lib/context-engine/providers/index.ts`
- Add or modify: `packages/api/src/lib/context-engine/__tests__/sub-agent-provider-e2e.test.ts`
- Modify if needed: `packages/api/src/handlers/mcp-context-engine.ts`
- Modify if needed: `apps/admin/src/components/ContextEngineSubAgentPanel.tsx`
- Modify if needed: `apps/admin/src/lib/context-engine-api.ts`

**Approach**

- Keep the base sub-agent contract narrow: source-specific strategy, tool allowlist, depth/pass cap, process model, and normalized `ContextHit` return shape.
- Add a live Company Brain/wiki source-agent demonstration that invokes the wiki retrieval helper through an injected source retrieval seam, or harden the existing source-agent test so it proves the retrieval seam ran and produced normalized hits.
- Ensure `createCoreContextProviders` can include the demonstrable provider without breaking default source behavior. If the provider is not default-enabled, E2E can select it explicitly.
- Expose `subAgent.seamState`, `processModel`, tool allowlist, and target binding through provider descriptors so the operator UI can distinguish live vs inert.

**Test Scenarios**

- The source-agent provider invokes the injected wiki/source retrieval seam for a query.
- The provider returns normalized hits and provider status through the standard Context Engine router.
- The router runs the source-agent provider in parallel with other selected providers.
- Provider descriptor output marks the source agent as live or inert accurately.
- Inert ERP/CRM/support/catalog providers continue returning skipped/inert status.

### Unit 4: Company Brain E2E retrieval coverage

**Goal:** Prove the feature end to end against local code and, where possible, deployed dev data.

**Files**

- Add or modify: `packages/api/vitest.context-engine-e2e.config.ts`
- Add or modify: `packages/api/test/integration/context-engine/company-brain-context.e2e.test.ts`
- Modify: `packages/api/package.json`
- Add or modify: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_e2e.py`

**Approach**

- Add a package script for Context Engine E2E.
- Keep exact-spelling live E2E runnable against deployed dev data.
- Add typo-query assertions for local/unit coverage immediately and live E2E once the branch is deployed.
- Add bridge assertions with fixture/mocked data if the deployed dev database does not currently contain a stable cited-memory fixture.
- Keep provider selection explicit so optional MCP/source failures do not hide core Company Brain regressions.

**Test Scenarios**

- `favorite restaurant in paris` returns at least one wiki-family hit from core providers.
- `favorite restarant in paris` returns a wiki-family hit in local/API tests.
- A memory hit with a cited wiki page returns the boosted compiled page.
- A selected source-agent provider returns normalized hits and status.
- Provider failures are represented as degraded/skipped without failing the entire query when non-required.

### Unit 5: Admin provider metadata visibility

**Goal:** Let an operator see whether Company Brain source agents are live, inert, or degraded.

**Files**

- Modify: `apps/admin/src/components/ContextEngineSubAgentPanel.tsx`
- Modify: `apps/admin/src/lib/context-engine-api.ts`
- Modify: `packages/api/src/handlers/mcp-context-engine.ts`

**Approach**

- Preserve existing provider list behavior.
- Include `subAgent` metadata in provider summaries.
- Render live/inert status, process model, and tool/target hints compactly in the Sources/test surface.

**Test Scenarios**

- Provider summaries with `subAgent` metadata deserialize in admin code.
- Live and inert providers render distinct status labels.
- Provider descriptors without `subAgent` metadata still render normally.

## Dependencies and Sequencing

1. Hybrid wiki search should land first because both direct wiki provider and source-agent demonstrations depend on reliable retrieval.
2. Hindsight-to-wiki bridge follows because it depends on stable wiki hit normalization and page provenance.
3. Source-agent seam work can proceed after the core source helpers are stable.
4. E2E tests should be added alongside each behavior, with live deployed assertions separated from local deterministic fixtures.
5. Admin provider metadata can be finished after API descriptors are stable.

## Risks and Mitigations

- **False positives from fuzzy search.** Mitigate by requiring scoped tenant/user filters, minimum token length, stopword removal, and ranking that prefers direct FTS over fuzzy fallback.
- **Slow trigram scans.** Mitigate by keeping `search_tsv` primary, limiting fallback candidates, and testing query SQL/latency against dev data.
- **Bridge N+1 lookups.** Mitigate with a batched source-ref lookup or bounded memory hit limits.
- **Confusing provider labels.** Mitigate by returning bridge hits as wiki-family hits with explicit metadata that they were boosted via memory citation.
- **Agentic demo that is still too fake.** Mitigate by testing an actual source-specific retrieval seam invocation, not just descriptor metadata.
- **Live E2E data drift.** Mitigate with local deterministic fixtures and environment-gated live checks that explain when a deployed branch is required for typo assertions.

## What The Agents Are For

Agents are not valuable because they can perform a better `ILIKE` or `ts_rank_cd` query than Postgres. They are valuable when a source requires source-specific judgment: query expansion, pagination, citation following, freshness checks, domain-specific filters, fallback strategies, and explaining why a provider produced no result.

For the compiled wiki, the source agent should orchestrate a hybrid retrieval tool and follow citations; the retrieval tool itself should stay deterministic. For operational systems, future source agents can choose source APIs, inspect related objects, and return structured facets. This PR makes that distinction demonstrable while fixing the core retrieval failure now.

## Acceptance Checklist

- Wiki search returns compiled pages for exact and typo restaurant queries.
- Hindsight memory hits can boost/return compiled pages that cite the recalled memory unit.
- At least one source-agent seam is demonstrably live in tests or selected E2E.
- Provider statuses continue to show partial failure/skipped behavior.
- Existing memory/wiki/admin tests still pass.
- A dev server is available for user validation on the admin Sources surface.
