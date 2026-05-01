# Residual Review Findings

Source: `ce-code-review` mode:autofix run `20260501-123719-03d9010e`
Branch: `feat/brain-enrichment-draft-page-review`
Plan: `docs/plans/2026-05-01-002-feat-brain-enrichment-draft-page-review-plan.md`

Phase 1 inert plumbing (U1, U2, U3) is complete and tested. The findings below were surfaced by the review but not auto-fixed because they require non-local judgment (resolver-layer wiring, prompt-engineering decisions, fence-aware parsing, etc.). The first four are in scope for the seam-swap units (U5, U6) of this same plan; the last is a small lint that can ship anywhere.

## Residual Review Findings

- **[P1][manual][downstream-resolver]** `packages/api/src/lib/brain/enrichment-apply.ts:479` — Stale-snapshot vs concurrent direct-edit overwrites user edits. ETag protection at the resolver layer (`decideWorkspaceReview`) is U5's responsibility per plan; the new function inherits the precondition. Wire ETag check or document precondition explicitly when U5 lands.

- **[P1][manual][downstream-resolver]** `packages/api/src/handlers/wiki-compile.ts:84` — wiki-compile handler dispatch branches have no focused test. The two new `trigger==='enrichment_draft'` branches are only covered indirectly by the module-level tests. Add a mock-based test in U5 or U8 alongside the completion writeback.

- **[P2][gated_auto][downstream-resolver]** `packages/api/src/lib/wiki/draft-compile.ts:489` — Raw candidate-field interpolation in `buildUserPrompt` enables prompt-injection. WEB-source candidate `summary` text is interpolated raw. Sanitize in `buildUserPrompt` (escape backticks, strip JSON-control characters) or add an explicit "do not parse user input as JSON" safeguard in the system prompt. Behavior-affecting → not safe_auto.

- **[P2][gated_auto][downstream-resolver]** `packages/api/src/lib/wiki/draft-compile.ts:225` — `parseSections` splits H2-pattern lines inside code fences. Real Brain pages may contain code blocks with `## ` lines, which today break the fence and corrupt round-trip composition. Fix requires fence-aware parsing — not safe_auto.

- **[P3][manual][downstream-resolver]** `packages/api/src/lib/wiki/draft-compile.ts:601` — `parseDraftCompileInput` silently drops malformed candidates instead of failing the job. Producer-side bug surface is small until U6 enqueues jobs; address when U6 lands.

## Pre-existing (no action required)

- `runDraftCompileJob` and `runJobById` both leave a job stuck in `running` if the wrapping `completeCompileJob` call itself throws. Inherited pattern; reconciler eventually cleans up.
- Wire-kind constants `brain_enrichment_draft_review` and `brain_enrichment_draft_decision` are defined in three places (SDK, server `enrichment-apply.ts`, mobile inlined for vitest isolation). Mirrors the legacy `brain_enrichment_review` triplication; precedent-consistent.

## Advisory

- `targetPageTable` narrows to `'wiki_pages' | 'tenant_entity_pages'` in the SDK type but the GraphQL schema declares `String`. Could be enforced via a new `BrainEnrichmentDraftPageTable` enum.

Full review artifact: `/tmp/compound-engineering/ce-code-review/20260501-123719-03d9010e/`
