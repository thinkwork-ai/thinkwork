---
title: "feat: Activate Routine agent MCP tools"
type: feat
status: completed
date: 2026-05-03
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Activate Routine agent MCP tools

## Summary

Make the Routine agent-facing MCP tools safe to activate in the live AgentCore runtime. The current `create_routine` and `routine_invoke` tool definitions exist in `packages/lambda/admin-ops-mcp.ts`, but they are gated behind `ROUTINES_AGENT_TOOLS_ENABLED` and `create_routine` still stamps a placeholder `Succeed` state machine. Before flipping the runtime flag broadly, this slice should route agent-created routines through the same recipe-backed authoring path used by admin, add coverage for the inert/live gate, and document the deployment verification steps needed after AgentCore warm-flush.

## Problem Frame

The admin Routine MVP is shipped: operators can create, edit, test, and inspect Step Functions-backed routines. The remaining near-term risk is the agent surface. `create_routine` is visible to agents once the runtime is warm-flushed, but today it creates an agent-private placeholder routine and expects later iteration via `publishRoutineVersion`. That is not a good activation contract: the first live agent call should create an executable recipe-backed routine when the intent is supported, or return an actionable unsupported-intent error without minting a fake active routine.

This plan keeps the activation path narrow. It does not flip production environment variables by itself; it prepares code and tests so the operator can confidently warm-flush the runtime and enable the tools.

## Requirements Trace

- R1. `create_routine` must use recipe-backed authoring artifacts for supported intents, not placeholder `Succeed` ASL.
- R2. `create_routine` must keep routines agent-private by default with `visibility: "agent_private"` and `owningAgentId = caller agentId`.
- R3. Unsupported or underspecified intents must fail before creating a routine.
- R4. `routine_invoke` must continue enforcing tenant and owning-agent visibility before triggering execution.
- R5. Both tools must remain inert unless `ROUTINES_AGENT_TOOLS_ENABLED=true`.
- R6. Tests must cover inert gate behavior, supported `create_routine`, unsupported `create_routine`, private visibility checks, and `routine_invoke` GraphQL input forwarding.
- R7. The plan must preserve the AgentCore runtime deployment reality: new code does not reach the runtime until the deploy path performs `UpdateAgentRuntime` or an operator runs an equivalent warm-flush.

**Origin actors:** A3 (tenant agent), A4 (ThinkWork engineer/operator).
**Origin flows:** F3 (agent self-stamps), F4 (agent invokes routine).
**Related acceptance examples:** Agent calls `create_routine`, gets an executable routine id; agent calls `routine_invoke`, execution starts; another agent cannot invoke a private routine.

## Scope Boundaries

- No environment flip in code. `ROUTINES_AGENT_TOOLS_ENABLED` stays the runtime gate.
- No mobile conversational authoring work.
- No Phase E `python()` usage dashboard.
- No new recipe types.
- No broad LLM planner. Reuse the current deterministic recipe-backed draft planner.
- No raw ASL authoring exposed to agents in this slice.
- No direct AWS Step Functions calls from MCP helpers; keep GraphQL as the product-owned boundary.

## Context & Research

### Relevant Code and Patterns

- `packages/lambda/admin-ops-mcp.ts` defines `create_routine`, `routine_invoke`, the env gate, and the agent-stamp markdown helper.
- `packages/admin-ops/src/routines.ts` wraps the GraphQL `createRoutine` and `triggerRoutineRun` operations and currently owns the placeholder ASL.
- `packages/admin-ops/src/routines.test.ts` covers the pure visibility matrix for `routine_invoke`.
- `packages/api/src/graphql/resolvers/routines/createRoutine.mutation.ts` already routes intent-only creation through `buildRoutineDraftFromIntent` when explicit ASL artifacts are omitted.
- `packages/api/src/lib/routines/routine-draft-authoring.ts` and `packages/api/src/lib/routines/routine-authoring-planner.ts` are the current recipe-backed authoring path.
- `packages/api/src/__tests__/routines-publish-flow.test.ts` verifies `createRoutine`, `planRoutineDraft`, `rebuildRoutineVersion`, and routine execution input behavior.
- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` explains why runtime warm-flush / `UpdateAgentRuntime` verification is required before expecting agents to see new code.

### Existing Constraints

- The `admin-ops` package intentionally keeps MCP tool helpers as thin GraphQL wrappers.
- Agent runtime activation is a deployment/ops action, not something a unit test can complete.
- `tenantId` may come from a tenant-pinned admin key or tool args; helpers should preserve the existing `clientFor(args)` behavior.
- `requireAdminOrApiKeyCaller(ctx, tenantId, "create_routine")` already gates the server-side authoring path.

### External Research

Skipped. The implementation follows existing local MCP, GraphQL, recipe-authoring, and AgentCore deployment patterns.

## Key Technical Decisions

- **Use GraphQL intent-only creation instead of client-side ASL assembly.** `createRoutine` already owns the recipe-backed authoring path. The MCP helper should omit placeholder `asl`, `markdownSummary`, and `stepManifest` so the server builds real artifacts from `name` and `intent`.
- **Keep the env gate as the activation boundary.** Unit tests should prove both tools return `not_yet_enabled` when disabled and live behavior only happens when the flag is true.
- **Preserve agent-private defaults at the MCP boundary.** The helper still passes `agentId`, `owningAgentId`, and `visibility: "agent_private"` so the server stores the correct ownership model.
- **Do not broaden runtime permissions.** `routine_invoke` stays a GraphQL `triggerRoutineRun` wrapper after visibility check.
- **Document live activation verification separately from code tests.** The PR can prove code behavior; a follow-up operator step must verify `tools/list` and live calls after runtime warm-flush.

## Implementation Units

### U1. Route `create_routine` through recipe-backed server authoring

**Goal:** Replace placeholder routine creation with the existing server-side recipe planner.

**Files:**

- Modify: `packages/admin-ops/src/routines.ts`
- Modify: `packages/lambda/admin-ops-mcp.ts`
- Test: `packages/admin-ops/src/routines.test.ts`

**Approach:**

- Remove the placeholder ASL constant and explicit artifact submission from `createAgentRoutine`.
- Send `name`, `description`, and a composed intent string to `createRoutine` without explicit `asl`, `markdownSummary`, or `stepManifest`.
- Preserve `agentId`, `owningAgentId`, and `visibility: "agent_private"`.
- Update tool copy so it no longer promises a no-op draft routine.

**Test Scenarios:**

- Supported Austin weather/email intent calls GraphQL `createRoutine` with no explicit ASL artifacts and includes agent-private ownership fields.
- Unsupported or too-short intent fails before GraphQL mutation.
- Markdown helper is removed or no longer used by `create_routine` tests.

### U2. Add MCP env-gate and call-shape coverage

**Goal:** Prove the inert/live boundary and GraphQL forwarding behavior.

**Files:**

- Modify: `packages/lambda/admin-ops-mcp.ts` if exports are needed for testability.
- Test: existing or new admin-ops MCP tests, preferably near `packages/api/src/__tests__/admin-ops-mcp.test.ts` or `packages/admin-ops/src/routines.test.ts` depending on available test harness.

**Approach:**

- Add focused tests for `ROUTINES_AGENT_TOOLS_ENABLED` disabled returning `not_yet_enabled`.
- Add tests for enabled `create_routine` delegating to `routineOps.createAgentRoutine`.
- Add tests for enabled `routine_invoke` fetching the routine, enforcing visibility, and forwarding args to `triggerRoutineRun`.

**Test Scenarios:**

- Disabled env flag returns `not_yet_enabled` for both tools and performs no GraphQL calls.
- Enabled `create_routine` rejects empty/underspecified intent.
- Enabled `routine_invoke` rejects a routine private to another agent.
- Enabled `routine_invoke` forwards arbitrary args as AWSJSON input through the helper.

### U3. Activation runbook notes

**Goal:** Leave the operator with concrete post-merge activation steps.

**Files:**

- Modify: `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- Optionally modify: `docs/guides/sandbox-environments.md` if the runtime warm-flush guidance needs a Routine-specific pointer.

**Approach:**

- Update the master plan's `Next Session Pickup` section after implementation so it no longer says "route through planner if placeholder"; the code should already do that.
- Add a short post-merge verification checklist: deploy / `UpdateAgentRuntime`, confirm `tools/list`, call disabled and enabled paths in dev, create supported routine, invoke it, inspect execution.

**Test Scenarios:**

- Documentation references only repo-relative paths.
- Checklist distinguishes code merge from runtime activation.

## Verification Plan

- `pnpm --filter @thinkwork/admin-ops test`
- Targeted API/Admin MCP tests if the tool harness lives outside `admin-ops`.
- `pnpm --filter @thinkwork/api test -- routines` if GraphQL behavior is touched.
- `git diff --check`.
- Manual post-merge/dev activation checklist from U3 after deploy, because unit tests cannot prove AgentCore runtime image freshness.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agent-created routines still become placeholders | Remove explicit ASL artifacts from the MCP helper and assert the GraphQL input shape in tests. |
| Unsupported agent intent creates a fake active routine | Preserve `createRoutine` unsupported-intent failure and assert no mutation path is called for underspecified intent. |
| Runtime still serves old tool code after merge | Follow the `UpdateAgentRuntime` / warm-flush guidance and verify `tools/list` from the live runtime. |
| Visibility model regresses | Keep existing pure visibility tests and add enabled `routine_invoke` tests around private/tenant-shared behavior. |
| Tool activation exposes too broad a surface | Keep `ROUTINES_AGENT_TOOLS_ENABLED` disabled by default and require explicit runtime env flip. |

## Sources & References

- Master plan: `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- Phase C authoring plan: `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md`
- Routine closeout compound doc: `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md`
- AgentCore runtime deployment learning: `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`
