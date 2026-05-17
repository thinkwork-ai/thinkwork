import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoTenantAssigned } from "../src/components/NoTenantAssigned";

const { authState, apiFetchMock, setGraphqlTenantIdMock } = vi.hoisted(() => ({
  authState: {
    value: {
      user: {
        id: "google-user-1",
        email: "alex@acme.example",
        tenantId: null,
      },
      isAuthenticated: true,
      getToken: vi.fn(async () => "jwt-token"),
      signOut: vi.fn(),
    },
  },
  apiFetchMock: vi.fn(),
  setGraphqlTenantIdMock: vi.fn(),
}));

vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => authState.value,
}));

vi.mock("../src/lib/api-fetch", () => ({
  NotReadyError: class NotReadyError extends Error {},
  apiFetch: apiFetchMock,
}));

vi.mock("../src/lib/graphql-client", () => ({
  setGraphqlTenantId: setGraphqlTenantIdMock,
}));

async function renderTenantProbe() {
  const { TenantProvider, useTenant } = await import(
    "../src/context/TenantContext"
  );

  function Probe() {
    const tenant = useTenant();
    if (tenant.noTenantAssigned) return <NoTenantAssigned />;
    if (tenant.isLoading) return <div>Loading tenant</div>;
    return <div>Tenant: {tenant.tenantId}</div>;
  }

  render(
    <TenantProvider>
      <Probe />
    </TenantProvider>,
  );
}

describe("apps/computer tenant discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://api.example.test");
    vi.stubEnv("VITE_GRAPHQL_HTTP_URL", "https://api.example.test/graphql");
    vi.stubEnv("VITE_GRAPHQL_API_KEY", "test-key");
    authState.value = {
      user: {
        id: "google-user-1",
        email: "alex@acme.example",
        tenantId: null,
      },
      isAuthenticated: true,
      getToken: vi.fn(async () => "jwt-token"),
      signOut: vi.fn(),
    };
    apiFetchMock.mockReset();
    setGraphqlTenantIdMock.mockReset();
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("discovers an invited Google-federated user's tenant through assignedComputers", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          assignedComputers: [{ id: "computer-1", tenantId: "tenant-A" }],
        },
      }),
    } as Response);
    apiFetchMock.mockResolvedValueOnce({
      id: "tenant-A",
      name: "Acme",
      slug: "acme",
      plan: "enterprise",
    });

    await renderTenantProbe();

    expect(await screen.findByText("Tenant: tenant-A")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.test/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "jwt-token",
          "x-api-key": "test-key",
        }),
        body: expect.stringContaining("assignedComputers"),
      }),
    );
    expect(apiFetchMock).toHaveBeenCalledWith("/api/tenants/tenant-A", {
      extraHeaders: { "x-tenant-id": "tenant-A" },
    });
    await waitFor(() =>
      expect(setGraphqlTenantIdMock).toHaveBeenCalledWith("tenant-A"),
    );
  });

  it("renders the no-tenant surface instead of bootstrapping when discovery finds nothing", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          assignedComputers: [],
        },
      }),
    } as Response);

    await renderTenantProbe();

    expect(
      await screen.findByRole("heading", { name: "No tenant assigned" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Ask your tenant operator to invite you/),
    ).toBeTruthy();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(
      setGraphqlTenantIdMock.mock.calls.map(([tenantId]) => tenantId),
    ).not.toContain("tenant-A");
  });
});
