---
title: "feat: Computer terminal (PTY) via ECS Exec"
type: feat
status: proposed
date: 2026-05-13
---

# feat: Computer terminal via ECS Exec

## Overview

Give operators a real terminal into a running Computer ECS task — `cd`, `ls`, `python repl`, tail logs, debug a wedged worker — without exposing any new ports on the runtime container. ECS Exec is the AWS-native answer: enable it on the per-Computer service, the SSM agent (built into the Fargate platform) routes traffic via SSM Session Manager, the admin SPA hosts an xterm.js terminal that tunnels the SSM streaming protocol.

This is a sibling plan to `2026-05-13-003-feat-admin-computer-efs-listing-plan.md`. That plan ripped the **workspace listing** off the queue (direct EFS read). This plan adds **interactive shell** as a separate path. Both are direct-to-container in spirit but use different AWS primitives because they have different semantics.

## Why not the runtime HTTP server?

Considered. Rejected for v1:

- Runtime is a worker loop today (polls `computer_tasks`). Adding an HTTP listener means the runtime simultaneously serves and polls; non-trivial async I/O refactor.
- Networking from admin to the Computer ECS task needs ALB or Cloud Map service discovery. Admin's existing API path doesn't have either, and ALB target-group-per-Computer doesn't scale.
- ECS Exec is audit-trail by default (CloudTrail + optional S3/CloudWatch session log).

## Why not workspace-file mutations via ECS Exec?

The latency profile is wrong. ECS Exec session establishment is ~1–2 s per call; the WorkspaceEditor performs many small file ops per session. The U3 EFS-Lambda path is sub-100 ms warm. Terminal is the right use case (sessions are intentional and long-lived).

## Phases

### U1 — Enable ECS Exec on the per-Computer service

- `terraform/modules/app/computer-runtime/main.tf`: `enable_execute_command = true` on `aws_ecs_service.computer` (or wherever the per-Computer service is provisioned by `provisionComputerRuntime`).
- Task role gets `ssmmessages:CreateControlChannel`, `ssmmessages:CreateDataChannel`, `ssmmessages:OpenControlChannel`, `ssmmessages:OpenDataChannel`.
- Verify on dev: `aws ecs execute-command --cluster thinkwork-dev-computer --task <id> --container thinkwork-strands --interactive --command "/bin/bash"` opens a shell.

### U2 — Admin-side starter Lambda

- New `terraform/modules/app/lambda-api/handlers.tf` entry: `computer-exec-session-start` Lambda.
- Accepts `{ tenantId, computerId }`. Authorizes via the same Cognito JWT path workspace-files uses. Resolves the task ARN from `ecs_service_name`.
- Calls `ecs:ExecuteCommand` and returns `{ sessionId, streamUrl, tokenValue }` to the admin client. (Same envelope `ssm:StartSession` returns.)
- IAM: `ecs:ExecuteCommand`, `ecs:DescribeTasks`, `ssm:StartSession`. Scoped to the per-stage cluster.

### U3 — Admin Terminal panel

- New `apps/admin/src/components/computers/ComputerTerminal.tsx` using `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-web-links`.
- WebSocket client speaks the SSM Session Manager streaming protocol (handshake with `tokenValue`, then bidirectional `inputStreamMessage` / `outputStreamMessage` frames).
- Mount under `Computers → $computerId → Terminal` tab (sibling to Dashboard / Workspace / Config).

### U4 — Audit-trail glue

- CloudTrail captures the `ecs:ExecuteCommand` invocation by default.
- Optional: enable session logging to CloudWatch Logs (`cluster.executeCommandConfiguration.logConfiguration`) so the session's command stream is durable. Plumb the log group ARN into the cluster definition.
- Compliance audit-event emit: at session start (per `2026-05-07-007` Compliance U6 pattern), emit `computer_terminal_session_started` with `{ tenantId, computerId, operatorUserId, sessionId }`.

### U5 — Permission model

- Tenant-admin-only by default. The starter Lambda runs `requireTenantAdmin(ctx, tenantId)` before any SSM call.
- Per-Computer override is out of scope; revisit if the n=4 enterprise rollout surfaces a need for per-Computer operator scoping.

## Non-goals

- **File listing / reading via ECS Exec.** That's the EFS-Lambda path (sibling plan).
- **Background terminal sessions.** Sessions die when the operator closes the tab; resurrection is not in v1.
- **Multi-pane terminal in admin.** One xterm per Computer tab, one session at a time, is enough for v1.

## Risks

- **Session expansion in SSM ledger** — long sessions accumulate state; tune `executeCommandConfiguration.idleTimeout` accordingly.
- **Browser-side WebSocket tunneling** is the meaty bit; ship a small SSM streaming client (well-trodden but not built-in to xterm). Reference: the SSM Session Manager Plugin's protocol (open source) and `aws-sdk-js-v3 @aws-sdk/client-ssm/StartSession`.
- **Latency** — session-start is ~1–2 s. UX it as a loading state in the Terminal panel.
