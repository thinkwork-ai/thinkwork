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
    checkGoogleWorkspaceConnection: vi.fn(),
    resolveGoogleWorkspaceCliToken: vi.fn(),
    delegateConnectorWorkTask: vi.fn(),
    executeThreadTurnTask: vi.fn(),
    loadThreadTurnContext: vi.fn(),
    recordThreadTurnResponse: vi.fn(),
    completeComputerTask: vi.fn(),
    cancelComputerTask: vi.fn(),
    failComputerTask: vi.fn(),
    loadRunbookExecutionContext: vi.fn(),
    startRunbookExecutionTask: vi.fn(),
    executeRunbookExecutionTask: vi.fn(),
    completeRunbookExecutionTask: vi.fn(),
    failRunbookExecutionTask: vi.fn(),
    completeRunbookExecutionRun: vi.fn(),
    recordRunbookExecutionResponse: vi.fn(),
    ComputerTaskDelegationError: class ComputerTaskDelegationError extends Error {
      statusCode: number;

      constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
      }
    },
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
  checkGoogleWorkspaceConnection: mocks.checkGoogleWorkspaceConnection,
  resolveGoogleWorkspaceCliToken: mocks.resolveGoogleWorkspaceCliToken,
  delegateConnectorWorkTask: mocks.delegateConnectorWorkTask,
  executeThreadTurnTask: mocks.executeThreadTurnTask,
  loadThreadTurnContext: mocks.loadThreadTurnContext,
  recordThreadTurnResponse: mocks.recordThreadTurnResponse,
  completeComputerTask: mocks.completeComputerTask,
  cancelComputerTask: mocks.cancelComputerTask,
  failComputerTask: mocks.failComputerTask,
  ComputerTaskDelegationError: mocks.ComputerTaskDelegationError,
  ComputerNotFoundError: mocks.ComputerNotFoundError,
  ComputerTaskNotFoundError: mocks.ComputerTaskNotFoundError,
}));

vi.mock("../lib/runbooks/runtime-api.js", () => ({
  loadRunbookExecutionContext: mocks.loadRunbookExecutionContext,
  startRunbookExecutionTask: mocks.startRunbookExecutionTask,
  executeRunbookExecutionTask: mocks.executeRunbookExecutionTask,
  completeRunbookExecutionTask: mocks.completeRunbookExecutionTask,
  failRunbookExecutionTask: mocks.failRunbookExecutionTask,
  completeRunbookExecutionRun: mocks.completeRunbookExecutionRun,
  recordRunbookExecutionResponse: mocks.recordRunbookExecutionResponse,
  RunbookRuntimeError: class RunbookRuntimeError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
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
    mocks.checkGoogleWorkspaceConnection.mockResolvedValue({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
    });
    mocks.resolveGoogleWorkspaceCliToken.mockResolvedValue({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      accessToken: "ya29.secret-token",
    });
    mocks.delegateConnectorWorkTask.mockResolvedValue({
      delegated: true,
      mode: "managed_agent",
      delegationId: "delegation-1",
      agentId: "agent-1",
      threadId: "thread-1",
      status: "running",
    });
    mocks.executeThreadTurnTask.mockResolvedValue({
      error: "legacy-disabled",
    });
    mocks.loadThreadTurnContext.mockResolvedValue({
      taskId: TASK_ID,
      source: "chat_message",
      computer: { id: COMPUTER_ID, name: "Marco", slug: "marco" },
      thread: { id: "thread-1", title: "Hello" },
      message: { id: "message-1", content: "Hi" },
      messagesHistory: [{ id: "message-1", role: "user", content: "Hi" }],
      model: "model-1",
    });
    mocks.recordThreadTurnResponse.mockResolvedValue({
      responded: true,
      mode: "computer_native",
      responseMessageId: "message-2",
      threadId: "thread-1",
      messageId: "message-1",
      status: "completed",
    });
    mocks.completeComputerTask.mockResolvedValue({
      id: TASK_ID,
      status: "completed",
    });
    mocks.cancelComputerTask.mockResolvedValue({
      id: TASK_ID,
      status: "cancelled",
    });
    mocks.failComputerTask.mockResolvedValue({ id: TASK_ID, status: "failed" });
    mocks.loadRunbookExecutionContext.mockResolvedValue({
      taskId: TASK_ID,
      run: {
        id: "run-1",
        status: "running",
        runbookSlug: "research-dashboard",
        runbookVersion: "0.1.0",
      },
      tasks: [],
    });
    mocks.startRunbookExecutionTask.mockResolvedValue({ id: "rt-1" });
    mocks.completeRunbookExecutionTask.mockResolvedValue({ id: "rt-1" });
    mocks.failRunbookExecutionTask.mockResolvedValue({ failed: true });
    mocks.completeRunbookExecutionRun.mockResolvedValue({ id: "run-1" });
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

    const cancelResponse = await handler(
      event("POST", `/api/computers/runtime/tasks/${TASK_ID}/cancel`, {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
          output: { cancelled: true },
        },
      }),
    );
    expect(cancelResponse.statusCode).toBe(200);
  });

  it("routes runbook runtime endpoints through service-auth task paths", async () => {
    const runbookTaskId = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";

    const contextResponse = await handler(
      event("POST", `/api/computers/runtime/tasks/${TASK_ID}/runbook/context`, {
        body: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
      }),
    );
    expect(contextResponse.statusCode).toBe(200);
    expect(mocks.loadRunbookExecutionContext).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
    });

    await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/runbook/tasks/${runbookTaskId}/start`,
        {
          body: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
        },
      ),
    );
    expect(mocks.startRunbookExecutionTask).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      runbookTaskId,
    });

    await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/runbook/tasks/${runbookTaskId}/complete`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
            output: { ok: true },
          },
        },
      ),
    );
    expect(mocks.completeRunbookExecutionTask).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      runbookTaskId,
      output: { ok: true },
    });

    await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/runbook/tasks/${runbookTaskId}/fail`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
            error: { message: "boom" },
          },
        },
      ),
    );
    expect(mocks.failRunbookExecutionTask).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      runbookTaskId,
      error: { message: "boom" },
    });

    await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/runbook/complete`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
            output: { done: true },
          },
        },
      ),
    );
    expect(mocks.completeRunbookExecutionRun).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      output: { done: true },
    });
  });

  it("delegates connector work through the service-auth task endpoint", async () => {
    const response = await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/delegate-connector-work`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
          },
        },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.delegateConnectorWorkTask).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      delegated: true,
      mode: "managed_agent",
      delegationId: "delegation-1",
    });
  });

  it("loads Computer-owned thread turn context through the service-auth task endpoint", async () => {
    const response = await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/thread-turn-context`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
          },
        },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.loadThreadTurnContext).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      taskId: TASK_ID,
      thread: { id: "thread-1" },
      message: { id: "message-1" },
    });
  });

  it("records Computer-native thread responses through the service-auth task endpoint", async () => {
    const response = await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/thread-turn-response`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
            content: "Assistant reply",
            model: "model-1",
            usage: { inputTokens: 3 },
          },
        },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.recordThreadTurnResponse).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      content: "Assistant reply",
      model: "model-1",
      usage: { inputTokens: 3 },
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      responded: true,
      mode: "computer_native",
      responseMessageId: "message-2",
    });
  });

  it("allows empty Computer-native thread response content", async () => {
    const response = await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/thread-turn-response`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
            content: "",
          },
        },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.recordThreadTurnResponse).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      taskId: TASK_ID,
      content: "",
      model: null,
      usage: undefined,
    });
  });

  it("surfaces connector work delegation errors with their status code", async () => {
    mocks.delegateConnectorWorkTask.mockRejectedValueOnce(
      new mocks.ComputerTaskDelegationError(
        "Computer has no delegated Managed Agent configured",
        409,
      ),
    );

    const response = await handler(
      event(
        "POST",
        `/api/computers/runtime/tasks/${TASK_ID}/delegate-connector-work`,
        {
          body: {
            tenantId: TENANT_ID,
            computerId: COMPUTER_ID,
          },
        },
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toContain(
      "Computer has no delegated Managed Agent configured",
    );
  });

  it("checks Google Workspace connection status without exposing tokens", async () => {
    const response = await handler(
      event("POST", "/api/computers/runtime/google-workspace/check", {
        body: { tenantId: TENANT_ID, computerId: COMPUTER_ID },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.checkGoogleWorkspaceConnection).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
    });
    expect(response.body).not.toContain("accessToken");
  });

  it("resolves Google Workspace CLI token through the runtime service endpoint", async () => {
    const response = await handler(
      event("POST", "/api/computers/runtime/google-workspace/cli-token", {
        body: {
          tenantId: TENANT_ID,
          computerId: COMPUTER_ID,
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.resolveGoogleWorkspaceCliToken).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      connected: true,
      tokenResolved: true,
      accessToken: "ya29.secret-token",
    });
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
