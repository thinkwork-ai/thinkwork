import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: {
    user: null as { tenantId?: string | null; sub?: string | null } | null,
    isAuthenticated: false,
    getToken: vi.fn<() => Promise<string | null>>(),
  },
}));

const apiFetchMock = vi.hoisted(() => vi.fn());
const setGraphqlTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => authState.value,
}));

vi.mock("@/lib/api-fetch", () => {
  class NotReadyError extends Error {}
  return {
    NotReadyError,
    apiFetch: apiFetchMock,
  };
});

vi.mock("@/lib/graphql-client", () => ({
  setGraphqlTenantId: setGraphqlTenantIdMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example");
  authState.value = {
    user: null,
    isAuthenticated: false,
    getToken: vi.fn<() => Promise<string | null>>(),
  };
});

describe("TenantProvider", () => {
  it("uses the DB user id from auth/me even when the JWT already has a tenant claim", async () => {
    authState.value = {
      user: { tenantId: "tenant-jwt", sub: "cognito-sub" },
      isAuthenticated: true,
      getToken: vi.fn(async () => "id-token"),
    };
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/me") {
        return {
          tenantId: "tenant-jwt",
          userId: "db-user-1",
        };
      }
      if (path === "/api/tenants/tenant-jwt") {
        return {
          id: "tenant-jwt",
          name: "Acme",
          slug: "acme",
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const { TenantProvider, useTenant } = await import("./TenantContext");

    function Probe() {
      const { isLoading, tenantId, userId } = useTenant();
      return (
        <div>
          <p>{isLoading ? "loading" : "ready"}</p>
          <p data-testid="tenant-id">{tenantId}</p>
          <p data-testid="user-id">{userId}</p>
        </div>
      );
    }

    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    await screen.findByText("ready");
    expect(screen.getByTestId("tenant-id").textContent).toBe("tenant-jwt");
    expect(screen.getByTestId("user-id").textContent).toBe("db-user-1");
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/me"),
    );
  });
});
