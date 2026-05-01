/**
 * Routines admin-ops — visibility check tests.
 *
 * Plan: docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md §U11.
 * The visibility model is the load-bearing safety property for the
 * routine_invoke MCP tool: a private routine must not be invokable by
 * an agent that doesn't own it. These tests exercise the pure logic
 * without GraphQL.
 */

import { describe, it, expect } from "vitest";
import { checkRoutineVisibility, type Routine } from "./routines.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AGENT_OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT_OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    tenantId: TENANT_A,
    agentId: AGENT_OWNER,
    name: "Test routine",
    description: null,
    status: "active",
    engine: "step_functions",
    currentVersion: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("checkRoutineVisibility", () => {
  it("rejects when routine is null (not found)", () => {
    const result = checkRoutineVisibility(null, {
      tenantId: TENANT_A,
      agentId: AGENT_OWNER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("rejects when caller is in a different tenant", () => {
    const result = checkRoutineVisibility(routine(), {
      tenantId: TENANT_B,
      agentId: AGENT_OWNER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("different_tenant");
  });

  it("allows the owning agent to invoke a private routine", () => {
    const result = checkRoutineVisibility(routine(), {
      tenantId: TENANT_A,
      agentId: AGENT_OWNER,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects another agent in the same tenant from invoking a private routine", () => {
    const result = checkRoutineVisibility(routine(), {
      tenantId: TENANT_A,
      agentId: AGENT_OTHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_to_other_agent");
  });

  it("allows any agent in the tenant to invoke a tenant-shared routine (agentId=null)", () => {
    const result = checkRoutineVisibility(routine({ agentId: null }), {
      tenantId: TENANT_A,
      agentId: AGENT_OTHER,
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects cross-tenant access on tenant-shared routines", () => {
    const result = checkRoutineVisibility(routine({ agentId: null }), {
      tenantId: TENANT_B,
      agentId: AGENT_OTHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("different_tenant");
  });
});
