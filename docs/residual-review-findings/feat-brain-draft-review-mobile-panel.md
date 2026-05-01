# Residual Review Findings

Source: `ce-code-review` mode:autofix run `20260501-125728-6a1908d7`
Branch: `feat/brain-draft-review-mobile-panel`
Plan: `docs/plans/2026-05-01-002-feat-brain-enrichment-draft-page-review-plan.md` (U4)

U4 ships inert mobile UI for the Brain enrichment draft-page review (the in-place panel + show-changes toggle + region tap). Three reviewer-flagged issues were fixed in `65c64...` (autofix); four findings deferred — none block the PR.

## Residual Review Findings

- **[P2][manual][downstream-resolver]** `apps/mobile/app/thread/[threadId]/index.tsx:205` — `acceptedRegionIds` reset useEffect omits `draftPayload` from its deps. If the workspace-review subscription mutates the payload (regions array changes) within a stable runId, newly arrived regions get serialized as rejected, violating "default = accept all." Reachability depends on U5/U6 producer behavior; address when those land and the mutation semantics are known.

- **[P3][advisory][human]** `apps/mobile/lib/brain-enrichment-draft-review.ts:53` — `serializeBrainEnrichmentDraftDecision` doesn't enforce that accepted/rejected lists are disjoint. Defensive only — the panel currently produces disjoint pairs, and the server treats `rejected` as authoritative on overlap (silent drop of the conflicting accept).

- **[P3][manual][downstream-resolver]** `apps/mobile/components/brain/BrainEnrichmentDraftReviewPanel.tsx:486` — `familyTint` and `hexWithAlpha` helpers are file-local pure functions without unit tests. Would need extraction to the helpers module to test. Low yield; ship as-is.

- **[P3][manual][downstream-resolver]** `apps/mobile/lib/brain-enrichment-draft-review.ts:115` — `parseDraftSections` lacks edge-case coverage (consecutive H2 with no body between them, `_preamble` slug collision against an actual user heading). The server `parseSections` has the same gaps; the parent plan's existing residual on fence-aware parsing covers the same general area. Address together when fence-aware parsing lands.

## Acknowledged residual risks (no action)

- The panel itself has no render test — vitest's node environment can't load `react-native-markdown-display` without an Expo runtime. The pure helpers (parseDraftSections, slugifyDraftHeading, defaultAcceptedRegionIds, serializeBrainEnrichmentDraftDecision, regionFamilyLabel) are unit-tested in isolation, including a cross-package parity guard against the server's `slugifyTitle`. Toggle / region-tap / Markdown rendering will need TestFlight visual QA before U5/U6 light up the producer.

- ThreadHitlPrompt now hosts two parallel state machines (legacy candidate-card + draft-page review) selected via `isBrainEnrichmentDraft` branch. Switching payload kinds mid-thread could leave stale state visible. Pre-existing pattern from the legacy panel.

Full review artifact: `/tmp/compound-engineering/ce-code-review/20260501-125728-6a1908d7/`
