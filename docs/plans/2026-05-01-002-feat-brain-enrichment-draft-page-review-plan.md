---
title: "feat: Brain enrichment draft-page review (async, in-place diff)"
type: feat
status: active
date: 2026-05-01
origin: docs/brainstorms/2026-05-01-enrich-page-draft-page-review-ux-requirements.md
---

# feat: Brain enrichment draft-page review (async, in-place diff)

## Summary

Rewire Brain enrichment to flow through an async **draft-compile** path that runs in the background, dedupes against the existing page body, and emits section-grain region annotations. The mobile thread review screen renders the proposed page in place with highlighted regions for tap-to-✓/✗, plus a "show changes" toggle for an explicit before/after view. The Enrich Page sheet becomes a fire-and-forget trigger; apply replaces the page body with rejected regions reverted to a snapshot.

---

## Problem Frame

Today's apply path is append-only (`packages/api/src/lib/brain/enrichment-apply.ts:appendCandidatesToPage` writes a new `## Approved enrichment <date>` section), and brain-enrichment candidates are produced by the context engine without consulting the page body. Duplicate facts and disconnected snippets accumulate. Origin doc establishes the user-facing remedy; this plan establishes the engineering shape to deliver it (see origin: `docs/brainstorms/2026-05-01-enrich-page-draft-page-review-ux-requirements.md`).

---

## Assumptions

*This plan was authored without synchronous user confirmation (LFG pipeline mode). The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- **Region granularity is section-level.** The wiki compile pipeline already groups output by `section_slug` via `writeSection` in `packages/api/src/lib/wiki/section-writer.ts`; sub-section block annotations would require a new model contract and are deferred.
- **`wiki_compile_jobs` ledger is reused via `trigger='enrichment_draft'` plus a new `input` jsonb column** — the existing `dedupe_key` invariant from `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` is preserved; the trigger value discriminates dispatch.
- **The draft-compile is a NEW agentic module, sibling to the existing wiki compile** (different prompt, different contract: takes `pageId`, current body, candidates → returns proposed body + sections). It shares the Lambda handler dispatcher and S3 review pattern but is its own module — it is NOT a flag on `runCompileJob`.
- **Region annotations travel via side-channel**, not as inline markers in `proposedBodyMd`. The body stays clean markdown that renders as a normal page.
- **`agent_workspace_runs` + `agent_workspace_events` is the delivery substrate** — already carrying brain-enrichment review post-PR #725. The new payload kind `brain_enrichment_draft_review` extends what is already there; no new inbox surface.
- **Snapshot the current `body_md` into the S3 review object at draft creation.** Rejection reverts to that pinned snapshot, deterministic regardless of subsequent edits to the page.
- **Failure mode** = system thread message + close run with status `cancelled` and `metadata.reason='compile_failed'`. **No-op mode** = thread message + status `completed`; no review screen opens.
- **Inert-to-live seam pattern** (per `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`): plumbing units land first as inert code; seam-swap units flip the user-visible flow.
- **Snapshot env at completion-callback entry** (per `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`).
- **The dead inbox-only paths** (`applyBrainEnrichmentInboxItem`, `closeBrainEnrichmentReviewThread`) are not touched in this plan; they remain in code for the legacy candidate-card flow that this plan does not retire.

---

## Requirements

R-IDs trace to the origin requirements doc.

**Async compile + thread delivery**
- R1. Triggering enrichment must NOT show a synchronous candidate-card list; the inline sheet only confirms the run was queued. *(see origin R1)*
- R2. The wiki-style draft compile must run asynchronously with no user-facing latency budget. *(see origin R2)*
- R3. When the draft compile completes, a thread message must announce the draft is ready and link the user to the thread review surface. *(see origin R3)*
- R4. When the draft compile fails, the thread must surface a clear error state. *(see origin R4)*
- R5. When the compile decides nothing should change, the thread must close with an explicit "no enrichment landed" message. *(see origin R5)*

**Compile-time dedup + provenance**
- R10. The compile must dedup candidate facts against the existing page body. *(see origin R10)*
- R11. Each changed region must carry contributing source family and citation metadata. *(see origin R11)*

**Review surface**
- R6. The thread review screen must render the proposed page in place with highlighted changed regions. *(see origin R6)*
- R7. Tapping a highlighted region must reveal per-region ✓/✗ controls; default state is "accepted." *(see origin R7)*
- R8. A "show changes" toggle must expose a stacked before/after block diff sharing decision state with the in-place view. *(see origin R8)*
- R12. Source provenance must be visible at the region level in both views. *(see origin R12)*

**Apply semantics**
- R9. Bulk-accept-all must apply the proposed page in full as a single decision. *(see origin R9)*
- R13. Rejecting a region must drop that region and restore the snapshot text in that location; no recompile. *(see origin R13)*
- R14. Whole-draft reject must leave the page unchanged. *(see origin R14)*
- R15. After apply, the thread must record the outcome in a durable status message. *(see origin R15)*

**Origin actors:** A1 (mobile user), A2 (wiki compile agent / draft-compile in this plan), A3 (thread review surface), A4 (Enrich Page sheet).
**Origin flows:** F1 (trigger), F2 (async draft compile), F3 (in-place draft review), F4 (apply or discard).
**Origin acceptance examples:** AE1 (R1, R3), AE2 (R5), AE3 (R10), AE4 (R6, R7), AE5 (R8), AE6 (R13), AE7 (R4).

---

## Scope Boundaries

- Do not implement recompile-on-rejection in v1.
- Do not implement per-candidate subtraction within a region (region-grain reject only).
- Do not allow inline editing of the proposed page text before applying.
- Do not retire or modify the legacy candidate-card flow / append-only apply path; both stay live in code for non-Brain-page enrichment runs.
- Do not change upstream candidate generators or the Web Search adapter (covered by `docs/brainstorms/2026-05-01-enrich-page-web-and-review-ux-requirements.md`).
- Do not introduce a new revision/draft table for wiki pages; S3 sidecar carries the snapshot + proposed body + regions.
- Do not introduce sub-section block-level region annotations.

### Deferred to Follow-Up Work

- **Cleanup of dead inbox paths** (`applyBrainEnrichmentInboxItem`, `closeBrainEnrichmentReviewThread`): unreachable post-PR #725; leave in place for now, separate cleanup PR.
- **Retirement of synchronous candidate-card flow for non-Brain enrichments** (KB-only, etc.): this plan only changes the Brain-page path.
- **Recompile-on-rejection** as a v2 feature once rejection patterns motivate it.

---

## Context & Research

### Relevant Code and Patterns

- **Wiki compile pipeline**
  - `packages/api/src/handlers/wiki-compile.ts` — Lambda entry; claims a `wiki_compile_jobs` row and dispatches.
  - `packages/api/src/lib/wiki/compiler.ts` — `runCompileJob`, `applyPlan` (line ~592). Per-batch loop calling `runPlanner` then writing sections.
  - `packages/api/src/lib/wiki/planner.ts`, `aggregation-planner.ts`, `section-writer.ts` — agentic compile internals; `writeSection` returns plain markdown plus token/cost metadata.
  - `packages/api/src/lib/wiki/repository.ts` — `upsertPage` (line ~996) overwrites `wiki_pages.body_md` in place. **No revision table.**
  - `packages/database-pg/src/schema/wiki.ts:wikiCompileJobs` — job ledger; columns `dedupe_key`, `trigger`, `status`, `metrics` already in place. Plan adds `input` jsonb for candidate payload.

- **Brain enrichment proposal flow**
  - `packages/api/src/lib/brain/enrichment-service.ts:runBrainPageEnrichment` — produces the synchronous proposal today via the context engine. Plan rewires this to enqueue a draft compile job.
  - `packages/api/src/lib/brain/enrichment-apply.ts` — `applyBrainEnrichmentWorkspaceReview` is append-only via `appendCandidatesToPage`. Plan adds a sibling `applyBrainEnrichmentDraftReview` that does replace-with-revert.
  - `packages/api/src/lib/workspace-events/review-actions.ts:decideWorkspaceReview` — single entry point for accept/cancel; dispatches by payload kind.

- **Workspace review substrate**
  - `agent_workspace_runs`, `agent_workspace_events`, S3 review-object pattern with ETag-guarded reads (`assertExpectedReviewEtag`).
  - Existing payload kinds discriminate via `payload.kind`. New kind: `brain_enrichment_draft_review`.

- **Mobile review surface**
  - `apps/mobile/components/brain/BrainEnrichmentReviewPanel.tsx` — current candidate-card panel.
  - `apps/mobile/components/brain/BrainEnrichmentSheet.tsx` — Enrich Page modal.
  - `apps/mobile/app/thread/[threadId]/index.tsx:ThreadHitlPrompt` — dispatches review panel by payload kind.
  - `apps/mobile/lib/brain-enrichment-review.ts` — selection serialization helpers.
  - `DetailLayout` — standard mobile sub-screen wrapper (per `docs/solutions/best-practices/mobile-sub-screen-headers-use-detail-layout-2026-04-23.md`).

- **GraphQL surfaces**
  - `packages/database-pg/graphql/types/brain.graphql` — `BrainEnrichmentProposal`, `BrainEnrichmentCandidate`. New types: `BrainEnrichmentDraftPage`, `BrainEnrichmentRegion`.
  - `packages/database-pg/graphql/types/agent-workspace-events.graphql` — already exposes `payload: AWSJSON` and `before/after/diff` on proposed-changes; the new payload rides through the AWSJSON channel.

### Institutional Learnings

- `docs/solutions/integration-issues/web-enrichment-must-use-summarized-external-results-2026-05-01.md` — keep raw external chrome out of region content; metadata behind a Review-details affordance.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — multi-PR pattern for shipping a new Bedrock-integrated module; mirrored in the unit ordering below.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` — `parseCompileDedupeBucket` invariant; reuse `wiki_compile_jobs` rather than a parallel ledger.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — snapshot `THINKWORK_API_URL` / `API_AUTH_SECRET` at coroutine entry.
- `docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md` — prefer raw boto3 clients; if a new Lambda needs newer Bedrock SDK, add to `BUNDLED_AGENTCORE_ESBUILD_FLAGS` in `scripts/build-lambdas.sh`.
- `docs/solutions/best-practices/mobile-sub-screen-headers-use-detail-layout-2026-04-23.md` — mobile sub-screen wraps in `DetailLayout`; "show changes" toggle goes in `headerRight`.

### External References

None — codebase has strong local patterns for every surface we touch.

---

## Key Technical Decisions

- **Sibling agentic module, not flag on `runCompileJob`.** The draft compile takes (page, current body, candidates) and produces proposed body + section regions. Different inputs and contract from the existing wiki compile, which reads from clusters of `memory_units`. Sharing the prompt would force false coupling; the only thing they share is the job ledger and the Lambda handler shell.
- **`trigger='enrichment_draft'` discriminates the new path.** No new column on `wiki_compile_jobs.status`; the existing dispatch in `wiki-compile.ts` adds a branch keyed on trigger.
- **Section-grain regions.** Cheapest correct unit; matches what the planner already emits and what `wiki_section_sources` already tracks. Sub-section is a real future need but out of scope.
- **S3 review object holds snapshot + proposed body + regions inline.** No new persistent table; ETag guards staleness for region-level decisions, mirroring the existing review substrate.
- **Apply replaces the body wholesale.** A new `applyBrainEnrichmentDraftReview` consumes `proposedBodyMd`, `snapshotMd`, `regions`, `acceptedRegionIds`, and writes a final body. Rejection swaps the rejected section's `afterMd` for its `beforeMd` from the snapshot, then writes once. Old `appendCandidatesToPage` stays untouched.
- **Inert-to-live across two phases.** Phase 1 (U1–U4) ships compile + apply + types + renderer behind feature kind dispatch — production behavior unchanged. Phase 2 (U5–U7) flips enrichment to enqueue draft jobs and swaps the mobile sheet.
- **Push notification reuses `sendExternalTaskPush`.** The "draft is ready" event is structurally the same as the external-task pattern; renaming the eventKind is cheaper than building a sibling primitive.

---

## Open Questions

### Resolved During Planning

- *Q: Mobile rendering strategy for highlighted regions.* — Resolved: render `proposedBodyMd` via the existing markdown renderer; overlay highlighting using section-anchor lookups against the regions array. No inline body markers.
- *Q: Compile output shape.* — Resolved: side-channel regions array, body stays clean markdown.
- *Q: Rejected-region revert mapping.* — Resolved: snapshot at draft creation; reject = swap section's `afterMd` for `beforeMd` from snapshot.
- *Q: Provenance display.* — Resolved: color-coded source-family marker per region (Brain blue / KB green / Web amber to mirror existing chip colors); citation revealed in the tap-region details popover.
- *Q: Where dedup happens.* — Resolved: inside the new draft-compile module (sibling agentic module).

### Deferred to Implementation

- Exact prompt wording for the new draft-compile agent — drafted during U1 implementation against representative pages.
- Whether to extend `agent_workspace_runs.metadata` schema for `compile_failed` reason or use existing `error` field — checked against schema during U5.
- Push notification payload field names — finalized during U5 against `sendExternalTaskPush`.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Data flow

```
Mobile (Enrich Page sheet)
    │
    │ runBrainPageEnrichment mutation
    ▼
GraphQL resolver
    │
    │ enqueue wiki_compile_jobs(trigger='enrichment_draft', input={pageId, candidates})
    ▼
wiki_compile_jobs row (status='pending')
    │
    │ EventBridge / scheduler trigger (existing)
    ▼
wiki-compile Lambda handler
    │
    │ dispatch by trigger -> draft-compile module
    ▼
Draft-compile agentic module
    │   inputs: page body_md, candidates
    │   outputs: { proposedBodyMd, regions[], snapshotMd }
    │
    ├── empty regions? -> insert system thread message ("no enrichment landed")
    │                     status='completed', no review surface
    │
    ├── failure? -> insert system thread message ("draft compile failed")
    │              status='cancelled', metadata.reason='compile_failed'
    │
    └── success -> S3 sidecar: { snapshotMd, proposedBodyMd, regions }
                   agent_workspace_runs row, status='awaiting_review'
                   agent_workspace_events row, payload.kind='brain_enrichment_draft_review'
                   thread message ("draft is ready")
                   sendExternalTaskPush (notification)
                          │
                          ▼
                   Mobile thread renderer dispatch (kind switch)
                          │
                          ▼
                   BrainEnrichmentDraftReviewPanel
                     - in-place page render with highlighted regions
                     - show-changes toggle to stacked diff
                     - per-region tap -> ✓/✗
                          │
                          │ acceptAgentWorkspaceReview mutation
                          │ responseMarkdown = {kind:'brain_enrichment_draft_decision',
                          │                     acceptedRegionIds, rejectedRegionIds}
                          ▼
                   decideWorkspaceReview
                          │
                          │ dispatch by payload kind
                          ▼
                   applyBrainEnrichmentDraftReview
                     - read snapshotMd from S3 sidecar
                     - merge proposedBodyMd with rejected regions reverted
                     - write to wiki_pages.body_md (or tenant_entity_pages.body_md)
                     - close thread with outcome status
```

### Region payload sketch

```
BrainEnrichmentDraftPage {
  proposedBodyMd: string
  snapshotMd: string
  regions: BrainEnrichmentRegion[]
}

BrainEnrichmentRegion {
  id: string                  // stable UUID
  sectionSlug: string         // anchor in proposedBodyMd AND snapshotMd
  sourceFamily: BRAIN | KNOWLEDGE_BASE | WEB
  citation: { uri?, label? } | null
  beforeMd: string            // section content from snapshot (may be empty for new sections)
  afterMd: string             // section content from proposed (may be empty for removed sections)
}
```

The decision payload from the mobile client:

```
{
  kind: 'brain_enrichment_draft_decision',
  acceptedRegionIds: string[],
  rejectedRegionIds: string[],
  note?: string,
}
```

---

## Implementation Units

- U1. **Wiki compile draft mode (job ledger + agentic module + handler dispatch)**

**Goal:** Add an `input` jsonb column to `wiki_compile_jobs`, introduce a new agentic draft-compile module sibling to `runCompileJob`, and wire `wiki-compile.ts` handler dispatch by `trigger`. Ships **inert** — no callers invoke the new path.

**Requirements:** R2, R10, R11

**Dependencies:** None

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_wiki_compile_jobs_input.sql` (manual migration: `ALTER TABLE wiki_compile_jobs ADD COLUMN input jsonb`)
- Modify: `packages/database-pg/src/schema/wiki.ts` (add `input: jsonb("input")`)
- Create: `packages/api/src/lib/wiki/draft-compile.ts` (new agentic module: `runDraftCompile({ pageId, currentBodyMd, candidates }) -> { proposedBodyMd, regions, snapshotMd }`)
- Modify: `packages/api/src/handlers/wiki-compile.ts` (dispatch by `job.trigger`: `enrichment_draft` -> `runDraftCompile`, default -> existing `runCompileJob`)
- Modify: `scripts/build-lambdas.sh` if `draft-compile.ts` needs the agentcore esbuild flags (it should — it calls Bedrock)
- Test: `packages/api/src/__tests__/wiki-draft-compile.test.ts`

**Approach:**
- The new module owns its prompt; do NOT extend `runPlanner` / `runAggregationPass`. Their cluster-driven contract doesn't fit ad-hoc candidate input.
- Output structure is the `BrainEnrichmentDraftPage` shape from High-Level Design.
- Section anchor convention: `sectionSlug` matches H2 headings in both `snapshotMd` and `proposedBodyMd` (slugify rules to be consistent across both).
- Empty regions array is a valid result (signals "no enrichment landed").
- Use raw `boto3` / `@aws-sdk/client-bedrock-runtime` per learning #6.

**Patterns to follow:**
- `packages/api/src/lib/wiki/section-writer.ts` for Bedrock invocation shape and error handling.
- `parseCompileDedupeBucket` invariant from `repository.ts`.
- `pnpm --filter @thinkwork/database-pg db:migrate-manual` registration: header marker `-- creates-column: public.wiki_compile_jobs.input`.

**Test scenarios:**
- *Happy path:* Given a fixture page body with two H2 sections and three candidates that introduce new facts to one section, when `runDraftCompile` runs against an injected Bedrock seam, the result has a `proposedBodyMd` containing both sections with the third section unchanged, a single region for the touched section with `sourceFamily='WEB'` (or whichever family), and `snapshotMd === currentBodyMd`.
- *Happy path no-op:* Given candidates that are all substantively present in the page, the result has `regions === []` and `proposedBodyMd === snapshotMd`. **Covers AE3.**
- *Edge:* Given an empty `currentBodyMd` and one candidate, the result has one region with `beforeMd === ''` and `afterMd` containing the new section.
- *Edge:* Given candidates that span multiple sections, regions array contains one entry per touched section, each with its own `sectionSlug`.
- *Error path:* Given the Bedrock seam throws, the function rejects cleanly with the original error preserved.
- *Integration:* Round-trip JSON serialization of the result type matches the wire shape used downstream by U3 and U4.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes the new test file.
- The `wiki-compile.ts` handler dispatcher has a unit test that confirms it routes `trigger='enrichment_draft'` to `runDraftCompile` and other triggers to the existing path.
- `pnpm --filter @thinkwork/database-pg db:migrate-manual` reports the new column as present (after the migration is applied locally).

---

- U2. **Apply replace-with-revert (`applyBrainEnrichmentDraftReview`)**

**Goal:** Add a new apply function that consumes a draft payload + decision, writes the final body, and closes the thread. Ships **inert** — `decideWorkspaceReview` does not yet dispatch to it.

**Requirements:** R9, R13, R14, R15

**Dependencies:** None (operates on payload fixtures)

**Files:**
- Modify: `packages/api/src/lib/brain/enrichment-apply.ts` (add `applyBrainEnrichmentDraftReview`, sibling to `applyBrainEnrichmentWorkspaceReview`; do NOT delete the existing function)
- Test: `packages/api/src/lib/brain/enrichment-apply-draft.test.ts`

**Approach:**
- Function signature: `applyBrainEnrichmentDraftReview({ draftPayload, decision, tenantId, threadId, turnId, reviewerId, db }) -> { writtenBytes, regionsAccepted, regionsRejected }`.
- Build the final body by walking sections in `proposedBodyMd` order; for each section whose region id is in `rejectedRegionIds`, replace its content with the corresponding section content from `snapshotMd`.
- Single transaction: read the current page, compute final body, write `body_md` + `updated_at`, close the thread (`done` for accept, `cancelled` for whole-draft reject).
- Both `wiki_pages` and `tenant_entity_pages` get parallel branches mirroring the existing `appendCandidatesToPage` shape.
- Reject-all behaves identically to whole-draft reject: final body = snapshotMd.

**Patterns to follow:**
- `appendCandidatesToPage` for the wiki vs tenant-entity table fork.
- `completeReviewThread` for thread closure semantics.

**Test scenarios:**
- *Happy path bulk-accept:* Given a draft with three regions and `acceptedRegionIds = [r1, r2, r3]`, when apply runs, page body equals `proposedBodyMd` byte-for-byte.
- *Happy path mixed:* Given regions [r1, r2, r3] and `rejectedRegionIds = [r2]`, when apply runs, final body has r1 and r3's `afterMd` from proposed, but r2's section content equals `beforeMd` from snapshot. **Covers AE6.**
- *Edge:* Reject-all → final body equals `snapshotMd`.
- *Edge:* Empty regions array → final body equals `proposedBodyMd` (which equals `snapshotMd`); no-op write but thread closes successfully.
- *Error path:* `sectionSlug` in regions doesn't appear in `proposedBodyMd` → throws and the body is not written. **Covers R13's deterministic semantics.**
- *Integration:* Round-trip with both `wiki_pages` and `tenant_entity_pages` target tables.
- *Integration:* Concurrent edit between snapshot and apply — out of scope for unit tests; ETag guard at the resolver layer is responsible.

**Verification:**
- New test file passes.
- Existing `enrichment-apply.test.ts` continues to pass unchanged (the legacy `applyBrainEnrichmentWorkspaceReview` is not modified).

---

- U3. **GraphQL types + payload kind for draft-page review**

**Goal:** Add `BrainEnrichmentDraftPage`, `BrainEnrichmentRegion`, decision payload kind constants. Codegen across all consumers.

**Requirements:** R6, R8, R11, R12

**Dependencies:** None

**Files:**
- Modify: `packages/database-pg/graphql/types/brain.graphql`
- Modify: `terraform/schema.graphql` via `pnpm schema:build`
- Modify: `packages/api/src/lib/brain/enrichment-service.ts` (export TypeScript types matching the new GraphQL types, even if the resolver doesn't yet emit them)
- Run codegen: `pnpm --filter @thinkwork/api codegen`, `pnpm --filter @thinkwork/admin codegen`, `pnpm --filter @thinkwork/mobile codegen`, `pnpm --filter @thinkwork/cli codegen`
- Test: type-check round-trip via existing `pnpm typecheck`

**Approach:**
- Types are the wire shape from High-Level Design.
- Decision kind constant `'brain_enrichment_draft_decision'` lives alongside the existing `'brain_enrichment_selection'` constant in `apps/mobile/lib/brain-enrichment-review.ts` (or a sibling file) — exported for both producer and consumer.
- Payload kind `'brain_enrichment_draft_review'` is a discriminator on the `AgentWorkspaceReview.payload` AWSJSON; the GraphQL type itself doesn't need to enumerate it, but constants must be exported and reused on both sides.

**Patterns to follow:**
- Existing `BrainEnrichmentProposal` / `BrainEnrichmentCandidate` shape in `brain.graphql`.
- Existing kind-discriminator pattern in `apps/mobile/lib/brain-enrichment-review.ts`.

**Test scenarios:**
- *Test expectation:* schema validates and `pnpm -r typecheck` passes across all consumers; the new types deserialize from a hand-written JSON fixture in a unit test (`packages/api/src/__tests__/brain-draft-payload.test.ts`).
- No behavioral test scenarios (this unit is contract-only).

**Verification:**
- `pnpm schema:build` succeeds; `terraform/schema.graphql` updated.
- All four consumer codegens succeed.
- `pnpm -r typecheck` passes.

---

- U4. **Mobile draft-review panel (in-place + show-changes toggle + region tap)**

**Goal:** Add a new `BrainEnrichmentDraftReviewPanel` that renders the proposed page in place with highlighted regions, exposes a "show changes" toggle, and lets the user accept/reject regions. Ships **inert** — no payload of kind `brain_enrichment_draft_review` exists in production yet, but the panel renders correctly from a fixture in dev.

**Requirements:** R6, R7, R8, R12

**Dependencies:** U3

**Files:**
- Create: `apps/mobile/components/brain/BrainEnrichmentDraftReviewPanel.tsx`
- Create: `apps/mobile/lib/brain-enrichment-draft-review.ts` (helpers: `serializeBrainEnrichmentDraftDecision`, `isBrainEnrichmentDraftReviewPayload`, `defaultAcceptedRegionIds`)
- Modify: `apps/mobile/app/thread/[threadId]/index.tsx:ThreadHitlPrompt` (add a kind branch for `brain_enrichment_draft_review` that renders the new panel)
- Test: `apps/mobile/lib/__tests__/brain-enrichment-draft-review.test.ts`

**Approach:**
- Use existing markdown renderer (whatever `BrainEnrichmentReviewPanel` and other mobile screens use today; mirror its imports).
- Region highlighting: walk the rendered markdown's H2 sections, look up section slug against the regions array, wrap matching sections in a `Pressable` with a subtle background tint and a per-source-family color marker.
- Tap a highlighted section → show ✓/✗ controls + provenance chip + citation (when present).
- "Show changes" toggle in `headerRight` slot of `DetailLayout`. Switching to changes view renders a stacked list of `{ heading, beforeMd, afterMd }` per region, each card inheriting the same accept/reject state as the in-place view.
- Source-family colors: Brain → primary; Knowledge base → green; Web → amber (mirror current `BrainEnrichmentReviewPanel` color choices).

**Patterns to follow:**
- `apps/mobile/components/brain/BrainEnrichmentReviewPanel.tsx` for the candidate-card render pattern, color choices, and Modal/details affordance.
- `DetailLayout` for the screen wrapper.
- `serializeBrainEnrichmentSelection` in `apps/mobile/lib/brain-enrichment-review.ts` for the selection-serialization pattern.

**Test scenarios:**
- *Happy path:* Given a fixture payload with three regions, when the panel mounts, the proposed body markdown renders top-to-bottom with three sections highlighted, each tap-revealing ✓/✗ controls in the accepted state. **Covers AE4.**
- *Happy path toggle:* Given the same fixture, when the user toggles "show changes," the view switches to a stacked before/after diff with the same three regions and the same accept states. Toggling back restores the in-place view with state preserved. **Covers AE5.**
- *Edge:* Empty regions → "no enrichment landed" message renders with no review controls.
- *Edge:* Region with citation → tap reveals citation chip; region without citation shows source-family chip only.
- *Edge:* Reject one region → in-place view dims that section; show-changes view marks the corresponding card as rejected.
- *Error path:* Malformed payload (missing `proposedBodyMd`) → renderer falls through to a safe error state, doesn't crash the thread.
- *Integration (manual):* Open the thread with a fixture — renders without crashing on iOS sim and Android.

**Verification:**
- New helper test file passes.
- Storybook / dev fixture renders correctly on simulator (manual).

---

- U5. **Server completion writeback (compile -> review object + thread message + failure path)**

**Goal:** Wire the draft-compile output to write the workspace review object, post the "draft is ready" thread message, fire the push notification, and handle no-op + failure paths. **Seam-swap on the server side** — the draft-compile path becomes live.

**Requirements:** R3, R4, R5, R11, R15

**Dependencies:** U1, U3

**Files:**
- Create: `packages/api/src/lib/brain/draft-review-writeback.ts` (`writeDraftReviewWorkspaceObject`, `postDraftReadyThreadMessage`, `markDraftCompileFailed`, `markDraftCompileNoOp`)
- Modify: `packages/api/src/handlers/wiki-compile.ts` (after `runDraftCompile` returns, dispatch to writeback)
- Modify: `packages/api/src/lib/workspace-events/review-actions.ts:decideWorkspaceReview` (add a kind branch for `brain_enrichment_draft_review` -> dispatches to `applyBrainEnrichmentDraftReview` or whole-draft cancel from U2)
- Modify: `packages/api/src/lib/push-notifications.ts` (eventKind value for "draft is ready" — reuse `sendExternalTaskPush` with renamed/extended kind, do not add a new top-level function)
- Test: `packages/api/src/__tests__/draft-review-writeback.test.ts`
- Test: `packages/api/src/lib/workspace-events/review-actions-draft.test.ts`

**Approach:**
- On compile success with non-empty regions: write S3 sidecar at the existing review-object key pattern (`tenants/<slug>/agents/<slug>/workspace/review/brain-enrichment-draft-<reviewId>.md` plus `.json` for the structured payload, or single JSON object — match the existing pattern), insert `agent_workspace_runs` row with `status='awaiting_review'`, insert `agent_workspace_events` row with `event_type='review.requested'` and `payload.kind='brain_enrichment_draft_review'`, insert `messages` row ("Draft is ready — tap to review"), call `sendExternalTaskPush`.
- On compile success with empty regions: insert thread message "No enrichment landed — your page already covers all the new facts," close run with `status='completed'`. **No review surface is created.**
- On compile failure: insert thread message with error context, close run with `status='cancelled'` and `metadata.reason='compile_failed'`.
- **Snapshot env at coroutine entry** for the writeback callback per `agentcore-completion-callback-env-shadowing-2026-04-25.md`.
- Idempotency: writeback is keyed on `wiki_compile_jobs.id`; re-invocation is a no-op via dedupe at the workspace-event insert (UNIQUE on `(run_id, sequence)` or equivalent existing constraint).

**Patterns to follow:**
- `packages/api/src/lib/brain/enrichment-service.ts:createReviewThread` — existing review-object + workspace-run + thread-message coordination.
- `assertExpectedReviewEtag` for staleness protection.

**Test scenarios:**
- *Happy path:* Given a successful draft-compile result with three regions, when writeback runs, S3 has the JSON payload, `agent_workspace_runs` row exists with `awaiting_review`, `agent_workspace_events` row has `payload.kind='brain_enrichment_draft_review'`, thread message inserted, push notification dispatched.
- *Happy path no-op:* Given empty regions, when writeback runs, no review run is created, thread message is "no enrichment landed", run/turn closed cleanly. **Covers AE2 / R5.**
- *Error path:* Given draft-compile threw, when writeback runs, `agent_workspace_runs` row has `status='cancelled'` and `metadata.reason='compile_failed'`, thread message describes the failure, no review surface opens. **Covers AE7 / R4.**
- *Integration:* Env shadowing — simulate `THINKWORK_API_URL` mutated mid-coroutine; writeback uses snapshotted value, not the mutated one.
- *Integration:* `decideWorkspaceReview` with a draft payload accept dispatches to `applyBrainEnrichmentDraftReview`; cancel dispatches to a draft-aware cancel that closes the thread without writing.
- *Integration:* Re-invoking writeback for the same `wiki_compile_jobs.id` does not duplicate workspace events or messages.

**Verification:**
- All new test files pass.
- Manual: a hand-injected `wiki_compile_jobs` row with `trigger='enrichment_draft'` produces the expected workspace review and thread message in dev.

**Execution note:** Snapshot `THINKWORK_API_URL` and `API_AUTH_SECRET` at coroutine entry per `feedback_completion_callback_snapshot_pattern`.

---

- U6. **Brain enrichment service rewires to enqueue draft compile**

**Goal:** Switch `runBrainPageEnrichment` to enqueue a draft-compile job with the candidate input rather than synthesizing a synchronous workspace review. Resolver returns immediately with a "queued" indicator.

**Requirements:** R1, R2, R10

**Dependencies:** U2 (apply path live in `decideWorkspaceReview`), U5 (writeback path live)

**Files:**
- Modify: `packages/api/src/lib/brain/enrichment-service.ts:runBrainPageEnrichment`
- Modify: `packages/api/src/graphql/resolvers/...runBrainPageEnrichment.mutation.ts` (whichever file hosts the mutation — locate via grep for `runBrainPageEnrichment`)
- Modify: `packages/database-pg/graphql/types/brain.graphql` (extend `BrainEnrichmentProposal` return shape, or add a sibling return type, to indicate "queued" state when `targetPageTable` is a Brain page)
- Test: `packages/api/src/lib/brain/enrichment-service-draft.test.ts`

**Approach:**
- Branch on `targetPageTable === 'wiki_pages' || targetPageTable === 'tenant_entity_pages'`: route through draft-compile path.
- For non-Brain-page enrichment runs (KB-only, etc.), fall through to the existing synchronous candidate-card path. Both paths coexist.
- Build the candidate input by running existing candidate synthesis up to the candidate list (do NOT call `createReviewThread`); pass the candidates into the new draft-compile job's `input` jsonb.
- Insert `wiki_compile_jobs` row with `trigger='enrichment_draft'`, `dedupe_key = enrichment-draft:${tenantId}:${ownerId}:${pageId}:${bucket}` (preserve the bucket invariant), `input = { pageId, candidates }`.
- Resolver returns `{ status: 'queued', reviewRunId: <generated upfront for the eventual workspace_run>, ... }` with a clear discriminator the mobile sheet can read.

**Patterns to follow:**
- `parseCompileDedupeBucket` from `packages/api/src/lib/wiki/repository.ts`.
- Existing candidate synthesis in `packages/api/src/lib/brain/enrichment-candidate-synthesis.ts`.

**Test scenarios:**
- *Happy path:* Given a `runBrainPageEnrichment` call targeting a `wiki_pages` row, when the resolver runs, a `wiki_compile_jobs` row is inserted with `trigger='enrichment_draft'`, the candidates appear in `input`, the resolver returns a `'queued'` status, and no `agent_workspace_runs` row is created. **Covers AE1 / R1.**
- *Edge:* Two runs in the same dedupe bucket → only one job is enqueued (dedupe_key UNIQUE conflict swallowed cleanly with logging).
- *Edge:* Enrichment targeting a non-Brain page → falls through to legacy synchronous path; behavior unchanged.
- *Error path:* Page does not exist → resolver errors before enqueueing.
- *Integration:* End-to-end with U5 — enqueueing a job triggers the dispatcher (manual in dev), eventually the writeback fires and the workspace review appears.

**Verification:**
- New test file passes.
- Manual e2e in dev: trigger enrichment → see job row → see workspace review → see thread message.

---

- U7. **Mobile Enrich Page sheet rewires to fire-and-forget**

**Goal:** Submit closes the sheet immediately with a confirmation that a thread message will arrive when ready. No synchronous candidate review for Brain-page targets.

**Requirements:** R1

**Dependencies:** U6

**Files:**
- Modify: `apps/mobile/components/brain/BrainEnrichmentSheet.tsx`
- Test: existing mobile test surface for the sheet (locate via grep — likely `apps/mobile/__tests__/` or near the component)

**Approach:**
- After successful `runBrainPageEnrichment` mutation that returns `status === 'queued'`, immediately close the sheet and surface a toast/confirmation: "We're preparing your draft. You'll get a thread message when it's ready."
- Non-Brain-page targets (if the sheet handles them) keep the legacy synchronous flow.
- No changes to thread review screen — U4 already handles the new payload kind.

**Patterns to follow:**
- Existing toast/confirmation pattern used elsewhere in `apps/mobile/components/brain/`.

**Test scenarios:**
- *Happy path:* Given user submits enrichment for a Brain page, when the mutation returns `'queued'`, the sheet closes immediately with a confirmation toast. No candidate cards render. **Covers AE1.**
- *Error path:* Mutation fails → sheet shows an error and stays open for retry.
- *Edge:* Non-Brain target (KB-only) → sheet keeps the legacy synchronous behavior.

**Verification:**
- Mobile sheet test passes.
- Manual e2e: end-to-end run from sheet → notification → thread → review → apply.

---

- U8. **End-to-end tests + telemetry**

**Goal:** Validate the full flow with integration coverage and add cost/latency telemetry to the new draft-compile path.

**Requirements:** R3, R4, R5, R6, R8, R9, R13

**Dependencies:** U1–U7

**Files:**
- Create: `packages/api/src/__tests__/brain-enrichment-draft-flow.test.ts` (integration: enqueue job → simulate compile → writeback → decide → apply → page body asserts)
- Modify: `packages/api/src/lib/wiki/draft-compile.ts` (telemetry hooks: `metrics.input_tokens`, `metrics.output_tokens`, `metrics.regions_count`, `metrics.cost_usd`)
- Modify: `packages/api/src/lib/cost-recording.ts` if a new event-kind is needed for draft compile cost
- Test: `packages/api/src/__tests__/draft-compile-telemetry.test.ts`

**Approach:**
- Integration test injects fixture candidates, drives the full pipeline with a stubbed Bedrock client, asserts final page body matches expectations across the bulk-accept and mixed-accept paths.
- Telemetry: emit a cost-recording event with token counts + latency at the end of `runDraftCompile`. Mirror the existing wiki compile telemetry shape.
- Add a regression test that asserts proposed regions never contain raw external chrome strings (e.g., `# back`, `Subscribe to`, `Sign in to`) — per `web-enrichment-must-use-summarized-external-results-2026-05-01.md`.

**Patterns to follow:**
- `packages/api/src/__tests__/wiki-compiler.test.ts` for the compile-test fixture pattern.
- `packages/api/src/lib/cost-recording.ts` for cost-event emission.

**Test scenarios:**
- *E2E happy bulk-accept:* enqueue → compile → writeback → review object exists → decide accept-all → page body equals `proposedBodyMd`.
- *E2E happy mixed:* enqueue → compile → writeback → decide with one region rejected → page body has accepted regions from proposed and rejected region from snapshot. **Covers AE6.**
- *E2E no-op:* enqueue → compile returns empty regions → no review surface, thread closes "no enrichment landed". **Covers AE2.**
- *E2E failure:* enqueue → compile throws → thread shows failure state. **Covers AE7.**
- *Regression:* Web-source regions don't contain external chrome strings.
- *Telemetry:* Successful compile emits a cost event with non-zero `input_tokens` and `output_tokens`.

**Verification:**
- All integration tests pass.
- `pnpm -r --if-present test` green.
- Manual e2e in dev confirms the user-visible flow.

---

## System-Wide Impact

- **Interaction graph:** New edge `runBrainPageEnrichment -> wiki_compile_jobs -> wiki-compile Lambda -> draft-compile module -> agent_workspace_runs / messages / push notifications`. The mobile thread render gains a new payload-kind branch. No existing edge is removed.
- **Error propagation:** Compile failures surface as thread messages + cancelled run; they do NOT propagate to the caller of `runBrainPageEnrichment` (resolver returns immediately with queued status).
- **State lifecycle risks:** Snapshot-vs-current divergence. Between draft creation and decision time, the user could edit the page directly. Apply reverts to snapshot, not current. Acceptable for v1; ETag protects against the same draft being applied twice.
- **API surface parity:** Both `wiki_pages` and `tenant_entity_pages` get the new apply path; legacy `appendCandidatesToPage` stays for the legacy flow.
- **Integration coverage:** End-to-end test in U8 covers the full pipeline including writeback, decide, and apply.
- **Unchanged invariants:** `runCompileJob` and the existing wiki compile pipeline are not modified; existing memory-retain → wiki-compile flow is untouched. Legacy `applyBrainEnrichmentWorkspaceReview` is not modified. The dead inbox paths in `enrichment-apply.ts` are not touched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| New agentic compile produces lower-quality merges than users expect | U1 ships behind a feature trigger before U6 swaps callers; review fixture quality on representative pages during U1 development. |
| Section-grain regions feel too coarse on small edits | Documented as a v1 limitation; sub-section regions are deferred. Region payload's `beforeMd`/`afterMd` already carry full section content so the show-changes view shows real prose, not a one-line diff. |
| Snapshot drift between draft and decide time | Document in the help text on the review surface that a side edit during review is overridden by the draft decision. ETag prevents re-applying the same draft twice. |
| Bedrock SDK version drift in the new Lambda module | Use raw `@aws-sdk/client-bedrock-runtime` per learning; add to `BUNDLED_AGENTCORE_ESBUILD_FLAGS` if needed. |
| Env shadowing on long-running coroutine writeback | Snapshot env at coroutine entry per `feedback_completion_callback_snapshot_pattern`. |
| `wiki_compile_jobs.dedupe_key` collisions across normal + enrichment-draft jobs | Distinct dedupe-key prefix (`enrichment-draft:` vs existing prefix) prevents cross-trigger collisions. |
| Concurrent enrichments for the same page | dedupe_key bucket invariant collapses storms; UNIQUE constraint is enforced by the existing schema. |

---

## Documentation / Operational Notes

- Update `docs/` if there is a public-facing reference for Enrich Page UX — likely none, but check `docs/` Astro Starlight site after U7.
- Push notification eventKind addition (or rename) — confirm with mobile push registry.
- New cost-recording event kind for `enrichment_draft_compile` — add to any cost dashboard query.

---

## Phased Delivery

### Phase 1 — Inert plumbing (no user-visible change)
- U1, U2, U3, U4

### Phase 2 — Seam swap (user-visible change goes live)
- U5, U6, U7

### Phase 3 — Verification
- U8

Each unit is shippable as its own PR. PRs in Phase 1 may be merged in any order; Phase 2 PRs must merge in order U5 → U6 → U7. U8 may merge in parallel with U7 or after.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-01-enrich-page-draft-page-review-ux-requirements.md`
- Related code: `packages/api/src/lib/brain/enrichment-apply.ts`, `packages/api/src/handlers/wiki-compile.ts`, `apps/mobile/components/brain/BrainEnrichmentReviewPanel.tsx`
- Related origin (parallel): `docs/brainstorms/2026-05-01-enrich-page-web-and-review-ux-requirements.md`
- Predecessor PR: #725 `feat(brain): add web enrichment review flow`
- Institutional learnings: see Context & Research → Institutional Learnings list above.
