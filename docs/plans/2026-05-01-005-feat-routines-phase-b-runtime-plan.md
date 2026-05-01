---
title: "feat: Routines rebuild Phase B — runtime"
type: feat
status: active
date: 2026-05-01
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Routines rebuild Phase B — runtime

## Summary

Wire the live Step Functions runtime: Task wrapper Lambdas (`routine-task-python` with mandatory S3 offload, `routine-resume` for HITL `SendTaskSuccess`/`SendTaskFailure`), publish flow (`createRoutine` / `publishRoutineVersion` / `updateRoutine` resolvers replacing the legacy Python-code path), trigger fan-in swap (`triggerRoutineRun` mutation + `job-trigger.ts` ROUTINE_RUNNER_URL stub replacement), HITL bridge (`inbox_approval` recipe + `routine-approval-bridge.ts` + token persistence), and step-event ingestion (callback REST endpoints). After Phase B, routines are creatable and executable end-to-end via the GraphQL API even before any UI ships.

---

## Problem Frame

Phase B of the master plan (`docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`). Phase A's substrate exists; nothing executes routines yet. The current `triggerRoutineRun` only inserts a `thread_turns` row, and `job-trigger.ts` POSTs to a `ROUTINE_RUNNER_URL` that nothing hosts. Phase B replaces both with real `SFN.StartExecution` calls and stands up the Task wrappers, HITL bridge, and callback ingestion that the run UI in Phase D will read from.

---

## Requirements

R-IDs trace to the origin requirements doc.

- R1, R2, R10. Publish flow consumes the validator and produces ASL + state machine + alias (U7).
- R3, R11, R12, R13. HITL `inbox_approval` runtime: ASL Task with `.waitForTaskToken` → callback Lambda creates inbox row + persists token → operator decision → bridge → `SendTaskSuccess`/`SendTaskFailure` (U8).
- R8. `python()` Task wrapper with S3 offload (U6).
- R14, R16, R17. Step-event ingestion populates `routine_executions` + `routine_step_events` (U9).
- R18. Reuse existing `scheduled_jobs` triggers (U7 + `job-trigger.ts` swap).

**Origin actors:** A2 (operator approving HITL), A3 (agent invoking via `routine_invoke`).
**Origin flows:** F4 (HITL execution) is fully exercised after Phase B.
**Origin acceptance examples:** AE1 (HITL phrase recognition — partial; chat-side in Phase C), AE3 (validator error handling — exercised end-to-end at U7), AE4 (run UI surfaces awaiting_approval — data side here; UI side Phase D).

---

## Scope Boundaries

- No mobile / admin chat builder retarget (Phase C U10)
- No new MCP tools (Phase C U11)
- No admin nav / run-detail / run-list UI (Phase D)
- No legacy archival or `python()` dashboard (Phase E)
- Origin Scope Boundaries carried forward unchanged.

### Deferred to Follow-Up Work

- Phase A (Substrate) — `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` (must merge first)
- Phase C (Authoring) — `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md`
- Phase D (UI) — `docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md`
- Phase E (Cleanup + observability) — `docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md`

---

## Context & Research

Defer to the master plan's "Context & Research" section. Phase-B-specific highlights:

- `packages/lambda/job-trigger.ts:568-619` — single insertion point for the `SFN.StartExecution` swap
- `packages/api/src/graphql/resolvers/triggers/triggerRoutineRun.mutation.ts` — manual-trigger insertion point
- `packages/api/src/graphql/resolvers/inbox/workspace-review-bridge.ts` — exact shape for `routine-approval-bridge.ts`
- `packages/api/src/graphql/resolvers/inbox/{approveInboxItem,decideInboxItem,rejectInboxItem}.mutation.ts` — already dispatch on inbox_item.type
- `packages/api/agentcore-invoke.ts` — `InvokeAgentRuntimeCommand` shape (`agent_invoke` recipe uses AWS-SDK direct integration; no wrapper needed)
- `packages/agentcore-strands/agent-container/container-sources/sandbox_tool.py` — `InvokeCodeInterpreter` raw-boto3 shape (port to TS for U6)
- Institutional learnings particularly relevant: env-snapshot-at-handler-entry, raw-boto3-over-SDK-helper, narrow-REST-for-service-auth, `requireTenantAdmin` before any side effect, fire-and-forget Lambda invokes are forbidden.

---

## Key Technical Decisions

Carry from the master plan (Phase B-relevant subset):

- `python()` Task = thin Lambda wrapping `InvokeCodeInterpreterCommand` with raw boto3-equivalent SDK calls in TS; mandatory S3 offload.
- `agent_invoke` Task uses `arn:aws:states:::aws-sdk:bedrockagentcore:invokeAgentRuntime` direct integration — no wrapper Lambda.
- `routine_invoke` defaults to `.sync:2`; cycle detection at compose time (in the validator from Phase A U5).
- HITL via `Resource: arn:aws:states:::lambda:invoke.waitForTaskToken` invoking `routine-approval-callback`; token persisted in `routine_approval_tokens` keyed on Inbox item id.
- All resolvers use `requireTenantAdmin(ctx, tenantId)` BEFORE any external side effect (especially `StartExecution`, `SendTaskSuccess`).
- Service-to-service callbacks on narrow REST endpoints with Bearer `API_AUTH_SECRET`.
- Snapshot `THINKWORK_API_URL` + `API_AUTH_SECRET` at handler entry.
- `triggerRoutineRun` and `job-trigger` use RequestResponse semantics — no fire-and-forget.

---

## Open Questions

### Resolved During Planning

All Phase B open questions resolved in the master plan. No new ones surfaced.

### Deferred to Implementation

- Whether the `routine-approval-callback` is its own dedicated Lambda or rolled into the existing graphql-http handler's REST surface — decide based on blast-radius preference; dedicated is cleaner.
- Stream-parse exact shape of `InvokeCodeInterpreterCommand` in TS — reproduce from the Python boto3 shape; first integration test against dev exposes any drift.
- Whether `routine_executions` rows are inserted pre-emptively at `triggerRoutineRun` or only on the first execution-state-change EventBridge event — pre-emptive is simpler for the run-list UX.
- EventBridge rule routing SFN execution-state-change events to `routine-execution-callback` — Terraform module addition or inline in the routines-stepfunctions module from Phase A.

---

## Implementation Units

Units carried verbatim from the master plan. U-IDs preserved.

- U6. **Routine task wrappers: routine-task-python (S3 offload) + routine-resume**

**Goal:** Land the two new Task wrapper Lambdas. `agent_invoke` recipe needs no wrapper (uses AWS-SDK direct integration).

**Requirements:** R8, R11, R13

**Dependencies:** Phase A U1, U2

**Files:**
- Create: `packages/lambda/routine-task-python.ts`
- Create: `packages/lambda/routine-task-python.test.ts`
- Create: `packages/lambda/routine-resume.ts`
- Create: `packages/lambda/routine-resume.test.ts`
- Modify: `scripts/build-lambdas.sh` (both new entries; `BUNDLED_AGENTCORE_ESBUILD_FLAGS` for python wrapper)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (two `for_each` entries)
- Modify: `terraform/modules/app/lambda-api/main.tf` (IAM grants per master plan)

**Approach:**
- `routine-task-python` accepts `{ tenantId, executionArn, nodeId, code, networkAccess (default false), timeoutSeconds (default 300, max 900), env (filtered allowlist) }`. Calls `start_code_interpreter_session` → `invoke_code_interpreter` → `stop_code_interpreter_session` (always-`finally`). Streams output to `s3://thinkwork-${stage}-routine-output/<tenantId>/<executionArn>/<nodeId>/{stdout,stderr}.log`. Returns `{ exitCode, stdoutS3Uri, stderrS3Uri, stdoutPreview: first 4KB, truncated: bool }`.
- Stream parsing: terminal `result.structuredContent` is authoritative; intermediate `result.content[]` is concatenated text-block streaming chunks (per institutional learning).
- `routine-resume` accepts `{ taskToken, decision: 'success' | 'failure', output?, errorCode?, errorMessage? }`. Calls `SendTaskSuccess` / `SendTaskFailure`. Idempotent on already-consumed token.
- Both snapshot env at handler entry.

**Execution note:** Test-first for the python wrapper — mock the AWS SDK in unit tests, then add an integration test that exercises the path through dev manually before declaring done.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/sandbox_tool.py` (Python; port to TS)
- `packages/api/agentcore-invoke.ts` (TS Bedrock client setup)
- `packages/lambda/sandbox-log-scrubber.ts` (TS Lambda accessing the sandbox bucket)

**Test scenarios:**
- Happy path (python wrapper): code with stdout returns `{ exitCode: 0, stdoutS3Uri, stdoutPreview, truncated: false }`
- Happy path (python wrapper): large stdout (>4KB) returns `truncated: true`; full output in S3
- Happy path (resume): valid token success calls `SendTaskSuccess` with output
- Happy path (resume): valid token failure calls `SendTaskFailure` with errorCode/errorMessage
- Edge case (python wrapper): timeout returns sandbox's timeout exit code, stderr captured
- Edge case (python wrapper): network access not requested but code attempts network — captured to stderr
- Error path (python wrapper): InvokeCodeInterpreter throws — stderr captured, `exitCode: -1`, `errorClass: 'sandbox_invoke_failed'`
- Error path (resume): token already consumed — return success with `alreadyConsumed: true`
- Integration (python wrapper): real call to dev AgentCore sandbox returns exitCode + S3 keys
- Integration (resume): real `SendTaskSuccess` to a paused dev execution releases the wait

**Verification:**
- Both Lambdas pass unit tests
- `terraform deploy -s dev` provisions both with correct IAM
- Manual: invoke `routine-task-python` with `print("hello")` returns exitCode 0; S3 keys exist
- Manual: `routine-resume` releases a paused dev execution

---

- U7. **createRoutine / publishRoutineVersion / triggerRoutineRun resolvers — ASL flow live**

**Goal:** Wire the publish flow end-to-end: validator → `CreateStateMachine` (or `UpdateStateMachine` + `PublishStateMachineVersion`) → `UpdateAlias`. Replace the legacy `update_routine`-with-Python-code path. Trigger flow swaps to `SFN.StartExecution`.

**Requirements:** R1, R2, R10, R18, R19

**Dependencies:** Phase A U5 (validator), Phase A U2 (schema)

**Files:**
- Create: `packages/api/src/graphql/resolvers/routines/createRoutine.mutation.ts` (rewrite of existing under triggers/)
- Create: `packages/api/src/graphql/resolvers/routines/publishRoutineVersion.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/routines/updateRoutine.mutation.ts` (preserves name/description/visibility edits; ASL changes go through publishRoutineVersion)
- Modify: `packages/api/src/graphql/resolvers/triggers/triggerRoutineRun.mutation.ts` (swap thread_turns insert for `SFN.StartExecution`)
- Modify: `packages/api/src/graphql/resolvers/triggers/index.ts` (rewire imports)
- Modify: `packages/lambda/job-trigger.ts` (lines 568-619: swap ROUTINE_RUNNER_URL POST for `SFN.StartExecution`)
- Modify: `packages/api/src/handlers/routines.ts` (REST surface mirrors GraphQL)

**Approach:**
- `createRoutine`: gates with `requireTenantAdmin` BEFORE `CreateStateMachine`. Validates ASL via Phase A U5 validator. On success: `CreateStateMachine` with `tenantId`/`agentId`/`routineId` tags + `LoggingConfiguration` pointing at the shared log group + `Type=STANDARD`. Then `CreateAlias` pointing at version 1. Inserts `routines` row (`engine = 'step_functions'`, `state_machine_arn`, `alias_arn`). Inserts first `routine_asl_versions` row.
- `publishRoutineVersion`: validates → `UpdateStateMachine` + `PublishStateMachineVersion` + `UpdateAlias` pointer-flip → inserts new `routine_asl_versions` row with sequential version_number. Rolls back via `DeleteStateMachineVersion` on partial failure.
- `triggerRoutineRun`: gates → `SFN.StartExecution` against alias ARN with `Input` payload → inserts `routine_executions` row pre-emptively (status `running`, keyed on `sfn_execution_arn`). RequestResponse — surfaces AWS errors.
- `job-trigger`: same swap path; `trigger_source = 'schedule'`.
- All resolvers snapshot env at handler entry.

**Execution note:** Test-first integration test for `publishRoutineVersion` exercising validator → CreateStateMachine → DB write end-to-end against dev. The IAM and alias mechanics are the highest-value bug surface.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/triggers/createRoutine.mutation.ts` (existing) — auth pattern + REST shape
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` — RequestResponse + error-surfacing
- `packages/api/src/graphql/utils.ts` — `resolveCallerTenantId`

**Test scenarios:**
- Happy path: `createRoutine` with valid ASL creates state machine + alias + DB row; routine has `engine: 'step_functions'`
- Happy path: `publishRoutineVersion` increments version_number, flips alias, retains prior version_arn
- Happy path: `triggerRoutineRun` creates `routine_executions` row + real SFN execution; row status is `running` until completion
- Error path: `createRoutine` with invalid ASL returns the validator's errors unchanged; no state machine created, no DB row
- Error path: `publishRoutineVersion` AWS API throttle returns retryable error; partial state rolled back
- Error path: `triggerRoutineRun` against a routine with `engine = 'legacy_python'` returns deprecation error (not silent failure)
- Error path: covers AE3 — `createRoutine` with bogus `agent_invoke` agentId returns validator error
- Integration: end-to-end create → trigger → execution-completes against dev; `routine_executions.status` flips to `succeeded`

**Verification:**
- Resolver tests pass
- `pnpm typecheck` passes
- Real routine created against dev appears in AWS Step Functions console with correct tags

---

- U8. **HITL bridge: inbox_approval recipe + routine-approval-bridge.ts + token persistence**

**Goal:** Wire HITL end-to-end. The `inbox_approval` recipe (catalog entry from Phase A U4) emits an ASL Task with `.waitForTaskToken`. SFN reaches that state, callback Lambda creates an `inbox_items` row + persists task token in `routine_approval_tokens`. Existing `decideInboxItem` mutation gains a routine-aware bridge.

**Requirements:** R3, R11, R12, R13

**Dependencies:** U6 (routine-resume Lambda), Phase A U2 (token table), Phase A U4 (`inbox_approval` recipe ASL emitter)

**Files:**
- Create: `packages/api/src/graphql/resolvers/inbox/routine-approval-bridge.ts`
- Modify: `packages/api/src/graphql/resolvers/inbox/decideInboxItem.mutation.ts` (dispatch on `inbox_item.type === 'routine_approval'`)
- Modify: `packages/api/src/graphql/resolvers/inbox/approveInboxItem.mutation.ts` (same dispatch)
- Modify: `packages/api/src/graphql/resolvers/inbox/rejectInboxItem.mutation.ts` (same dispatch)
- Create: `packages/api/src/handlers/routine-approval-callback.ts` (narrow REST endpoint hit by SFN)
- Modify: `scripts/build-lambdas.sh` and `terraform/modules/app/lambda-api/handlers.tf` (callback handler entry)

**Approach:**
- `inbox_approval` recipe ASL: `Task` with `Resource: arn:aws:states:::lambda:invoke.waitForTaskToken`, parameter `FunctionName: routine-approval-callback`, `Payload: { taskToken: $$.Task.Token, executionArn, nodeId, tenantId, routineId, decisionShape, approvalRouting, timeoutBehavior, contextPreviewMd }`.
- `routine-approval-callback`: gates with API_AUTH_SECRET → inserts `inbox_items` row (type `routine_approval`, config carrying token + nodeId + decisionShape + previewMd) → inserts `routine_approval_tokens` row (consumed=false) → notifies via existing inbox path. Snapshots env.
- `routine-approval-bridge`: when an inbox item of type `routine_approval` is decided, conditional UPDATE the token row (consumed=false → consumed=true). If already consumed, return `alreadyDecided: true`. Else call `routine-resume` with `{ taskToken, decision, output: decisionPayload }`.

**Execution note:** Test-first the consume-once invariant — the most important safety property. Cover double-decide, decide-after-cancel, decide-after-timeout before wiring to SFN.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/inbox/workspace-review-bridge.ts` (mirror exactly)

**Test scenarios:**
- Happy path: covers AE1 — `inbox_approval` step pauses; inbox item created with markdown context naming the approval point
- Happy path: operator approves → token consumed → SFN resumes on success branch
- Happy path: operator rejects → token consumed → SFN resumes on failure branch
- Edge case: double-decide (race) → second decide returns `alreadyDecided: true`, no second `SendTaskSuccess`
- Edge case: routine deleted while approval pending → operator decision returns `executionAlreadyEnded: true`
- Error path: SFN execution timeout fires before operator decides → token stays consumed=false; reaper job (deferred) flags expired tokens
- Integration: covers AE4 (data side) — pending approval execution surfaces in `routine_executions` with `awaiting_approval` status

**Verification:**
- `pnpm --filter @thinkwork/api test routine-approval-bridge` passes
- A real routine with `inbox_approval` step against dev creates an inbox item; approving releases the execution

---

- U9. **routine-step-callback REST endpoint + step-event ingestion**

**Goal:** Narrow REST endpoints that Task wrappers and CloudWatch EventBridge piping callback to in order to populate `routine_step_events` and update `routine_executions` lifecycle states.

**Requirements:** R13, R14, R16, R17

**Dependencies:** U6 (callbacks from Task wrappers), Phase A U2 (tables)

**Files:**
- Create: `packages/api/src/handlers/routine-step-callback.ts`
- Create: `packages/api/src/handlers/routine-execution-callback.ts`
- Modify: `scripts/build-lambdas.sh` and `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `packages/lambda/routine-task-python.ts` (POST step-callback before/after sandbox invocation)
- Modify: `packages/lambda/routine-resume.ts` (POST step-callback after `SendTaskSuccess`)
- Modify: `terraform/modules/app/routines-stepfunctions/main.tf` (add EventBridge rule routing SFN execution-state-change → `routine-execution-callback`)

**Approach:**
- `POST /api/routines/step` accepts `{ tenantId, executionArn, nodeId, recipeType, status, startedAt, finishedAt?, inputJson?, outputJson?, errorJson?, llmCostUsdCents?, retryCount?, stdoutS3Uri?, stderrS3Uri?, stdoutPreview?, truncated? }`. Bearer `API_AUTH_SECRET`. Inserts (or upserts by composite key) `routine_step_events` row.
- `POST /api/routines/execution` accepts `{ executionArn, status, startedAt?, finishedAt?, totalLlmCostUsdCents? }`. Updates `routine_executions` row.
- Both snapshot env. Idempotent — CloudWatch may double-deliver events.
- For `agent_invoke` recipe (no wrapper Lambda), the EventBridge rule is the only path to per-step events; callback ingests on each `state-entered`/`state-exited`.

**Execution note:** Land tests covering happy path + idempotency for both endpoints.

**Patterns to follow:**
- `packages/api/src/handlers/sandbox-quota-check.ts` (narrow REST + Bearer)
- `packages/api/src/handlers/sandbox-invocation-log.ts` (append-only event ingestion)

**Test scenarios:**
- Happy path: `POST /api/routines/step` inserts new step event row
- Happy path: re-POST same event idempotently (no duplicate row)
- Happy path: `POST /api/routines/execution` flips status `running` → `succeeded`
- Edge case: out-of-order events (finish before start) merge correctly
- Error path: invalid Bearer token returns 401
- Integration: real SFN execution piped through EventBridge populates `routine_step_events` for an `agent_invoke`-only routine

**Verification:**
- Tests pass
- Manual: a dev SFN execution leaves `routine_step_events` rows queryable by execution_id

---

## System-Wide Impact

- **Interaction graph:** New touch points across `scheduled_jobs` (trigger → SFN start), `inbox_items` (HITL pause/resume), `agentcore-runtime` (agent_invoke direct integration), `agentcore-code-interpreter` (python() Task). Existing `thread_turns` flow unchanged.
- **Error propagation:** SFN execution failures propagate to `routine_executions.status = 'failed'` via U9 callbacks. SFN throttle/retry handled by SFN itself.
- **State lifecycle risks:** Double-decide HITL is the most acute risk; consume-once invariant in `routine_approval_tokens` is the load-bearing safety. Token reaper for expired tokens deferred.
- **API surface parity:** `createRoutine`/`triggerRoutineRun` updated in GraphQL + REST; MCP surface comes in Phase C.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Step Functions IAM missing a permission, fails silently at runtime | U7 integration test exercises full execution path against dev before further units |
| AgentCore SDK drift breaks `routine-task-python` | Use raw boto3-equivalent SDK calls; pin SDK version (institutional learning) |
| Task token leak (paused indefinitely) | `expires_at` column; reaper job deferred to v1.1 |
| 256KB state-payload limit hit | S3 offload mandatory; `stdoutPreview` capped at 4KB in code |
| Fire-and-forget Lambda invokes regress | All resolvers use RequestResponse + error-surfacing (institutional learning) |
| EventBridge double-delivers execution events | Step-callback endpoints idempotent on composite key |
| HITL double-decide race | Conditional UPDATE on token row (consumed=false → true) atomic |

---

## Sources & References

- **Master design plan:** `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- **Origin requirements:** `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`
- **Predecessor:** `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` (must merge first)
