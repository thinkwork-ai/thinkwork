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
        loadTelemetry: vi.fn(async () => [
          {
            id: "run-1",
            pluginInstallId: "install-n8n",
            managedApplicationId: "app-n8n",
            spaceId: "space-1",
            agentId: "agent-1",
            threadId: "thread-1",
            threadTurnId: "turn-1",
            openingMessageId: "message-1",
            status: "resumed",
            resumeStatus: "resumed",
            workflowId: "wf-1",
            workflowName: "Fulfillment follow-up",
            executionId: "exec-1",
            stepId: "step-1",
            correlationId: "correlation-1",
            requestId: "request-1",
            instructionsPreview: "Do work",
            inputPreview: null,
            outputPreview: "Done",
            errorMessage: null,
            summary: "Completed",
            links: null,
            timeoutSeconds: 900,
            expiresAt: new Date("2026-06-20T12:15:00.000Z"),
            resumeAttemptCount: 1,
            nextResumeAttemptAt: null,
            lastResumeAttemptAt: null,
            lastResumeHttpStatus: null,
            lastResumeError: null,
            resumedAt: new Date("2026-06-20T12:03:00.000Z"),
            terminalAt: new Date("2026-06-20T12:03:00.000Z"),
            acceptedAt: new Date("2026-06-20T12:00:00.000Z"),
            createdAt: new Date("2026-06-20T12:00:00.000Z"),
            updatedAt: new Date("2026-06-20T12:03:00.000Z"),
          },
          {
            id: "run-other-workflow",
            pluginInstallId: "install-n8n",
            managedApplicationId: "app-n8n",
            spaceId: "space-1",
            agentId: null,
            threadId: null,
            threadTurnId: null,
            openingMessageId: null,
            status: "failed",
            resumeStatus: "failed",
            workflowId: "wf-other",
            workflowName: null,
            executionId: "exec-1",
            stepId: "step-2",
            correlationId: "correlation-2",
            requestId: null,
            instructionsPreview: null,
            inputPreview: null,
            outputPreview: null,
            errorMessage: "Different workflow",
            summary: null,
            links: null,
            timeoutSeconds: 900,
            expiresAt: new Date("2026-06-20T12:15:00.000Z"),
            resumeAttemptCount: 0,
            nextResumeAttemptAt: null,
            lastResumeAttemptAt: null,
            lastResumeHttpStatus: null,
            lastResumeError: null,
            resumedAt: null,
            terminalAt: null,
            acceptedAt: new Date("2026-06-20T12:00:00.000Z"),
            createdAt: new Date("2026-06-20T12:00:00.000Z"),
            updatedAt: new Date("2026-06-20T12:03:00.000Z"),
          },
        ]),
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
    expect(result.executions[0].bridgeRuns).toHaveLength(1);
    expect(result.executions[0].bridgeRuns[0]).toMatchObject({
      id: "run-1",
      executionId: "exec-1",
      workflowId: "wf-1",
      outputPreview: "Done",
    });
    expect(JSON.stringify(result)).not.toContain("run-other-workflow");
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
