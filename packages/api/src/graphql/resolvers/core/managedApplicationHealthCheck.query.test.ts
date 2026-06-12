import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAdminOrServiceCaller, mockResolveCallerTenantId } =
  vi.hoisted(() => ({
    mockRequireAdminOrServiceCaller: vi.fn(),
    mockResolveCallerTenantId: vi.fn(),
  }));

vi.mock("./authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

let mod: typeof import("./managedApplicationHealthCheck.query.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mod = await import("./managedApplicationHealthCheck.query.js");
});

const cognito = { auth: { authType: "cognito" } } as any;

describe("managedApplicationHealthCheck", () => {
  it("refuses a member before probing a managed application", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      mod.managedApplicationHealthCheck(null, { key: "twenty" }, cognito),
    ).rejects.toThrow(/admin/i);

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      cognito,
      "tenant-1",
      "managed_application:health_check",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unhealthy without fetching when Twenty is not provisioned", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await mod.managedApplicationHealthCheck(
      null,
      { key: "twenty" },
      cognito,
    );

    expect(result).toMatchObject({
      key: "twenty",
      healthy: false,
      statusCode: null,
      latencyMs: 0,
      endpoint: null,
      message: "Twenty CRM is not provisioned for this stage.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns parked status without fetching when Twenty runtime is disabled", async () => {
    vi.stubEnv("TWENTY", "1|0|https://crm.example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await mod.managedApplicationHealthCheck(
      null,
      { key: "crm" },
      cognito,
    );

    expect(result).toMatchObject({
      key: "twenty",
      healthy: false,
      statusCode: 503,
      latencyMs: 0,
      endpoint: "https://crm.example.com",
      message: "Twenty CRM runtime is parked; CRM data is retained.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes Twenty public /healthz when the runtime is enabled", async () => {
    vi.stubEnv("TWENTY", "1|1|https://crm.example.com/");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mod.managedApplicationHealthCheck(
      null,
      { key: "twenty" },
      cognito,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://crm.example.com/healthz",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      key: "twenty",
      healthy: true,
      statusCode: 200,
      endpoint: "https://crm.example.com/",
      message: "Twenty CRM /healthz is healthy.",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it("rejects unknown managed application keys", async () => {
    await expect(
      mod.managedApplicationHealthCheck(null, { key: "nope" }, cognito),
    ).rejects.toThrow(/unknown managed application/i);
    await expect(
      mod.managedApplicationHealthCheck(null, { key: "kestra" }, cognito),
    ).rejects.toThrow(/unknown managed application/i);
  });
});
