import { describe, expect, it, vi } from "vitest";
import {
  resolveTurnRunContext,
  type RunActingUserQueries,
} from "./run-acting-user.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const TURN_ID = "33333333-3333-3333-3333-333333333333";
const RUN_ID = "99999999-9999-9999-9999-999999999999";
const WORKFLOW_RUN_ID = "77777777-7777-7777-7777-777777777777";
const LOOP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RUN_AS_USER_ID = "88888888-8888-8888-8888-888888888888";

function makeQueries(
  overrides: Partial<RunActingUserQueries> = {},
): RunActingUserQueries {
  return {
    findRunForTurn: vi.fn(async () => ({
      runId: RUN_ID,
      agentLoopId: LOOP_ID,
      loopName: "Weekly pipeline report",
      runAsUserId: RUN_AS_USER_ID,
    })),
    findWorkflowRunForTurn: vi.fn(async () => null),
    isActiveTenantMember: vi.fn(async () => true),
    ...overrides,
  };
}

describe("resolveTurnRunContext (THINK-155 U1/U3)", () => {
  it("returns the run context with the run-as user when linked and an active tenant member", async () => {
    const queries = makeQueries();
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toEqual({
      runId: RUN_ID,
      agentLoopId: LOOP_ID,
      loopName: "Weekly pipeline report",
      actingUserId: RUN_AS_USER_ID,
      runKind: "agent_loop",
    });
    expect(queries.findRunForTurn).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });
    expect(queries.isActiveTenantMember).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: RUN_AS_USER_ID,
    });
  });

  it("returns null when the turn has no run linkage on either runner", async () => {
    const queries = makeQueries({
      findRunForTurn: vi.fn(async () => null),
    });
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toBeNull();
    expect(queries.findWorkflowRunForTurn).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      turnId: TURN_ID,
    });
    expect(queries.isActiveTenantMember).not.toHaveBeenCalled();
  });

  it("keeps the run context but nulls the acting user on a failed membership cross-check", async () => {
    const queries = makeQueries({
      isActiveTenantMember: vi.fn(async () => false),
    });
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toEqual({
      runId: RUN_ID,
      agentLoopId: LOOP_ID,
      loopName: "Weekly pipeline report",
      actingUserId: null,
      runKind: "agent_loop",
    });
  });

  it("skips the membership check when the automation carries no run-as user", async () => {
    const queries = makeQueries({
      findRunForTurn: vi.fn(async () => ({
        runId: RUN_ID,
        agentLoopId: LOOP_ID,
        loopName: null,
        runAsUserId: null,
      })),
    });
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result?.actingUserId).toBeNull();
    expect(queries.isActiveTenantMember).not.toHaveBeenCalled();
  });

  // THINK-227 U2: converged automations run on the interpreter — the run
  // context resolves through the workflow linkage with identical semantics.
  it("falls back to the workflow-run linkage for interpreter turns", async () => {
    const queries = makeQueries({
      findRunForTurn: vi.fn(async () => null),
      findWorkflowRunForTurn: vi.fn(async () => ({
        runId: WORKFLOW_RUN_ID,
        agentLoopId: LOOP_ID,
        loopName: "Weekly pipeline report",
        runAsUserId: RUN_AS_USER_ID,
      })),
    });
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toEqual({
      runId: WORKFLOW_RUN_ID,
      agentLoopId: LOOP_ID,
      loopName: "Weekly pipeline report",
      actingUserId: RUN_AS_USER_ID,
      runKind: "workflow",
    });
    expect(queries.isActiveTenantMember).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: RUN_AS_USER_ID,
    });
  });

  it("prefers the agent-loop linkage when both exist (legacy runner wins)", async () => {
    const queries = makeQueries();
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result?.runKind).toBe("agent_loop");
    expect(queries.findWorkflowRunForTurn).not.toHaveBeenCalled();
  });

  it("workflow membership cross-check failure nulls the acting user, keeps context", async () => {
    const queries = makeQueries({
      findRunForTurn: vi.fn(async () => null),
      findWorkflowRunForTurn: vi.fn(async () => ({
        runId: WORKFLOW_RUN_ID,
        agentLoopId: LOOP_ID,
        loopName: null,
        runAsUserId: RUN_AS_USER_ID,
      })),
      isActiveTenantMember: vi.fn(async () => false),
    });
    const result = await resolveTurnRunContext(
      { tenantId: TENANT_ID, turnId: TURN_ID },
      queries,
    );
    expect(result).toEqual({
      runId: WORKFLOW_RUN_ID,
      agentLoopId: LOOP_ID,
      loopName: null,
      actingUserId: null,
      runKind: "workflow",
    });
  });
});
