---
title: Release N deploys customer stacks with the runner script staged by release N−1
date: 2026-08-10
category: integration-issues
module: deployment-control-plane
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "New Terraform vars (brain_ops_api_url, brain_ops_m2m_secret_arn) absent from /thinkwork/<stage>/runtime-config after a SUCCEEDED release deploy on tei-e2e and mcpherson"
  - "Controller run reported SUCCEEDED and selected-release-version updated to the new release — no error surfaced anywhere"
  - "Runner-secrets JSON contained the new keys, but the deployed stacks never received the -var values"
  - "Re-running the identical release deploy command made both keys appear on both stacks"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags:
  - deployment-control-plane
  - runner-py
  - codebuild
  - release-deploy
  - runtime-config
  - evidence-bucket
  - one-release-lag
related_components:
  - terraform-modules
  - runner-secrets
---

# Release N deploys customer stacks with the runner script staged by release N−1

## Problem

THINK-781 (PR #4263, merged 2026-08-10) added two customer-settable Terraform variables — `brain_ops_api_url` and `brain_ops_m2m_secret_arn` — wired through the deployment-control-plane runner's three wiring points: the `vars_json` allowlist mapping reading runner-secrets keys `brainOpsApiUrl` / `brainOpsM2mSecretArn` (`terraform/modules/app/deployment-control-plane/runner.py:4845-4853`), the generated-root variable declarations (`runner.py:5021-5026`), and the `module "thinkwork"` arguments (`runner.py:5495-5496`), plus `terraform/modules/{app,thinkwork}` pass-throughs feeding the lambda-api runtime-config SSM document. The runner-secrets JSON docs (Secrets Manager `/thinkwork/<stage>/deployment/runner-secrets`) for tei-e2e and mcpherson were updated with the new keys via read-modify-write.

Deploying the release that carried all of this (`thinkwork release deploy v0.1.0-canary.450 -s <stage> -y`) succeeded on both stages — yet the new configuration never landed. Unlike every previously documented runner-skew failure (init crash, guardrail refusal), this one is **silent**: the wiring was correct, the run was green, and the release was half-applied.

## Symptoms

- Controller run: SUCCEEDED. SSM `/thinkwork/<stage>/deployment/selected-release-version` correctly updated to `v0.1.0-canary.450`.
- But `BRAIN_OPS_API_URL` / `BRAIN_OPS_M2M_SECRET_ARN` were absent from the `/thinkwork/<stage>/runtime-config` SSM document on both stacks.
- No error anywhere in the pipeline. The miss was only caught by explicitly checking the runtime-config document for the new keys:

```bash
aws ssm get-parameter --name /thinkwork/<stage>/runtime-config --query Parameter.Value --output text | jq 'keys'
```

## What Didn't Work

- **Checking whether the API Lambda updated, using the wrong function name.** First guess was `thinkwork-<stage>-graphql-http`; the actual name is `thinkwork-<stage>-api-graphql-http`. Dead end that cost a loop before the real trail.
- **Trusting the SUCCEEDED status.** The run genuinely succeeded — it just applied the release with empty-string defaults for the new vars, and the runtime-config document conditionally includes those keys, so they were silently omitted rather than written empty.

## Solution

Re-run the *identical* command:

```bash
thinkwork release deploy v0.1.0-canary.450 -s <stage> -y
```

The second pass wired both keys into runtime-config on both stacks, verified with:

```bash
aws ssm get-parameter --name /thinkwork/<stage>/runtime-config --query Parameter.Value --output text | jq '.BRAIN_OPS_API_URL, .BRAIN_OPS_M2M_SECRET_ARN'
```

## Why This Works

The CodeBuild runner fetches its own script from the stack's evidence bucket at build start:

- `terraform/modules/app/deployment-control-plane/buildspec.yml:26` — `aws s3 cp "$THINKWORK_RUNNER_SCRIPT_S3_URI" /tmp/thinkwork-runner.py`
- `terraform/modules/app/deployment-control-plane/main.tf:416-418` — `THINKWORK_RUNNER_SCRIPT_S3_URI` points at `s3://thinkwork-<stage>-<acct>-deploy-evidence/runner/thinkwork-runner.py`

That S3 object is itself a Terraform-managed resource — `aws_s3_object.runner_script` at `terraform/modules/app/deployment-control-plane/main.tf:87-100` (`source = "${path.module}/runner.py"`, content-tracked via `etag = filemd5(...)`) — updated **by the terraform apply inside the controller run**. So the run that applies release N executes the runner.py staged by release N−1: a built-in one-release lag on any runner.py behavior change.

canary.449's runner predates the brain-var mapping, so the first canary.450 pass never passed the new `-var` values; Terraform applied the `""` defaults and the runtime-config document (which conditionally includes the keys) omitted them. That same first pass *did* stage canary.450's runner.py — confirmed by downloading the staged S3 object and grepping (5 `brainOpsApiUrl`/`brain_ops_api_url` hits):

```bash
aws s3 cp s3://thinkwork-<stage>-<acct>-deploy-evidence/runner/thinkwork-runner.py /tmp/staged-runner.py
grep -c 'brainOpsApiUrl\|brain_ops_api_url' /tmp/staged-runner.py
```

So the second identical deploy runs with the freshly staged runner and applies the vars. The re-run is idempotent — safe to repeat.

## Prevention

When a release adds a **new runner-wired variable** (any change to runner.py's vars_json mapping, generated-root declarations, or module arguments), either:

1. **Plan a double deploy** of that release per customer stack — the second pass is idempotent and picks up the freshly staged runner; or
2. **Ship the runner.py change one release before** the release that depends on it, so the staged runner is already current when the dependent release deploys.

And always verify post-deploy that new keys actually appear in the stage runtime-config document:

```bash
aws ssm get-parameter --name /thinkwork/<stage>/runtime-config --query Parameter.Value --output text | jq 'keys'
```

Note the correct Lambda name if checking the API function directly: `thinkwork-<stage>-api-graphql-http` (not `thinkwork-<stage>-graphql-http`).

A stronger structural fix, already proposed once (see the frozen-bootstrap doc below) and re-validated by this incident: enforce `compatibility.minRunnerVersion` before dispatch, or have the controller stage the release's own runner before running it.

## Related Issues

- [customer-control-plane-frozen-bootstrap-incompatibility](customer-control-plane-frozen-bootstrap-incompatibility.md) — the loud-failure sibling: same runner-self-update-at-end-of-run mechanism, but there the stale runner crashed at terraform init instead of succeeding silently. Documents the manual S3 runner-swap escape hatch and the unimplemented `compatibility.minRunnerVersion` guard.
- [controller-vars-allowlist-blocks-cognito-ses-invite-emails](controller-vars-allowlist-blocks-cognito-ses-invite-emails.md) — origin of the three-wiring-points rule. There the wiring was missing; here it was correct and still didn't apply on the first pass — the deployment-timing corollary to that rule.
- [runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04](../workflow-issues/runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04.md) — documents the hot-stage escape hatch (manually `aws s3 cp` a patched runner into the evidence bucket, then re-run), the manual equivalent of the second deploy pass.
- [customer-updates-use-release-deploy-not-deploy-controller-2026-07-12](../workflow-issues/customer-updates-use-release-deploy-not-deploy-controller-2026-07-12.md) — the release-deploy command path itself; this incident nuances its claim that failed runs never half-deploy (a *successful* run can half-apply).
- `docs/runbooks/customer-release-cutover.md` — the cutover runbook this learning amends: its verification section (selected-release-version + Pi image digest) cannot detect this failure mode.
