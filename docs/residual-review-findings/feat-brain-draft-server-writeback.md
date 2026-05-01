# Residual Review Findings

Source: `ce-code-review` mode:autofix run `20260501-132529-bca3799a`
Branch: `feat/brain-draft-server-writeback`
Plan: `docs/plans/2026-05-01-002-feat-brain-enrichment-draft-page-review-plan.md` (U5)

3 reviewers (correctness, adversarial, reliability) cross-corroborated a P0/P1 cascade on Lambda retry of `running`-state jobs. Five safe_auto fixes applied in the autofix commit. Six findings deferred — none block the PR.

## Residual Review Findings

- **[P1][gated_auto][downstream-resolver]** `packages/api/src/lib/brain/draft-review-writeback.ts:138` — Wrap multi-step writeback in `db.transaction`. The 5 sequential DB writes plus the `tenants.issue_counter++` are not transactional; mid-flight failure leaks an orphan thread/turn/run with no terminal state. Mirrors the legacy `createReviewThread` pattern (precedent-consistent), but the new surface area is bigger and the failure modes are more annoying. Refactor: thread `tx` through `openThread` and the 5 inserts. ~50 LOC change.

- **[P2][gated_auto][downstream-resolver]** `packages/api/src/lib/workspace-events/review-actions.ts:257` — Silent bulk-accept when `parseBrainEnrichmentDraftDecision` returns null. `mergeAcceptedRegions` treats null decision as bulk-accept. Parse failures (corrupted `responseMarkdown`, schema drift) silently flip a partial-reject into a full accept. Should distinguish "responseMarkdown empty" (legacy bulk-accept ok) from "responseMarkdown non-empty but unparseable" (throw 400). Behavior change touches mobile contract; gate.

- **[P2][gated_auto][downstream-resolver]** `packages/api/src/lib/workspace-events/review-actions.ts:229` — Corrupted draft-review payload falls through to legacy wakeup-enqueue. `parseDraftReviewEventPayload` returns null when kind matches but a field is missing. Legacy `isBrainEnrichmentReviewPayload` check requires a different kind so it also returns false; control falls through to the generic wakeup-enqueue path with a payload it doesn't know how to interpret. Should distinguish "kind doesn't match" from "kind matches but shape invalid" and throw on the latter.

- **[P3][manual][downstream-resolver]** `packages/api/src/lib/wiki/draft-compile.ts:669` — No per-call Bedrock timeout in `runDraftCompileJob`. Inherited risk from U1's `runDraftCompile` seam. Wiki-compile Lambda has a 480s budget; a hung Bedrock call could consume the whole thing without a per-call cap. Construct an `AbortController` with a configurable timeout (e.g., 240s) and thread `signal` through `opts.seam`.

- **[P3][manual][downstream-resolver]** `packages/api/src/lib/brain/draft-review-writeback.ts:390` — `resolveAgentContext` fallback non-deterministic ordering. `SELECT id, slug FROM agents WHERE tenant_id=$1 LIMIT 1` with no `ORDER BY`. On duplicate writebacks (defense-in-depth case), the success thread and failure thread can be attributed to different agents. Add `ORDER BY agents.created_at, agents.id` for stability.

- **[P3][manual][downstream-resolver]** Tests for the running-status short-circuit + duplicate-writeback flow. The autofix added the short-circuit but no test mocks `getCompileJob` to verify the early return. Worth adding alongside the next round of writeback tests in U6/U8.

## Acknowledged risks (no action)

- Lambda async retry config (`MaximumRetryAttempts=0` + SQS DLQ) is the institutional recommendation per `docs/solutions/architecture-patterns/async-retry-idempotency-lessons` but lives in Terraform, out of scope for this PR. U6 should land it alongside the producer.
- Push notification dispatch ("draft is ready" via `sendExternalTaskPush`) intentionally deferred. The thread itself + existing thread-list subscription are the visibility surface for v1.
- `decision === 'resumed'` on a draft review falls through to the legacy wakeup-enqueue path. Latent today — mobile only emits accepted/cancelled.

Full review artifact: `/tmp/compound-engineering/ce-code-review/20260501-132529-bca3799a/`
