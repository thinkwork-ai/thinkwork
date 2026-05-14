import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionProxyHandler } from "../handlers/extension-proxy.js";

const mockFetch = vi.fn<typeof fetch>();
const mockRequireTenantMembership = vi.fn();

function makeHandler() {
  return createExtensionProxyHandler({
    fetch: mockFetch,
    requireTenantMembership: mockRequireTenantMembership,
    now: () => new Date("2026-05-14T12:00:00.000Z"),
  });
}

function makeEvent(overrides: {
  method?: string;
  path?: string;
  query?: string;
  body?: string | null;
  headers?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  const path = overrides.path ?? "/api/extensions/customer-module/api/v1/runs";
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: overrides.query ?? "",
    headers: overrides.headers ?? {
      authorization: "Bearer jwt",
      "x-tenant-id": "tenant-a",
      "content-type": "application/json",
    },
    requestContext: {
      accountId: "1",
      apiId: "1",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: overrides.method ?? "GET",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "r",
      routeKey: "$default",
      stage: "$default",
      time: "now",
      timeEpoch: 0,
    },
    body: overrides.body ?? null,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  process.env.EXTENSION_PROXY_BACKENDS_JSON = JSON.stringify({
    "customer-module": { baseUrl: "https://extension.example.test" },
    unsafe: { baseUrl: "http://extension.example.test" },
  });
  process.env.EXTENSION_PROXY_SIGNING_SECRET = "test-secret";
  mockFetch.mockReset();
  mockRequireTenantMembership.mockReset();
  mockRequireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: "tenant-a",
    userId: "user-a",
    role: "admin",
    auth: {
      authType: "cognito",
      email: "admin@example.test",
      principalId: "sub-a",
      tenantId: null,
      agentId: null,
    },
  });
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

describe("extension proxy handler", () => {
  it("short-circuits OPTIONS preflight before auth", async () => {
    const res = await makeHandler()(makeEvent({ method: "OPTIONS" }));

    expect(res.statusCode).toBe(204);
    expect(mockRequireTenantMembership).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards to an allowlisted backend with signed actor context", async () => {
    const res = await makeHandler()(
      makeEvent({
        method: "POST",
        path: "/api/extensions/customer-module/api/v1/runs",
        query: "limit=20",
        body: JSON.stringify({ run: true }),
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mockRequireTenantMembership).toHaveBeenCalledWith(
      expect.any(Object),
      "tenant-a",
      { requiredRoles: ["owner", "admin"] },
    );

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://extension.example.test/api/v1/runs?limit=20",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ run: true }));
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-thinkwork-extension-signature": expect.stringMatching(/^v1=/),
    });
    expect(init?.headers).not.toHaveProperty("authorization");

    const encoded = (init?.headers as Record<string, string>)[
      "x-thinkwork-extension-context"
    ];
    const context = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    expect(context).toMatchObject({
      extension_id: "customer-module",
      tenant_id: "tenant-a",
      actor: {
        user_id: "user-a",
        role: "admin",
        email: "admin@example.test",
      },
      request: { method: "POST", path: "/api/v1/runs" },
    });
  });

  it("rejects disabled extensions and unsafe backend config", async () => {
    const unknown = await makeHandler()(
      makeEvent({ path: "/api/extensions/not-registered/api/v1/runs" }),
    );
    expect(unknown.statusCode).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();

    const unsafe = await makeHandler()(
      makeEvent({ path: "/api/extensions/unsafe/api/v1/runs" }),
    );
    expect(unsafe.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-admin tenant members before forwarding", async () => {
    mockRequireTenantMembership.mockResolvedValueOnce({
      ok: false,
      status: 403,
      reason: 'Role "member" lacks privilege',
    });

    const res = await makeHandler()(makeEvent({}));

    expect(res.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects service credentials as browser extension actors", async () => {
    mockRequireTenantMembership.mockResolvedValueOnce({
      ok: true,
      tenantId: "tenant-a",
      userId: null,
      role: "owner",
      auth: {
        authType: "apikey",
        email: null,
        principalId: "service",
        tenantId: "tenant-a",
        agentId: null,
      },
    });

    const res = await makeHandler()(makeEvent({}));

    expect(res.statusCode).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
