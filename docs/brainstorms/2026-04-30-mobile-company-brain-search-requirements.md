---
date: 2026-04-30
topic: mobile-company-brain-search
status: ready-for-planning
related:
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
  - docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
  - docs/brainstorms/2026-04-20-mobile-wiki-browse-feature-requirements.md
  - docs/plans/2026-04-30-001-refactor-company-brain-nav-docs-plan.md
  - docs/plans/2026-04-30-002-feat-company-brain-hybrid-retrieval-plan.md
---

# Mobile Company Brain Search

## Problem Frame

The current mobile Wiki surface is still page-first: users can search compiled pages, browse recent pages, and switch into the force graph. Admin is moving to **Company Brain** as the product-facing umbrella for memory, compiled pages, knowledge bases, and source adapters. Mobile should make the same conceptual move, but with a different job: it is the user's surface plane for asking the Brain, enriching it, and reviewing what should become durable context for agents.

The mobile Brain should become **search-first enterprise context**, not a renamed wiki list. A user should be able to search their current Brain, inspect ranked/cited results across Brain pages, Hindsight, knowledge bases, web search, and other approved adapters, then turn useful findings into better agent context. Pages and the force graph remain important, but they become browse/visualization modes inside the broader Brain surface.

The first wedge is an **agentic enrichment run for an existing page**. From a page, the user can ask source agents to enrich the topic using Brain, Web, and Knowledge Base sources, review candidate summaries/facts, select what belongs, and trigger the page to be updated/recompiled. This proves the loop that matters most: mobile search and review improves the context automated agents use later.

---

## Actors

- A1. Mobile user: searches the Brain, explores source results, and decides what should become durable context.
- A2. Automated agent: later uses enriched Brain context when running scheduled or triggered work.
- A3. Source-agent adapter: searches one source family, normalizes cited results, and reports source status without blocking other sources.
- A4. Company Brain page: the durable topic/entity/decision surface being enriched, browsed, converted, or reviewed.
- A5. Tenant admin: governs which sources are eligible for Company Brain search and enrichment.

---

## Key Flows

- F1. Search-first Brain query
  - **Trigger:** The user opens the mobile Brain tab and enters a query.
  - **Actors:** A1, A3
  - **Steps:** The surface runs a Company Brain search across default-safe sources. Results show source family, title, summary/snippet, citation/provenance, and provider status. The user can filter results by source family or switch to Pages/graph browsing for page-shaped results.
  - **Outcome:** The user gets one ranked, cited result set instead of choosing between Wiki, Hindsight, KB, or web-style tools.
  - **Covered by:** R1, R2, R3, R4, R5, R6

- F2. Enrich an existing page with Brain, Web, and KB
  - **Trigger:** The user opens a Brain page and starts an enrichment run.
  - **Actors:** A1, A3, A4
  - **Steps:** The user selects source families, with Brain, Web, and Knowledge Base as the v0 proof set. Source agents run a bounded enrichment pass and return grouped candidate summaries/facts with citations and source status. The user selects which candidates to include, rejects the rest, and confirms the update.
  - **Outcome:** The page gains reviewed, cited context and can be recompiled so future agent work has better grounding.
  - **Covered by:** R7, R8, R9, R10, R11, R12, R13

- F3. Review proposed enrichments
  - **Trigger:** An agent or enrichment job proposes candidate page additions in the background.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The mobile Brain surface shows a review queue of pending additions. The user can open a proposal, inspect source citations, approve, edit, reject, or defer it.
  - **Outcome:** Agents can compound the Brain without silently writing unreviewed claims into durable context.
  - **Covered by:** R14, R15, R16

- F4. Convert a result into a page
  - **Trigger:** The user long-presses or opens a context menu on a search result that should become durable.
  - **Actors:** A1, A4
  - **Steps:** The user chooses a page action such as convert to page or add to page. If the page does not already exist, the app helps create a topic/entity/decision page through the existing verification model rather than creating orphan pages. If the page exists, the result can be attached as a candidate enrichment.
  - **Outcome:** Search results become durable Brain material with page identity and review, not loose bookmarks.
  - **Covered by:** R17, R18, R19

---

## Requirements

**Search-first mobile Brain**
- R1. The mobile top-level Wiki label is replaced or reframed as Company Brain/Brain, with search as the primary interaction.
- R2. Mobile Brain search returns a unified ranked result set across multiple Company Brain source families instead of only compiled wiki/page search.
- R3. Each result shows enough citation and source context for the user to judge trust: source family, title, excerpt or summary, provenance, and freshness/as-of where available.
- R4. Provider health is visible. Partial failures, skipped sources, timeouts, and no-data states appear as source status rather than a generic search failure.
- R5. Pages remain a first-class filter or mode inside Brain search. The existing page list and force graph are preserved as browse/visualization paths, not removed.
- R6. Search actions support page-oriented affordances such as open page, add to page, convert to page, tag/classify, and mark useful/not useful.

**Agentic page enrichment**
- R7. The first buildable wedge is an enrichment run launched from an existing Brain page.
- R8. The v0 enrichment proof uses at least Brain, Web, and Knowledge Base source families. CRM and ERP enrichment are valuable follow-ups but not required for the first proof.
- R9. Enrichment is agentic in product shape: source adapters run source-specific searches and return grouped candidate additions, not just raw links.
- R10. Candidate additions are review-first. The user chooses what to include before anything becomes durable page context.
- R11. Candidate additions preserve citations/provenance so the page can show where each accepted fact or summary came from.
- R12. Accepted additions trigger the page update/recompile flow so future automated agents can use the improved context.
- R13. Rejected additions are not silently retried into the same page as if they were accepted.

**Review and curation**
- R14. Mobile Brain includes a review surface for proposed enrichments and page changes produced by agents or background jobs.
- R15. Review actions include approve, reject, edit before approve, and defer.
- R16. Review items make the target page, source family, proposed addition, and citation visible before the user decides.
- R17. Long-press or context-menu actions on search results support conversion into durable Brain material.
- R18. Convert-to-page flows respect page identity and verification; they should not create duplicate or orphan topic/entity pages when a likely page already exists.
- R19. Add-to-page flows allow a result or selected summary to become a candidate addition to an existing page, with the same review/citation expectations as enrichment.

**Roadmap sequencing**
- R20. Existing page enrichment ships before review queue, convert-to-page, and general save actions.
- R21. Review queue follows enrichment because it reuses the same candidate-addition review model.
- R22. Convert-to-page follows review queue because it adds page identity and verification decisions.
- R23. General search-answer save actions follow once add/convert semantics are proven in page workflows.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given the user searches "pricing concerns for Customer X" in mobile Brain, when Brain and KB succeed but Web times out, the user sees ranked Brain/KB results with citations and a visible Web timeout status.
- AE2. **Covers R5.** Given a query returns several compiled pages, when the user filters to Pages or switches to graph browsing, the existing page/graph exploration remains available without making search leave the Brain surface.
- AE3. **Covers R7-R12.** Given the user opens a topic page about a market change, when they run enrichment with Brain, Web, and KB selected, the app returns candidate summaries with citations, the user selects two, and the page is updated/recompiled with only those selected additions.
- AE4. **Covers R10, R13.** Given an enrichment run proposes an inaccurate web summary, when the user rejects it, that summary does not become page context and is not treated as accepted evidence for future automated agents.
- AE5. **Covers R14-R16.** Given a background agent proposes three additions to an Opportunity page, when the user opens the mobile review queue, each proposal shows its target page and citations and can be approved, edited, rejected, or deferred.
- AE6. **Covers R17-R19.** Given a search result describes a topic that has no page, when the user chooses Convert to page, the flow checks for likely existing pages and routes creation through verification rather than silently creating an orphan.

---

## Success Criteria

- A mobile user can improve an existing Brain page from their phone by running an enrichment pass and approving cited additions without opening admin.
- Automated agents produce better grounded output after enrichment because accepted additions are durable Brain context, not one-off search results.
- Search feels like the primary mobile Brain interaction, while Pages and graph browsing still remain discoverable and useful.
- The requirements are concrete enough that planning does not need to re-decide product sequencing, first-source set, or approval semantics.

---

## Scope Boundaries

- This does not remove the force graph. It is demoted to a Pages/browse visualization path inside Brain.
- This does not make CRM or ERP enrichment required for the first mobile proof, though the design should not block them.
- This does not allow unreviewed web results to become durable page context.
- This does not introduce external system writes. v0 writes only to Company Brain pages/review state.
- This does not replace admin source governance. Mobile uses sources that are tenant-approved and safe for the user.
- This does not require the mobile app to expose every provider knob admins can configure.
- This does not build a human-only notes/wiki product. The point is to improve the context agents use.

---

## Key Decisions

- **Search-first mobile Brain.** The mobile surface should lead with enterprise context search, not the current Wiki list or graph.
- **Pages and graph stay, but become modes.** Existing page browsing and force graph visualization still matter for orientation and trust.
- **Agentic enrichment run is the first wedge.** The first proof should feel like source agents enriching a page, not manual copy/paste from search.
- **Brain + Web + KB is the minimum source proof.** It demonstrates internal context, trusted document context, and external enrichment without waiting on CRM/ERP wiring.
- **Review before durability.** User approval is required before enrichment candidates become page context.
- **Roadmap order is enrichment, review queue, convert-to-page, then general save actions.** This keeps the model grounded in page updates before expanding to broad search actions.

---

## Dependencies / Assumptions

- The Company Brain source/router work in `docs/plans/2026-04-30-002-feat-company-brain-hybrid-retrieval-plan.md` provides the retrieval substrate for Brain/Page and source-agent results.
- Admin source governance from the Company Brain admin plans determines which source families mobile may show by default or allow as opt-in.
- Existing mobile page detail and force graph surfaces can be reused or reframed instead of rebuilt from scratch.
- Existing page identity and unresolved-mention verification concepts are reused for convert-to-page flows.
- Web search and Knowledge Base enrichment need safe citation/freshness presentation before they can be trusted as page material.

---

## Outstanding Questions

### Resolve Before Planning

_(none)_

### Deferred to Planning

- [Affects R1-R6][Technical] Exact mobile navigation shape: rename the current Wiki segment, split Brain into search/results/pages modes, or add an internal mode switch beneath the existing Threads/Brain pill.
- [Affects R2-R4][Technical] Whether mobile calls the existing Company Brain HTTP/MCP facade directly or uses a GraphQL wrapper for query/search and provider status.
- [Affects R7-R12][Technical] Exact enrichment-run lifecycle: synchronous in-app run vs background job with progress updates, cancellation, retry, and saved draft proposals.
- [Affects R8][Needs research] Which Web source adapter is available and safe for mobile-triggered enrichment, including citation payload and rate limits.
- [Affects R8][Technical] Knowledge Base source selection: one default tenant KB family vs user-selectable KBs.
- [Affects R10-R13][Technical] Accepted addition format: appended page section, candidate fact row, relationship-facet item, or another page patch model.
- [Affects R14-R16][Technical] Whether review queue lives inside the Brain tab, thread HITL queue, notifications, or a shared review surface.
- [Affects R17-R19][Technical] Convert-to-page duplicate detection and verification UX, including how strongly the flow pushes users toward an existing page when one likely matches.
- [Affects R6, R17-R19][Design] Long-press/context-menu action set and naming: "Convert to page", "Add to page", "Tag", "Classify", "Mark useful", or a smaller v0 subset.

---

## Next Steps

-> /ce-plan for structured implementation planning.
