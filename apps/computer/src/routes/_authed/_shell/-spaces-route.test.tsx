import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));

vi.mock("urql", () => ({
  useQuery: () => [{ data: null, fetching: false, error: null }],
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/lib/graphql-queries", () => ({
  SpacesQuery: {},
  SpaceQuery: {},
  SpaceThreadsQuery: {},
}));

import { Route as SpaceDetailRoute } from "./spaces.$spaceId";
import { Route as SpacesIndexRoute } from "./spaces.index";

describe("Spaces routes", () => {
  it("renders the Spaces index instead of redirecting away from workrooms", () => {
    expect(SpacesIndexRoute).toHaveProperty("component");
    expect(SpacesIndexRoute).not.toHaveProperty("beforeLoad");
  });

  it("renders a Space workroom page instead of redirecting away from the Space", () => {
    expect(SpaceDetailRoute).toHaveProperty("component");
    expect(SpaceDetailRoute).not.toHaveProperty("beforeLoad");
  });
});
