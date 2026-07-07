import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockAssertCanReadWorkflowTenant, mockLambdaSend } =
  vi.hoisted(() => ({
    mockRows: vi.fn(),
    mockAssertCanReadWorkflowTenant: vi.fn(),
    mockLambdaSend: vi.fn(),
  }));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockRows()),
        }),
      }),
    }),
  },
  snakeToCamel: (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return out;
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflowRuns: { id: "workflow_runs.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

vi.mock("./types.js", () => ({
  assertCanReadWorkflowTenant: mockAssertCanReadWorkflowTenant,
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn((input) => ({ input })),
}));

let resolver: typeof import("./resolveWorkflowApproval.mutation.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockAssertCanReadWorkflowTenant.mockReset();
  mockLambdaSend.mockReset();
  process.env.STAGE = "dev";
  vi.resetModules();
  resolver = await import("./resolveWorkflowApproval.mutation.js");
});

const ctx = {
  auth: { tenantId: "tenant-1", agentId: null, principalId: "user-1" },
} as any;

function decodePayload(): Record<string, unknown> {
  const cmd = mockLambdaSend.mock.calls[0][0].input;
  return JSON.parse(new TextDecoder().decode(cmd.Payload));
}

describe("resolveWorkflowApproval", () => {
  it("invokes workflow-resume RequestResponse with the decision payload and returns the run", async () => {
    mockRows
      .mockReturnValueOnce([
        { id: "run-1", tenant_id: "tenant-1", status: "waiting_for_human" },
      ])
      .mockReturnValueOnce([
        { id: "run-1", tenant_id: "tenant-1", status: "running" },
      ]);
    mockLambdaSend.mockResolvedValue({ StatusCode: 200 });

    const result = await resolver.resolveWorkflowApproval(
      null,
      { runId: "run-1", approve: true, note: "looks good" },
      ctx,
    );

    expect(mockAssertCanReadWorkflowTenant).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    const cmd = mockLambdaSend.mock.calls[0][0].input;
    expect(cmd.FunctionName).toBe("thinkwork-dev-api-workflow-resume");
    expect(cmd.InvocationType).toBe("RequestResponse");
    expect(decodePayload()).toEqual({
      tenantId: "tenant-1",
      workflowRunId: "run-1",
      approved: true,
      note: "looks good",
    });
    expect(result).toMatchObject({ id: "run-1", status: "running" });
  });

  it("errors cleanly for a run that is not awaiting approval, without invoking the Lambda", async () => {
    mockRows.mockReturnValueOnce([
      { id: "run-1", tenant_id: "tenant-1", status: "running" },
    ]);

    await expect(
      resolver.resolveWorkflowApproval(
        null,
        { runId: "run-1", approve: true },
        ctx,
      ),
    ).rejects.toThrow(/not awaiting approval/);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("denies a cross-tenant caller BEFORE any Lambda invoke", async () => {
    mockRows.mockReturnValueOnce([
      { id: "run-1", tenant_id: "tenant-other", status: "waiting_for_human" },
    ]);
    mockAssertCanReadWorkflowTenant.mockRejectedValue(
      new Error("not a member of tenant tenant-other"),
    );

    await expect(
      resolver.resolveWorkflowApproval(
        null,
        { runId: "run-1", approve: true },
        ctx,
      ),
    ).rejects.toThrow(/not a member/);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("surfaces a workflow-resume Lambda FunctionError to the caller", async () => {
    mockRows.mockReturnValueOnce([
      { id: "run-1", tenant_id: "tenant-1", status: "waiting_for_human" },
    ]);
    mockLambdaSend.mockResolvedValue({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: new TextEncoder().encode("boom"),
    });

    await expect(
      resolver.resolveWorkflowApproval(
        null,
        { runId: "run-1", approve: false },
        ctx,
      ),
    ).rejects.toThrow(/workflow-resume Lambda error: boom/);
  });
});
