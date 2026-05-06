---
title: "feat: ThinkWork Computer phase three runtime activation"
type: feat
status: completed
date: 2026-05-06
origin: docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
---

# feat: ThinkWork Computer phase three runtime activation

## Overview

Phase 1 created the Computer domain model and migration foundation. Phase 2 made Computers visible in admin, added typed Templates, operationalized migration, and landed the ECS/EFS runtime skeleton with heartbeat, no-op work claiming, and manager lifecycle control.

Phase 3 should turn that skeleton into a deployable, operator-usable Computer runtime:

- Operators can build/push a versioned Computer runtime image and tell ECS services which image tag to run.
- Operators can provision/start/stop/restart/status a Computer from the CLI without hand-crafting REST calls.
- The API can enqueue auditable Computer tasks, including idempotent health checks and a safe workspace file write.
- The runtime can complete first useful tasks against the EFS workspace and run a Google CLI binary smoke without user OAuth token hydration.
- A lightweight reconciler can move Computers toward their desired runtime status so "always-on by default" is not dependent on a human pressing start once.

This phase does not implement delegated AgentCore execution, user OAuth token hydration, Gmail/Calendar/Docs mutation tasks, browser/computer-use sessions, or a remote desktop UI. Those capabilities need the runtime activation spine to be real first.

## Problem Frame

ThinkWork Computer is only valuable if the Computer is more than a renamed Agent record. Phase 2 established the ECS/EFS runtime path, but it still lacks the operational glue required to run it repeatedly: image build/push mechanics, CLI controls, task enqueue APIs, a useful task surface, and reconciliation from database intent to ECS desired state.

The product promise is "one persistent Computer per user, always available by default, with a live workspace and delegated workers later." Phase 3 should prove the first half of that promise in a measured way: a Computer service can be deployed, kept aligned with `desired_runtime_status`, write useful state to EFS, and report auditable task/event results through ThinkWork APIs.

## Requirements Trace

- R1. Computers replace user-specific Agents as the primary product model.
- R2. Each human user has exactly one Computer in v1.
- R3. Computers are always-on by default.
- R4. Computers own persistent user work state.
- R5. ThinkWork Computer is positioned as a governed AWS-native workplace.
- R10. Computers delegate bounded work to Agents.
- R11. Delegated results return into the Computer.
- R12. Audit preserves delegation attribution.
- R14. v1 proves the Computer with personal work orchestration.
- R15. Google CLI/tooling is part of the v1 proof.
- R16. The Computer has a live filesystem workspace.
- R17. S3 remains durability and audit infrastructure, not the primary live workspace.
- R18. Streaming and lower latency are architectural upsides, not v1 acceptance gates.
- R19. The Computer cost target is acceptable below roughly `$10/month/user` before variable storage/network effects.
- R20. Per-user credentials remain user-owned.
- R21. Governance applies to Computers and Agents.

**Origin flows:** F1 User gets a Computer, F3 Computer delegates work to an Agent, F4 Computer performs personal work orchestration.

**Origin acceptance examples:** AE1 primary Computer surface, AE3 delegation writeback and attribution, AE4 Google Workspace plus live files, AE5 governed/cost-accounted success without streaming guarantee.

## Scope Boundaries

### In scope

- Runtime image build/push helper and documented deployment path.
- CLI runtime lifecycle commands for provision/start/stop/restart/status.
- Runtime task enqueue API usable by CLI and future admin/mobile clients.
- Runtime handlers for `health_check`, `workspace_file_write`, and `google_cli_smoke`.
- Event/audit records for task enqueue, start, completion, failure, and runtime reconciliation.
- A scheduled reconciler Lambda that can provision/start/stop Computers according to `desired_runtime_status`.
- Tests for API task contracts, runtime task handlers, CLI registration, reconciler selection, and manager image/tag behavior.

### Deferred for later

- Delegated AgentCore execution from `computer_delegations`.
- User OAuth token hydration for Google Workspace.
- Gmail, Calendar, Drive, Docs, and Sheets read/write task types.
- Browser/computer-use sessions inside ECS.
- Rich admin task composer or live workspace file browser.
- Multi-Computer-per-user behavior.
- EC2 capacity-provider optimization.

## Context & Research

### Relevant Code and Patterns

- `docs/plans/2026-05-06-005-feat-thinkwork-computer-phase-one-foundation-plan.md` introduced `computers`, `computer_tasks`, `computer_events`, `computer_snapshots`, and `computer_delegations`.
- `docs/plans/2026-05-06-006-feat-thinkwork-computer-phase-two-product-runtime-plan.md` completed the admin surface, typed Templates UX, migration operationalization, runtime REST endpoints, ECS/EFS Terraform substrate, runtime container skeleton, manager lifecycle handler, and docs.
- `packages/database-pg/src/schema/computers.ts` already has task status/idempotency fields, runtime intent/status fields, EFS metadata, ECS service metadata, and heartbeat timestamps.
- `packages/api/src/handlers/computer-runtime.ts` and `packages/api/src/lib/computers/runtime-api.ts` are the service-auth runtime API. They already handle config, heartbeat, task claim, task event, complete, and fail.
- `packages/api/src/handlers/computer-manager.ts` and `packages/api/src/lib/computers/runtime-control.ts` are the service-auth manager API. They already handle provision/start/stop/restart/status and register per-Computer ECS task definitions.
- `packages/computer-runtime/src/task-loop.ts`, `workspace.ts`, and `api-client.ts` are the runtime loop and first task handling surface. Today they handle no-op and health check only.
- `apps/cli/src/commands/computer.ts` already owns Computer migration commands and uses `apps/cli/src/api-client.ts` for service-auth REST calls.
- `terraform/modules/app/lambda-api/handlers.tf` is the handler registration point for new REST Lambdas and schedules.
- `scripts/build-lambdas.sh` must include any new Lambda handler.
- `.github/workflows/deploy.yml` already has image build/deploy patterns for runtime images; any Computer runtime image step should avoid cross-wiring AgentCore/Lambda image tags.

### Institutional Learnings

- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` applies directly: pushing a new runtime image is not enough. ECS services need an explicit task-definition/service update path and version marker.
- `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md` warns that Lambda and runtime images need separate architecture/tag handling. Computer runtime should use its own ARM64 image tags.
- `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md` reinforces that Phase 3 must not push OAuth secrets or refresh tokens into EFS or container env vars. Google work in this phase is binary smoke only.
- `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` supports conservative awaited dispatches for smoke/reconcile calls when a user-facing response needs durable enqueue evidence.

### External Research Decision

No new external research is required for this implementation slice. The Phase 2 plan already captured the relevant AWS Fargate/EFS pricing and ECS EFS constraints, and Phase 3 follows existing repo patterns for ECS task-definition registration, Lambda scheduling, CLI service-auth calls, and runtime polling. If the implementation changes AWS service semantics beyond the current manager skeleton, use official AWS documentation before expanding the plan.

## Key Technical Decisions

- **Keep runtime callbacks service-auth REST.** The ECS runtime should not use user GraphQL auth. It uses `/api/computers/runtime/*` with `API_AUTH_SECRET`, matching Phase 2.
- **Expose task enqueue through the product API, not the runtime API.** Users/admin clients should enqueue Computer tasks through GraphQL or CLI operator commands; the runtime API remains runtime-only.
- **Make CLI the first full control surface.** Admin can show runtime fields today, but lifecycle operations that create AWS resources should first be CLI-backed and service-auth gated.
- **Reconcile from database intent to ECS state.** `desired_runtime_status` is the source of product intent. A scheduled reconciler should provision/start/stop services so always-on does not rely on manual runtime manager calls.
- **Use immutable-ish image tags for rollout.** The manager already accepts `COMPUTER_RUNTIME_IMAGE_TAG`; Phase 3 should provide a build/push path and ensure provision/restart moves the ECS service to that tag.
- **Do safe workspace tasks before real Google tasks.** `workspace_file_write` proves EFS state. `google_cli_smoke` proves the image contains the CLI. User-token-backed Gmail/Calendar/Docs work remains later.
- **Do not implement delegation yet, but keep the contract honest.** Phase 3 should document that task/event attribution is ready for delegated Agent outputs; actual `computer_delegations` execution is a follow-up.

## Implementation Units

- U1. **Add Computer task enqueue/read contracts**

**Goal:** Let authorized product/API callers create auditable Computer tasks and inspect recent task state without writing directly to the runtime service API.

**Requirements:** R3, R4, R10, R11, R12, R16, R17, R20, R21; F3, F4; AE3, AE4, AE5.

**Dependencies:** Phase 1 task tables and Phase 2 runtime claim/complete API.

**Files:**

- Modify: `packages/database-pg/graphql/types/computers.graphql`
- Create: `packages/api/src/graphql/resolvers/computers/enqueueComputerTask.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/computers/computerTasks.query.ts`
- Modify: `packages/api/src/graphql/resolvers/computers/index.ts`
- Create: `packages/api/src/lib/computers/tasks.ts`
- Test: `packages/api/src/graphql/resolvers/computers/enqueueComputerTask.mutation.test.ts`
- Test: `packages/api/src/lib/computers/tasks.test.ts`
- Modify: `apps/admin/src/gql/graphql.ts`
- Modify: `apps/cli/src/gql/graphql.ts`
- Modify: `apps/mobile/src/gql/graphql.ts`

**Approach:**

- Add `ComputerTask`, `ComputerTaskStatus`, `ComputerTaskInput`, `EnqueueComputerTaskInput`, `ComputerTaskType` or a constrained string strategy to GraphQL.
- Support first task types: `health_check`, `workspace_file_write`, and `google_cli_smoke`.
- Validate tenant membership and Computer ownership using existing Computer resolver auth patterns. Tenant admins can enqueue for any tenant Computer; normal members can enqueue for their own Computer.
- Validate task input shape by task type. `workspace_file_write` should require a relative path and string content; paths must stay inside the workspace. `google_cli_smoke` should require no token material.
- Insert `computer_tasks` with optional `idempotency_key`; on unique conflict, return the existing task rather than creating duplicates.
- Insert a `computer_events` row for `computer_task_enqueued`.
- Keep output/error fields opaque JSON for now; runtime completion remains the source of result details.

**Patterns to follow:**

- `packages/api/src/graphql/resolvers/computers/createComputer.mutation.ts`
- `packages/api/src/graphql/resolvers/computers/computers.query.ts`
- `packages/api/src/lib/computers/runtime-api.ts`
- `packages/database-pg/src/schema/computers.ts`

**Test scenarios:**

- Happy path: tenant admin enqueues a `health_check` task for a tenant Computer.
- Happy path: normal member enqueues a `workspace_file_write` task for their own Computer.
- Edge case: duplicate idempotency key returns the existing task.
- Error path: normal member cannot enqueue for another user's Computer.
- Error path: `workspace_file_write` rejects absolute paths and `..` traversal.
- Error path: unsupported task type is rejected before insert.
- Integration: GraphQL schema loads and generated clients include the task contracts.

**Verification:**

- API resolver tests pass.
- Generated GraphQL types compile in admin, CLI, and mobile packages.

- U2. **Add first useful runtime task handlers**

**Goal:** Make the ECS runtime do observable, bounded work against the EFS workspace.

**Requirements:** R3, R4, R14, R15, R16, R17, R20, R21; F4; AE4, AE5.

**Dependencies:** U1 and Phase 2 runtime API.

**Files:**

- Modify: `packages/computer-runtime/src/task-loop.ts`
- Modify: `packages/computer-runtime/src/workspace.ts`
- Modify: `packages/computer-runtime/src/google-cli-smoke.ts`
- Test: `packages/computer-runtime/test/task-loop.test.ts`
- Test: `packages/computer-runtime/test/workspace.test.ts`
- Test: `packages/computer-runtime/test/google-cli-smoke.test.ts`

**Approach:**

- Implement `workspace_file_write` with strict relative path validation, parent directory creation, UTF-8 content writes, and structured output containing the workspace-relative path.
- Implement `google_cli_smoke` by invoking the existing binary-smoke helper and returning binary availability/version/help output. Do not accept or log OAuth tokens.
- Keep task logs bounded; do not echo full user content in console logs or events.
- Emit task events around useful task start/finish where they help auditing without duplicating completion events.

**Patterns to follow:**

- `packages/computer-runtime/src/workspace.ts`
- `packages/computer-runtime/test/task-loop.test.ts`
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`

**Test scenarios:**

- Happy path: `workspace_file_write` creates a nested file under the workspace.
- Error path: absolute path and traversal path are rejected.
- Happy path: `google_cli_smoke` returns an unavailable result when the binary is missing, without failing the runtime.
- Error path: malformed task input fails the task and emits a safe error payload.

**Verification:**

- Runtime package tests pass.
- Runtime task outputs are small structured JSON values.

- U3. **Add CLI runtime controls and task commands**

**Goal:** Give operators a supported command-line path for Computer lifecycle control and task enqueueing.

**Requirements:** R3, R4, R5, R16, R19, R21; F1, F4; AE1, AE4, AE5.

**Dependencies:** U1 and Phase 2 manager API.

**Files:**

- Modify: `apps/cli/src/commands/computer.ts`
- Test: `apps/cli/__tests__/registration-smoke.test.ts`
- Test: `apps/cli/__tests__/no-required-options.test.ts`

**Approach:**

- Add `thinkwork computer runtime provision|start|stop|restart|status --tenant <uuid> --computer <uuid>`.
- Add `thinkwork computer task enqueue --tenant <uuid> --computer <uuid> --type <task-type> [--path <path>] [--content <content>] [--idempotency-key <key>]`.
- Use `apiFetchRaw` for manager calls and GraphQL or REST-backed helper for task enqueue depending on the least invasive contract available after U1.
- Render concise human output and exact JSON under existing JSON mode.
- Preserve existing migration command behavior.

**Patterns to follow:**

- `apps/cli/src/commands/computer.ts`
- `apps/cli/src/commands/mcp.ts`
- `apps/cli/src/lib/output.ts`

**Test scenarios:**

- CLI registration includes `computer runtime` and `computer task` commands.
- Commands do not require options at construction time.
- Missing tenant/computer IDs print the existing CLI error style.
- Runtime command maps actions to `/api/computers/manager`.
- Task enqueue maps CLI flags into the correct task input payload.

**Verification:**

- CLI tests pass.
- Manual command help renders without throwing.

- U4. **Add runtime reconciliation and image rollout support**

**Goal:** Make always-on Computers recoverable from database intent and make image rollout explicit.

**Requirements:** R3, R5, R16, R19, R21; F1; AE1, AE5.

**Dependencies:** Phase 2 runtime manager.

**Files:**

- Create: `packages/api/src/handlers/computer-runtime-reconciler.ts`
- Create: `packages/api/src/handlers/computer-runtime-reconciler.test.ts`
- Modify: `packages/api/src/lib/computers/runtime-control.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `terraform/modules/app/lambda-api/main.tf`
- Modify: `terraform/modules/app/lambda-api/variables.tf`
- Modify: `.github/workflows/deploy.yml`
- Create: `scripts/build-computer-runtime-image.sh`

**Approach:**

- Reconciler selects active Computers whose `desired_runtime_status` differs from observed runtime state, have no ECS service despite desired running, or have stale heartbeat while desired running.
- For desired running and no service, call `provisionComputerRuntime`.
- For desired running and provisioned stopped/unknown, call `start`.
- For desired stopped and provisioned running/starting, call `stop`.
- Limit batch size through an environment variable to avoid thundering herd behavior.
- Record `computer_runtime_reconcile_*` events for success and failure.
- Keep image rollout explicit: build/push `packages/computer-runtime` to its dedicated ECR repo with a stage/sha tag, then set `COMPUTER_RUNTIME_IMAGE_TAG` for manager/reconciler use.
- Avoid using mutable `latest` as the only deployed identity.

**Patterns to follow:**

- `packages/api/src/handlers/job-schedule-manager.ts`
- `packages/api/src/lib/computers/runtime-control.ts`
- `terraform/modules/app/lambda-api/handlers.tf`
- `.github/workflows/deploy.yml`
- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`

**Test scenarios:**

- Happy path: desired running + no service provisions one Computer.
- Happy path: desired stopped + existing running service stops it.
- Edge case: batch size caps selected Computers.
- Error path: one failed Computer records a failure event and does not stop the batch.
- Integration: new reconciler handler is built and scheduled only when runtime substrate is configured.
- Image rollout: build helper tags ARM64 image with the supplied tag and repository URL.

**Verification:**

- Reconciler tests cover selection and action dispatch with mocks.
- Lambda build includes `computer-runtime-reconciler`.
- Terraform format/validation accepts schedule wiring.

- U5. **Update runtime docs and rollout runbook**

**Goal:** Make Phase 3 operable without relying on memory of this session.

**Requirements:** R5, R14, R15, R16, R17, R19, R20, R21; AE4, AE5.

**Dependencies:** U1 through U4.

**Files:**

- Modify: `docs/runbooks/computer-runtime-runbook.md`
- Modify: `docs/src/content/docs/applications/admin/computers.mdx`
- Modify: `docs/src/content/docs/concepts/computers.mdx`

**Approach:**

- Document image build/push, runtime manager commands, task enqueue examples, reconciler behavior, and rollback posture.
- Document the exact Phase 3 task set and clarify that Google Workspace OAuth-backed tasks are deferred.
- Add an operator smoke sequence: migrate/create Computer, push image, provision/start, enqueue health check, enqueue workspace file write, enqueue Google CLI smoke, inspect events/heartbeat, stop.
- Call out cost and quota drivers without updating pricing claims unless verified separately.

**Test scenarios:**

- Documentation build should render updated pages.
- Runbook commands should match implemented CLI flags and endpoint names.

**Verification:**

- Docs build succeeds or affected markdown/MDX files pass existing checks.

## System-Wide Impact

- **Runtime execution:** Computer runtime shifts from skeleton/no-op to safe file and binary-smoke work against EFS.
- **API surface:** GraphQL gains task enqueue/read contracts; service-auth runtime endpoints remain narrow.
- **Operations:** CLI becomes the first supported lifecycle/task control surface. The reconciler reduces manual start/provision drift.
- **Infrastructure:** A new scheduled Lambda may call ECS/EFS through the existing manager library. Image rollout becomes explicit and versioned.
- **Security:** No user refresh tokens, OAuth client secrets, or provider access tokens are stored in EFS or runtime env vars in this phase.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Reconciler provisions too many Computers at once | Medium | High | Batch size cap, schedule gate, structured failure events, and no tenant-wide enablement without dev smoke |
| Runtime image tag drifts from pushed image | Medium | Medium | Versioned tag helper, runbook smoke, and manager/restart path that registers a fresh task definition |
| Workspace file writes escape EFS root | Low | High | Strict relative path validation in API and runtime, with traversal tests |
| Google CLI smoke becomes mistaken for full Google Workspace support | Medium | Medium | Name task and docs as smoke-only; no OAuth input accepted |
| Service-auth task enqueue bypasses user authorization | Low | High | Product task enqueue goes through GraphQL authorization; runtime service-auth remains runtime-only |
| CLI grows too broad before admin UX is ready | Medium | Low | Keep commands operator-oriented and document them as Phase 3 activation controls |

## Success Metrics

- A runtime image can be built, pushed, referenced by `COMPUTER_RUNTIME_IMAGE_TAG`, and used by a provisioned ECS service.
- `thinkwork computer runtime provision|start|stop|restart|status` works against the deployed service-auth manager.
- A Computer task can be enqueued through the API/CLI, claimed by the runtime, completed, and inspected with task/event status.
- `workspace_file_write` creates a file inside the EFS workspace and rejects unsafe paths.
- `google_cli_smoke` confirms whether the runtime image contains the Google CLI binary without requiring user OAuth.
- The reconciler can bring a small batch of active Computers toward `desired_runtime_status` and record success/failure events.

## Sources & References

- Origin document: `docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md`
- Phase 1 plan: `docs/plans/2026-05-06-005-feat-thinkwork-computer-phase-one-foundation-plan.md`
- Phase 2 plan: `docs/plans/2026-05-06-006-feat-thinkwork-computer-phase-two-product-runtime-plan.md`
- Related code: `packages/database-pg/src/schema/computers.ts`
- Related code: `packages/api/src/handlers/computer-runtime.ts`
- Related code: `packages/api/src/lib/computers/runtime-api.ts`
- Related code: `packages/api/src/handlers/computer-manager.ts`
- Related code: `packages/api/src/lib/computers/runtime-control.ts`
- Related code: `packages/computer-runtime/src/task-loop.ts`
- Related code: `apps/cli/src/commands/computer.ts`
- Institutional learning: `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`
- Institutional learning: `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md`
- Institutional learning: `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`
