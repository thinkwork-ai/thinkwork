---
title: "Browser-to-ECS-Exec terminal stack (ssm-session + xterm.js, no proxy)"
date: 2026-05-13
category: architecture-patterns
module: apps/admin + packages/api
problem_type: architecture_pattern
component: control_plane
severity: medium
applies_when:
  - You want an in-browser terminal into a running ECS Fargate / EC2 task
  - You're tempted to either (a) add an HTTP server to the worker container or (b) proxy SSM Session Manager through API Gateway WebSocket
  - You'd rather not maintain either of those
---

# Browser-to-ECS-Exec terminal stack

## TL;DR

A working in-browser terminal into a running ECS Fargate task is ~300 LOC of frontend + ~200 LOC of backend, with three off-the-shelf libraries doing the load-bearing work:

- `@xterm/xterm` + `@xterm/addon-fit` — render + resize
- `ssm-session` (bertrandmartel, MIT) — AWS Message Gateway Service binary framing
- `@aws-sdk/client-ecs` — `ExecuteCommandCommand` on the Lambda side

**The browser connects directly to `wss://ssmmessages.<region>.amazonaws.com`.** No API GW WebSocket proxy. No extra port on the worker container. Same path the AWS Console terminal uses.

## What you avoid by NOT writing this from scratch

The MGS wire protocol is the hard part: binary framing, 32-byte header, MessageType + SchemaVersion + CreatedDate + SequenceNumber + Flags + MessageId + SHA-256 payload digest + payload, per-message ACKs, PayloadType-keyed body shape (1=Output, 3=Size, 11=StdErr, 12=ExitCode, 17=Ready). The Go reference is `aws/session-manager-plugin/src/datachannel/streaming.go` + `aws/amazon-ssm-agent/agent/session/contracts/agentmessage.go`. Re-implementing in TypeScript would be 1-2 weeks of bug-hunting. `ssm-session` already does it.

## The architecture

```
[Operator clicks Terminal tab]
        │
        ▼
[React SPA]  POST /api/computers/:id/terminal/start  (Cognito JWT + tenant-admin)
        │
        ▼
[computer-terminal-start Lambda (Node 20)]
        │  ECSClient.send(new ListTasksCommand({...}))         ← find running task
        │  ECSClient.send(new DescribeTasksCommand({...}))     ← verify SSM agent RUNNING
        │  ECSClient.send(new ExecuteCommandCommand({
        │    cluster, task, container, interactive: true, command: "/bin/sh"
        │  }))
        ▼
[ECS control plane]
        │  returns { session: { sessionId, streamUrl, tokenValue } }
        │  Lambda forwards verbatim over HTTPS (DO NOT log tokenValue)
        ▼
[React SPA]
        const ws = new WebSocket(envelope.streamUrl);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => ssm.init(ws, { token: tokenValue, termOptions });
        ws.onmessage = (e) => {
          const msg = ssm.decode(e.data);
          ssm.sendACK(ws, msg);
          if (msg.payloadType === 1) term.write(decoder.decode(msg.payload));
          if (msg.payloadType === 17) ssm.sendInitMessage(ws, termOptions);
        };
        ▼
[wss://ssmmessages.<region>.amazonaws.com/v1/data-channel/<sessionId>?role=publish_subscribe]
        │  proxies to amazon-ssm-agent inside the Fargate task
        ▼
[Container]  /bin/sh ←→ ssm-agent ←→ MGS data channel
```

Keystroke path: `xterm.onData(d) → ssm.sendText(ws, encoder.encode(d))`.

Resize path: `xterm.onResize(({cols, rows}) => ssm.sendInitMessage(ws, {cols, rows}))`.

## Gotchas

1. **20-minute idle timeout** on ECS Exec is fixed and not configurable (unlike plain SSM Session Manager, which lets you set 1-60 min via doc preferences). Show a "Session ended — Reconnect" affordance on `ws.onclose`.
2. **Max 2 concurrent ECS Exec sessions per task** is an AWS quota. Surface "too many active sessions" cleanly.
3. **`enableExecuteCommand` is a per-task launch-time flag** — see `ecs-exec-existing-tasks-need-force-new-deployment-2026-05-13.md`. Flipping it on an existing service does NOT enable exec on already-running tasks; you need `--force-new-deployment`.
4. **Pre-check the SSM managed agent before calling `ExecuteCommand`** — DescribeTasks tells you whether `ExecuteCommandAgent` is `RUNNING` / `PENDING` / not present. Lets the handler return a clearer 409 instead of the confusing `TargetNotConnectedException`.
5. **CORS does NOT apply to WebSocket upgrades.** The browser can connect to `wss://ssmmessages.<region>.amazonaws.com` from any origin. Auth is the token in the `init` JSON frame, not Origin.
6. **`tokenValue` is a short-lived bearer credential.** Returns over HTTPS only. Never log it. Don't persist it. Treat it like a session cookie.
7. **Vite needs a Buffer polyfill.** `ssm-session` uses Node-style `Buffer` for SHA-256 digesting. Add a one-liner to your entry file:
   ```ts
   import { Buffer } from "buffer";
   (globalThis as any).Buffer = Buffer;
   ```
   Otherwise the bundle dies on `Buffer is not defined` at runtime.
8. **Sequence numbers reset on `ssm.init()`.** One `ssm` instance per WebSocket. Don't share across terminals.
9. **Use `ExecuteCommand` (ECS), not `StartSession` (SSM) directly.** ExecuteCommand wraps StartSession with the correct ECS target format (`ecs:<cluster>_<task>_<container>`).

## IAM + Terraform

Per-task (the ECS task role):

```hcl
resource "aws_iam_role_policy" "task_ssm_messages" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
    ]
  })
}
```

Per-cluster (audit log destination, optional but worth doing):

```hcl
resource "aws_ecs_cluster" "runtime" {
  # ...
  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }
}
```

Per-task (write to the audit log group):

```hcl
# Same policy as above, second statement:
{
  Effect = "Allow"
  Action = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
  Resource = "${aws_cloudwatch_log_group.ecs_exec.arn}:*"
}
```

Per-Lambda (the handler that calls ExecuteCommand):

```hcl
{
  Effect = "Allow"
  Action = ["ecs:ExecuteCommand", "ecs:DescribeTasks", "ecs:ListTasks"]
  Resource = "*"
}
```

Per-service (the actual flag flip):

```hcl
# In your CreateService / UpdateService input:
enableExecuteCommand: true
```

## Audit trail

- **CloudTrail** captures the `ecs:ExecuteCommand` API call (who, when, which task).
- **Cluster execute-command log group** captures the per-session command transcript (what was typed + output).
- **Application-domain audit-event** (e.g., this repo's compliance event taxonomy) is **not** the right channel for ECS Exec; infrastructure operations don't belong in the app event log. Use CloudTrail + the cluster log group.

## Implementation in this repo

- PR: thinkwork-ai/thinkwork#1209.
- Lambda handler: `packages/api/src/handlers/computer-terminal-start.ts`.
- Admin component: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerTerminal.tsx`.
- API client: `apps/admin/src/lib/computer-terminal-api.ts`.
- Buffer polyfill: `apps/admin/src/main.tsx`.
- Terraform: `terraform/modules/app/computer-runtime/main.tf` (cluster exec config + task role) + `terraform/modules/app/lambda-api/handlers.tf` (handler + cross-invoke not required since direct ECS API).

## References

- `bertrandmartel/aws-ssm-session` — MGS protocol JS lib.
- `aws/session-manager-plugin/src/datachannel/streaming.go` — canonical Go reference.
- `aws/amazon-ssm-agent/agent/session/contracts/agentmessage.go` — wire format.
- `aws-containers/amazon-ecs-exec-checker` — sanity-check IAM + task config before chasing WebSocket bugs.
