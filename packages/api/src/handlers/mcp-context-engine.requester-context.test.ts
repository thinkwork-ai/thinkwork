import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./mcp-context-engine.js";
import { getContextEngineService } from "../lib/context-engine/service.js";

vi.mock("../lib/context-engine/service.js", () => ({
  getContextEngineService: vi.fn(),
}));

const host = "api.test";
const getContextEngineServiceMock = vi.mocked(getContextEngineService);

describe("mcp-context-engine requester context", () => {
  const queryMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.THINKWORK_API_SECRET = "test-secret";
    queryMock.mockResolvedValue({
      query: "new email",
      mode: "results",
      scope: "auto",
      depth: "quick",
      hits: [],
      providers: [
        {
          providerId: "memory",
          family: "memory",
          displayName: "Hindsight Memory",
          state: "skipped",
          scope: "auto",
          hitCount: 0,
          metadata: {
            contextClass: "personal_connector_event",
            requesterUserId: "user-eric",
          },
        },
      ],
    });
    getContextEngineServiceMock.mockReturnValue({
      query: queryMock,
      listProviders: vi.fn(),
    });
  });

  it("passes connector requester metadata through to Context Engine", async () => {
    const response = await handler(
      event({
        headers: {
          authorization: "Bearer test-secret",
          "x-tenant-id": "tenant-1",
          "x-user-id": "user-eric",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "query_memory_context",
            arguments: {
              query: "new email from Acme",
              contextClass: "personal_connector_event",
              computerId: "computer-sales",
              sourceSurface: "gmail",
              credentialSubject: {
                type: "user",
                userId: "user-eric",
                connectionId: "connection-1",
                provider: "google_workspace",
              },
              event: {
                provider: "gmail",
                eventType: "message.created",
                eventId: "gmail-event-1",
                metadata: { from: "buyer@example.com" },
              },
            },
          },
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { families: ["memory"] },
        caller: expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-eric",
          requesterContext: {
            contextClass: "personal_connector_event",
            computerId: "computer-sales",
            requesterUserId: "user-eric",
            sourceSurface: "gmail",
            credentialSubject: {
              type: "user",
              userId: "user-eric",
              connectionId: "connection-1",
              provider: "google_workspace",
            },
            event: {
              provider: "gmail",
              eventType: "message.created",
              eventId: "gmail-event-1",
              metadata: { from: "buyer@example.com" },
            },
          },
        }),
      }),
    );
    const body = JSON.parse(response.body || "{}");
    expect(body.result.structuredContent.providers[0].metadata).toMatchObject({
      contextClass: "personal_connector_event",
      requesterUserId: "user-eric",
    });
  });

  it("rejects credential subjects for a different requester", async () => {
    const response = await handler(
      event({
        headers: {
          authorization: "Bearer test-secret",
          "x-tenant-id": "tenant-1",
          "x-user-id": "user-eric",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "query_memory_context",
            arguments: {
              query: "new email from Acme",
              contextClass: "personal_connector_event",
              credentialSubject: {
                type: "user",
                userId: "user-amy",
                provider: "google_workspace",
              },
            },
          },
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body || "{}");
    expect(body.error.message).toContain("credentialSubject.userId must match");
    expect(queryMock).not.toHaveBeenCalled();
  });
});

function event(input: {
  headers?: Record<string, string>;
  body?: unknown;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /mcp/context-engine",
    rawPath: "/mcp/context-engine",
    rawQueryString: "",
    headers: {
      host,
      ...(input.headers ?? {}),
    },
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: host,
      domainPrefix: "api",
      http: {
        method: "POST",
        path: "/mcp/context-engine",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request",
      routeKey: "POST /mcp/context-engine",
      stage: "$default",
      time: "",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  } as APIGatewayProxyEventV2;
}
