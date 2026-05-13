---
title: "feat: Direct EFS listing for Computer workspaces (admin)"
type: feat
status: in-progress
date: 2026-05-13
---

# feat: Direct EFS listing for Computer workspaces

## Overview

Admin's Computer Workspace tab was rendering "No workspace files yet." even when the EFS workspace contained files. Root cause: workspace listing was routed through the per-Computer `computer_tasks` queue. The runtime claims and processes tasks FIFO, with no priority. A Computer with stale `running` zombies or a write backlog left admin's `workspace_file_list` task starved past the 12 s polling deadline; the admin caught the error silently and rendered an empty state.

The fix shipped in this plan moves Computer **list/get** off the queue and onto a dedicated VPC-attached Lambda (`workspace-files-efs`) that mounts the shared EFS and reads files directly. Computer **put/delete** stay on the queue (writes have ordering semantics with the runtime's in-process state; moving them is out of scope here).

## Status

- [x] U1 — Shared EFS access point + Lambda security group in `terraform/modules/app/computer-runtime/`.
- [x] U2 — Threaded ARN / SG-id through `module.thinkwork → module.lambda_api`.
- [x] U3 — Standalone `aws_lambda_function.workspace_files_efs` resource (VPC config + file_system_config). Cross-invoke IAM grant from the existing `workspace-files` Lambda.
- [x] U4 — Handler at `packages/api/src/handlers/workspace-files-efs.ts`. UUID-validated tenantId/computerId; path-traversal-rejecting `safeJoin`; operational-artifact filter matches the S3-backed list path.
- [x] U5 — Build entry in `scripts/build-lambdas.sh`.
- [x] U6 — `packages/api/workspace-files.ts` `handleComputerList` / `handleComputerGet` swapped to `LambdaClient.send(InvokeCommand)`. Helper `invokeWorkspaceFilesEfs` translates sidecar errors into upstream-failure status codes.
- [x] U7 — Tests: standalone sidecar handler (`workspace-files-efs-handler.test.ts`, 9 cases) + invoke-shape coverage in `workspace-files-handler.test.ts` (replaces the old queue-mock test).

## Non-goals (deferred)

- **Write/delete via EFS.** Mutations would race the runtime's in-process state. Leave on the queue.
- **Write-queue priority.** Lists and reads no longer share the queue with writes — list latency is bounded by EFS read perf, not write throughput. Priority is moot for this PR.
- **Heartbeat reconciler / stuck-`running` reaper.** The original investigation surfaced both. Reads now work even when the runtime is dead, so admin no longer goes blank on a hung runtime; the reapers would still be useful but are independent.
- **Computer terminal feature.** Tracked in a sibling plan (see below).

## Operational unblock for existing Computers

After deploy, every existing Computer's workspace tab should populate immediately — the listing path no longer depends on the runtime claiming a task. Computers whose runtime is wedged (e.g., Marco was hung at investigation time with 20+ minute heartbeat gap and 2,000 pending writes) still need the runtime restarted before their write backlog drains, but the listing UX is restored without that step.

If a Computer is fully wedged: `aws ecs update-service --cluster thinkwork-dev-computer --service thinkwork-dev-computer-<id> --force-new-deployment --region us-east-1`.

## Verification

- Open `admin → Computers → Marco → Workspace`. Confirm files appear regardless of runtime health.
- `aws lambda invoke --function-name thinkwork-dev-api-workspace-files-efs --payload '{"action":"list","tenantId":"<UUID>","computerId":"<UUID>"}'` → `{ ok: true, files: [...] }`.
- Confirm no new `workspace_file_list` rows accumulate in `computer_tasks` after deploy.
