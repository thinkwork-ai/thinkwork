import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { paramsMock, queryDocs, tenantMock } = vi.hoisted(() => ({
  paramsMock: vi.fn(),
  tenantMock: vi.fn(),
  queryDocs: {
    SpacesQuery: Symbol("SpacesQuery"),
    SpaceQuery: Symbol("SpaceQuery"),
    SpaceThreadsQuery: Symbol("SpaceThreadsQuery"),
    ThreadTurnUpdatedSubscription: Symbol("ThreadTurnUpdatedSubscription"),
    ThreadUpdatedSubscription: Symbol("ThreadUpdatedSubscription"),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    ...config,
    useParams: paramsMock,
  }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: (options: { query: unknown }) => {
    if (options.query === queryDocs.SpacesQuery) {
      return [
        {
          fetching: false,
          data: {
            spaces: [
              {
                id: "space-1",
                slug: "customer-onboarding",
                name: "Customer Onboarding",
                kind: "CUSTOMER_ONBOARDING",
                updatedAt: "2026-05-19T12:00:00Z",
              },
            ],
          },
        },
      ];
    }
    if (options.query === queryDocs.SpaceQuery) {
      return [
        {
          fetching: false,
          data: {
            space: {
              id: "space-1",
              tenantId: "tenant-1",
              name: "Customer Onboarding",
              description: "Won deals",
              checklistTemplates: [
                {
                  id: "template-1",
                  name: "Default",
                  items: [
                    {
                      id: "item-1",
                      title: "Run credit report",
                      required: true,
                      sortOrder: 1,
                    },
                  ],
                },
              ],
              integrations: [],
              agentAssignments: [],
            },
          },
        },
      ];
    }
    if (options.query === queryDocs.SpaceThreadsQuery) {
      return [
        {
          fetching: false,
          data: {
            threadsPaged: {
              totalCount: 1,
              items: [
                {
                  id: "thread-1",
                  identifier: "CO-1",
                  title: "Acme onboarding",
                  status: "IN_PROGRESS",
                  updatedAt: "2026-05-19T12:00:00Z",
                },
              ],
            },
          },
        },
        vi.fn(),
      ];
    }
    return [{ fetching: false, data: null }, vi.fn()];
  },
  useSubscription: () => [{ data: null }],
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));
vi.mock("@/components/spaces/StartOnboardingDialog", () => ({
  StartOnboardingDialog: () => <button type="button">Start</button>,
}));

import { Route as SpacesIndexRoute } from "./spaces.index";
import { Route as SpaceDetailRoute } from "./spaces.$spaceId";

const SpacesIndex = (
  SpacesIndexRoute as unknown as { component: React.ComponentType }
).component;
const SpaceDetail = (
  SpaceDetailRoute as unknown as { component: React.ComponentType }
).component;

beforeEach(() => {
  paramsMock.mockReturnValue({ spaceId: "space-1" });
  tenantMock.mockReturnValue({ tenantId: "tenant-1" });
});
afterEach(() => {
  cleanup();
  paramsMock.mockReset();
  tenantMock.mockReset();
});

describe("Spaces routes", () => {
  it("renders the Spaces index with Customer Onboarding", () => {
    render(<SpacesIndex />);
    expect(screen.getAllByText("Customer Onboarding").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("customer-onboarding")).toBeTruthy();
  });

  it("renders Space-scoped onboarding threads and checklist configuration", () => {
    render(<SpaceDetail />);
    expect(screen.getByLabelText("Search Space threads")).toBeTruthy();
    expect(screen.getByText("Acme onboarding")).toBeTruthy();
    expect(screen.getByText("Run credit report")).toBeTruthy();
  });
});
