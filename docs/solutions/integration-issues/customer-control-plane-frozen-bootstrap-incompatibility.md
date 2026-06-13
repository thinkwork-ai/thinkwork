---
title: "Frozen customer control plane cannot deploy releases that add provider aliases or IAM actions"
date: "2026-06-12"
category: integration-issues
module: terraform/modules/app/deployment-control-plane
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "`terraform init` fails in CodeBuild with: The child module requires an additional configuration for provider hashicorp/aws, with the local name aws.us_east_1"
  - "Deployment apply fails with AccessDenied: not authorized to perform route53:CreateHostedZone (deployment CodeBuild role)"
  - Runner self-update never fires because it only executes at the end of a successful run
  - Old runner generates a root main.tf incompatible with the newer registry module version the same run pins
root_cause: missing_permission
resolution_type: code_fix
tags:
  - terraform
  - deployment-controller
  - codebuild
  - customer-account
  - iam-permissions
  - route53
  - runner-self-update
  - bootstrap-freeze
  - provider-alias
---

# Frozen customer control plane cannot deploy releases that add provider aliases or IAM actions

## Problem

Customer-account deployments run through an AWS-native control plane (Step Functions → CodeBuild → an S3-hosted runner script) whose components are intentionally frozen at bootstrap: customer roots set `enable_deployment_control_plane = false`, so customer applies never update the runner script or the CodeBuild role policy. PR #2401 shipped a `thinkwork` module version that unconditionally requires an `aws.us_east_1` provider alias and creates Route53 hosted zones — and the first customer (TEI) could not deploy it: the frozen runner generated an incompatible root, and the frozen role lacked the new IAM actions. The runner's self-update mechanism could not rescue it, because self-update only fires at the end of a **successful** run.

## Symptoms

**Failure 1 — `terraform init` crash in CodeBuild (old runner + new module):**

```
Error: The child module requires an additional configuration for provider
hashicorp/aws, with the local name "aws.us_east_1".

  on main.tf line 140:
 140: module "thinkwork" {
```

The pre-#2401 runner's generated root had a single `provider "aws"` block and no `providers` mapping, while the registry module at the pinned version (published by the same git tag) declared `configuration_aliases = [aws.us_east_1]`.

**Failure 2 — apply crash after the runner was fixed (frozen role):**

```
Error: creating Route53 Hosted Zone (tei.thinkwork.ai): api error AccessDenied:
User: arn:aws:sts::<account>:assumed-role/thinkwork-<stage>-deployment-codebuild-role/...
is not authorized to perform: route53:CreateHostedZone
```

The bootstrapped CodeBuild role's `deployment-runner` policy (`aws_iam_role_policy.codebuild` in `terraform/modules/app/deployment-control-plane/main.tf`) listed `acm:*` but no `route53:*` — and the gap existed in the module source too.

## What Didn't Work

- **Expecting runner self-update to bridge the skew.** `self_update_runner_script()` (runner.py) copies the release source's runner to S3 only at the tail of a successful run. A run that dies at `terraform init` never reaches it — so the old runner can never successfully complete a run pinned to a module version that requires root-template changes. Chicken-and-egg.
- **Expecting the echoed-fields guard (KTD5, #2401) to explain the failure.** That guard detects the runner silently *dropping new payload fields*; an init failure surfaces only as a raw Terraform error in CodeBuild logs, and nothing tells the operator "your runner script is stale."
- **Relying on the release manifest's `compatibility.minRunnerVersion`.** The field exists and was correct (`0.1.0-canary.178`), but nothing enforces it before dispatch — the run fails on the downstream symptom instead of the version check.

## Solution

**Step 1 — manual S3 runner swap (the escape hatch):**

```bash
# Back up the frozen script
aws s3 cp \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py.bak-pre-<release>

# Overwrite with the release's runner (identical to the release source at the tag)
aws s3 cp \
  terraform/modules/app/deployment-control-plane/runner.py \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py
```

Re-dispatch the same Step Functions execution input unchanged. The new runner emits the alias provider block and `providers = { aws.us_east_1 = aws.us_east_1 }` in the generated root, so init succeeds.

**Step 2 — patch the live bootstrapped role (additive inline policy):**

```bash
aws iam put-role-policy \
  --role-name thinkwork-<stage>-deployment-codebuild-role \
  --policy-name thinkwork-customer-domain-route53-acm \
  --policy-document '{ "Version": "2012-10-17", "Statement": [
    { "Sid": "CustomerDomainRoute53", "Effect": "Allow",
      "Action": ["route53:CreateHostedZone","route53:GetHostedZone","route53:ListHostedZones",
                 "route53:DeleteHostedZone","route53:ChangeResourceRecordSets",
                 "route53:ListResourceRecordSets","route53:GetChange",
                 "route53:ChangeTagsForResource","route53:ListTagsForResource"],
      "Resource": "*" } ] }'
```

**Step 3 — durable module fix for future bootstraps (PR #2402):**

```diff
           "rds:*",
+          "route53:*",
           "scheduler:*",
```

The module fix reaches **future bootstraps only**: existing customer roles never re-apply the controller module, so every already-bootstrapped environment needs Step 2 manually.

After the successful run, the runner's normal end-of-run self-update resumed — future releases update the S3 script automatically again.

## Why This Works

The S3 runner script is the unit of execution inside CodeBuild and is fully decoupled from the registry module version a run pins — so uploading the release's own `runner.py` to the S3 script URI is safe and breaks the deadlock: the generated root satisfies the module's provider requirements before `terraform init` runs. The IAM patch works because the role is live and inline policies take effect immediately; the frozen control plane only prevents *Terraform-managed* updates, not direct AWS API mutation.

## Prevention

- **Treat generated-root and IAM changes as release blockers for frozen control planes.** Any release that changes the runner's generated-root template (new provider aliases, new root-level blocks, new `providers` mappings) or requires new IAM actions in the CodeBuild role cannot be deployed by existing customers without a runner/role update first. Flag these in review — "does this change what the generated root must contain, or what the deploy role must be allowed to do?"
- **Enforce `compatibility.minRunnerVersion` pre-dispatch.** The manifest already carries it; the controller (or runner, as its first act) should compare it against the deployed runner's version and fail fast with an actionable message ("update the runner script before dispatching this release") instead of a raw Terraform error.
- **The escape hatch is standard remediation, not a hack.** Manual S3 runner upload (with a `.bak-` backup) followed by re-dispatching the unchanged input is the canonical recovery for runner-skew init failures; it is documented in `docs/runbooks/customer-domain-claim-runbook.md` and should be reused for any future root-template-breaking release.
- **For role-policy gaps: additive inline policy on live roles + module fix for future bootstraps.** Never expect the module change alone to fix existing customers.

## Related Issues

- PR #2401 — the customer-domain release that triggered both failures (added `aws.us_east_1` requirement and Route53 resources)
- PR #2402 — durable `route53:*` grant in the control-plane module
- PR #2374 — runner self-update mechanism (this incident documents its blind spot)
- PR #2371 — ledger-driven migrations; earlier instance of the same frozen-bootstrap class
- Issue #2375 — graphql-http Lambda env at the 4KB ceiling; same class (customer environment unable to absorb a release change)
- `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md` — the architecture this failure mode lives in (its guardrails predate this learning)
- `docs/runbooks/customer-domain-claim-runbook.md` — operational context for the triggering release
