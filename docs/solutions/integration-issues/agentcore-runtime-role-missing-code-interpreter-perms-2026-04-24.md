---
title: "AgentCore runtime role missing StartCodeInterpreterSession — sandbox feature needs its own IAM statement"
module: terraform/modules/app/agentcore-runtime
date: 2026-04-24
problem_type: integration_issue
component: permissions
severity: high
symptoms:
  - "execute_code tool registered cleanly in runtime logs"
  - "Strands agent calls the tool (runtime log shows tools=['execute_code'])"
  - "Tool call fails with `SandboxError: AccessDeniedException ... is not authorized to perform: bedrock-agentcore:StartCodeInterpreterSession`"
  - "sandbox_invocations row written with exit_status='error' and the AccessDenied message in failure_reason"
  - "counter increments — the failure happens mid-tool, after the quota-check succeeded"
root_cause: incomplete_setup
resolution_type: terraform_fix
related_components:
  - permissions
  - assistant
tags:
  - iam
  - bedrock-agentcore
  - code-interpreter
  - sandbox
  - access-denied
  - recurring-class
last_updated: 2026-04-24
---

# AgentCore runtime role missing StartCodeInterpreterSession — sandbox feature needs its own IAM statement

## Problem

The `thinkwork-${stage}-agentcore-role` (the Strands runtime's execution role) was provisioned in `terraform/modules/app/agentcore-runtime/main.tf` with:

- S3 access to the workspace bucket
- Bedrock `InvokeModel` on foundation models
- `AgentCoreMemoryReadWrite` covering `CreateEvent` / `ListEvents` / `RetrieveMemoryRecords` / etc.
- CloudWatch Logs + X-Ray + ECR auth + SSM parameter reads + Lambda invoke on `memory-retain`

But **not** the `bedrock-agentcore:StartCodeInterpreterSession` + siblings needed to operate a Code Interpreter session. When the sandbox feature landed (PRs #437 / #439 / #441), the runtime got the Python code to register the `execute_code` tool but the IAM role didn't grow to match. Every invocation that reached `start_code_interpreter_session()` hit:

```
AccessDeniedException: User: arn:aws:sts::<acct>:assumed-role/thinkwork-dev-agentcore-role/thinkwork-dev-agentcore
  is not authorized to perform: bedrock-agentcore:StartCodeInterpreterSession
  on resource: arn:aws:bedrock-agentcore:us-east-1:<acct>:code-interpreter-custom/thinkwork_dev_<tenant>_pub-<id>
  because no identity-based policy allows the bedrock-agentcore:StartCodeInterpreterSession action
```

## Symptoms

- `/thinkwork/${stage}/agentcore` log contains `sandbox tool registered: execute_code (interpreter=... env=default-public)` on container boot — the tool surfaces to the agent
- `Strands agent complete: ... tools=['execute_code']` — the agent calls it
- Immediately after, `ERROR sandbox execute_code failed` with stack frame in `sandbox_tool.py` line 237 (`_ensure_session` → `start_session` → boto3 call)
- `sandbox_invocations` row has `exit_status='error'`, `duration_ms ~= 1000-2000`, `stdout_bytes=0`, and `failure_reason` containing the full `AccessDeniedException` text. Because the shape is preserved, operators can grep `failure_reason LIKE '%AccessDenied%'` directly
- Counter increments — the quota-check happens before the session-start, so the invocation gets counted whether or not it succeeded (by design per plan R-Q8)

## What Didn't Work

- **Assuming `AgentCoreMemoryReadWrite` covers all bedrock-agentcore actions.** It doesn't. That statement was written specifically for memory ops (CreateEvent, RetrieveMemoryRecords). AgentCore's Code Interpreter actions are a separate subtree.
- **Reading the `bedrock-agentcore:*` doc page end-to-end.** The AgentCore docs are organized around "tools" (memory, code interpreter, browser) with each tool's action list in its own section — but the IAM docs list all actions together. Easy to scan one and miss the other.
- **Catching this in ad-hoc role audits.** The role has ~30 statements covering logs, ECR, SSM, X-Ray, Bedrock — it reads as comprehensive. The absence of a `Code Interpreter` statement is invisible when the existing statements look thorough.

## Resolution

Add a dedicated statement to the `agentcore-permissions` inline policy in `terraform/modules/app/agentcore-runtime/main.tf`:

```hcl
{
  Sid    = "AgentCoreCodeInterpreter"
  Effect = "Allow"
  Action = [
    "bedrock-agentcore:StartCodeInterpreterSession",
    "bedrock-agentcore:StopCodeInterpreterSession",
    "bedrock-agentcore:InvokeCodeInterpreter",
    "bedrock-agentcore:GetCodeInterpreterSession",
    "bedrock-agentcore:ListCodeInterpreterSessions",
    "bedrock-agentcore:GetCodeInterpreter",
  ]
  Resource = "arn:aws:bedrock-agentcore:${var.region}:${var.account_id}:code-interpreter-custom/*"
}
```

Resource wildcards under `code-interpreter-custom/*` — every tenant's interpreter is under this account, and the per-turn cross-tenant guard lives in `packages/api/src/lib/sandbox-preflight.ts` (which only hands the runtime the interpreter id for the tenant the invocation is scoped to).

Implemented in PR #493.

## Prevention

1. **IAM policy coverage as part of the feature plan.** When adding a new AWS API call to runtime code, the terraform change that grants the action must be part of the same PR. PRs #437/#439/#441 added the Python SDK calls but not the IAM grant; the gap only surfaced when something tried to actually exercise the path.
2. **Deny-by-default feedback pattern.** The `failure_reason` captured the full AccessDeniedException text including the exact action + resource. This is the right shape for any permission error — the full ARN + action string is copy-pasteable into the terraform statement. Keep error propagation this verbose at the sandbox-tool layer.
3. **IAM lint.** Consider a CI step that greps the runtime's Python source for `bedrock-agentcore:` action patterns and cross-references against the terraform policy. Not cheap to build, but this class of "Python added a new call, terraform didn't grow to match" is a recurring shape across features.

## Related Learnings

- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` — for this permission fix to land, the runtime must actually deploy; the runtime doesn't auto-repull even after terraform updates the role.
