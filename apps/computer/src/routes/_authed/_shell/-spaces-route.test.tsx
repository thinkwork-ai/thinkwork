import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routePathnameMock } = vi.hoisted(() => ({
  routePathnameMock: vi.fn(() => "/spaces/space-1"),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  Outlet: () => <div>thread detail outlet</div>,
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: routePathnameMock() } }),
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

afterEach(() => {
  cleanup();
  routePathnameMock.mockReset();
  routePathnameMock.mockReturnValue("/spaces/space-1");
});

describe("Spaces routes", () => {
  it("renders the Spaces index instead of redirecting away from workrooms", () => {
    expect(SpacesIndexRoute).toHaveProperty("component");
    expect(SpacesIndexRoute).not.toHaveProperty("beforeLoad");
  });

  it("renders a Space workroom page instead of redirecting away from the Space", () => {
    expect(SpaceDetailRoute).toHaveProperty("component");
    expect(SpaceDetailRoute).not.toHaveProperty("beforeLoad");
  });

  it("lets nested Space thread routes render the thread detail", () => {
    routePathnameMock.mockReturnValue("/spaces/space-1/threads/thread-1");
    const Component = (
      SpaceDetailRoute as unknown as { component: ComponentType }
    ).component;

    render(<Component />);

    expect(screen.getByText("thread detail outlet")).toBeTruthy();
  });
});
