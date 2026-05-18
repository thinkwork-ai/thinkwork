---
title: "ECS Exec — `enableExecuteCommand` is a task launch-time flag; existing tasks need force-new-deployment"
date: 2026-05-13
category: runtime-errors
module: terraform + runtime-control
problem_type: api_semantics
component: ecs
severity: medium
symptoms:
  - "Set enable_execute_command=true on the service via Terraform / UpdateService and confirm it sticks (aws ecs describe-services shows enableExecuteCommand: True)."
  - "Call ecs:ExecuteCommand against a task in that service. Get back: `502 ExecuteCommand failed: The execute command failed because execute command was not enabled when the task was run or the execute command agent isn't running. Wait and try again or run a new task with execute command enabled and try again.`"
  - "Task is RUNNING. ExecuteCommandAgent is NOT in the task's managed agents list."
root_cause: per_task_launch_time_flag
---

# ECS Exec: `enableExecuteCommand` is per-task at launch time

## What this means

`enableExecuteCommand` is a property of a **task**, not of a service. It's read at task launch time from the service's current setting and stamped onto the task definition's runtime envelope. Flipping it on the service updates *future* task launches; **already-running tasks keep whatever value they were launched with** and silently don't get the SSM agent injected.

The AWS error message is misleading — "execute command agent isn't running" reads like the agent might come up if you wait. It won't. The agent isn't there; it was never injected when the task started.

## Reproduction

1. Service was created with `enableExecuteCommand: false` (the default). Task starts, no SSM agent.
2. Operator wants ECS Exec. Updates the service:
   ```sh
   aws ecs update-service --service my-svc --enable-execute-command --region us-east-1
   ```
3. `aws ecs describe-services` confirms `enableExecuteCommand: true`. ✅
4. `aws ecs execute-command --cluster ... --task <still-running-old-task>` fails with the error above.

## Fix

Force a new task with the flag set at launch:

```sh
aws ecs update-service \
  --cluster <cluster> \
  --service <service> \
  --enable-execute-command \
  --force-new-deployment \
  --region us-east-1
```

`--force-new-deployment` is the load-bearing flag. The new task is launched with `enableExecuteCommand: true` baked in, the SSM agent (provided by the Fargate platform) starts, the managed-agents list reports `ExecuteCommandAgent: RUNNING`.

Cost: ~60-90s of worker downtime per service (Fargate task pull + start). In-flight work that was on the old task may need to be retried; queue-based workers tolerate this fine, RPC-style workers don't.

## How to confirm a task is exec-ready before calling `ExecuteCommand`

```sh
aws ecs describe-tasks --cluster <c> --tasks <task-arn> --output json \
  | jq '.tasks[0].containers[] | select(.name=="<container>") | .managedAgents[]? | {name, lastStatus}'
```

If `ExecuteCommandAgent` is not in the list at all → task was launched without the flag; needs new task.
If it's `PENDING` → agent is still warming; wait 30 s.
If it's `RUNNING` → safe to call `ExecuteCommand`.

The admin Terminal handler in this repo (`packages/api/src/handlers/computer-terminal-start.ts`) does this pre-check and returns 409 with a clearer error when the agent isn't yet RUNNING, instead of letting `ExecuteCommand` throw the confusing AWS error.

## Terraform implication

For services managed by Terraform with `enable_execute_command = true`, `terraform apply` updates the service config but does **not** force a new task — same problem. Either:

- Add a `triggers` block / `replace_triggered_by` to recreate the service on flag changes (heavy-handed), or
- Run a one-shot `force-new-deployment` per service after the apply lands (what we did).

For services provisioned imperatively (e.g., `provisionComputerRuntime` in this repo calls `CreateService` / `UpdateService` from a Lambda), the same applies: code-level flip on UpdateService only affects future task launches. Force-new-deployment is the user-visible event that takes the flag live.

## Operator command for fleet flip

```sh
for svc in svc-a svc-b svc-c; do
  aws ecs update-service --cluster <c> --service "$svc" \
    --enable-execute-command --force-new-deployment --region us-east-1 &
done
wait
```

Parallel updates are safe — ECS serializes deployments per service, not per cluster.
