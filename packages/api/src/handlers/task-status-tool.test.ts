import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => ({
  setTaskStatus: vi.fn(),
  setWorkItemStatus: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock("../lib/task-status-tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/task-status-tool.js")>();
  return {
    ...actual,
    setTaskStatus: mocks.setTaskStatus,
  };
});

vi.mock("../lib/work-items/work-item-status-tool.js", () => ({
  setWorkItemStatus: mocks.setWorkItemStatus,
}));

vi.mock("../lib/auth.js", () => ({
  validateApiSecret: (token: string) => token === "api-secret",
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mocks.authenticate,
}));

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "user-1",
              tenantId: "tenant-1",
              email: "eric@example.com",
            },
          ],
        }),
      }),
    }),
  },
}));

import { handler } from "./task-status-tool";

function event(
  body: unknown,
  headers: Record<string, string> = { authorization: "Bearer api-secret" },
  path = "/api/tasks/status",
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: "POST", path },
    },
    headers,
    body: JSON.stringify(body),
    rawPath: path,
  } as unknown as APIGatewayProxyEventV2;
}

function parse(res: { body?: unknown }) {
  return JSON.parse(res.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setTaskStatus.mockResolvedValue({
    ok: true,
    linkedTaskId: "task-1",
    previousStatus: "todo",
    status: "completed",
  });
  mocks.setWorkItemStatus.mockResolvedValue({
    ok: true,
    workItemId: "work-item-1",
    previousStatusCategory: "todo",
    statusCategory: "done",
    statusId: "status-done",
  });
});

describe("task-status-tool handler", () => {
  it("accepts service auth and calls the database status service", async () => {
    const res = await handler(
      event({
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        linkedTaskId: "task-1",
        status: "completed",
        note: "done",
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ isError: false });
    expect(mocks.setTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        linkedTaskId: "task-1",
        status: "completed",
        note: "done",
        actor: { type: "agent", id: "agent-1" },
      }),
    );
  });

  it("accepts mobile Cognito auth and resolves the caller user", async () => {
    mocks.authenticate.mockResolvedValue({
      authType: "cognito",
      email: "eric@example.com",
      tenantId: "tenant-1",
    });

    const res = await handler(
      event(
        {
          threadId: "thread-1",
          agentId: "agent-1",
          linkedTaskId: "task-1",
          status: "blocked",
        },
        { authorization: "Bearer user-jwt" },
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(mocks.setTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        linkedTaskId: "task-1",
        status: "blocked",
        actor: {
          type: "user",
          id: "user-1",
          email: "eric@example.com",
        },
      }),
    );
  });

  it("requires a task id and status before mutation", async () => {
    const res = await handler(
      event({
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        status: "completed",
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(parse(res)).toEqual({ error: "linkedTaskId is required" });
    expect(mocks.setTaskStatus).not.toHaveBeenCalled();
  });

  it("accepts native work item status updates on the work item endpoint", async () => {
    const res = await handler(
      event(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          workItemId: "work-item-1",
          statusCategory: "done",
          threadTurnId: "turn-1",
          toolCallId: "call-1",
          note: "done",
        },
        { authorization: "Bearer api-secret" },
        "/api/work-items/status",
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ isError: false });
    expect(mocks.setWorkItemStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        agentId: "agent-1",
        workItemId: "work-item-1",
        statusCategory: "done",
        threadTurnId: "turn-1",
        toolCallId: "call-1",
        actor: { type: "agent", id: "agent-1" },
      }),
    );
  });

  it("requires a work item id before native mutation", async () => {
    const res = await handler(
      event(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          agentId: "agent-1",
          statusCategory: "done",
        },
        { authorization: "Bearer api-secret" },
        "/api/work-items/status",
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(parse(res)).toEqual({ error: "workItemId is required" });
    expect(mocks.setWorkItemStatus).not.toHaveBeenCalled();
  });
});
