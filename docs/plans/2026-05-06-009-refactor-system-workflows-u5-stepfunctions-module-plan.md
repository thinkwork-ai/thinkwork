---
title: "Phase 2 U5: Destroy System Workflows Step Functions module + IAM"
type: refactor
status: active
date: 2026-05-06
origin: docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md
---

# Phase 2 U5: Destroy System Workflows Step Functions module + IAM

## Summary

Phase 2 U5 of the System Workflows revert. Delete the entire `terraform/modules/app/system-workflows-stepfunctions/` module (3 state machines, IAM execution role, S3 output bucket, log group), remove the matching `lambda_system_workflows_stepfunctions` IAM policy from the `lambda-api` module, and remove the module call from `thinkwork`. This is the highest-blast-radius unit of Phase 2 — first real terraform destroy of stateful AWS resources rather than just function/code teardown.

---

## Problem Frame

Parent plan establishes the full motivation (System Workflows → Compliance reframe). Briefly: U2/U3/U4 removed all callers of the SW state machines; this unit destroys the state machines + their backing AWS infrastructure. After this lands, only the Postgres schema (`packages/database-pg/src/schema/{system-workflows,activation}.ts` + migrations 0059/0060 + the actual tables in dev) remains for U6.

See origin: `docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md` lines 387-450.

---

## Requirements

- R1. Carry forward parent R3/R4 (Activation feature removed at the orchestration layer; multi-step infrastructure destroyed).
- R2. `terraform plan` against `dev` shows the expected destroy set (see RBW2 acceptance criteria) and zero unexpected destroys.
- R3. `pnpm typecheck` and `pnpm test` stay green (no TS imports referenced the SW module — verified at planning time).
- R4. The `tenant-agent-activation` ASL still embeds the `activation_workflow_adapter_lambda_arn` (passed in by `terraform/modules/thinkwork/main.tf:440`) but the entire state machine destroys with the module, so the dead ARN reference goes with it.
- R5. After this PR's deploy, `aws stepfunctions list-state-machines` returns zero `thinkwork-${stage}-system-*` machines, `aws s3api head-bucket --bucket thinkwork-${stage}-system-workflow-output` returns 404, and `aws iam get-role --role-name thinkwork-${stage}-system-workflows-execution-role` returns NoSuchEntity.

---

## Scope Boundaries

- Postgres schema (`packages/database-pg/src/schema/{system-workflows,activation}.ts` + migrations 0059/0060) → U6.
- Activation tables in dev (`activation_sessions`, `activation_session_turns`, `activation_apply_outbox`, `activation_automation_candidates`) + SW tables (`system_workflow_definitions`, `_configs`, `_extension_bindings`, `_runs`, `_step_events`, `_evidence`, `_change_events`) — all 11 tables remain in Postgres until U6 ships the forward-drop migration.
- Multi-stage rollout (staging/prod) — N/A. `.github/workflows/deploy.yml` hardcodes `STAGE=dev`; no auto-staging chain. If staging/prod ever exists, U5 needs per-stage terraform apply, but that's deferred operational work.
- AgentCore activation runtime + ECR repo → already done (U4, both empty in dev pre-U5).

### Deferred to Follow-Up Work

- Anything not explicitly listed above is in-scope. U5 is a single-PR terraform destroy.

---

## Context & Research

### Relevant Code and Patterns

- **Module resources to destroy** (from `terraform/modules/app/system-workflows-stepfunctions/main.tf`):
  - 3x `aws_sfn_state_machine.standard["wiki-build"|"evaluation-runs"|"tenant-agent-activation"]` (line 182 — for_each over `local.standard_state_machines`)
  - 1x `aws_cloudwatch_log_group.system_workflows` (line 94)
  - 1x `aws_s3_bucket.system_workflow_output` (line 105) — empty in dev (Total Objects: 0 verified at planning time), no `force_destroy`, no `lifecycle.prevent_destroy`
  - 1x `aws_iam_role.system_workflows_execution` (line 115)
  - 1x `aws_iam_role_policy.system_workflows_execution` (line 138)
  - **No EventBridge resources to destroy** — U3 already gated `aws_cloudwatch_event_rule.sfn_state_change` + `aws_cloudwatch_event_target.sfn_state_change` + `aws_lambda_permission.sfn_state_change` (lines 205-241) to count=0 by setting `var.execution_callback_lambda_arn = ""` in the thinkwork module call. They were destroyed in the U3 deploy.
- **Caller in `terraform/modules/thinkwork/main.tf`**: `module "system_workflows_stepfunctions"` block at lines 418-441 — sole caller of the SW module. `module.system_workflows_stepfunctions.*` outputs have ZERO consumers elsewhere in `terraform/` (verified at planning time via repo-wide grep).
- **IAM policy in `terraform/modules/app/lambda-api/main.tf`**: `aws_iam_role_policy.lambda_system_workflows_stepfunctions` at lines 643-665. Grants `states:StartExecution|DescribeExecution|GetExecutionHistory` on `arn:aws:states:${region}:${account}:stateMachine:thinkwork-${stage}-system-*`. After U2 deleted `startSystemWorkflow`, no caller exercises this grant. Once the state machines themselves are destroyed in U5, the grant becomes a permission on a non-existent resource. Removing the policy in the same PR keeps the IAM surface aligned with reality.
- **Tracked files in `terraform/modules/app/system-workflows-stepfunctions/`** (verified via `git ls-files`):
  - `main.tf`
  - `asl/evaluation-runs-standard.asl.json`
  - `asl/tenant-agent-activation-standard.asl.json`
  - `asl/wiki-build-standard.asl.json`
  - Local `.terraform/` working directory (~767M) is gitignored — not in the deletion set.

### Institutional Learnings

- `feedback_lambda_zip_build_entry_required.md` (inverted for deletion): symmetric Terraform + build-script cleanup. U5 has no build-script side; this is pure terraform.
- `feedback_diff_against_origin_before_patching.md`: line numbers re-verified at planning time vs current `main` (lambda-api/main.tf shifted from 637-659 in parent plan to 643-665 due to intervening merges).
- `feedback_worktree_isolation.md` + `feedback_cleanup_worktrees_when_done.md`: same pattern as U2/U3/U4.
- `feedback_merge_prs_as_ci_passes.md`: engineers blocked → squash-merge as CI green.
- Parent plan's adversarial review found that prior deploy interleaves are sequential, not concurrent — terraform-state-lock contention is not a real risk on this repo.

### External References

- AWS docs on Step Functions state-machine deletion: deleting a state machine with running executions cancels them. RUNNING count is 0 (verified at planning time + RBW1.1 will re-verify).
- AWS S3 bucket deletion requires the bucket be empty unless `force_destroy=true`. Bucket is empty (verified) and has no `force_destroy` setting; terraform destroy will succeed.

---

## Key Technical Decisions

- **Single coordinated PR** for the module deletion + IAM policy removal + module-call removal. Splitting into two PRs creates an intermediate state where either:
  - The state machines exist with no caller (already true post-U2; harmless) but the IAM policy still grants on them — fine but wasteful.
  - The IAM policy is removed but the state machines still exist — also fine but wasteful.
  - Either order works; the single-PR approach is the cleanest terraform diff.
- **Delete the entire module directory** rather than emptying main.tf and leaving the directory. Saves a follow-up cleanup. The `.terraform/` working dir is gitignored and untouched.
- **Do not use `terraform state rm` to orphan resources first** — the deploy pipeline runs `terraform apply` which will issue the destroy commands. Manual state surgery is a fallback if the apply fails, not the primary path.
- **Empty S3 bucket before terraform destroy?** Already empty per pre-flight. Plan does NOT add a manual `aws s3 rm --recursive` step because there's nothing to remove. If RBW1.2 finds the bucket non-empty at impl time, the operator runs the manual empty before push.
- **Worktree off `origin/main`**, branch `refactor/sw-revert-phase-2-u5`, single squash-merged PR — same shape as U2/U3/U4.

---

## Open Questions

### Resolve Before Work

- **RBW1**: Re-confirm AWS state immediately before push:
  1. **0 RUNNING executions across all 3 state machines** — `for sm in wiki-build evaluation-runs tenant-agent-activation; do aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:$ACCOUNT:stateMachine:thinkwork-dev-system-$sm --status-filter RUNNING --max-results 5 --query 'length(executions)' --output text; done` — each must return 0. AWS will cancel running executions on state-machine destroy, but a non-zero count is a stop signal: investigate before destroying live work.
  2. **S3 output bucket empty** — `aws s3 ls s3://thinkwork-dev-system-workflow-output --recursive --summarize | tail -3` — Total Objects must be 0. If non-empty, run `aws s3 rm s3://thinkwork-dev-system-workflow-output --recursive` before push (no `force_destroy` set).
  3. **Latest deploy succeeded** — `gh run list --workflow=deploy.yml --branch=main --status=success --limit=3` — most recent successful run timestamp must be after PR #855 (U4) merge to confirm prior phases applied cleanly.
- **RBW2**: `terraform plan` acceptance set. Run from a working `dev` checkout: `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` and confirm the destroy diff exactly matches:
  - 3x `module.system_workflows_stepfunctions.aws_sfn_state_machine.standard["wiki-build"]` / `["evaluation-runs"]` / `["tenant-agent-activation"]`
  - 1x `module.system_workflows_stepfunctions.aws_cloudwatch_log_group.system_workflows`
  - 1x `module.system_workflows_stepfunctions.aws_s3_bucket.system_workflow_output`
  - 1x `module.system_workflows_stepfunctions.aws_iam_role.system_workflows_execution`
  - 1x `module.system_workflows_stepfunctions.aws_iam_role_policy.system_workflows_execution`
  - 1x `module.lambda_api.aws_iam_role_policy.lambda_system_workflows_stepfunctions`
  - **Total: 8 destroys, 0 creates, 0 changes outside the destroy set.**
  
  EventBridge resources (`aws_cloudwatch_event_rule.sfn_state_change`, target, permission) should NOT appear in the plan — they were already destroyed by U3's `count=0` gate. Any additional destroys outside the 8 listed = stop and investigate.
- **RBW3**: Verify zero remaining importers / references:
  - `grep -rln "system-workflows-stepfunctions\|system_workflows_stepfunctions\|lambda_system_workflows_stepfunctions" terraform/ packages/ apps/ scripts/ .github/ --include="*.tf" --include="*.ts" --include="*.tsx" --include="*.sh" --include="*.yml"` — must return zero matches outside `terraform/modules/app/system-workflows-stepfunctions/` itself + the lambda-api/main.tf and thinkwork/main.tf lines being modified in this PR.
  - `grep -rln "thinkwork-.*-system-\(wiki-build\|evaluation-runs\|tenant-agent-activation\)" terraform/ packages/` — must return zero matches outside the SW module ASL templates being deleted.

### Resolved During Planning

- **lambda-api/main.tf line numbers refreshed**: `aws_iam_role_policy.lambda_system_workflows_stepfunctions` is at lines 643-665 on current `main` (parent plan said 637-659 — 5-line shift due to intervening merges).
- **thinkwork/main.tf module call**: lines 418-441. Block includes a code comment about U3's `execution_callback_lambda_arn = ""` rationale; the entire block goes.
- **No external module-output consumers**: `grep -rE "module\.system_workflows_stepfunctions|standard_state_machine_arns" terraform/` returns zero matches. The module's outputs are unused.
- **No graphql-http env-var dependency**: `grep -rE "system_workflow|SystemWorkflow|SW_STATE_MACHINE_ARN" terraform/modules/app/lambda-api/` returns zero matches in the env-var block. The launcher-env concern from the parent plan was a planning-time hypothetical that didn't materialize.
- **S3 bucket destroyability**: empty + no `force_destroy` + no `lifecycle.prevent_destroy` → plain terraform destroy succeeds.
- **IAM role destroyability**: only one inline policy (`system_workflows_execution`); will destroy alongside role.

### Deferred to Implementation

- Exact `terraform plan` output against the engineer's local `dev` state. RBW2 enumerates the acceptance set; the actual diff is generated at execution time.

---

## Implementation Units

- U1. **Destroy SW Step Functions module + IAM policy + thinkwork module call**

**Goal:** Single-PR terraform destroy of the SW Step Functions module and all references to it.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** U2/U3/U4 of parent plan (PRs #848, #851+#853, #855+#857) — all merged + deployed to dev.

**Files:**
- Delete (entire directory):
  - `terraform/modules/app/system-workflows-stepfunctions/main.tf`
  - `terraform/modules/app/system-workflows-stepfunctions/asl/evaluation-runs-standard.asl.json`
  - `terraform/modules/app/system-workflows-stepfunctions/asl/tenant-agent-activation-standard.asl.json`
  - `terraform/modules/app/system-workflows-stepfunctions/asl/wiki-build-standard.asl.json`
- Modify:
  - `terraform/modules/app/lambda-api/main.tf` — remove `aws_iam_role_policy.lambda_system_workflows_stepfunctions` block at lines 643-665.
  - `terraform/modules/thinkwork/main.tf` — remove `module "system_workflows_stepfunctions"` block at lines 418-441 (including the U3-rationale code comment).
- No test files. CI's `verify` + `terraform plan` jobs are the regression gate.

**Approach:**
- **Pre-flight (RBW1)**: 4 checks — 0 RUNNING SFN executions, S3 bucket empty, latest deploy succeeded, repo-wide importer survey clean.
- **Worktree**: `git worktree add .claude/worktrees/sw-revert-phase-2-u5 -b refactor/sw-revert-phase-2-u5 origin/main`.
- **Bootstrap**: `pnpm install`, kill stale tsbuildinfos, `pnpm --filter @thinkwork/database-pg build` (per `feedback_worktree_tsbuildinfo_bootstrap`).
- **Delete + edit**:
  1. `git rm -r terraform/modules/app/system-workflows-stepfunctions/` (4 tracked files; gitignored `.terraform/` is untouched).
  2. Edit `terraform/modules/app/lambda-api/main.tf` to remove the IAM policy block at 643-665.
  3. Edit `terraform/modules/thinkwork/main.tf` to remove the `module "system_workflows_stepfunctions"` block at 418-441.
- **Local terraform validation** (optional, requires terraform CLI + tfvars):
  - `terraform -chdir=terraform/examples/greenfield init` — should succeed without referencing the deleted module.
  - `terraform -chdir=terraform/examples/greenfield validate` — should pass.
  - `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` — should produce the 8-destroy diff per RBW2.
- **Verify (TS)**: `pnpm -r --if-present typecheck` — clean (no TS code references the module).
- **Verify (tests)**: `pnpm -r --if-present test` — clean (no test depends on the module).
- **Format**: `pnpm exec prettier --check` on changed files (the plan doc + any TS — none in this PR).
- **Commit + push + open PR** against `main`. Engineers blocked → squash-merge as CI green.
- **Post-merge**: deploy pipeline applies the destroy. Verify dev state via the R5 commands.

**Patterns to follow:**
- Worktree isolation: `feedback_worktree_isolation` + `feedback_cleanup_worktrees_when_done`.
- Symmetric multi-file edit (delete dir + remove caller + remove IAM policy) in one PR.
- `feedback_diff_against_origin_before_patching` — line numbers refreshed at planning time; if `main` shifts before merge, re-verify before applying.

**Test scenarios:**
- *Test expectation: none for code paths — pure terraform destroy. CI's `verify` job + the deploy pipeline's `terraform plan` are the regression gates.*
- *Integration:* Post-merge, run R5 verification commands per stage:
  - `aws stepfunctions list-state-machines --query "stateMachines[?contains(name, 'thinkwork-dev-system')].name"` → empty
  - `aws s3api head-bucket --bucket thinkwork-dev-system-workflow-output` → NoSuchBucket
  - `aws iam get-role --role-name thinkwork-dev-system-workflows-execution-role` → NoSuchEntity
  - `aws logs describe-log-groups --log-group-name-prefix /aws/vendedlogs/states/thinkwork-dev-system-workflows --query 'logGroups[].logGroupName'` → empty

**Verification:**
- All CI checks (cla, lint, verify, test, typecheck) green on the PR.
- `pnpm exec prettier --check` clean.
- Deploy pipeline post-merge: terraform plan diff matches RBW2's 8-destroy acceptance set.
- R5 post-deploy verification: all 4 commands return the expected empty/404 results.

---

## System-Wide Impact

- **Interaction graph:** Step Functions executions can no longer be started against `thinkwork-${stage}-system-*` ARNs (they don't exist). No caller exercises this path after U2 — confirmed by zero remaining `startSystemWorkflow` references.
- **Error propagation:** Any caller that hard-coded the SW state-machine ARNs would get `StateMachineDoesNotExist` from AWS. RBW3 confirms zero such hard-coded references.
- **State lifecycle risks:** None. Empty S3 bucket destroys cleanly. IAM role + inline policy destroy together. No resources have `prevent_destroy` set.
- **API surface parity:** None — U2 already removed the user-facing GraphQL surface.
- **Integration coverage:** Post-deploy R5 verification is the cross-layer test: confirms the destroys actually applied at the AWS layer, not just in terraform state.
- **Unchanged invariants:** Routines Step Functions module (`terraform/modules/app/routines-stepfunctions/`) is untouched and continues to function. The `lambda_api_cross_invoke` IAM policy stays — it doesn't reference SW resources. The `routines_stepfunctions` IAM policy at `lambda-api/main.tf:535+` is unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Concurrent in-flight deploy locks terraform state during apply | RBW1.3 confirms most recent deploy succeeded; absence of an in-flight deploy is verifiable via `gh run list --workflow=deploy.yml --status=in_progress`. If one is mid-flight, wait for it to finish before pushing. |
| RUNNING SFN executions cancelled mid-flight cause downstream errors | RBW1.1 confirms 0 RUNNING. If anything is RUNNING, abort and investigate (parent plan U2 should have severed all callers). |
| S3 bucket non-empty blocks terraform destroy | RBW1.2 confirms empty. If non-empty, manual `aws s3 rm --recursive` before push. |
| `terraform plan` shows unexpected destroys (e.g., a Routines resource, an unrelated IAM policy) | RBW2 explicit 8-destroy acceptance set. Any deviation = abort and investigate. |
| Stale module-output consumer slipped through repo-wide grep | RBW3 grep covers `terraform/`, `packages/`, `apps/`, `scripts/`, `.github/`. The fall-through is `terraform validate` failing post-edit if a hidden consumer exists. |
| `tenant-agent-activation` ASL still embeds the (deleted in U3) `activation-workflow-adapter` Lambda ARN | The state machine destroys with the module — the dead-ARN reference goes with it. No additional cleanup needed. |
| IAM role has orphan attached managed policies blocking role destroy | Module only declares one inline policy (`system_workflows_execution`); no managed policies attached. If terraform destroy reports `DeleteConflict`, manually `aws iam list-attached-role-policies --role-name thinkwork-dev-system-workflows-execution-role` and detach before retrying. |

---

## Documentation / Operational Notes

- No user-facing docs touched.
- Operational impact: 8 AWS resources destroyed in dev. Empty S3 bucket → bucket gone. Non-empty CloudWatch log group → log group gone (logs retained per retention policy until expiry, then deleted; if logs are needed for compliance evidence, archive them before merge — but per parent brainstorm, this entire arc is being replaced by Compliance log in Phase 3).
- Memory file `project_system_workflows_revert_compliance_reframe.md` should be updated post-merge to reflect U5 SHIPPED.
- The deploy workflow (`.github/workflows/deploy.yml`) is hardcoded `STAGE: dev`; only dev gets these destroys. Per-stage rollout for staging/prod (if/when they exist) is operational follow-up.

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md](docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md), specifically lines 387-450 (U5 unit).
- **Brainstorm:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md)
- **Predecessor PRs:** #845 (Phase 1), #846 (Phase 2 U1), #848 (Phase 2 U2), #851 + #853 (Phase 2 U3), #855 + #857 (Phase 2 U4).
- **Memory:** `project_system_workflows_revert_compliance_reframe.md`
