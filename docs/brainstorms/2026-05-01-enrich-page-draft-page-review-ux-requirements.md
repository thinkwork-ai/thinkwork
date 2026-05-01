---
date: 2026-05-01
topic: enrich-page-draft-page-review-ux
related:
  - docs/brainstorms/2026-05-01-enrich-page-web-and-review-ux-requirements.md
  - docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
  - docs/brainstorms/2026-04-30-mobile-company-brain-search-requirements.md
---

# Enrich Page Draft-Page Review UX

## Summary

Replace the current candidate-card review with an async, thread-delivered draft of the recompiled Brain page. The thread renders the proposed page in place — readable as a normal Brain page — with changed regions highlighted for tap-to-approve/reject, plus a "show changes" toggle that reveals a stacked before/after block diff. Dedup against existing page content moves into the agentic compile.

---

## Problem Frame

Today's Enrich Page review surfaces candidate facts as cards. Two pains compound: cards often duplicate content the page already covers, and even when a candidate is genuinely new, the user can't tell where it would land or whether it would read coherently next to the prose already there. Approving feels like sending facts into a black box — the apply step today only appends a flat bulleted list under a fresh dated heading, which is why duplicate facts and disconnected snippets accumulate. The user wants to evaluate the *page they would actually have* after applying, not a pile of suggestions that may or may not change the page in useful ways.

---

## Actors

- A1. Mobile user: triggers enrichment on a Brain page and reviews the resulting draft when notified.
- A2. Wiki compile agent: runs the agentic recompile in draft mode, dedupes incoming candidates against existing page content, and produces the proposed page plus changed-region annotations.
- A3. Thread review surface: hosts the durable review session, renders the in-place draft and the diff-toggle view, and applies or discards the user's accept/reject decisions.
- A4. Enrich Page sheet: triggers the async run and disengages until completion is reported back through the thread.

---

## Key Flows

- F1. Trigger enrichment from a Brain page
  - **Trigger:** Mobile user opens Enrich Page on a Brain/wiki page and runs enrichment with selected sources.
  - **Actors:** A1, A4
  - **Steps:** User selects sources and submits. The sheet confirms the draft is being prepared and that a thread message will arrive when ready, then closes the synchronous review surface. No candidate cards render in the sheet for this flow.
  - **Outcome:** User is freed from a synchronous review wait; an async draft compile is in flight.
  - **Covered by:** R1, R2

- F2. Async draft compile
  - **Trigger:** Enrichment job dispatched by F1.
  - **Actors:** A2
  - **Steps:** The compile agent ingests candidate facts plus the current page, dedupes against existing content, and produces a proposed page body plus a list of changed regions, each annotated with contributing source family and any citation. On completion it posts a thread message announcing the draft is ready. On failure it posts an error state.
  - **Outcome:** A reviewable draft (or a clearly surfaced error) is attached to the thread.
  - **Covered by:** R3, R4, R5, R10, R11

- F3. In-place draft review
  - **Trigger:** User opens the thread review screen for a ready draft.
  - **Actors:** A1, A3
  - **Steps:** The thread renders the proposed page as a normal Brain page, with each changed region subtly highlighted. The user reads the page top-to-bottom as a coherent document. Tapping a highlighted region reveals ✓/✗ controls, defaulting to accepted. A "show changes" toggle switches the view to a stacked before/after block diff for explicit comparison; toggling does not change decision state.
  - **Outcome:** User has reviewed each changed region with at least the option to inspect.
  - **Covered by:** R6, R7, R8, R12

- F4. Apply or discard the draft
  - **Trigger:** User completes review and taps apply (or whole-draft reject).
  - **Actors:** A1, A3
  - **Steps:** Bulk-accept-all writes the entire proposed page to the wiki page body. Mixed accept/reject writes the proposed page with rejected regions reverted to the current page's text in those locations. Whole-draft reject leaves the page unchanged. The thread closes with an outcome status message.
  - **Outcome:** The Brain page reflects the user's accept decisions; the thread is durably resolved.
  - **Covered by:** R9, R13, R14, R15

---

## Requirements

**Async compile + thread delivery**
- R1. Triggering enrichment must NOT show a synchronous candidate-card list; the inline sheet only confirms the run was queued and indicates that a thread message will arrive when ready.
- R2. The wiki compile must run asynchronously with no user-facing latency budget; the existing compile pipeline is the dedup and merge boundary.
- R3. When the draft compile completes, a thread message must announce the draft is ready and link the user to the thread review surface.
- R4. When the draft compile fails (timeout, model error, missing data), the thread must surface a clear error state instead of a vacuous draft or silent close.
- R5. When the draft compile decides nothing in the page should change, the thread must close with an explicit "no enrichment landed" message rather than show an empty diff.

**Compile-time dedup and provenance**
- R10. The compile must dedup candidate facts against the existing page body, not just against each other; client-side candidate-card dedup is no longer sufficient.
- R11. The compile output must associate each changed region with contributing source family (Brain / Knowledge base / external research) and any citation metadata so provenance survives into the review surface.

**Review surface**
- R6. The thread review screen must render the proposed page in place — readable as a normal Brain page top-to-bottom — with each changed region visually highlighted.
- R7. Tapping a highlighted region must reveal per-region ✓/✗ controls; the default state for every region is "accepted."
- R8. The review surface must expose a "show changes" toggle that switches to a stacked before/after block diff covering the same regions, without altering decision state when toggled.
- R12. Source provenance must be visible at the region level in both the in-place view and the diff view.

**Apply semantics**
- R9. A bulk-accept-all action must apply the proposed page in full as a single decision.
- R13. Rejecting a region must drop that region from the apply and restore the current page's text in that location; no recompile is triggered.
- R14. A whole-draft reject action must leave the current Brain page unchanged and mark the thread as discarded.
- R15. After apply, the thread must record the outcome (accepted-all, partial, rejected, no-op, error) in a durable status message.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given a user runs enrichment on a Brain page, when they submit the run, the inline sheet closes immediately with a confirmation that a thread message will arrive when ready, and no candidate cards are shown in the sheet.
- AE2. **Covers R5.** Given a draft compile decides the page already covers all incoming facts, when it completes, the thread closes with a "no enrichment landed" status message and no review surface opens.
- AE3. **Covers R10.** Given an incoming candidate fact is already substantively present in the page body, when the draft compile runs, no changed region is produced for that fact.
- AE4. **Covers R6, R7.** Given a draft contains three changed regions, when the user opens the review surface, the proposed page renders top-to-bottom with three highlighted regions, each tap-revealing ✓/✗ controls in the accepted state.
- AE5. **Covers R8.** Given the user toggles "show changes," when the view switches, the same three regions are listed as stacked before/after block diffs with the same accept/reject states they had in the in-place view.
- AE6. **Covers R13.** Given the user rejects one of three highlighted regions and bulk-applies, when apply runs, the page reflects the proposed text for the two accepted regions and the current page's text in the location of the rejected region.
- AE7. **Covers R4.** Given the draft compile fails partway through, when failure is detected, the thread surfaces an error state with enough signal for the user to retry or escalate, rather than silently closing or producing an empty draft.

---

## Success Criteria

- A user runs enrichment, gets a thread message later, and reviews the proposed page as if it were the actual Brain page they would land on after applying.
- Duplicate facts already covered by the existing page no longer appear as accept/reject items, because dedup happened at compile time.
- Per-region accept/reject and bulk-accept both work without recompile, and both produce a coherent Brain page after apply — no orphaned section-headed lists of approved bullets.
- Planning can proceed without re-deciding async vs sync, what review granularity is supported, what reject-region means, or whether candidate-card dedup is still part of the path.

---

## Scope Boundaries

- Do not show synchronous candidate cards in the inline Enrich Page sheet for runs targeting this draft-review flow.
- Do not pre-filter candidates client-side before the compile sees them; the compile owns dedup.
- Do not implement recompile-on-rejection ("redo the draft without these facts") in v1.
- Do not implement per-candidate subtraction from a merged region; v1 reject is region-granularity only.
- Do not allow inline editing of the proposed page text before applying — the surface is review-only.
- Do not auto-apply enrichment without human review.
- Do not change upstream candidate generators or the Web Search adapter (covered by `2026-05-01-enrich-page-web-and-review-ux-requirements.md`).
- Do not introduce scheduled or batch re-enrichment across pages.

---

## Key Decisions

- **Async, thread-delivered review.** No latency budget on the compile because the user is decoupled from it; the thread is the durable surface for "your draft is ready."
- **In-place draft as the primary review surface, two-pane diff as a toggle.** Reading the future page matches the value the user wants to evaluate; the diff is an explicit-comparison escape hatch, not the default.
- **Dedup belongs to the agentic compile, not the candidate generator or the client.** The compile is the only stage that sees both the page body and the candidates; it can resolve overlap in prose context rather than via string matching.
- **Reject-region drops the proposed text and restores current page text in that location.** Recompile-on-rejection is a real future feature but adds round-trip and complexity; v1 ships the simpler semantics.
- **Inline Enrich Page sheet becomes a trigger, not a review surface for this flow.** This supersedes R10 ("inline review must remain a complete review path") of `2026-05-01-enrich-page-web-and-review-ux-requirements.md` for Brain-page enrichment runs.
- **Apply replaces the page body; it does not append.** Today's append-only behavior is the source of much of the duplication problem; planning must replace it, not extend it.

---

## Dependencies / Assumptions

- The existing wiki compile pipeline can run in a "draft" mode that returns a proposed body without writing it to the page. Whether this is a flag on the existing handler, a new entry point, or something else is a planning concern.
- The compile can emit changed-region annotations alongside the proposed body, with each region carrying contributing source-family and citation metadata. The exact shape is a planning concern.
- The existing thread review flow can host a custom review payload type for "Brain enrichment draft." Today's thread review hosts a candidate-list payload; adapting it to a draft-page payload is expected to be the larger UX change.
- The enrichment apply path must be reworked. Today's apply only appends an `## Approved enrichment <date>` section; this flow requires writing the proposed body with rejected regions reverted, not a flat append. This was verified by reading `packages/api/src/lib/brain/enrichment-apply.ts` on 2026-05-01.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R6, R8][Technical] Mobile rendering strategy for "highlighted regions on a normal page" — whether highlighting is an inline visual treatment on the page render or a block-bounded overlay, and how the diff-toggle view shares state with the in-place view.
- [Affects R10, R11][Technical] Compile output shape: full proposed body plus side-channel region annotations vs. inline annotation markers in the body. Has implications for both the diff renderer and the apply path.
- [Affects R13][Technical] How rejected-region apply maps proposed regions back to current-text spans when the compile has restructured surrounding prose. May require the compile to emit anchor metadata for each region so reverting a region to current text remains well-defined.
- [Affects R4][Needs research] What thread-side error states the existing thread review surface already supports vs. what needs to be added for compile-failure visibility.
- [Affects R12][Technical] Provenance display: per-region chip strip, line-side markers, or tap-revealed source list — design and accessibility implications.

---

## Next Steps

-> /ce-plan for structured implementation planning.
