---
title: "refactor: Wiki + Evals revert from System Workflows (revert Phase 1)"
type: refactor
status: active
date: 2026-05-06
origin: docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md
---

# refactor: Wiki + Evals revert from System Workflows (revert Phase 1)

## Summary

Wiki Build returns to its existing direct-Lambda fallback path (promote it to the only path) and Evaluation Runs gets a new direct-Lambda invocation built from scratch (mirroring the wiki dynamic-import pattern). Strip 20 System Workflows recorder call sites in `wiki-compile.ts` and `eval-runner.ts` so Phase 2 can later delete the recorder library cleanly. Single PR, three implementation units, designed to merge before Phase 2 begins schema/Terraform/Lambda removal.

---

## Problem Frame

System Workflows wraps Wiki Build and Evaluation Runs in a Step Functions orchestration that adds developer friction without auditor-grade output (per origin Problem Frame — "the schema has the shape of compliance infrastructure without the substance"). Phase 1 unblocks dev velocity on these two product features by reverting them to direct Lambda invocation, which is the *prerequisite* for Phase 2's deletion of the SW infrastructure. (See origin: `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md`.)

---

## Requirements

- R1. Wiki Build returns to direct GraphQL-resolver-to-Lambda invocation, with no dependency on System Workflows. *(see origin: R1)*
- R2. Evaluation Runs returns to direct GraphQL-resolver-to-Lambda invocation, with no dependency on System Workflows. *(see origin: R2)*

**Origin actors:** A1 (Tenant admin invokes via mutation), A3 (Platform services — wiki-compile + eval-runner Lambdas).
**Origin flows:** F1 (Pull Wiki + Evals out of System Workflows) — covered end-to-end by this plan.
**Origin acceptance examples:** AE1 (covers R1, R2) — Phase 1 ships and triggering Wiki Build / Evaluation Run produces no rows in `system_workflow_*` tables and starts no Step Functions execution.

---

## Scope Boundaries

- Deletion of `packages/api/src/lib/system-workflows/{wiki-build,evaluation-runs}.ts` recorder helpers — Phase 2 deletes the entire library.
- Deletion of `system_workflow_*` tables, Step Functions state machines, IAM policies, EventBridge rules, adapter Lambdas — all Phase 2.
- The `lib/system-workflows/start.ts` launcher itself stays in Phase 1 — only the call sites in Wiki and Evals resolvers stop using it. Other callers (the Activation resolver, until Phase 2 R3 removes it) continue using the launcher.
- Activation feature removal — Phase 2 (R3).
- Branch hygiene + doc rescue from `codex/activation-deploy-smoke-plan` — Phase 2 U1.
- Compliance feature design and implementation — Phase 3 (separate plan after the 30 Resolve-Before-Planning items in the origin doc are resolved).

---

## Context & Research

### Relevant Code and Patterns

- **Wiki resolver fallback (existing pattern to promote):** `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` lines 62-77 — `isUnconfiguredSystemWorkflow` catch block dynamically imports `LambdaClient` + `InvokeCommand` and invokes `wiki-compile` directly. This is the pattern the eval resolver will mirror.
- **Eval resolver (no fallback today):** `packages/api/src/graphql/resolvers/evaluations/index.ts` lines ~396 (call site) and 412-422 (catch block that marks failed and rethrows). Phase 1 R2 builds the missing direct-invoke path here.
- **Wiki handler (recorder importers to strip):** `packages/api/src/handlers/wiki-compile.ts` — imports at lines 26-28 (`recordWikiBuildWorkflowStep`, `recordWikiBuildWorkflowEvidence`, `updateWikiBuildWorkflowRunSummary`); event-payload type field `systemWorkflowRunId?: string` at line 67; `WikiBuildSystemWorkflowContext` type usage; recorder call sites at lines 263, 299, 309, 323, 331, 346, 356, 363, 371 (~10 total).
- **Eval handler (recorder importers to strip):** `packages/api/src/handlers/eval-runner.ts` — imports at lines 52-54; `EvalSystemWorkflowContext` type usage; recorder call sites at lines 596, 633, 791, 843, 851, 862, 870, 898, 906, 914 (~10 total).
- **Handler tests with SW mocks:** `packages/api/src/handlers/wiki-compile.test.ts` lines 41-43 (mocks the recorder helpers); `packages/api/src/handlers/eval-runner.test.ts` (verify and update similarly).
- **Resolver Lambda IAM:** `terraform/modules/app/lambda-api/main.tf` — the existing `lambda:InvokeFunction` grant for `wiki-compile-*` (used by the wiki fallback) needs to be extended to `eval-runner-*` for R2. Exact statement location confirmed at implementation time.
- **GraphQL Lambda deploy pattern:** per memory `feedback_graphql_deploy_via_pr` — don't `aws lambda update-function-code` directly; PR to main and let the merge pipeline deploy.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — Inverted for deletions: Phase 1 = "consumers stop writing"; Phase 2 = "schema drop." This plan IS the consumers-stop-writing PR.
- `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` — Confirms the SW indirection on the Evals side has produced bugs and is the right thing to back out. Also flags `cancelEvalRun` doesn't `StopExecution` — relevant to Phase 2 drain, not Phase 1.

---

## Key Technical Decisions

- **Single PR, three implementation units.** Wiki and Evals share the same recorder-removal pattern; reviewing them together is faster than two PRs. Atomic merge means Phase 2 has a single dependency to verify, not two. Each unit is independently understandable but the PR ships as one.
- **Eval-runner direct invoke mirrors the wiki dynamic-import pattern.** Use the same `LambdaClient` + `InvokeCommand` shape from `compileWikiNow.mutation.ts` lines 62-77 — dynamic import inside the resolver function rather than module-load static import. Consistency with the codebase wins; the import overhead is negligible at GraphQL-mutation cadence.
- **Promote wiki fallback to primary path; do not preserve the SW launcher attempt.** Wiki currently tries `startSystemWorkflow` first and falls back on `isUnconfiguredSystemWorkflow`. Phase 1 removes the primary attempt entirely — Wiki goes straight to direct invoke. The fallback path becomes the only path; no need for try/catch around launcher anymore.
- **Wiki and Evals diverge on direct-invoke shape.** Wiki invokes via `Event` invocation type (fire-and-forget, matches the existing fallback's pattern — wiki compilation runs asynchronously and reports back via DB writes). Evals follows the same pattern: `Event` invocation, async run, status updates via `evalRuns` table writes from inside the handler. Confirmed by reading the existing pre-SW behavior implied by the eval-runner handler shape.
- **IAM grant extension is a single Terraform statement edit.** The existing `lambda:InvokeFunction` IAM block in `terraform/modules/app/lambda-api/main.tf` already grants invoke on `wiki-compile-*`. Phase 1 extends the resource list to also include `eval-runner-*`. Same IAM statement; no new resource.
- **Strip handler-side recorder calls completely (don't leave them as no-ops).** Phase 2 will delete `lib/system-workflows/{wiki-build,evaluation-runs}.ts`. If Phase 1 leaves the imports + calls in place but null-context-no-op'd, Phase 2's library deletion fails typecheck. Strip every importer and every call site in Phase 1.
- **Test the integration in dev, not pre-merge.** Per memory `feedback_merge_prs_as_ci_passes` — v1 pre-launch default is squash-merge as soon as CI passes; deploy to dev is the E2E validation loop. Phase 1's verification is "Wiki Build and Eval Run trigger via GraphQL mutation on dev, succeed end-to-end, produce no rows in `system_workflow_runs`/`step_events`."

---

## Open Questions

### Resolved During Planning

- **Q: One PR or split into Wiki PR + Evals PR?** A: Single PR. Recorder-removal pattern is shared; review surface is small (~40-50 line changes); atomic gate for Phase 2.
- **Q: Eval direct-invoke pattern — dynamic import or module-load static?** A: Dynamic import inside the resolver function, mirroring the wiki fallback at `compileWikiNow.mutation.ts` lines 62-77. Consistency with the codebase pattern.
- **Q: IAM grant location — extend existing or new statement?** A: Extend the existing `lambda:InvokeFunction` statement in `terraform/modules/app/lambda-api/main.tf` that currently grants invoke on `wiki-compile-*`. Add `eval-runner-*` to the resource list. Single statement edit.
- **Q: Are there integration tests that go through the SW path today?** A: To be verified at implementation time via `grep -r "startSystemWorkflow\|recordWikiBuildWorkflowStep\|recordEvaluationWorkflowStep" packages/api/test/integration/ packages/api/src/__tests__/`. If found, update assertions to direct-invoke shape; if not, no integration test changes needed.
- **Q: Replacement onboarding flow?** A: N/A for Phase 1 — Phase 1 only touches Wiki and Evals, not Activation. Activation's onboarding-replacement question lives in Phase 2's RBW.

### Deferred to Implementation

- Exact line numbers in `terraform/modules/app/lambda-api/main.tf` for the `lambda:InvokeFunction` statement. Implementer greps for `wiki-compile-*` resource ARN pattern.
- Whether the eval-runner Lambda needs any new env-var injection (it currently has its own context; verify nothing in the SW path was injecting tenant context that the direct invoke needs to preserve).
- Whether `cancelEvalRun` (which currently flips a DB row without `StopExecution`) needs any behavior change in Phase 1. Likely no — without SFN executions to stop, the row-flip is the right semantic. Confirm at implementation.
- Whether any monitoring dashboards or alarms reference `system_workflow_runs` for the Wiki/Evals subset — implementer checks at impl time and either updates or notes for Phase 2.

---

## Implementation Units

- U1. **Wiki Build: strip handler recorder calls + flip resolver to direct-only**

**Goal:** Remove Wiki Build's dependency on System Workflows. Strip 10 handler-side recorder call sites + their imports. Promote the existing fallback to the only path in the resolver.

**Requirements:** R1.

**Dependencies:** None — independent of U2 within the same PR.

**Files:**
- Modify: `packages/api/src/handlers/wiki-compile.ts` — remove imports at lines 26-28 (`recordWikiBuildWorkflowStep`, `recordWikiBuildWorkflowEvidence`, `updateWikiBuildWorkflowRunSummary`), remove `WikiBuildSystemWorkflowContext` type import, remove `systemWorkflowRunId?: string` from event-payload type at line 67, strip 10 recorder call sites at lines 263, 299, 309, 323, 331, 346, 356, 363, 371 + any `recordClaimStep` / `recordWikiWorkflowOutcome` / `recordWikiWorkflowFailure` helper invocations
- Modify: `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` — remove the `startSystemWorkflow` primary call and the surrounding try/catch; promote the fallback's `LambdaClient`/`InvokeCommand` invocation to be the only path. Drop the `isUnconfiguredSystemWorkflow` import if no longer used elsewhere
- Test: `packages/api/src/handlers/wiki-compile.test.ts` — remove the recorder-helper mocks at lines 41-43

**Approach:**
- Strip imports first (typecheck reveals all dependent code via "unused" errors).
- Remove call sites in handler. Each call site is a no-arg or context-arg invocation that returns void/Promise<void> — deletion is direct, no replacement helper needed.
- Resolver: simplify the existing two-path try/catch to a single direct-invoke path. Reference the existing fallback shape verbatim — same dynamic import, same `InvokeCommand`, same fire-and-forget `Event` invocation type.
- Run `pnpm --filter @thinkwork/api typecheck` to verify clean.

**Patterns to follow:**
- Direct-invoke pattern from `compileWikiNow.mutation.ts` lines 62-77 (the existing fallback) — copy the shape, drop the conditional wrapping.
- GraphQL deploy via PR per `feedback_graphql_deploy_via_pr` — do not `aws lambda update-function-code` directly.

**Test scenarios:**
- *Happy path:* `compileWikiNow` mutation triggers a `wiki-compile` Lambda invocation directly (no SFN execution started, no `system_workflow_runs` row inserted). Confirmed by either spying on `LambdaClient.send` in unit tests or by post-deploy dev-stage verification (`aws logs filter-log-events` on `wiki-compile` shows invocations matching mutation timestamps).
- *Edge case:* When `LambdaClient.send` rejects (Lambda unreachable, throttled), the GraphQL mutation surfaces the failure to the caller as a meaningful error — same behavior as the prior fallback path.
- *Integration:* Covers AE1. Triggering Wiki Build via GraphQL mutation on `dev` post-merge produces zero new rows in `system_workflow_runs` filtered by `definition_id = 'wiki-build'` over a 24-hour soak window.

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` passes.
- `pnpm --filter @thinkwork/api test handlers/wiki-compile.test.ts` passes with mocks removed.
- `grep -n "system-workflows\|SystemWorkflow\|recordWikiBuild\|recordWikiWorkflow\|recordClaimStep" packages/api/src/handlers/wiki-compile.ts packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` returns zero matches.
- Post-deploy `dev` smoke: trigger Wiki Build via admin SPA; confirm CloudWatch log group for `wiki-compile-dev` shows invocation; query `system_workflow_runs` for new wiki-build entries returns zero.

---

- U2. **Evaluation Runs: strip handler recorder calls + build direct-invoke + extend IAM**

**Goal:** Build the missing direct-Lambda invocation path in the Evals resolver (which has no fallback today), strip 10 handler-side recorder call sites + their imports, and extend the resolver Lambda IAM role to grant `lambda:InvokeFunction` on `eval-runner-*`.

**Requirements:** R2.

**Dependencies:** None — independent of U1 within the same PR; U2 is the larger of the two units.

**Files:**
- Modify: `packages/api/src/handlers/eval-runner.ts` — remove imports at lines 52-54 (`recordEvaluationWorkflowStep`, `recordEvaluationWorkflowEvidence`, `updateEvaluationWorkflowRunSummary`), remove `EvalSystemWorkflowContext` type import, strip 10 recorder call sites at lines 596, 633, 791, 843, 851, 862, 870, 898, 906, 914
- Modify: `packages/api/src/graphql/resolvers/evaluations/index.ts` — remove `startSystemWorkflow` import and call at line ~396; remove the catch block at lines 412-422 (mark-failed-and-rethrow); add direct-invoke path mirroring `compileWikiNow.mutation.ts` lines 62-77 (dynamic `import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"`, construct `eval-runner` function name from stage, `Event` invocation type, fire-and-forget)
- Modify: `terraform/modules/app/lambda-api/main.tf` — extend the existing `lambda:InvokeFunction` IAM statement (currently lists `wiki-compile-*` ARN pattern) to also include `eval-runner-*` ARN pattern. Single resource-list addition.
- Test: `packages/api/src/handlers/eval-runner.test.ts` — verify and remove any SW recorder mocks (parallel to U1's wiki-compile.test.ts changes)

**Approach:**
- Strip handler imports + call sites first; typecheck surfaces every importer.
- Build the resolver direct-invoke: read the wiki resolver's fallback as the reference, write the eval equivalent with `eval-runner` as the target function name. Use the same fire-and-forget `Event` invocation pattern — eval runs are async, status flows back through `evalRuns` table writes from inside the handler.
- Extend IAM in Terraform: locate the statement granting `lambda:InvokeFunction` on `wiki-compile-*` and add `arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-eval-runner` (or matching wildcard) to the resource list. Single-statement edit.
- Run `pnpm --filter @thinkwork/api typecheck`. Run `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` to confirm the IAM diff is exactly one statement, one resource added.

**Execution note:** None — well-patterned change.

**Patterns to follow:**
- Direct-invoke pattern from `compileWikiNow.mutation.ts` lines 62-77 (dynamic import + `LambdaClient` + `InvokeCommand` + `Event` invocation type).
- IAM grant pattern from the existing `wiki-compile-*` statement in `terraform/modules/app/lambda-api/main.tf`.

**Test scenarios:**
- *Happy path:* `startEvalRun` mutation triggers an `eval-runner` Lambda invocation directly. Spy on `LambdaClient.send` in unit tests; post-deploy verify via CloudWatch log group `eval-runner-dev`.
- *Edge case:* When `LambdaClient.send` rejects, the resolver still updates `evalRuns.status = 'failed'` and surfaces a meaningful GraphQL error. (This preserves the current observable behavior where the run row reflects launch failure.)
- *Error path:* IAM denies invoke (e.g., during a misconfigured deploy) — resolver surfaces the AWS error; the eval run is marked failed in `evalRuns`.
- *Integration:* Covers AE1. Triggering Eval Run via GraphQL mutation on `dev` post-merge produces zero new rows in `system_workflow_runs` filtered by `definition_id = 'evaluation-runs'` over a 24-hour soak window.
- *Integration:* `terraform plan` on `dev` shows the IAM resource list change as the only Terraform diff produced by this unit.

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` passes.
- `pnpm --filter @thinkwork/api test handlers/eval-runner.test.ts graphql/resolvers/evaluations/` passes.
- `grep -n "system-workflows\|SystemWorkflow\|recordEvaluation\|EvalSystemWorkflowContext" packages/api/src/handlers/eval-runner.ts packages/api/src/graphql/resolvers/evaluations/index.ts` returns zero matches.
- `terraform plan` shows the IAM statement change cleanly.
- Post-deploy `dev` smoke: trigger an Eval Run via admin SPA; confirm CloudWatch log group `eval-runner-dev` shows invocation; query `system_workflow_runs` for new evaluation-runs entries returns zero.

---

- U3. **Verify integration tests + post-deploy soak**

**Goal:** Confirm no integration tests assert SW-path behavior (or update those that do); run a 24-hour `dev`-stage soak after merge to verify the revert is clean and Phase 2 can begin.

**Requirements:** R1, R2.

**Dependencies:** U1 + U2 (this unit verifies the merged result; nothing to do until they land).

**Files:**
- Audit: `packages/api/test/integration/` — `grep -rn "startSystemWorkflow\|recordWikiBuildWorkflowStep\|recordEvaluationWorkflowStep\|systemWorkflowRunId" packages/api/test/integration/ packages/api/src/__tests__/` to find any integration tests that traverse the SW path.
- Modify (if found): integration test files — update assertions from SW-path expectations to direct-invoke expectations (no `system_workflow_runs` row, no `system_workflow_step_events`, just direct Lambda invocation).

**Approach:**
- Run the grep at the start of the unit. If zero matches, this unit is a no-op verification; PR can merge.
- If matches exist, the affected tests need their assertions updated. Likely small surface (the SW indirection was new in late April 2026, so integration tests that go through it are recent additions if any).
- After merge, deploy to `dev` (auto-deploys on merge to main per CLAUDE.md). Soak for 24 hours.
- During soak: trigger Wiki Build at least 3 times via admin SPA; trigger Eval Run at least 3 times via admin SPA; verify both succeed end-to-end.
- Soak verification queries:
  - `psql -c "SELECT COUNT(*) FROM system_workflow_runs WHERE definition_id IN ('wiki-build', 'evaluation-runs') AND created_at > NOW() - INTERVAL '24 hours';"` — must return 0.
  - `aws stepfunctions list-executions --state-machine-arn ...wiki-build... --status-filter RUNNING` and `...evaluation-runs...` — must return empty.
  - CloudWatch log groups for `wiki-compile-dev` and `eval-runner-dev` — must show invocations matching mutation timestamps.

**Patterns to follow:**
- Diff-against-origin discipline per `feedback_diff_against_origin_before_patching` — if integration tests need updates, fetch + diff first.
- "Merge as CI passes, deploy to dev is E2E validation" per memory `feedback_merge_prs_as_ci_passes`.

**Test scenarios:**
- *Happy path:* Audit grep returns zero matches in `packages/api/test/integration/`. Soak verification all green.
- *Edge case:* Audit grep finds 1-2 integration tests asserting SW-path; assertions are updated to direct-invoke shape; tests pass.
- *Integration:* Covers AE1. End-to-end soak on `dev` for 24 hours produces zero new SW rows for wiki-build or evaluation-runs.

**Verification:**
- `system_workflow_runs` count for `wiki-build` + `evaluation-runs` definitions over the soak window is zero.
- No `RUNNING` SFN executions for these two state machines at any point in the soak window.
- CloudWatch log groups for `wiki-compile-dev` and `eval-runner-dev` show steady invocations matching admin-triggered mutations.
- Phase 2 can begin: signal that with a comment on the Phase 2 plan PR (whenever it opens) confirming Phase 1's soak is clean.

---

## System-Wide Impact

- **Interaction graph:** Two GraphQL resolver call paths change shape (`compileWikiNow` and `startEvalRun`). The `lib/system-workflows/start.ts` launcher loses two of its three callers in Phase 1; the Activation resolver remains as the third caller until Phase 2 R3.
- **Error propagation:** Wiki and Evals failures now surface via GraphQL resolver error responses (the pre-SW behavior); previously they surfaced via SW execution failure + DB-row status-flipping. For Evals, the resolver still updates `evalRuns.status = 'failed'` on launch error to preserve the row-state behavior the admin UI relies on.
- **State lifecycle risks:** None for Phase 1 itself — recorder calls being stripped means no half-written `system_workflow_step_events` or `system_workflow_evidence` rows. Existing in-flight SFN executions started before Phase 1 deploys will continue to write step_events + evidence as they finish; that's fine, those tables stay until Phase 2 drops them.
- **API surface parity:** GraphQL mutation contracts for `compileWikiNow` and `startEvalRun` are unchanged. Admin SPA and mobile callers see no API contract change.
- **Integration coverage:** 24-hour `dev` soak is the cross-layer integration check. Unit tests alone cannot prove the IAM grant works at runtime; the soak is the verification.
- **Unchanged invariants:** `wiki-compile` and `eval-runner` Lambda handler interfaces (event shape, response shape) are unchanged — they continue to accept the same event payloads (minus the `systemWorkflowRunId?` optional field, which had no callers if the resolver doesn't pass it). The `evalRuns` table schema is unchanged. The `system_workflow_runs` table is unchanged (Phase 2 drops it).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stripping all 20 recorder call sites is mechanical but tedious; one missed call site fails Phase 2's library deletion | Final-grep verification step in U1 + U2: `grep -n "system-workflows\|recordWikiBuild\|recordEvaluation\|recordClaim\|WikiBuildSystemWorkflowContext\|EvalSystemWorkflowContext"` returns zero matches across both handlers and both resolver files before opening the PR |
| IAM grant change misses the right statement, or wildcards conflict | `terraform plan` diff inspection: must show exactly one statement modified, one resource added. If the diff is larger, stop and investigate before applying |
| Eval direct-invoke pattern diverges from wiki pattern in some subtle way (e.g., env var dependency, argument shape) and fails at runtime on `dev` | Read `compileWikiNow.mutation.ts` lines 62-77 verbatim before writing the eval equivalent; mirror the shape exactly. Soak on `dev` catches runtime divergence before promotion to staging/prod |
| In-flight Wiki/Eval SFN executions started pre-deploy continue writing step_events post-deploy until they finish | Acceptable — those tables stay until Phase 2 drops them. The `system_workflow_runs` count check uses `created_at > NOW() - INTERVAL '24 hours'` to focus on post-deploy rows only |
| `cancelEvalRun` mutation behavior change (currently flips a DB row, doesn't `StopExecution`) | Likely no change needed in Phase 1 — without SFN executions to stop, the row-flip is the right semantic. Verify at implementation; if behavior change is needed, scope-creep flag (defer to a separate fix or fold into U3) |
| Integration test audit reveals more changes than expected | Bounded — the SW indirection was added late April 2026 (~2 weeks before this plan). Integration test surface for SW-path assertions is small. If audit reveals >5 affected tests, surface to user before merging |

---

## Documentation / Operational Notes

- **PR description**: cite origin brainstorm, link the Phase 2 plan as the dependent next step, note the 24-hour `dev` soak as the merge-readiness gate for Phase 2.
- **Post-merge announcement**: notify team that Phase 1 has shipped and the Phase 2 PR(s) can begin once the soak is clean.
- **No customer-facing comms needed** — Wiki and Evals UX is unchanged; only the orchestration substrate moves under the hood.
- **No CloudWatch dashboards or alarms touched** — Phase 1 doesn't change metric emissions; Phase 2's table drops will require alarm cleanup, not Phase 1.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](../brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md) (R1, R2, F1, AE1)
- **Phase 2 plan (downstream):** [docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md](2026-05-06-001-refactor-system-workflows-activation-removal-plan.md) — depends on this plan merging + soaking first
- **Project memory:** `project_system_workflows_revert_compliance_reframe.md` (overall arc)
- **Institutional learnings:**
  - [docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md](../solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md)
  - [docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md](../solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md)
- **Code references:** see Context & Research § Relevant Code and Patterns
