---
date: 2026-05-01
topic: enrich-page-web-and-review-ux
status: ready-for-planning
related:
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
  - docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
  - docs/brainstorms/2026-04-30-mobile-company-brain-search-requirements.md
---

# Enrich Page Web Search and Review UX

## Problem Frame

The mobile Enrich Page feature is useful, but it currently under-delivers on two important expectations.

First, the source picker exposes Web as an enrichment family, but the current Context Engine provider set does not include a first-party Web Search adapter. Web results only appear if some approved provider happens to classify as web, which makes the user-facing Web option feel broken. Web enrichment matters because it can surface current public facts that Brain and KB do not yet contain, but those facts are lower-trust and should not be treated as default internal knowledge.

Second, enrichment review is split across the inline Enrich Page sheet and the thread review flow. Both paths should remain, but they need to feel like two views of the same pending proposal rather than two separate products. Users should be able to review immediately inline or hand off to the thread when they want the normal workspace review workflow.

---

## Actors

- A1. Mobile user: runs enrichment from a Brain/wiki page and decides which suggestions should be applied.
- A2. Tenant/client admin: opts the tenant into Web Search as an approved external source.
- A3. Context Engine: routes enrichment across Brain, KB, and opted-in Web Search providers.
- A4. Review agent/thread workflow: hosts the durable pending review and applies or rejects approved suggestions.

---

## Key Flows

- F1. Inline enrichment review
  - **Trigger:** A mobile user opens Enrich Page from a Brain/wiki page.
  - **Actors:** A1, A3
  - **Steps:** The sheet shows available sources. Brain and KB may be selected according to existing defaults. Web appears only when the tenant has opted in, and remains unselected by default. The user selects sources, runs enrichment, and reviews selectable suggestions directly in the sheet.
  - **Outcome:** The user can approve selected suggestions or reject the proposal without leaving the page.
  - **Covered by:** R1, R3, R5, R6, R8, R9

- F2. Thread-based enrichment review
  - **Trigger:** A mobile user opens the review thread created for an enrichment run.
  - **Actors:** A1, A4
  - **Steps:** The thread review screen loads the same proposal, grouped source statuses, and selectable suggestions as the inline sheet. The user can select or deselect suggestions, add a note, approve selected suggestions, or reject the proposal.
  - **Outcome:** Thread review produces the same apply/reject result as inline review.
  - **Covered by:** R5, R6, R8, R9, R10

- F3. Web-enriched proposal generation
  - **Trigger:** A tenant has opted into Web Search and the mobile user explicitly selects Web for an enrichment run.
  - **Actors:** A1, A2, A3
  - **Steps:** Context Engine queries the configured Web Search adapter along with any other selected sources. Raw web results are synthesized into page-worthy candidate updates with citations and source labels rather than dumped as undifferentiated search snippets.
  - **Outcome:** Web contributes meaningful candidate suggestions that can update the page if approved, while preserving external-source trust labeling.
  - **Covered by:** R1, R2, R3, R4, R7, R11

---

## Requirements

**Web Search adapter and trust posture**
- R1. Enrich Page must only offer Web as a source when the tenant/client has explicitly opted into a Web Search Context Engine adapter.
- R2. Web Search must not be part of the default adapter set for tenants that have not opted in.
- R3. Even after tenant opt-in, Web must not be selected by default for each Enrich Page run; the mobile user must explicitly select it.
- R4. If Web is unavailable, disabled, missing credentials, or errors, Enrich Page must surface a clear provider status rather than silently returning only Brain/KB suggestions.
- R5. Web suggestions must be visibly labeled as external/lower-trust and must carry citations with URL or source identity when available.

**Suggestion quality**
- R6. Enrichment proposals must contain candidate page updates, not raw search/result dumps. Each candidate should state the proposed update in human-reviewable form.
- R7. Web enrichment should synthesize current public information into concise, page-worthy suggestions with enough context for the user to judge whether the page should change.
- R8. Duplicate or near-duplicate candidates across Brain, KB, and Web should collapse into one review item where possible, preserving the best citation/source metadata.

**Two review surfaces, one proposal**
- R9. Inline review and thread review must operate on the same pending enrichment proposal: same candidates, same source statuses, same selected-candidate semantics, same note semantics, and same apply/reject outcomes.
- R10. Inline review must remain a complete review path, not just a preview: users can approve selected suggestions or reject directly from the Enrich Page sheet.
- R11. Thread review must remain available for users who prefer the durable workspace review flow or need to return later.
- R12. The two UIs may be visually adapted to their containers, but they should share labels, status language, candidate grouping, selection affordances, and empty/error states.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a tenant has not enabled Web Search, when a user opens Enrich Page, Web is not offered as an available source and the run does not attempt web enrichment.
- AE2. **Covers R1, R3.** Given a tenant has enabled Web Search, when a user opens Enrich Page, Web is visible but unselected until the user explicitly selects it.
- AE3. **Covers R4.** Given a tenant has enabled Web Search but the provider credential is invalid, when a user runs enrichment with Web selected, the proposal shows Web as errored/unavailable instead of making it look like web found nothing.
- AE4. **Covers R6, R7.** Given Web returns several search hits about a page topic, when the proposal is generated, the user sees concise candidate updates with citations, not raw search result rows.
- AE5. **Covers R9, R10, R11.** Given a proposal has 12 candidates, when the user opens either inline review or thread review, both surfaces show the same 12 candidates and approving the same selected set applies the same update.

---

## Success Criteria

- A user can intentionally run web-backed enrichment and see at least one useful cited candidate update when relevant public information exists.
- Users no longer need to understand which review path is more capable; inline and thread review both support selection, note, approve, and reject.
- Web remains explicitly opt-in at both levels: tenant/client authorization first, user selection per run second.
- Planning can proceed without re-deciding whether Web is default, whether inline review survives, or whether web output should be raw results versus synthesized suggestions.

---

## Scope Boundaries

- Do not make Web Search a globally enabled or tenant-default source.
- Do not auto-apply Web suggestions to compiled Brain/wiki content without human approval.
- Do not remove the thread review flow.
- Do not collapse Enrich Page into thread-only review.
- Do not build broad web monitoring, scheduled web refresh, or alerting in this pass.
- Do not require external-source facts to outrank Brain or KB facts; Web remains lower-trust supporting context.

---

## Key Decisions

- **Both review paths stay.** Inline review is valuable for immediate page-local work; thread review is valuable for durable workspace review and later return.
- **Web is tenant opt-in and per-run explicit.** Client approval makes Web available, but the user still chooses it each time.
- **Web enrichment should synthesize, not dump.** Raw results are not enough; the product value is candidate updates that could meaningfully improve the page.
- **Review parity matters more than identical layout.** The two surfaces can look different, but their capabilities and semantics should match.

---

## Dependencies / Assumptions

- Current code scan on 2026-05-01 verified that the GraphQL enrichment source enum already includes `WEB`, and the mobile source picker already renders Web.
- Current code scan on 2026-05-01 verified that core Context Engine providers include memory/wiki/workspace/Bedrock KB and other source-agent providers, but not a first-party Web Search adapter.
- Current tenant provider settings support built-in provider opt-in for a fixed provider list; adding Web Search to that model is expected to be part of planning.
- Thinkwork already has tenant/template-level Web Search configuration for agent runtime use; planning should decide the cleanest way for Context Engine Web Search to reuse or bridge that policy and credential source.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] Exact tenant-admin configuration surface and credential source for the Web Search Context Engine adapter.
- [Affects R6-R8][Technical] Whether candidate synthesis is implemented inside the enrichment service, Context Engine answer mode, or a dedicated enrichment summarizer.
- [Affects R9-R12][Technical] How much UI code can be shared between the inline sheet and thread review without forcing an awkward layout in either surface.

---

## Next Steps

-> /ce-plan for structured implementation planning.
