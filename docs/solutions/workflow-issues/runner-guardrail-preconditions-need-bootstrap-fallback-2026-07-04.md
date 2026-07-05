---
title: New runner guardrail preconditions must not depend solely on prior guardrail state
date: 2026-07-04
category: workflow-issues
module: terraform/modules/app/deployment-control-plane/runner.py
problem_type: workflow_issue
component: customer_deploy
severity: high
applies_when:
  - "Adding a guardrail/precondition to the customer deployment runner"
  - "The precondition's input value is read from recorded state of previous deploys"
  - "Customer stacks exist that were deployed before the value was recorded"
tags:
  [
    deployment-controller,
    runner,
    guardrail,
    bootstrap,
    n8n,
    upgrade-path,
    canary,
  ]
---

# New runner guardrail preconditions must not depend solely on prior guardrail state

## Context

The v0.1.0-canary.315 runner added an n8n guardrail requiring `n8n_agent_step_bridge_credential_secret_arn` as a terraform override. The runner sourced that value **only** from guardrail input recorded in tfstate by previous runs — but no runner ≤ v314 ever recorded it. On McPherson (deployed through v314), the value rendered empty, the Step Functions deploy failed with `Resource precondition failed`, and the stack could not take v315 at all, even though the secret itself existed in the account under its well-known name (`thinkwork/mcpherson/n8n/agent-step-bridge-credential`).

This is a general upgrade-path trap: a guardrail whose input comes from state that only the _new_ runner writes can never pass on any stack that predates it — the fleet bricks on exactly the release that introduces the check.

## Fix

Resolve the value from ground truth when recorded state is absent. PR #3344 added a fallback that queries Secrets Manager by the well-known name:

```python
def n8n_bridge_secret_arn_fallback(stage):
    try:
        out = output(["aws", "secretsmanager", "describe-secret",
            "--secret-id", f"thinkwork/{stage}/n8n/agent-step-bridge-credential",
            "--query", "ARN", "--output", "text"])
        arn = (out or "").strip()
        return arn if arn.startswith("arn:") else ""
    except Exception:
        return ""
```

and used it as the fallback in `managed_app_terraform_overrides`. After one successful run the value is recorded in guardrail state and the fallback is no longer exercised (self-healing).

## Emergency unblock (hot-stage a patched runner)

The runner self-updates **only after a successful run**, so a broken-runner release can't fix itself. To unblock a stuck stack, stage the patched runner directly:

```bash
aws s3 cp runner-patched.py \
  s3://thinkwork-<stage>-<account>-deploy-evidence/runner/thinkwork-runner.py
```

then re-run the release deploy. The next successful run self-updates the runner back to the release copy — which is why the fix **must also land in the repo** or it will be silently reverted.

## Guidance

1. **Every new runner precondition needs a bootstrap story** for stacks that predate the value it checks: derive from ground truth (describe/list against the account), a well-known naming convention, or an explicit migration step — never only from state the new runner itself writes.
2. **Test new guardrails against a pre-upgrade state file**, not just a fresh stack.
3. **Hot-patched runners must land in the repo in the same session** — self-update reverts them on the next success.
4. Related trap from the same session: two `release deploy` invocations ~20s apart raced the terraform state lock and failed one execution — check Step Functions for an already-running execution before retrying a "failed" CLI invocation whose error was pre-flight (e.g. region resolution).
