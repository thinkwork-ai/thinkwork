import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQuery, useTenant } = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useTenant: vi.fn(),
}));

vi.mock("urql", () => ({ useQuery }));
vi.mock("@/context/TenantContext", () => ({ useTenant }));

import { useConsolidatedSources } from "./useConsolidatedSources";

interface QueryResult {
  data?: unknown;
  fetching?: boolean;
  error?: Error;
}

/** Drives the two useQuery calls in order: [agent, spaces]. */
function mockQueries(agent: QueryResult, spaces: QueryResult) {
  useQuery.mockReturnValueOnce([agent]).mockReturnValueOnce([spaces]);
}

const tenant = {
  tenantId: "t-1",
  userId: "u-1",
  isOperator: true,
  roleResolved: true,
  isLoading: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useTenant.mockReturnValue(tenant);
});

describe("useConsolidatedSources", () => {
  it("builds sub-targets from agent + spaces + user once resolved", () => {
    mockQueries(
      { data: { agent: { id: "agent-1" } }, fetching: false },
      {
        data: {
          spaces: [
            { id: "s-fin", name: "finance" },
            { id: "s-gen", name: "general" },
          ],
        },
        fetching: false,
      },
    );

    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.subTargets).toEqual({
      agentId: "agent-1",
      spaces: [
        { id: "s-fin", name: "finance" },
        { id: "s-gen", name: "general" },
      ],
      userId: "u-1",
    });
    expect(result.current.loading).toBe(false);
  });

  it("reports loading and null subTargets while either query is fetching", () => {
    mockQueries({ fetching: true }, { fetching: false });
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.loading).toBe(true);
    expect(result.current.subTargets).toBeNull();
  });

  it("is not admin for a member, even when operator query data is present", () => {
    useTenant.mockReturnValue({ ...tenant, isOperator: false });
    mockQueries(
      { data: { agent: { id: "agent-1" } }, fetching: false },
      { data: { spaces: [] }, fetching: false },
    );
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.isAdmin).toBe(false);
  });

  it("withholds admin until the role is resolved", () => {
    useTenant.mockReturnValue({ ...tenant, roleResolved: false });
    mockQueries(
      { data: { agent: { id: "agent-1" } }, fetching: false },
      { data: { spaces: [] }, fetching: false },
    );
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.isAdmin).toBe(false);
  });

  it("reads as loading while the tenant context is still resolving", () => {
    useTenant.mockReturnValue({
      tenantId: null,
      userId: null,
      isOperator: false,
      roleResolved: false,
      isLoading: true,
    });
    mockQueries({ fetching: false }, { fetching: false });
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.loading).toBe(true);
    expect(result.current.subTargets).toBeNull();
  });

  it("settles to a terminal no-tenant state (not an indefinite spinner)", () => {
    useTenant.mockReturnValue({
      tenantId: null,
      userId: null,
      isOperator: false,
      roleResolved: true,
      isLoading: false,
    });
    mockQueries({ fetching: false }, { fetching: false });
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.loading).toBe(false);
    expect(result.current.subTargets).toBeNull();
  });

  it("surfaces a query error", () => {
    const boom = new Error("spaces failed");
    mockQueries(
      { data: { agent: { id: "agent-1" } }, fetching: false },
      { error: boom, fetching: false },
    );
    const { result } = renderHook(() => useConsolidatedSources());
    expect(result.current.error).toBe(boom);
  });
});
