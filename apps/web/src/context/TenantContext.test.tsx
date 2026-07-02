import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: {
    user: null as { tenantId?: string | null; sub?: string | null } | null,
    isAuthenticated: false,
    isLoading: false,
    getToken: vi.fn<() => Promise<string | null>>(),
  },
}));

const apiFetchMock = vi.hoisted(() => vi.fn());
const setGraphqlTenantIdMock = vi.hoisted(() => vi.fn());
const graphqlMutationMock = vi.hoisted(() => vi.fn());

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
  graphqlClient: {
    mutation: graphqlMutationMock,
  },
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
    isLoading: false,
    getToken: vi.fn<() => Promise<string | null>>(),
  };
});

describe("TenantProvider", () => {
  it("uses the DB user id from auth/me even when the JWT already has a tenant claim", async () => {
    authState.value = {
      user: { tenantId: "tenant-jwt", sub: "cognito-sub" },
      isAuthenticated: true,
      isLoading: false,
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

  it("prefers the DB tenant from auth/me over a stale JWT tenant claim", async () => {
    authState.value = {
      user: { tenantId: "tenant-stale", sub: "cognito-sub" },
      isAuthenticated: true,
      isLoading: false,
      getToken: vi.fn(async () => "id-token"),
    };
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/me") {
        return {
          tenantId: "tenant-db",
          userId: "db-user-1",
          role: "member",
        };
      }
      if (path === "/api/tenants/tenant-db") {
        return {
          id: "tenant-db",
          name: "Acme",
          slug: "acme",
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const { TenantProvider, useTenant } = await import("./TenantContext");

    function Probe() {
      const { isLoading, tenantId, tenant, userId } = useTenant();
      return (
        <div>
          <p>{isLoading ? "loading" : "ready"}</p>
          <p data-testid="tenant-id">{tenantId}</p>
          <p data-testid="tenant-name">{tenant?.name}</p>
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
    expect(screen.getByTestId("tenant-id").textContent).toBe("tenant-db");
    expect(screen.getByTestId("tenant-name").textContent).toBe("Acme");
    expect(screen.getByTestId("user-id").textContent).toBe("db-user-1");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/me");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/tenants/tenant-db", {
      extraHeaders: { "x-tenant-id": "tenant-db" },
    });
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      "/api/tenants/tenant-stale",
      expect.anything(),
    );
    await waitFor(() =>
      expect(setGraphqlTenantIdMock).toHaveBeenLastCalledWith("tenant-db"),
    );
  });

  it("claims a pending pre-provisioned tenant via bootstrapUser, then re-discovers", async () => {
    authState.value = {
      user: { sub: "cognito-sub" },
      isAuthenticated: true,
      isLoading: false,
      getToken: vi.fn(async () => "id-token"),
    };
    let claimed = false;
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/me") {
        return claimed
          ? { tenantId: "tenant-new", userId: "db-user-1", role: "owner" }
          : { tenantId: null, userId: null, role: null, pendingClaim: true };
      }
      if (path === "/api/tenants/tenant-new") {
        return { id: "tenant-new", name: "HCI", slug: "hci" };
      }
      throw new Error(`unexpected path ${path}`);
    });
    graphqlMutationMock.mockImplementation(() => ({
      toPromise: async () => {
        claimed = true;
        return { data: { bootstrapUser: { tenant: { id: "tenant-new" } } } };
      },
    }));

    const { TenantProvider, useTenant } = await import("./TenantContext");

    function Probe() {
      const { isLoading, tenantId, noTenantAssigned, role } = useTenant();
      return (
        <div>
          <p>{isLoading ? "loading" : "ready"}</p>
          <p data-testid="tenant-id">{tenantId}</p>
          <p data-testid="no-tenant">{String(noTenantAssigned)}</p>
          <p data-testid="role">{role}</p>
        </div>
      );
    }

    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    await screen.findByText("ready");
    expect(graphqlMutationMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tenant-id").textContent).toBe("tenant-new");
    expect(screen.getByTestId("no-tenant").textContent).toBe("false");
    expect(screen.getByTestId("role").textContent).toBe("owner");
  });

  it("falls back to NoTenantAssigned when there is no pending claim (ADV-9)", async () => {
    authState.value = {
      user: { sub: "cognito-sub" },
      isAuthenticated: true,
      isLoading: false,
      getToken: vi.fn(async () => "id-token"),
    };
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/me") {
        return { tenantId: null, userId: null, role: null, pendingClaim: false };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const { TenantProvider, useTenant } = await import("./TenantContext");

    function Probe() {
      const { isLoading, noTenantAssigned } = useTenant();
      return (
        <div>
          <p>{isLoading ? "loading" : "ready"}</p>
          <p data-testid="no-tenant">{String(noTenantAssigned)}</p>
        </div>
      );
    }

    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    await screen.findByText("ready");
    expect(screen.getByTestId("no-tenant").textContent).toBe("true");
    expect(graphqlMutationMock).not.toHaveBeenCalled();
  });

  it("does not loop when the claim fails — one attempt, then NoTenantAssigned", async () => {
    authState.value = {
      user: { sub: "cognito-sub" },
      isAuthenticated: true,
      isLoading: false,
      getToken: vi.fn(async () => "id-token"),
    };
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/me") {
        return { tenantId: null, userId: null, role: null, pendingClaim: true };
      }
      throw new Error(`unexpected path ${path}`);
    });
    graphqlMutationMock.mockImplementation(() => ({
      toPromise: async () => ({ error: new Error("claim exploded") }),
    }));

    const { TenantProvider, useTenant } = await import("./TenantContext");

    function Probe() {
      const { isLoading, noTenantAssigned } = useTenant();
      return (
        <div>
          <p>{isLoading ? "loading" : "ready"}</p>
          <p data-testid="no-tenant">{String(noTenantAssigned)}</p>
        </div>
      );
    }

    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    await screen.findByText("ready");
    expect(screen.getByTestId("no-tenant").textContent).toBe("true");
    expect(graphqlMutationMock).toHaveBeenCalledTimes(1);
  });
});
