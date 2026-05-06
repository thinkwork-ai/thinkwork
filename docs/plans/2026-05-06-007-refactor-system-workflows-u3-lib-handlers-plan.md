---
title: "Phase 2 U3: Delete System Workflows library + Lambda handlers"
type: refactor
status: active
date: 2026-05-06
origin: docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md
---

# Phase 2 U3: Delete System Workflows library + Lambda handlers

## Summary

Execute Phase 2 U3 of the System Workflows revert: delete `packages/api/src/lib/system-workflows/` and the 5 SW/Activation Lambda handlers, then strip their entries from `scripts/build-lambdas.sh` and `terraform/modules/app/lambda-api/handlers.tf`. Phase 1 (PR #845), Phase 2 U1 (#846), and Phase 2 U2 (#848) are already merged on `main`, so the dependency gate is satisfied.

This plan is a **focused execution overlay** on the parent Phase 2 plan — it carries forward U3's goal, file list, and verification verbatim, refines line numbers and assumptions against the current `main`, and resolves the planning-time gaps the parent plan flagged for impl-time confirmation.

---

## Problem Frame

Parent plan establishes the full motivation. Briefly: U2 deleted the user-facing GraphQL/UI surface for SW + Activation. The runtime libs (`lib/system-workflows/`) and 5 backing Lambdas now have **zero in-tree consumers** but still ship with every deploy. U3 removes them so the platform stops carrying dead infrastructure code, and so the IAM/route surface contracts before U5 deletes the Step Functions module.

See origin: `docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md` lines 295-340.

---

## Requirements

- R1. Carries forward parent R3 (Activation runtime invocation removed) and R4 (multi-step adapter Lambdas removed, library deleted) — see origin §Requirements.
- R2. `pnpm typecheck` and `pnpm test` stay green across the workspace post-deletion.
- R3. `pnpm build:lambdas` exits cleanly — no missing-handler errors for any of the 5 deleted entries.
- R4. `terraform plan` against `dev` shows exactly 5 Lambda destroys (plus their integrations, routes, and permissions) AND the EventBridge `sfn_state_change` rule + target + permission destroys (gated to count=0 by setting `execution_callback_lambda_arn = ""` in `terraform/modules/thinkwork/main.tf` — see Key Technical Decisions); zero unexpected destroys outside that set.
- R5. `scripts/build-system-workflow-asl.ts` is deleted alongside the lib it imports — leaving it stranded would orphan a broken script.

---

## Scope Boundaries

- AgentCore activation runtime + ECR repo deletion → U4.
- `terraform/modules/app/system-workflows-stepfunctions/` module deletion + state-machine destroy → U5.
- `aws_iam_role_policy.lambda_system_workflows_stepfunctions` (`terraform/modules/app/lambda-api/main.tf:637-659`) is **not touched in U3** — it grants `states:StartExecution` on `thinkwork-*-system-*` state machines that still exist until U5. Removing it before U5 changes the IAM diff to be split across two PRs unnecessarily; leave it for U5 to remove alongside the state machines it grants on.
- Postgres schema (`packages/database-pg/src/schema/{system-workflows,activation}.ts` + migrations 0059/0060) → U6.
- `terraform/modules/thinkwork/main.tf:410` — `activation_workflow_adapter_lambda_arn` module input — is **not touched in U3**. The Step Functions state-machine module still consumes it via `terraform/modules/app/system-workflows-stepfunctions/main.tf:58-70`. Once the Lambda is deleted, the templated ASL still embeds the (now-stale) ARN; the state machine becomes an unreachable dead resource until U5 destroys it. This is by design — terraform doesn't fail because the ASL is just a string template, not a `data` lookup. Verified against the module source.
- `terraform/modules/thinkwork/main.tf:407` — `execution_callback_lambda_arn` module input — **IS** touched in U3 (set to `""`) so the EventBridge `sfn_state_change` rule + target + permission destroy alongside the deleted Lambda. The SW stepfunctions module gates these resources on `count = var.execution_callback_lambda_arn != "" ? 1 : 0` (lines 205-241). Leaving the ARN string non-empty would orphan an armed EventBridge rule pointing at a vanished Lambda → CloudWatch errors on any state-change event for `thinkwork-*-system-*` state machines (which still exist until U5). The variable + locals + ARN construction stay in place for U5 to remove; only the value passed in changes.
- AgentCore activation Python runtime container (`packages/agentcore-activation/agent-container/container-sources/activation_api_client.py`) embeds an HTTP client that POSTs to `/api/activation/{notify,checkpoint,complete}` — those routes 404 after U3. The runtime is expected idle (no GraphQL caller spawns it after U2); RBW1 confirms by checking the runtime's CloudWatch metrics in addition to the 5 Lambdas.

### Deferred to Follow-Up Work

- All deferrals above are tracked in the parent plan's U4–U6 units; this overlay does not introduce new follow-ups.

---

## Context & Research

### Relevant Code and Patterns

- **`scripts/build-lambdas.sh`** — single entry-point script. The 5 SW/Activation handlers appear at exact lines (verified 2026-05-06 against `main`):
  - Line 73 — `BUNDLED_AGENTCORE_ESBUILD_FLAGS` allowlist string includes `"activation-apply-worker"` (must be removed; the activation-apply-worker bundle reached for newer Bedrock SDKs and got the inlined-AWS-SDK treatment).
  - Lines 31 — comment-only mention in the "Bundled handlers (inline AWS SDK)" header comment, also mentions `activation-apply-worker`.
  - Lines 139-140 — `build_handler "activation"` block.
  - Lines 142-143 — `build_handler "activation-workflow-adapter"` block.
  - Lines 145-146 — `build_handler "activation-apply-worker"` block.
  - Lines 297-298 — `build_handler "system-workflow-step-callback"` block.
  - Lines 299-300 — `build_handler "system-workflow-execution-callback"` block.
- **`terraform/modules/app/lambda-api/handlers.tf`** — single `for_each`-driven `aws_lambda_function "handler"` resource (lines 180-301-ish) plus a `local.api_routes` route map. Removing a handler is symmetric: delete the name from the `for_each` set + delete its route entries from `local.api_routes` (lines 555-642 region). The integration, route, and permission resources downstream all `for_each` over `local.api_routes`, so they prune automatically. Verified line numbers (2026-05-06):
  - Line 211 — `"activation",`
  - Line 212 — `"activation-apply-worker",`
  - Line 281 — `"system-workflow-step-callback",`
  - Line 282 — `"system-workflow-execution-callback",`
  - Line 283 — `"activation-workflow-adapter",`
  - Lines 561-568 — Activation REST routes (3 POST + 3 OPTIONS = 6 entries) + comment block "Activation Agent runtime writeback. Shared API_AUTH_SECRET; OPTIONS short-circuits in the handler before auth."
  - Lines 639-642 — SW callback routes (2 POST + 2 OPTIONS = 4 entries).
  - **Note**: `activation-workflow-adapter` and `activation-apply-worker` have NO routes in `local.api_routes` — they're invoked by Step Functions / Lambda-to-Lambda async. Their `aws_lambda_permission "handler_apigw"` entry doesn't exist (the permission is `for_each` over distinct route values; no routes → no permission), so deletion is just the string in the function for_each set.
- **`packages/api/src/lib/system-workflows/`** — 11 source files + 4 test files. No remaining importers in `packages/api/src/{handlers,graphql,lib}/` after U2 (verified at planning time via `grep -rln "system-workflows" packages/api/src/{graphql,lib} | grep -v "lib/system-workflows/"`). The 5 handler files in `packages/api/src/handlers/` that still import are themselves being deleted by U3.

### Institutional Learnings

- `feedback_lambda_zip_build_entry_required.md` — adding a Lambda requires both Terraform `handlers.tf` and `scripts/build-lambdas.sh`. Inverted for this PR: removing a Lambda must touch both files symmetrically — leaving the Terraform but not the build script (or vice versa) blocks future deploys.
- `feedback_diff_against_origin_before_patching.md` — re-fetch + diff parent plan's hand-written line numbers vs current `origin/main` before relying on them. Done at planning time; numbers refreshed above.
- `feedback_ship_inert_pattern.md` (inverted for deletion) — don't delete a library while consumers still import it. Verified at planning time: no remaining importers post-U2 outside `lib/system-workflows/` itself and the 5 handlers being deleted.

### External References

- None.

---

## Key Technical Decisions

- **Single coordinated PR for all 5 handlers + the lib + the stranded ASL build script + Terraform + build-script changes.** Splitting per-handler creates a multi-PR sequence where intermediate states have orphaned route entries or orphaned IAM, and the test/typecheck signal is muddier. The deletion is deterministic and the blast radius is fully contained.
- **No IAM cleanup in U3.** The `lambda_system_workflows_stepfunctions` IAM policy + `lambda_api_cross_invoke` policy stay as-is (the latter never referenced the 5 deleted Lambdas; the former still grants on the still-existing `thinkwork-*-system-*` state machines that U5 will destroy).
- **No `activation_workflow_adapter_lambda_arn` cleanup in U3.** It's a static template variable; leaving it in place lets the SW state-machine module still terraform-apply cleanly with a dead-but-unreachable ARN until U5 deletes the module.
- **DO set `execution_callback_lambda_arn = ""` in U3.** The EventBridge `sfn_state_change` rule + target + permission in `terraform/modules/app/system-workflows-stepfunctions/main.tf:205-241` are count-gated on this variable. Setting the input to `""` in `terraform/modules/thinkwork/main.tf:407` gates count→0 and destroys those three resources symmetrically with the deleted Lambda. Without this, terraform-apply succeeds but the rule stays armed pointing at a vanished Lambda → CloudWatch errors on any SFN state-change event. Asymmetric to the activation_workflow_adapter case because that ARN is embedded in ASL templates only (no live AWS resource targets it directly), while execution_callback_lambda_arn drives a live EventBridge target.
- **Worktree off `origin/main`**, branch `refactor/sw-revert-phase-2-u3`, single squash-merged PR — same shape as U2 (#848).

---

## Open Questions

### Resolve Before Work

- **RBW1**: Confirm Phase 1 deployed to `dev` AND no live invocations of the 5 to-be-deleted Lambdas in the last 24 hours AND no in-flight Step Functions executions on the 3 SW state machines AND the activation AgentCore runtime is idle. Three checks:
  1. **Deploy gate**: `gh run list --workflow=deploy.yml --branch=main --status=success --limit=3` — confirm a successful run timestamped after PR #845 merge (commit `1335f1a9`, 2026-05-06). Absence of a successful post-#845 deploy is a stop-condition (Phase 1 may have rolled back or stalled mid-stage).
  2. **Lambda invocations**: `for h in activation activation-apply-worker activation-workflow-adapter system-workflow-step-callback system-workflow-execution-callback; do aws logs filter-log-events --log-group-name /aws/lambda/thinkwork-dev-api-$h --start-time $(($(date +%s%3N)-86400000)) --max-items 1; done` — each must return empty `events: []`. Loop is required because `aws logs filter-log-events` accepts only a single `--log-group-name`; brace expansion silently checks just the last name.
  3. **SFN executions**: `for sm in wiki-build evaluation-runs tenant-agent-activation; do aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:$ACCOUNT:stateMachine:thinkwork-dev-system-$sm --status-filter RUNNING --max-results 5; done` — empty result is the precondition. Standard SFN executions can run up to 1 year, so 24h Lambda silence is necessary but not sufficient.
  4. **Runtime idle**: `aws bedrock-agentcore list-agent-runtimes` (or stage-specific equivalent); if an activation-named runtime exists, its CloudWatch metrics for the last 24h must show zero invocations. The Python runtime container at `packages/agentcore-activation/agent-container/container-sources/activation_api_client.py` posts to `/api/activation/*` — those routes 404 after merge.
  
  If any check fails, stop and surface to the user before pushing the PR.
- **RBW2**: Confirm `terraform plan` diff is exactly the expected destroy set. Acceptance criteria:
  - 5 `aws_lambda_function.handler` destroys (`activation`, `activation-apply-worker`, `activation-workflow-adapter`, `system-workflow-step-callback`, `system-workflow-execution-callback`).
  - 10 `aws_apigatewayv2_integration.handler` destroys (6 activation REST routes + 4 SW callback routes; `activation-workflow-adapter` and `activation-apply-worker` have zero routes).
  - 10 `aws_apigatewayv2_route.handler` destroys (same set).
  - 3 `aws_lambda_permission.handler_apigw` destroys (one per handler with API Gateway routes: `activation`, `system-workflow-step-callback`, `system-workflow-execution-callback`; the two non-routed Lambdas have no permission resource).
  - 1 `aws_cloudwatch_event_rule.sfn_state_change[0]` + 1 `aws_cloudwatch_event_target.sfn_state_change[0]` + 1 `aws_lambda_permission.sfn_state_change[0]` destroy (count-gated to 0 by the `execution_callback_lambda_arn = ""` change).
  
  Any destroy outside this set blocks the PR. Run `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` from a working `dev` checkout.
- **RBW3**: Verify zero remaining `lib/system-workflows` importers across the **entire repo** (not just `packages/api/src/`) in `main` HEAD just before deletion: `grep -rln "lib/system-workflows\|system-workflows/start\|system-workflows/wiki-build\|system-workflows/evaluation-runs\|system-workflows/activation\|system-workflows/registry\|system-workflows/asl" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.sh" --include="*.yml" . | grep -v node_modules | grep -v "^./.claude/" | grep -v "^./packages/api/src/lib/system-workflows/" | grep -v -E "handlers/(activation-workflow-adapter|activation-apply-worker|activation|system-workflow-step-callback|system-workflow-execution-callback)\.ts" | grep -v "scripts/build-system-workflow-asl.ts"` must return zero matches. (Filters out the lib itself + 5 handlers + the stranded ASL build script being deleted in this PR. Repo-wide scope catches build scripts, CI workflow files, and test mocks the prior `packages/api/src/`-only scope missed.)
- **RBW4**: Verify build-script + Terraform are clean post-edit (not just that `pnpm build:lambdas` succeeded — `build_handler` SKIPs missing entries with exit 0): `! grep -E '"(activation|activation-apply-worker|activation-workflow-adapter|system-workflow-step-callback|system-workflow-execution-callback)"' scripts/build-lambdas.sh terraform/modules/app/lambda-api/handlers.tf` must return zero matches before pushing.

### Resolved During Planning

- **handlers.tf line numbers** — refreshed against `main` at planning time; numbers above replace the parent plan's stale references (211/212/281/282/283 in for_each set; 561-568 + 639-642 in route map).
- **build-lambdas.sh exact entries** — confirmed at lines 31 (comment), 73 (allowlist), 139-146 (3 build_handler blocks for activation/adapter/apply-worker), 297-300 (2 blocks for SW callbacks).
- **No separate per-Lambda permission resources** — confirmed `aws_lambda_permission "handler_apigw"` is `for_each` over `distinct(values(local.api_routes))`; pruning routes prunes permissions.
- **Lambdas with no API routes**: `activation-workflow-adapter` and `activation-apply-worker` — both invoked async (Step Functions / Lambda InvokeFunction). They have no entries in `local.api_routes` and no permission resource. Deletion is just the string in the for_each set + the build-lambdas.sh block.
- **Stranded ASL build script discovered**: `scripts/build-system-workflow-asl.ts` imports from `lib/system-workflows/registry.js` and `asl.js`. Caught by ce-doc-review's adversarial pass; added to deletion list. Repo-root grep for `lib/system-workflows` is now the canonical importer survey (RBW3), replacing the prior `packages/api/src/`-only scope which would have missed this script.
- **EventBridge `sfn_state_change` rule orphaning discovered**: in `terraform/modules/app/system-workflows-stepfunctions/main.tf:205-241`, the rule + target + permission are count-gated on `var.execution_callback_lambda_arn != ""`. The thinkwork module passes a non-empty constructed ARN; deleting the Lambda without zeroing the ARN input would leave the rule armed pointing at a vanished target. Resolved by setting `execution_callback_lambda_arn = ""` in `terraform/modules/thinkwork/main.tf:407` as part of U3's modify list.
- **Build-script silent-skip behavior**: `build_handler` in `scripts/build-lambdas.sh:67-69` prints `SKIP` and returns 0 when an entry path is missing. So `pnpm build:lambdas` success doesn't prove the script is clean of stale entries. Added RBW4 explicit grep verification.
- **Deploy pipeline scope**: confirmed `.github/workflows/deploy.yml` hardcodes `STAGE: dev`; there is no auto-staging/prod chain. Operational notes corrected.
- **Test deletion math**: 6 test files total (4 lib + 2 handler), not "~7" as initially estimated.

### Deferred to Implementation

- The exact `terraform plan` output against the engineer's local stack — `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` from a working `dev` checkout. Acceptance lives in RBW2.
- Whether the 5 handler files have test pairs (4 confirmed at planning time: `activation-workflow-adapter.test.ts` + `system-workflow-execution-callback.test.ts` definitely exist; `activation-apply-worker.ts`, `activation.ts`, `system-workflow-step-callback.ts` may or may not have `.test.ts` siblings — `git rm` with explicit paths handles both states gracefully).

---

## Implementation Units

- U1. **Delete System Workflows library + 5 Lambda handlers + tests + build-script + Terraform entries**

**Goal:** Single coordinated PR that removes all in-tree code and infrastructure-as-code references to the 5 SW/Activation Lambdas and the `lib/system-workflows/` library.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U2 of parent plan (PR #848, merged); Phase 1 of revert (PR #845, merged + deployed to dev — confirmed via RBW1 before opening this PR).

**Files:**
- Delete (entire directory):
  - `packages/api/src/lib/system-workflows/` — `activation.ts`, `activation.test.ts`, `asl.ts`, `evaluation-runs.ts`, `events.ts`, `evidence.ts`, `export-asl.ts`, `registry.ts`, `registry.test.ts`, `start.ts`, `start.test.ts`, `types.ts`, `validation.ts`, `wiki-build.ts`, `wiki-build.test.ts` (15 files total — 11 source + 4 test).
- Delete (stranded build script that imports the lib):
  - `scripts/build-system-workflow-asl.ts` — imports `listSystemWorkflowDefinitions` from `lib/system-workflows/registry.js` and `buildSystemWorkflowAsl` from `lib/system-workflows/asl.js`. Stranded after lib deletion. Not invoked from any `package.json` script and not under tsconfig coverage, so `pnpm typecheck` would not catch this — must be deleted explicitly.
- Delete (handlers + their tests where present, verified at planning time):
  - `packages/api/src/handlers/activation-workflow-adapter.ts` + `activation-workflow-adapter.test.ts`
  - `packages/api/src/handlers/activation-apply-worker.ts` (no test sibling on `main`)
  - `packages/api/src/handlers/activation.ts` (no test sibling on `main`)
  - `packages/api/src/handlers/system-workflow-step-callback.ts` (no test sibling on `main`)
  - `packages/api/src/handlers/system-workflow-execution-callback.ts` + `system-workflow-execution-callback.test.ts`
- Modify:
  - `scripts/build-lambdas.sh` — remove 5 `build_handler` blocks (lines 139-146 for activation/adapter/apply-worker, 297-300 for SW callbacks), `BUNDLED_AGENTCORE_ESBUILD_FLAGS` allowlist entry for `activation-apply-worker` (line 73), and the comment header mention (line 31).
  - `terraform/modules/app/lambda-api/handlers.tf` — remove 5 strings from the `aws_lambda_function "handler"` for_each set (lines 211, 212, 281, 282, 283) and 10 entries from `local.api_routes` (lines 561-568 + 639-642), including their comment blocks.
  - `terraform/modules/thinkwork/main.tf` — change line 407 from `execution_callback_lambda_arn = "arn:aws:lambda:..."` to `execution_callback_lambda_arn = ""` (count-gates the EventBridge rule + target + permission to 0 so they destroy alongside the deleted Lambda). The variable + locals + ARN construction in `terraform/modules/app/system-workflows-stepfunctions/main.tf:38-50` stay in place; only the value changes here.
- Test:
  - No new test files. Existing test impact: 6 test files deleted total — 4 in `lib/system-workflows/` (`activation.test.ts`, `registry.test.ts`, `start.test.ts`, `wiki-build.test.ts`) + 2 handler-level (`activation-workflow-adapter.test.ts`, `system-workflow-execution-callback.test.ts`).

**Approach:**
- **Pre-flight (RBW1)**: confirm Phase 1 deployed to `dev` and no live Lambda invocations in 24h via CloudWatch.
- **Worktree**: `git worktree add .claude/worktrees/sw-revert-phase-2-u3 -b refactor/sw-revert-phase-2-u3 origin/main`.
- **Bootstrap**: `pnpm install`, kill stale tsbuildinfos, `pnpm --filter @thinkwork/database-pg build` (per `feedback_worktree_tsbuildinfo_bootstrap`).
- **Delete**: `git rm -r packages/api/src/lib/system-workflows`, then `git rm` each of the 5 handlers + their `.test.ts` siblings (use shell glob or explicit list — `git rm` is idempotent on missing paths only with `--ignore-unmatch`; safer to list each pair explicitly).
- **Edit**: `scripts/build-lambdas.sh` — remove the comment mention, allowlist entry, and 5 `build_handler` blocks. `terraform/modules/app/lambda-api/handlers.tf` — remove 5 lines from the function for_each set and the 10 route map entries with their comment blocks.
- **Verify (TS)**: `pnpm -r --if-present typecheck` — must pass cleanly. Any dangling import surfaces here.
- **Verify (build)**: `pnpm build:lambdas` (or `bash scripts/build-lambdas.sh`) — must complete with no missing-entry-point errors. (CI runs this implicitly via the verify job; running locally before push catches drift earlier.)
- **Verify (tests)**: `pnpm -r --if-present test` — must pass. Some test files in `packages/api/src/lib/system-workflows/` and the handler tests will be deleted; new test count = previous count − ~7.
- **Verify (terraform — RBW2)**: from a working `dev` checkout, `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` and confirm the destroy set matches the acceptance criteria above. If extra destroys appear, abort and re-investigate.
- **Format**: `pnpm exec prettier --check` on changed files (per learning `feedback_format_check_via_pnpm_exec` from prior PRs).
- **Commit + push + open PR** against `main` per `feedback_pr_target_main`. Engineers blocked → merge as CI passes (`feedback_merge_prs_as_ci_passes`).

**Patterns to follow:**
- Worktree isolation: `feedback_worktree_isolation` + `feedback_cleanup_worktrees_when_done`.
- Symmetric Terraform + build-script cleanup per `feedback_lambda_zip_build_entry_required` (inverted for deletion).
- `feedback_diff_against_origin_before_patching` — line numbers re-verified at planning time; if main shifts before merge, re-verify before applying.

**Test scenarios:**
- *Happy path:* `pnpm -r --if-present typecheck` exits 0 with no dangling `import` errors against `lib/system-workflows/*` or the 5 deleted handler paths.
- *Happy path:* `pnpm -r --if-present test` exits 0 — new total = previous − 6 deleted test files; the remaining ~2074 tests in `packages/api` continue to pass.
- *Happy path:* `pnpm build:lambdas` exits 0 — esbuild bundles every remaining handler in `scripts/build-lambdas.sh` without "missing entry point" errors. **Note:** `build_handler` SKIPs missing entries with exit 0 (silent), so success here doesn't prove build-script cleanliness — the `RBW4` grep is the actual safety net.
- *Integration:* `terraform plan` shows exactly: 5 `aws_lambda_function.handler` destroys, 10 `aws_apigatewayv2_integration.handler` + 10 `aws_apigatewayv2_route.handler` destroys, 3 `aws_lambda_permission.handler_apigw` destroys, and 1 each of `aws_cloudwatch_event_rule.sfn_state_change[0]` + `aws_cloudwatch_event_target.sfn_state_change[0]` + `aws_lambda_permission.sfn_state_change[0]`. No other resource changes.
- *Edge case:* `grep -rln "lib/system-workflows" --include="*.ts" --include="*.sh" .` from repo root, filtered for the lib + 5 handlers + the deleted ASL builder, returns zero matches post-deletion.
- *Edge case:* `grep -rln "activation-workflow-adapter|activation-apply-worker|system-workflow-step-callback|system-workflow-execution-callback" packages/api/src --include="*.ts"` returns zero matches.
- *Integration:* Wiki Build and Eval Run continue to work end-to-end on `dev` post-merge — they were on direct Lambda after Phase 1; this unit doesn't touch them, but the smoke confirms no IAM regression. (Verified manually post-deploy, not in CI.)

**Verification:**
- All CI checks (cla, lint, verify, test, typecheck) green on the PR.
- `pnpm exec prettier --check` clean on changed files.
- Local `terraform plan` matches RBW2 acceptance set.
- Post-merge to `dev`: trigger `compileWikiNow` mutation + `startEvalRun` mutation via GraphQL; both succeed within p99 latency budget; no CloudWatch log entries reference the deleted handlers in the next 24h.

---

## System-Wide Impact

- **Interaction graph:** Step Functions state machines `thinkwork-*-system-{wiki-build,evaluation-runs,tenant-agent-activation}` continue to exist (U5 deletes them), but the state machine bound to `activation-workflow-adapter` becomes unreachable (its target Lambda is gone). Since U2 deleted all callers of `startSystemWorkflow`, no caller invokes any state machine after U2 merges. This PR makes that already-dead behavior more obvious.
- **Error propagation:** None to user-facing paths. The 5 deleted Lambdas had no traffic post-U2 (RBW1 confirms).
- **State lifecycle risks:** None — pure deletion. The Activation Postgres tables (`activation_sessions`, `activation_session_turns`, `activation_apply_outbox`, `activation_automation_candidates`) remain intact for U6's data migration; this PR does not touch them.
- **API surface parity:** None — U2 already removed the GraphQL surface. The Activation REST routes (`/api/activation/*`) and SW callback routes (`/api/system-workflows/*`) get 404s post-merge. No documented client uses them; admin SPA + mobile already had the surfaces removed in U2.
- **Integration coverage:** Wiki Build + Eval Run end-to-end smoke on `dev` post-merge confirms no orthogonal breakage.
- **Unchanged invariants:** `lambda_api_cross_invoke` policy stays — eval-runner + wiki-compile + routine-resume IAM grants for graphql-http unaffected. `lambda_system_workflows_stepfunctions` policy stays (cleaned up in U5).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Phase 1 not yet deployed to `dev` when U3 PR opens — rare since #845 merged 2026-05-06 morning, but the merge pipeline runtime is finite, and a partial-failed deploy looks identical to a successfully-quiet stage | RBW1 deploy-gate check (gh run list filtered for success after #845) + 24h Lambda invocation check + SFN running-execution check + activation runtime idle check. Multi-signal precondition. |
| Terraform plan shows unexpected destroys (e.g., a state machine, an IAM policy, the cross-invoke grant) | RBW2 — explicit acceptance set. If diff doesn't match, abort PR and re-investigate. |
| Stale `lib/system-workflows` importer slipped through U2 — would surface as typecheck error after lib deletion (or as a stranded broken script outside tsconfig coverage like `scripts/build-system-workflow-asl.ts`) | RBW3 — pre-flight grep at REPO ROOT (not just `packages/api/src/`) catches build scripts, CI workflow files, and test mocks. Stranded ASL builder caught at planning time and added to deletion list. The fall-through for normal-tsconfig importers is `pnpm typecheck` itself. |
| EventBridge `sfn_state_change` rule survives U3 with target ARN pointing at deleted Lambda → CloudWatch errors on any SFN state-change event until U5 destroys the module | Set `execution_callback_lambda_arn = ""` in `terraform/modules/thinkwork/main.tf:407` to count-gate the rule + target + permission to 0; they destroy alongside the Lambda symmetrically. RBW2 verifies the destroys appear in `terraform plan`. |
| `BUNDLED_AGENTCORE_ESBUILD_FLAGS` allowlist entry for `activation-apply-worker` left behind — `build_handler` SKIPs missing entries with exit 0 (silent), so build script success does not catch this | RBW4 explicit grep verification on `scripts/build-lambdas.sh` + `terraform/modules/app/lambda-api/handlers.tf` for any of the 5 deleted handler names; must return zero matches before push. |
| In-flight SFN executions on `tenant-agent-activation` (STANDARD type, can run up to 1 year) hit the deleted `activation-workflow-adapter` Lambda mid-execution → ResourceNotFoundException | RBW1.3 — `aws stepfunctions list-executions --status-filter RUNNING` per state machine; empty result is the precondition. 24h Lambda silence is necessary but not sufficient for STANDARD SFN. |

---

## Documentation / Operational Notes

- No user-facing docs touched.
- Operational impact: 5 Lambda functions + 1 EventBridge rule + target + permission disappear from `dev`. The deploy workflow (`.github/workflows/deploy.yml`) is currently hardcoded to `STAGE: dev` — there is no automatic staging/prod chain on merge. Future stages will need a separate per-stage deploy. No alerts to disable; no schedules to migrate.
- Memory file `project_system_workflows_revert_compliance_reframe.md` should be updated post-merge to reflect U3 SHIPPED.

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md](docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md), specifically lines 295-340 (U3 unit).
- **Brainstorm:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md)
- **Predecessor PRs:** #845 (Phase 1), #846 (Phase 2 U1), #848 (Phase 2 U2)
- **Memory:** `project_system_workflows_revert_compliance_reframe.md`
- **Institutional learnings cited:**
  - `feedback_lambda_zip_build_entry_required.md`
  - `feedback_diff_against_origin_before_patching.md`
  - `feedback_ship_inert_pattern.md` (inverted)
  - `feedback_worktree_isolation.md`
  - `feedback_pr_target_main.md`
  - `feedback_merge_prs_as_ci_passes.md`
