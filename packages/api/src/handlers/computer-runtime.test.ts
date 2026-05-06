import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => {
  class ComputerNotFoundError extends Error {}
  class ComputerTaskNotFoundError extends Error {}
  return {
    resolveComputerRuntimeConfig: vi.fn(),
    recordComputerHeartbeat: vi.fn(),
    claimNextComputerTask: vi.fn(),
    appendComputerTaskEvent: vi.fn(),
    completeComputerTask: vi.fn(),
    failComputerTask: vi.fn(),
    ComputerNotFoundError,
    ComputerTaskNotFoundError,
  };
});

vi.mock("../lib/auth.js", () => ({
  extractBearerToken: (event: APIGatewayProxyEventV2): string | null => {
    const header = event.headers?.authorization ?? null;
    return header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : null;
  },
  validateApiSecret: (token: string): boolean => token === "service-secret",
}));

vi.mock("../lib/computers/runtime-api.js", () => ({
  resolveComputerRuntimeConfig: mocks.resolveComputerRuntimeConfig,
  recordComputerHeartbeat: mocks.recordComputerHeartbeat,
  claimNextComputerTask: mocks.claimNextComputerTask,
  appendComputerTaskEvent: mocks.appendComputerTaskEvent,
  completeComputerTask: mocks.completeComputerTask,
  failComputerTask: mocks.failComputerTask,
  ComputerNotFoundError: mocks.ComputerNotFoundError,
  ComputerTaskNotFoundError: mocks.ComputerTaskNotFoundError,
}));

import { handler } from "./computer-runtime.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const COMPUTER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TASK_ID = "99999999-8888-7777-6666-555555555555";

function event(
  method: string,
  path: string,
  options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    auth?: string | null;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    headers:
      options.auth === null
        ? {}
        : { authorization: options.auth ?? "Bearer service-secret" },
    queryStringParameters: options.query ?? {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2;
}

describe("computer-runtime handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveComputerRuntimeConfig.mockResolvedValue({
      computerId: COMPUTER_ID,
      tenantId: TENANT_ID,
    });
    mocks.recordComputerHeartbeat.mockResolvedValue({
      computerId: COMPUTER_ID,
      runtimeStatus: "running",
    });
    mocks.claimNextComputerTask.mockResolvedValue({
      id: TASK_ID,
      taskType: "noop",
    });
    mocks.appendComputerTaskEvent.mockResolvedValue({ id: "event-1" });
    mocks.completeComputerTask.mockResolvedValue({
      id: TASK_ID,
      status: "completed",
    });
    mocks.failComputerTask.mockResolvedValue({ id: TASK_ID, status: "failed" });
  });

  it("requires service auth", async () => {
    const response = await handler(
      event("GET", "/api/computers/runtime/config", { auth: null }),
    );
    expect(response.statusCode).toBe(401);
  });

  it("returns runtime config for a tenant-scoped Computer", async () => {
    const response = await handler(
      event("GET", "/api/computers/runtime/config", {
        query: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.resolveComputerRuntimeConfig).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
    });
  });

  it("records heartbeat updates", async () => {
    const response = await handler(
      event("POST", "/api/computers/runtime/heartbeat", {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
          runtimeStatus: "running",
          runtimeVersion: "phase2",
          workspaceRoot: "/workspace",
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.recordComputerHeartbeat).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      runtimeStatus: "running",
      runtimeVersion: "phase2",
      workspaceRoot: "/workspace",
    });
  });

  it("claims the next task and wraps empty queues explicitly", async () => {
    let response = await handler(
      event("POST", "/api/computers/runtime/tasks/claim", {
        body: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
      }),
    );
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      task: { id: TASK_ID, taskType: "noop" },
    });

    mocks.claimNextComputerTask.mockResolvedValueOnce(null);
    response = await handler(
      event("POST", "/api/computers/runtime/tasks/claim", {
        body: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
      }),
    );
    expect(JSON.parse(response.body ?? "{}")).toEqual({ task: null });
  });

  it("appends events and completes or fails task ownership-scoped paths", async () => {
    const eventResponse = await handler(
      event("POST", `/api/computers/runtime/tasks/${TASK_ID}/events`, {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
          eventType: "task_log",
          level: "info",
          payload: { ok: true },
        },
      }),
    );
    expect(eventResponse.statusCode).toBe(201);

    const completeResponse = await handler(
      event("POST", `/api/computers/runtime/tasks/${TASK_ID}/complete`, {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
          output: { ok: true },
        },
      }),
    );
    expect(completeResponse.statusCode).toBe(200);

    const failResponse = await handler(
      event("POST", `/api/computers/runtime/tasks/${TASK_ID}/fail`, {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
          error: { message: "boom" },
        },
      }),
    );
    expect(failResponse.statusCode).toBe(200);
  });

  it("validates UUID inputs before calling runtime code", async () => {
    const response = await handler(
      event("GET", "/api/computers/runtime/config", {
        query: { tenantId: "tenant", computerId: COMPUTER_ID },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(mocks.resolveComputerRuntimeConfig).not.toHaveBeenCalled();
  });
});
