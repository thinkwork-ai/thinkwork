import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockResolveCallerTenantId,
  fetchMock,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("./authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

let mod: typeof import("./knowledgeGraphHealthCheck.query.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mod = await import("./knowledgeGraphHealthCheck.query.js");
});

const cognito = { auth: { authType: "cognito" } } as any;

describe("knowledgeGraphHealthCheck", () => {
  it("refuses a member before probing the private Cognee endpoint", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    await expect(
      mod.knowledgeGraphHealthCheck(null, {}, cognito),
    ).rejects.toThrow(/admin/i);

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      cognito,
      "tenant-1",
      "knowledge_graph:health_check",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an unhealthy result without network access when Cognee is off", async () => {
    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: null,
      latencyMs: 0,
      endpoint: null,
      message: "Cognee is not provisioned for this stage.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the private Cognee health endpoint when Cognee is enabled", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    fetchMock.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(fetchMock).toHaveBeenCalledWith("http://cognee.internal/health", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      healthy: true,
      statusCode: 200,
      endpoint: "http://cognee.internal",
      message: "Cognee health endpoint responded successfully.",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it("returns an unhealthy result for non-2xx Cognee responses", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: 503,
      endpoint: "http://cognee.internal",
      message: "Cognee health endpoint returned HTTP 503.",
    });
  });

  it("returns an unhealthy result when Cognee cannot be reached", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: null,
      endpoint: "http://cognee.internal",
      message: "Cognee health endpoint could not be reached.",
    });
  });
});
