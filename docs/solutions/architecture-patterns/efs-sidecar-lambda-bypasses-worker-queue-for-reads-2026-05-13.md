---
title: "EFS-sidecar Lambda bypasses the worker queue for read-only ops"
date: 2026-05-13
category: architecture-patterns
module: packages/api + admin
problem_type: architecture_pattern
component: data_plane
severity: high
applies_when:
  - A long-lived worker process (ECS task, daemon) is the only thing that talks to a storage tier
  - Admin/operator UI needs to read that storage on demand for an interactive flow
  - The worker accepts work via a FIFO task queue, so background writes can starve interactive reads
---

# EFS-sidecar Lambda bypasses the worker queue for read-only ops

## Problem

A long-lived worker process owns a piece of storage (here: an ECS Fargate task with an EFS workspace mount). Reads and writes are funneled through the same FIFO task queue. When the worker is healthy and lightly loaded, this works. When the queue backs up — bulk writes, a wedged worker, a multi-hour zombie task that never got reaped — every interactive read times out and the operator UI silently goes blank.

In this incident: a Computer's admin Workspace tab showed "No workspace files yet." while the files were sitting healthy on EFS, because the `workspace_file_list` task had been queued behind 2,000 `workspace_file_write` tasks for a Computer whose runtime had stopped heart-beating. The admin Lambda polled `computer_tasks` for 12 s, timed out, swallowed the error, and rendered empty state. Twice this had happened before — both times the response was "wait for the worker to drain."

## The pattern

For read-only operations against storage owned by a worker, **don't go through the worker.** Stand up a VPC-attached Lambda with the same storage mounted and read it directly. Writes stay on the queue (they have ordering semantics with the worker's in-process state and can't be safely raced from a sidecar).

### Concrete shape

1. **Storage is already shared.** If you have one EFS file system with per-worker access points (chrooted subpaths), you can create a *shared admin access point* rooted higher up and mount it in a single Lambda that sees every (tenantId, resourceId) at request time. No per-worker Lambda config.
2. **Sidecar Lambda is small and stateless.** UUID-validate the path inputs at the boundary, `safeJoin` under the chroot, filter operational artifacts (manifests, hidden files) to match the worker's own listing semantics. ~250 LOC.
3. **Existing handler invokes the sidecar.** The admin's primary workspace API stays at `agent`/`template`/`defaults` (S3-backed); only the `computer` branch routes to the sidecar via `LambdaClient.send(InvokeCommand)`. Errors propagate as upstream-failure status codes — no more silent empty state.
4. **Writes stay on the queue.** The worker is still authoritative for mutations. The sidecar is read-only.

### Why not put the existing handler in a VPC?

Putting one Lambda in the VPC drags every other path through it (S3 cold-start hit, S3 VPC endpoint or NAT required for the non-VPC paths). The sidecar isolates blast radius: agent / template / defaults paths stay outside the VPC; only the new Computer-target read path pays the VPC cost.

### Why not "make the worker handle priority"?

Considered. FIFO-with-priority introduces a starvation problem at the bottom of the queue (priority-0 writes never get claimed if priority-1 reads arrive faster than they're processed). It also doesn't help when the worker is dead — which is the failure mode we cared about. A direct read decouples the admin UI from worker liveness entirely.

## Implementation in this repo

- PR: thinkwork-ai/thinkwork#1204 + follow-up #1205 (ASCII fix on SG description).
- Sidecar handler: `packages/api/src/handlers/workspace-files-efs.ts`.
- Existing handler swap: `packages/api/workspace-files.ts` `handleComputerList` / `handleComputerGet` → `LambdaClient.send(InvokeCommand)`.
- Shared EFS access point: `terraform/modules/app/computer-runtime/main.tf` `aws_efs_access_point.workspace_admin` rooted at `/tenants`.
- Lambda Terraform: `terraform/modules/app/lambda-api/handlers.tf` standalone `aws_lambda_function.workspace_files_efs` with `vpc_config` + `file_system_config`.

## When the pattern applies (and when it doesn't)

**Apply when:**
- Worker is the sole bottleneck for both reads and writes today
- Storage is mounted (EFS, NFS) — direct read is feasible
- Reads need to work even when the worker is unhealthy (dashboards, audit-style "what files exist?")
- Read latency matters (sub-100 ms beats >1 s queue-polling)

**Don't apply when:**
- Reads need consistency with in-flight writes the worker hasn't flushed yet
- The worker's processing is itself the transformation you want to read (e.g., the worker produces materialized views; reading raw storage skips the materialization)
- Storage isn't independently addressable (object stores, key/value DBs without external read access)

## Failure modes captured at implementation time

- **Vite + `Buffer` polyfill** (admin client side, downstream of this PR): `ssm-session` and similar Node-ish libraries reach for `Buffer` at module load. Polyfill in `main.tsx`.
- **AWS Lambda EFS mount needs an Access Point, not the root.** You can't `FileSystemConfigs: [{ arn: aws_efs_file_system.arn }]`; it has to be an access point ARN.
- **Lambda in VPC needs `AWSLambdaVPCAccessExecutionRole`** so it can manage ENIs. Easy to miss.
- **Security Group descriptions reject non-ASCII** — see `aws-security-group-description-rejects-non-ascii-2026-05-13.md`.
