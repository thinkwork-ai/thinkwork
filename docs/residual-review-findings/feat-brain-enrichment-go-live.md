# Residual Review Findings

Source: `ce-code-review` mode:autofix run `20260501-135508-019db682`
Branch: `feat/brain-enrichment-go-live`
Plan: `docs/plans/2026-05-01-002-feat-brain-enrichment-draft-page-review-plan.md` (U6 + U7 bundled)

ce-correctness-reviewer found 2 **P0** mobile-sheet breakages (typecheck + runtime ID! mutation rejection) plus 1 P1 dedupe-race silent drop. All three fixed in the autofix commit, with U7's mobile sheet fire-and-forget rewire bundled into this PR per user direction.

## Residual Review Findings

- **[P2][manual][downstream-resolver]** `packages/api/src/lib/brain/enrichment-service.ts:222-466` — `createReviewThread`, `renderReviewMessage`, and `resolveReviewAgent` are now dead code. The synchronous `AWAITING_REVIEW` path is no longer reachable from any caller; only the `QUEUED` async path runs. ~250 LOC + an unused `S3Client` import + the `s3?` arg on `runBrainPageEnrichment` can be deleted. Cleanup PR follows; behavior unchanged.

- **[P2][manual][downstream-resolver]** `apps/mobile/components/brain/BrainEnrichmentReviewPanel.tsx:48-57` — Pre-selection effect short-circuits when `proposal.reviewRunId` is null (`initializedForRun === proposal.reviewRunId` is `null === null`, true). Default-selected candidates never get pre-checked. The legacy panel is no longer reachable from the mobile sheet on QUEUED responses (sheet closes), but the panel is still imported by the thread-detail screen for the legacy candidate-card flow. Fix: key on `proposal.id` or use a non-null sentinel for the initial state.

- **[P3][manual][downstream-resolver]** Lambda config: `wiki-compile` Lambda needs `MaximumRetryAttempts=0` + an SQS DLQ in `terraform/modules/app/lambda-api/handlers.tf` (mirror the pattern at `terraform/modules/app/agentcore-runtime/main.tf:408-430`). Per `docs/solutions/architecture-patterns/async-retry-idempotency-lessons`, AWS Lambda's default `MaximumRetryAttempts=2` would re-invoke a hung writeback. The runner's `running`-status short-circuit (U5) is the primary protection but belt-and-suspenders is the institutional pattern.

- **[P3][manual][downstream-resolver]** Tests for the dedupe race fix: no test covers the new `:rerun-N` suffix path (terminal-state existing job → fresh insert). Add a vi.mock-backed test that simulates an existing succeeded job and asserts the resolver re-enqueues with the rotated key.

- **[P3][manual][downstream-resolver]** Test for invoke rejection: `invokeWikiCompile` is fire-and-forget with `.catch()`. No test asserts the resolver still returns `QUEUED` when the invoke rejects. Worth locking in the durability guarantee — the job row exists, scheduler picks it up.

- **[P3][manual][downstream-resolver]** Test for enqueue throw: `enqueueEnrichmentDraftCompileJob` can throw on the new `exhausted rerun-suffix attempts` branch. Verify the GraphQL error surfaces sensibly in the resolver.

## Acknowledged risks (no action)

- A scheduled drainer for `wiki_compile_jobs` in `pending` status exists for the legacy compile (`aws_scheduler_schedule.wiki_compile_drainer` in handlers.tf:655) so a missed async invoke is recoverable. Confirm the new `enrichment_draft` trigger jobs are also covered by that drainer before broad rollout.
- Mobile typecheck has ~113 pre-existing errors in unrelated files (react-navigation, FlashList API drift, etc.). The U6/U7 changes contribute zero new errors; broader cleanup is out of scope.

Full review artifact: `/tmp/compound-engineering/ce-code-review/20260501-135508-019db682/`
