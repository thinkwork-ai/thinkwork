import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLastMileTasksAdapter,
  type LastMileMcpClient,
} from "./tasks-adapter.js";

const baseCreateInput = {
  tenantId: "tenant-1",
  spaceId: "space-1",
  threadId: "thread-1",
  checklistItemId: "checklist-1",
  idempotencyKey: "tenant-1:thread-1:checklist-1",
  title: "Collect sales tax exemption",
  required: true,
  assignee: {
    roleKey: "accounting",
    externalId: "user-100",
    displayName: "Accounting Owner",
  },
};

describe("LastMile Tasks adapter", () => {
  let client: LastMileMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    client = {
      callTool: vi.fn(),
    };
  });

  it("creates a task through the configured MCP tool and normalizes the response", async () => {
    client.callTool.mockResolvedValueOnce({
      structuredContent: {
        task: {
          id: "LM-100",
          url: "https://tasks.example/LM-100",
          title: "Collect sales tax exemption",
          status: "In Progress",
          assignee: { id: "user-100", name: "Accounting Owner" },
          dueDate: "2026-06-01",
        },
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    await expect(adapter.createTask(baseCreateInput)).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        externalTaskId: "LM-100",
        externalTaskUrl: "https://tasks.example/LM-100",
        status: "in_progress",
        blocked: false,
        syncStatus: "synced",
        assignee: {
          externalId: "user-100",
          displayName: "Accounting Owner",
        },
        dueAt: "2026-06-01",
        idempotent: false,
        needsTriage: false,
      }),
    });
    expect(client.callTool).toHaveBeenCalledWith({
      serverName: "lastmile-tasks",
      toolName: "create_task",
      arguments: expect.objectContaining({
        idempotencyKey: "tenant-1:thread-1:checklist-1",
        title: "Collect sales tax exemption",
        assignee: expect.objectContaining({ externalId: "user-100" }),
      }),
    });
  });

  it("treats duplicate/idempotent creates as successful existing task snapshots", async () => {
    client.callTool.mockResolvedValueOnce({
      structuredContent: {
        result: {
          taskId: "LM-100",
          externalTaskUrl: "https://tasks.example/LM-100",
          status: "todo",
          existing: true,
        },
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    const result = await adapter.createTask(baseCreateInput);

    expect(result).toMatchObject({
      ok: true,
      value: {
        externalTaskId: "LM-100",
        idempotent: true,
        status: "todo",
      },
    });
  });

  it("creates an unassigned task and marks triage when a role has no external owner", async () => {
    client.callTool.mockResolvedValueOnce({
      structuredContent: {
        task: {
          id: "LM-101",
          status: "not started",
        },
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    const result = await adapter.createTask({
      ...baseCreateInput,
      assignee: { roleKey: "finance", displayName: "Finance" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        externalTaskId: "LM-101",
        assignee: null,
        needsTriage: true,
        syncStatus: "synced",
      },
    });
    expect(client.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          assignee: {
            roleKey: "finance",
            externalId: null,
            displayName: "Finance",
          },
        }),
      }),
    );
  });

  it("preserves sanitized provider error detail for outages", async () => {
    client.callTool.mockRejectedValueOnce({
      status: 503,
      message: "LastMile unavailable",
      apiKey: "super-secret",
    });
    const adapter = createLastMileTasksAdapter({ client });

    const result = await adapter.readTask({ externalTaskId: "LM-100" });

    expect(result).toMatchObject({
      ok: false,
      providerError: {
        code: "MCP_CALL_FAILED",
        message: "LastMile unavailable",
        status: 503,
        retryable: true,
        detail: {
          status: 503,
          message: "LastMile unavailable",
          apiKey: "[redacted]",
        },
      },
    });
  });

  it("maps provider permission denial without throwing", async () => {
    client.callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: {
        code: "FORBIDDEN",
        status: 403,
        message: "not allowed",
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    await expect(adapter.createTask(baseCreateInput)).resolves.toMatchObject({
      ok: false,
      providerError: {
        code: "FORBIDDEN",
        status: 403,
        retryable: false,
        message: "not allowed",
      },
    });
  });

  it("treats a provider response without a task id as an unhealthy sync response", async () => {
    client.callTool.mockResolvedValueOnce({
      structuredContent: {
        task: {
          title: "Collect sales tax exemption",
          status: "todo",
        },
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    await expect(adapter.createTask(baseCreateInput)).resolves.toMatchObject({
      ok: false,
      providerError: {
        code: "PROVIDER_RESPONSE_MISSING_TASK_ID",
        retryable: false,
        message: "LastMile task provider response did not include a task id",
      },
    });
  });

  it("gates external comments through Space writeback policy before calling MCP", async () => {
    const adapter = createLastMileTasksAdapter({ client });

    await expect(
      adapter.postComment({
        externalTaskId: "LM-100",
        body: "Coordinator summary",
        writeback: {
          policy: "status_and_comments",
          action: "agent_comment",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      blockedByPolicy: expect.objectContaining({
        reason: "agent_comment_confirmation_required",
      }),
    });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("posts confirmed comments through MCP", async () => {
    client.callTool.mockResolvedValueOnce({
      structuredContent: {
        commentId: "comment-1",
        postedAt: "2026-05-19T00:00:00Z",
      },
    });
    const adapter = createLastMileTasksAdapter({ client });

    await expect(
      adapter.postComment({
        externalTaskId: "LM-100",
        body: "Ready for accounting review",
        writeback: {
          policy: "status_and_comments",
          action: "agent_comment",
          humanConfirmed: true,
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        externalTaskId: "LM-100",
        commentId: "comment-1",
      },
    });
    expect(client.callTool).toHaveBeenCalledWith({
      serverName: "lastmile-tasks",
      toolName: "post_comment",
      arguments: {
        externalTaskId: "LM-100",
        body: "Ready for accounting review",
        metadata: {},
      },
    });
  });
});
