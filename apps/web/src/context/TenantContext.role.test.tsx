import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `TenantContext` captures `import.meta.env.VITE_API_URL` in a module-load
// const, so the env must be stubbed BEFORE the module is imported. Each test
// dynamically imports after `beforeEach` stubs the env (with resetModules in
// afterEach) so the capture sees the stubbed value.

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

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState.value }));
vi.mock("@/lib/api-fetch", () => {
  class NotReadyError extends Error {}
  return { NotReadyError, apiFetch: apiFetchMock };
});
vi.mock("@/lib/graphql-client", () => ({
  setGraphqlTenantId: setGraphqlTenantIdMock,
}));

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example");
  authState.value = {
    user: { tenantId: "t1", sub: "u1" },
    isAuthenticated: true,
    isLoading: false,
    getToken: vi.fn(async () => "tok"),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function renderProbe() {
  const { TenantProvider, useTenant } = await import("./TenantContext");
  function Probe() {
    const { role, isOperator, roleResolved, userId } = useTenant();
    return (
      <div>
        <span data-testid="role">{role ?? "null"}</span>
        <span data-testid="isOperator">{String(isOperator)}</span>
        <span data-testid="roleResolved">{String(roleResolved)}</span>
        <span data-testid="userId">{userId ?? "null"}</span>
      </div>
    );
  }
  return render(
    <TenantProvider>
      <Probe />
    </TenantProvider>,
  );
}

function mockAuthMe(role: string | null) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/auth/me")
      return Promise.resolve({ tenantId: "t1", userId: "u1", role });
    if (path.startsWith("/api/tenants/"))
      return Promise.resolve({ id: "t1", name: "Tenant One", slug: "t1" });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe("TenantContext role gating", () => {
  it("owner resolves to isOperator true", async () => {
    mockAuthMe("owner");
    await renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("roleResolved").textContent).toBe("true"),
    );
    expect(screen.getByTestId("role").textContent).toBe("owner");
    expect(screen.getByTestId("isOperator").textContent).toBe("true");
  });

  it("admin resolves to isOperator true", async () => {
    mockAuthMe("admin");
    await renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("isOperator").textContent).toBe("true"),
    );
    expect(screen.getByTestId("role").textContent).toBe("admin");
  });

  it("member resolves to isOperator false", async () => {
    mockAuthMe("member");
    await renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("roleResolved").textContent).toBe("true"),
    );
    expect(screen.getByTestId("isOperator").textContent).toBe("false");
  });

  it("null role resolves to isOperator false without throwing", async () => {
    mockAuthMe(null);
    await renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("roleResolved").textContent).toBe("true"),
    );
    expect(screen.getByTestId("role").textContent).toBe("null");
    expect(screen.getByTestId("isOperator").textContent).toBe("false");
  });

  it("never resolves role=null during the pre-hydration window (U15 Finding 1)", async () => {
    // Hard page load: auth is still hydrating, so `isAuthenticated` is
    // transiently false WHILE `isLoading` is true. The provider must NOT flip
    // `roleResolved=true` with `role=null` here — that would make
    // OperatorGuard redirect operators to /settings/general before auth
    // settles.
    mockAuthMe("owner");
    authState.value = {
      user: null,
      isAuthenticated: false,
      isLoading: true,
      getToken: vi.fn(async () => "tok"),
    };

    const { TenantProvider, useTenant } = await import("./TenantContext");
    const observed: Array<{ roleResolved: boolean; role: string | null }> = [];
    function Probe() {
      const { role, roleResolved } = useTenant();
      observed.push({ roleResolved, role });
      return (
        <div>
          <span data-testid="roleResolved">{String(roleResolved)}</span>
          <span data-testid="role">{role ?? "null"}</span>
        </div>
      );
    }
    const { rerender } = render(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    // During hydration the guard stays unresolved (renders nothing), it does
    // not resolve to a non-operator.
    expect(screen.getByTestId("roleResolved").textContent).toBe("false");

    // Auth settles: user is authenticated with an operator role.
    authState.value = {
      user: { tenantId: "t1", sub: "u1" },
      isAuthenticated: true,
      isLoading: false,
      getToken: vi.fn(async () => "tok"),
    };
    rerender(
      <TenantProvider>
        <Probe />
      </TenantProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("roleResolved").textContent).toBe("true"),
    );
    expect(screen.getByTestId("role").textContent).toBe("owner");

    // The transient state (roleResolved=true && role=null) must never have
    // been observed — that's the premature-redirect bug.
    expect(observed.some((s) => s.roleResolved && s.role === null)).toBe(false);
  });

  it("resolves role=null only once auth definitively settles signed out", async () => {
    // `isLoading=false` + not authenticated = genuinely signed out. Resolving
    // role=null here is safe (the _authed layout redirects to /sign-in before
    // any OperatorGuard renders) and must not hang on roleResolved=false.
    authState.value = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      getToken: vi.fn<() => Promise<string | null>>(),
    };
    await renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("roleResolved").textContent).toBe("true"),
    );
    expect(screen.getByTestId("role").textContent).toBe("null");
    expect(screen.getByTestId("isOperator").textContent).toBe("false");
  });

  it("roleResolved is false before /api/auth/me resolves", async () => {
    // Make /api/auth/me hang so role never resolves during this assertion.
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/auth/me") return new Promise(() => {});
      return Promise.resolve({ id: "t1", name: "Tenant One", slug: "t1" });
    });
    await renderProbe();
    expect(screen.getByTestId("roleResolved").textContent).toBe("false");
    expect(screen.getByTestId("isOperator").textContent).toBe("false");
    expect(screen.getByTestId("userId").textContent).toBe("null");
  });
});
