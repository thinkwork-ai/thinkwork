---
title: "AWS Security Group description rejects non-ASCII characters (EC2 API, not Terraform validate)"
date: 2026-05-13
category: build-errors
module: terraform
problem_type: external_api_constraint
component: deploy_pipeline
severity: medium
symptoms:
  - "`terraform plan` and `terraform validate` pass locally."
  - "Post-merge `terraform apply` fails with: `Error: creating Security Group (...): InvalidParameterValue: Value (...) for parameter GroupDescription is invalid. Character sets beyond ASCII are not supported.`"
  - "Pre-merge CI green; deploy pipeline silently fails after merge unless you watch the post-merge Deploy run."
root_cause: ec2_api_parameter_validation
---

# AWS Security Group description rejects non-ASCII

## What happened

Shipped PR #1204 with this Terraform:

```hcl
resource "aws_security_group" "workspace_admin_lambda" {
  name_prefix = "thinkwork-${var.stage}-workspace-admin-lambda-"
  description = "ThinkWork workspace-files-efs Lambda — EFS client"
  vpc_id      = var.vpc_id
  # ...
}
```

The `—` is an em-dash (U+2014). `terraform validate` and `terraform plan` both pass because the AWS provider schema types `description` as `string` — provider-side schema validation has no character-set constraint. The EC2 `CreateSecurityGroup` API does, and rejects on apply:

```
Error: creating Security Group (...): InvalidParameterValue: Value (...) for
parameter GroupDescription is invalid. Character sets beyond ASCII are not supported.
```

Result: the Terraform Apply job failed *after* PR-merge, every downstream job in the Deploy pipeline (Build & Deploy Admin, Build & Deploy Computer, ...) was skipped, and the admin SPA never picked up the new handler. From the operator's POV, everything looked green but the feature was dead in dev.

## Where else this hides

Any AWS resource whose description / name / tag value is constrained at API-call time, not at provider-schema time. Known offenders:

- **`aws_security_group.description`** — strict ASCII, max 255 chars. ✅ confirmed in this incident.
- **IAM role/policy `description`** — historically rejects some control chars; ASCII is safest.
- **CloudFormation stack `Description`** — UTF-8 allowed but some chars cause downstream issues with the AWS Console renderer.
- **ECS task definition container `name`** — `[a-zA-Z0-9_-]` only.

Not exhaustive. Rule of thumb for any field labeled `description`, `name`, or `tag`: stick to printable ASCII unless the API doc explicitly says UTF-8 is fine.

## Fix

ASCII-only:

```hcl
description = "ThinkWork workspace-files-efs Lambda - EFS client"
```

PR #1205 was a one-character fix that unblocked the entire #1204 deploy.

## Prevention

1. **Watch the post-merge Deploy run, not just pre-merge CI.** Pre-merge CI runs unit tests + typecheck + lint — it does NOT run `terraform apply` against AWS. The deploy pipeline that fires on merge to `main` is where API-level validation happens, and a silent failure there is invisible from the PR view.
2. **CI lint for non-ASCII in Terraform `description`/`name` fields** would catch this. Not currently wired; would be a one-rule tflint or pre-commit grep:
   ```sh
   grep -nP '(description|name)\s*=\s*"[^"]*[^\x00-\x7F]' terraform/**/*.tf
   ```
3. **No emojis or smart quotes in Terraform string values.** Editor auto-substitution (Mac auto-replacing `--` with `—`, smart quotes for `"`) is the usual culprit. Disable per-language for `.tf` if your editor lets you.

## Operator runbook (when CI is silent and deploy fails)

```sh
# 1. Find the most recent main-branch run that failed
gh run list --branch main --limit 5 --status failure --json name,databaseId,url

# 2. Pull the failure log for the failed job (usually Terraform Apply)
gh run view <id> --log-failed | grep -iE "Error:|InvalidParameterValue" | head -20

# 3. Fix the offending Terraform, ship a one-line PR, watch the next Deploy
```
