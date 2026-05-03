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
import type { AdminOpsClient } from "./client.js";
import {
  buildAgentRoutineIntent,
  checkRoutineVisibility,
  createAgentRoutine,
  triggerRoutineRun,
  type Routine,
} from "./routines.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AGENT_OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT_OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    tenantId: TENANT_A,
    agentId: AGENT_OWNER,
    visibility: "agent_private",
    owningAgentId: AGENT_OWNER,
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

  it("allows any agent in the tenant to invoke a tenant_shared routine", () => {
    const result = checkRoutineVisibility(
      routine({
        visibility: "tenant_shared",
        owningAgentId: null,
        agentId: null,
      }),
      { tenantId: TENANT_A, agentId: AGENT_OTHER },
    );
    expect(result.ok).toBe(true);
  });

  it("still rejects cross-tenant access on tenant_shared routines", () => {
    const result = checkRoutineVisibility(
      routine({
        visibility: "tenant_shared",
        owningAgentId: null,
        agentId: null,
      }),
      { tenantId: TENANT_B, agentId: AGENT_OTHER },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("different_tenant");
  });

  it("uses owningAgentId (not agentId) for the private-routine ownership check", () => {
    // Schema follow-up bundle: a routine can have agentId set to one
    // execution agent while owningAgentId points at the authoring
    // agent. The MCP routine_invoke check is gated on owningAgentId.
    const result = checkRoutineVisibility(
      routine({
        agentId: AGENT_OTHER,
        owningAgentId: AGENT_OWNER,
        visibility: "agent_private",
      }),
      { tenantId: TENANT_A, agentId: AGENT_OWNER },
    );
    expect(result.ok).toBe(true);
  });
});

describe("createAgentRoutine", () => {
  it("submits intent-only createRoutine input so the API planner builds ASL artifacts", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
    const created = routine({
      name: "Check Austin Weather",
      description:
        "Fetch Austin weather and email the summary to ericodom37@gmail.com.",
    });
    const client = fakeClient(async (query, variables) => {
      calls.push({ query, variables });
      return { createRoutine: created };
    });

    const result = await createAgentRoutine(client, {
      tenantId: TENANT_A,
      agentId: AGENT_OWNER,
      name: "Check Austin Weather",
      description: "Daily weather check",
      intent: "Fetch Austin weather and email the summary to ericodom37@gmail.com.",
      suggestedSteps: ["Fetch Austin weather", "Email the summary"],
    });

    expect(result).toBe(created);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.variables!.input as Record<string, unknown>;
    expect(input).toMatchObject({
      tenantId: TENANT_A,
      agentId: AGENT_OWNER,
      owningAgentId: AGENT_OWNER,
      visibility: "agent_private",
      name: "Check Austin Weather",
    });
    expect(input.description).toBe(
      [
        "Daily weather check",
        "",
        "Fetch Austin weather and email the summary to ericodom37@gmail.com.",
        "",
        "Suggested steps:",
        "- Fetch Austin weather",
        "- Email the summary",
      ].join("\n"),
    );
    expect(input).not.toHaveProperty("asl");
    expect(input).not.toHaveProperty("markdownSummary");
    expect(input).not.toHaveProperty("stepManifest");
  });

  it("builds an intent string without blank suggested steps", () => {
    expect(
      buildAgentRoutineIntent({
        intent: "Fetch Austin weather and email it.",
        suggestedSteps: ["Fetch weather", "  ", "Send email"],
      }),
    ).toBe(
      [
        "Fetch Austin weather and email it.",
        "",
        "Suggested steps:",
        "- Fetch weather",
        "- Send email",
      ].join("\n"),
    );
  });

  it("omits the suggested-steps section when every suggested step is blank", () => {
    expect(
      buildAgentRoutineIntent({
        intent: "Fetch Austin weather and email it.",
        suggestedSteps: ["  ", "\t"],
      }),
    ).toBe("Fetch Austin weather and email it.");
  });
});

describe("triggerRoutineRun", () => {
  it("serializes args as AWSJSON input", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
    const execution = {
      id: "execution-id",
      status: "running",
      triggerSource: "agent_tool",
      startedAt: "2026-05-03T00:00:00.000Z",
    };
    const client = fakeClient(async (query, variables) => {
      calls.push({ query, variables });
      return { triggerRoutineRun: execution };
    });

    const result = await triggerRoutineRun(client, {
      routineId: "routine-id",
      args: { location: "Austin", units: "imperial" },
    });

    expect(result).toBe(execution);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.variables).toEqual({
      routineId: "routine-id",
      input: JSON.stringify({ location: "Austin", units: "imperial" }),
    });
  });
});

function fakeClient(
  graphql: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<unknown>,
): AdminOpsClient {
  return {
    apiUrl: "https://api.test",
    tenantId: TENANT_A,
    fetch: async () => {
      throw new Error("fetch not expected");
    },
    graphql: graphql as AdminOpsClient["graphql"],
    withTenant: () => fakeClient(graphql),
  };
}
