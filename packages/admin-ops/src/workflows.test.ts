import { describe, expect, it } from "vitest";
import type { AdminOpsClient } from "./client.js";
import {
  checkWorkflowVisibility,
  listWorkflows,
  triggerWorkflowRun,
  type Workflow,
} from "./workflows.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AGENT_OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT_OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "wwwwwwww-wwww-wwww-wwww-wwwwwwwwwwww",
    tenantId: TENANT_A,
    name: "Customer onboarding",
    description: null,
    lifecycleStatus: "active",
    visibility: "agent_private",
    ownerAgentId: AGENT_OWNER,
    primaryTriggerFamily: "agent",
    currentVersionNumber: 1,
    capabilityFlags: { start: true, monitor: true },
    readinessState: "ready",
    readinessReasons: [],
    lastRunAt: null,
    ...overrides,
  };
}

describe("checkWorkflowVisibility", () => {
  it("rejects missing workflows", () => {
    const result = checkWorkflowVisibility(null, {
      tenantId: TENANT_A,
      agentId: AGENT_OWNER,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects cross-tenant workflows", () => {
    const result = checkWorkflowVisibility(workflow(), {
      tenantId: TENANT_B,
      agentId: AGENT_OWNER,
    });
    expect(result).toEqual({ ok: false, reason: "different_tenant" });
  });

  it("allows tenant-shared active workflows for any tenant agent", () => {
    const result = checkWorkflowVisibility(
      workflow({ visibility: "tenant_shared", ownerAgentId: null }),
      { tenantId: TENANT_A, agentId: AGENT_OTHER },
    );
    expect(result).toEqual({ ok: true });
  });

  it("allows only the owning agent to invoke an agent-private workflow", () => {
    expect(
      checkWorkflowVisibility(workflow(), {
        tenantId: TENANT_A,
        agentId: AGENT_OWNER,
      }),
    ).toEqual({ ok: true });
    expect(
      checkWorkflowVisibility(workflow(), {
        tenantId: TENANT_A,
        agentId: AGENT_OTHER,
      }),
    ).toEqual({ ok: false, reason: "private_to_other_agent" });
  });

  it("rejects inactive or explicitly non-startable workflows", () => {
    expect(
      checkWorkflowVisibility(workflow({ lifecycleStatus: "archived" }), {
        tenantId: TENANT_A,
        agentId: AGENT_OWNER,
      }),
    ).toEqual({ ok: false, reason: "workflow_not_active" });
    expect(
      checkWorkflowVisibility(
        workflow({ capabilityFlags: { start: false, monitor: true } }),
        { tenantId: TENANT_A, agentId: AGENT_OWNER },
      ),
    ).toEqual({ ok: false, reason: "workflow_not_startable" });
  });
});

describe("workflow GraphQL wrappers", () => {
  it("lists active workflows for a tenant", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> =
      [];
    const rows = [workflow({ visibility: "tenant_shared" })];
    const client = fakeClient(async (query, variables) => {
      calls.push({ query, variables });
      return { workflows: rows };
    });

    const result = await listWorkflows(client, { tenantId: TENANT_A });

    expect(result).toBe(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain("workflows");
    expect(calls[0]!.variables).toEqual({ tenantId: TENANT_A, limit: 100 });
  });

  it("serializes workflow input without exposing backend identifiers", async () => {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> =
      [];
    const run = {
      id: "run-id",
      tenantId: TENANT_A,
      workflowId: "workflow-id",
      status: "running",
      triggerFamily: "agent",
      triggerSource: "admin_ops_mcp",
      actorType: "agent",
      actorId: AGENT_OWNER,
      idempotencyKey: "retry-key",
      correlationId: "retry-key",
      backendExecutionId: "arn:aws:states:execution",
      backendExecutionRef: { routineExecutionId: "routine-exec-id" },
      readinessSnapshot: { state: "ready" },
      startedAt: "2026-06-21T00:00:00.000Z",
      lastEventAt: "2026-06-21T00:00:00.000Z",
      errorCode: null,
      errorMessage: null,
    };
    const client = fakeClient(async (query, variables) => {
      calls.push({ query, variables });
      return { triggerWorkflowRun: run };
    });

    const result = await triggerWorkflowRun(client, {
      workflowId: "workflow-id",
      agentId: AGENT_OWNER,
      idempotencyKey: "retry-key",
      args: { accountId: "acct-1" },
    });

    expect(result).toBe(run);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain("triggerWorkflowRun");
    expect(calls[0]!.variables).toEqual({
      input: {
        workflowId: "workflow-id",
        input: JSON.stringify({ accountId: "acct-1" }),
        idempotencyKey: "retry-key",
        triggerSource: "admin_ops_mcp",
        actorType: "agent",
        actorId: AGENT_OWNER,
        agentId: AGENT_OWNER,
      },
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
