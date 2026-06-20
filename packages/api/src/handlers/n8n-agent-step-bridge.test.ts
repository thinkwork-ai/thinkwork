import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticate, mockStart } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockStart: vi.fn(),
}));

vi.mock("../lib/n8n-agent-step/auth.js", () => {
  class N8nAgentStepAuthError extends Error {
    readonly statusCode = 401;
  }
  return {
    N8nAgentStepAuthError,
    authenticateN8nAgentStepBridgeRequest: mockAuthenticate,
  };
});

vi.mock("../lib/n8n-agent-step/start.js", () => {
  class N8nAgentStepStartError extends Error {
    constructor(
      message: string,
      readonly statusCode = 400,
    ) {
      super(message);
    }
  }
  return {
    N8nAgentStepStartError,
    startN8nAgentStepRun: mockStart,
  };
});

import { N8nAgentStepAuthError } from "../lib/n8n-agent-step/auth.js";
import { handler } from "./n8n-agent-step-bridge.js";

const AUTH_CONTEXT = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantSlug: "acme",
  pluginInstallId: "22222222-2222-4222-8222-222222222222",
  managedApplicationId: "33333333-3333-4333-8333-333333333333",
  bridgeCredentialSecretRef: "arn:secret",
};

const VALID_BODY = {
  workflowId: "wf-1",
  workflowName: "Lead enrichment",
  executionId: "exec-1",
  stepId: "recommendation",
  correlationId: "lead-123",
  agentId: "44444444-4444-4444-8444-444444444444",
  spaceId: "55555555-5555-4555-8555-555555555555",
  instructions: "Recommend next actions.",
  input: { leadId: "lead-123" },
  resumeUrl: "https://n8n.example.test/webhook-waiting/resume/abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue(AUTH_CONTEXT);
  mockStart.mockResolvedValue({
    runId: "66666666-6666-4666-8666-666666666666",
    status: "waiting",
    replayed: false,
    wakeupRequestId: "77777777-7777-4777-8777-777777777777",
    threadId: "88888888-8888-4888-8888-888888888888",
    threadIdentifier: "HOOK-42",
    threadNumber: 42,
    openingMessageId: "99999999-9999-4999-8999-999999999999",
    expiresAt: "2026-06-21T12:00:00.000Z",
  });
});

describe("n8n agent-step bridge handler", () => {
  it("short-circuits OPTIONS before auth", async () => {
    const res = await handler(event({ method: "OPTIONS", body: null }));

    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("starts an n8n agent-step run", async () => {
    const res = await handler(event({ body: VALID_BODY }));

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body ?? "{}")).toMatchObject({
      ok: true,
      runId: "66666666-6666-4666-8666-666666666666",
      replayed: false,
      wakeupRequestId: "77777777-7777-4777-8777-777777777777",
    });
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: "Bearer bridge-token",
        "x-tenant-slug": "acme",
      }),
    );
    expect(mockStart).toHaveBeenCalledWith(
      AUTH_CONTEXT,
      expect.objectContaining({
        workflowId: "wf-1",
        spaceId: "55555555-5555-4555-8555-555555555555",
        resumeUrl: expect.objectContaining({
          host: "n8n.example.test",
          path: "/webhook-waiting/resume/abc",
        }),
        requestId: "request-1",
      }),
    );
  });

  it("returns replayed bridge runs as accepted 202 responses", async () => {
    mockStart.mockResolvedValueOnce({
      runId: "66666666-6666-4666-8666-666666666666",
      status: "waiting",
      replayed: true,
      wakeupRequestId: null,
      threadId: "88888888-8888-4888-8888-888888888888",
      threadIdentifier: null,
      threadNumber: null,
      openingMessageId: "99999999-9999-4999-8999-999999999999",
      expiresAt: "2026-06-21T12:00:00.000Z",
    });

    const res = await handler(event({ body: VALID_BODY }));

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body ?? "{}")).toMatchObject({
      ok: true,
      replayed: true,
      wakeupRequestId: null,
    });
  });

  it("rejects invalid resume URLs before starting a run", async () => {
    const res = await handler(
      event({ body: { ...VALID_BODY, resumeUrl: "http://n8n.example.test" } }),
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body ?? "{}").error).toMatch(/https/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("fails closed when the bridge credential does not authenticate", async () => {
    mockAuthenticate.mockRejectedValueOnce(new N8nAgentStepAuthError());

    const res = await handler(event({ body: VALID_BODY }));

    expect(res.statusCode).toBe(401);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

function event({
  body,
  method = "POST",
  path = "/api/integrations/n8n/agent-steps",
}: {
  body: Record<string, unknown> | null;
  method?: string;
  path?: string;
}): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    routeKey: `${method} ${path}`,
    headers: {
      authorization: "Bearer bridge-token",
      "x-tenant-slug": "acme",
      "x-request-id": "request-1",
    },
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    requestContext: {
      requestId: "request-context-1",
      http: { method, path, sourceIp: "127.0.0.1" },
    },
  } as unknown as APIGatewayProxyEventV2;
}
