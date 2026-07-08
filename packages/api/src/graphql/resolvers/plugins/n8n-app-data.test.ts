import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const { mockResolveCallerTenantId, mockResolveCallerUserId } = vi.hoisted(
  () => ({
    mockResolveCallerTenantId: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
  }),
);

vi.mock("../../utils.js", () => ({
  db: {},
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { n8nAppData } from "./n8n-app-data.js";

const CTX = { auth: { tenantId: null } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
});

describe("n8nAppData", () => {
  it("returns workflow and execution rows with redacted bridge linkage", async () => {
    const result = await n8nAppData(
      null,
      { installId: "install-n8n", executionLimit: 25 },
      CTX,
      {
        discoverWorkflows: vi.fn(async () => ({
          installId: "install-n8n",
          readinessState: "ready" as const,
          readinessReasons: [],
          workflows: [
            {
              externalWorkflowId: "wf-1",
              name: "Fulfillment follow-up",
              active: true,
              triggerTypes: ["webhook"],
              lastModifiedAt: new Date("2026-06-20T12:00:00.000Z"),
              lastExecutionAt: null,
              warnings: [],
              connectedWorkflowId: "workflow-1",
              connectedBindingId: "binding-1",
              readinessState: "ready" as const,
              readinessReasons: [],
            },
          ],
        })),
        discoverExecutions: vi.fn(async () => ({
          installId: "install-n8n",
          readinessState: "ready" as const,
          readinessReasons: [],
          nativeBaseUrl: "https://n8n.example.test/",
          executions: [
            {
              externalExecutionId: "exec-1",
              externalWorkflowId: "wf-1",
              workflowName: null,
              status: "success",
              mode: "webhook",
              startedAt: new Date("2026-06-20T12:00:00.000Z"),
              finishedAt: new Date("2026-06-20T12:00:03.000Z"),
              durationMs: 3000,
              failureMessage: null,
              nativeExecutionUrl:
                "https://n8n.example.test/workflow/wf-1/executions/exec-1",
              nativeWorkflowUrl: "https://n8n.example.test/workflow/wf-1",
              warnings: [],
            },
          ],
        })),
      },
    );

    expect(result.workflows[0]).toMatchObject({
      externalWorkflowId: "wf-1",
      nativeWorkflowUrl: "https://n8n.example.test/workflow/wf-1",
    });
    expect(result.executions[0]).toMatchObject({
      externalExecutionId: "exec-1",
      workflowName: "Fulfillment follow-up",
    });
  });

  it("rejects unauthenticated app data requests before discovery", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    const discoverWorkflows = vi.fn();

    await expect(
      n8nAppData(null, { installId: "install-n8n" }, CTX, {
        discoverWorkflows,
      }),
    ).rejects.toBeInstanceOf(GraphQLError);
    expect(discoverWorkflows).not.toHaveBeenCalled();
  });

  it("rejects invalid execution limits before discovery", async () => {
    const discoverWorkflows = vi.fn();

    await expect(
      n8nAppData(null, { installId: "install-n8n", executionLimit: 0 }, CTX, {
        discoverWorkflows,
      }),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(discoverWorkflows).not.toHaveBeenCalled();
  });
});
