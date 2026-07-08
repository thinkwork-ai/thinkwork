---
title: "Merged terraform IAM grant silently never applied — every deploy reported success"
module: .github/workflows/deploy.yml, terraform/modules/app (grouped API IAM policies)
date: 2026-07-04
category: integration-issues
problem_type: integration_issue
component: development_workflow
severity: high
symptoms:
  - "graphql-http Lambda threw AccessDeniedException — not authorized to perform lambda:InvokeFunction on thinkwork-dev-api-canvas-refresh — 3+ hours after the grant merged to main (#3326 at 16:01 UTC)"
  - "Every subsequent Terraform Apply job on main reported success while the merged IAM grant remained unapplied to the live policy"
  - "The deploy run for the terraform-carrying merge was cancelled by workflow concurrency when the next merge landed"
  - "Follow-on deploys touched no terraform/** files, so the targeted-apply recovery path ran with TF_TARGET_ARGS covering api_data_plane but not api_orchestration, api_ai, or api_observability"
  - "Failure surfaced only during the THINK-145 U11 live acceptance demo, not from any CI or deploy signal"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - tooling
tags:
  - terraform
  - iam
  - deploy-pipeline
  - targeted-apply
  - github-actions-concurrency
  - silent-failure
  - lambda-invoke-permission
  - infra-drift
---

# Merged terraform IAM grant silently never applied — every deploy reported success

## Problem

A terraform IAM grant merged to main (#3326) was never applied to the live dev stack for 3+ hours, while every Deploy workflow run reported success. It surfaced during the THINK-145 U11 demo as `AccessDeniedException: User arn:...:assumed-role/thinkwork-dev-api-lambda-role/thinkwork-dev-api-graphql-http is not authorized to perform: lambda:InvokeFunction on ...function:thinkwork-dev-api-canvas-refresh` when the `refreshCanvasData` mutation ran.

## Symptoms

- GraphQL mutation returns `INTERNAL_SERVER_ERROR: Unexpected error.` (generic, no detail to the client).
- CloudWatch on `/aws/lambda/thinkwork-dev-api-graphql-http` shows the exact `AccessDeniedException` for `lambda:InvokeFunction` on `thinkwork-dev-api-canvas-refresh`.
- The grant IS present in `terraform/modules/app/lambda-api/iam-grouped.tf` on `origin/main` (merged in #3326).
- `gh run list --workflow Deploy` shows recent Terraform Apply jobs all green — nothing looks broken from the CI side.

## Investigation That Worked (order matters)

1. Reproduce live: curl the mutation as a real user → generic `INTERNAL_SERVER_ERROR`.
2. CloudWatch filter on the API lambda log group for the mutation name → the exact `AccessDeniedException`.
3. Compare DECLARED vs LIVE: `git show origin/main:terraform/.../iam-grouped.tf` vs `aws iam get-policy-version` on the attached managed policy — the live invoke list was exactly one entry behind (missing only canvas-refresh).
4. Check deploy history: `gh api repos/.../actions/workflows/deploy.yml/runs` — the deploy runs for BOTH terraform-carrying merges (#3326, #3330) were CANCELLED by workflow concurrency when the next merge landed.
5. Read deploy.yml's Terraform Apply step: when `detect-changes` reports no `terraform/**` changes, it applies with `-target` flags covering ONLY `module.thinkwork.module.api.aws_iam_policy.api_data_plane`, `aws_lambda_function.handler`, and `cognito custom_auth` — the other three grouped IAM policies (`api_orchestration` — where the grant lived — `api_ai`, `api_observability`) were not in the recovery list.

## What Didn't Work

- **Assuming Terraform Apply success meant the declaration was applied.** Targeted applies exclude most resources; a green Apply job says nothing about whether a given merged resource was converged.
- **Suspecting IAM propagation delay.** Adding the missing permission was NOT a propagation issue — a retry after ~60s of "propagation" succeeded only AFTER the policy was actually updated. The permission was never live in the first place.

## Solution

**Root cause:** Deploy concurrency cancels superseded runs, so a merge that changes terraform can have its FULL apply cancelled by the very next merge. If that next merge touches no terraform files, the only apply that ever runs is the targeted recovery apply — and its target list silently excluded 3 of the 4 grouped API IAM policies. Merged infra declarations can therefore sit unapplied indefinitely while every deploy is green.

**Fix, two parts:**

1. **Immediate unblock** — hand-converged the live policy to the already-merged declaration:

   ```bash
   # IAM caps managed policies at 5 versions — delete the oldest first
   aws iam delete-policy-version --policy-arn <policy-arn> --version-id <oldest>
   aws iam create-policy-version --policy-arn <policy-arn> \
     --policy-document file://policy-with-canvas-refresh-arn.json \
     --set-as-default
   ```

   Safe because terraform already declares it: the next full apply is a no-op.

2. **Durable fix, PR #3338** — deploy.yml's targeted-apply list now includes ALL FOUR grouped API IAM policies:

   ```yaml
   TF_TARGET_ARGS+=(
     -target=module.thinkwork.module.api.aws_iam_policy.api_data_plane
     -target=module.thinkwork.module.api.aws_iam_policy.api_orchestration
     -target=module.thinkwork.module.api.aws_iam_policy.api_ai
     -target=module.thinkwork.module.api.aws_iam_policy.api_observability
     -target=module.thinkwork.module.api.aws_lambda_function.handler
     -target=module.thinkwork.module.cognito.aws_lambda_function.custom_auth
   )
   ```

   IAM-only drift now self-heals on the next deploy regardless of which run got cancelled.

## Why This Works

The targeted recovery apply runs on EVERY no-terraform-change deploy — the common case. Putting all grouped IAM policies in its target list guarantees at most one deploy of lag for IAM grants, even when the tf-carrying deploy is cancelled by concurrency. The hand-converged policy version is safe because it converges live state to what terraform already declares, so terraform sees no diff on the next full apply.

## Prevention

- **Diagnostic pattern:** new-function AccessDenied + green deploys → compare `git show origin/main:<tf file>` against live AWS state, then check whether the tf-carrying deploy run was cancelled (`gh api .../runs`, look at the `conclusion` field), BEFORE suspecting IAM propagation or application code.
- **When adding a NEW grouped/singleton IAM policy resource to lambda-api**, add it to deploy.yml's `TF_TARGET_ARGS` recovery list in the same PR (a comment in deploy.yml now explains why).
- The nightly drift-check (`verify.yml`, `terraform plan -refresh=true`) surfaces such drift to the step summary — it does not fail the build, so it must actually be read.
- Sibling failure genus already documented: "env-gated feature dead without terraform" — both are "merged ≠ live"; the check is always empirical verification of deployed config.

## Related Documentation

- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md` — closest sibling: its recurrence note documents a CANCELLED deploy leaving stale state for the AgentCore container image; this doc is the terraform variant of the same recurring class.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — the DB-migration variant of "merged but not applied"; its drift-reporter deploy gate is the pattern this doc's prevention parallels for terraform.
- `docs/solutions/workflow-issues/env-gated-feature-dead-without-terraform-wiring.md` — same family: merged code green, deployed environment never received the change.
- `docs/solutions/integration-issues/agentcore-runtime-role-missing-code-interpreter-perms-2026-04-24.md` — same symptom class (AccessDenied from missing IAM statement); there the grant was never written, here it was written but never applied.

## Related Issues

- PR #3326 — the merged IAM grant whose apply was cancelled
- PR #3330 — second tf-carrying merge, also cancelled by concurrency
- PR #3338 — durable fix expanding the targeted-apply recovery list
