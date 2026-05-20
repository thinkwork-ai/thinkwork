import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryDocs, tenantMock, locationMock } = vi.hoisted(() => ({
  tenantMock: vi.fn(),
  locationMock: vi.fn(),
  queryDocs: {
    ChatGlobalInboxQuery: Symbol("ChatGlobalInboxQuery"),
    SpacesQuery: Symbol("SpacesQuery"),
    ThreadsPagedQuery: Symbol("ThreadsPagedQuery"),
  },
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a
      href={`${to}${search?.spaceId ? `?spaceId=${search.spaceId}` : ""}`}
      {...props}
    >
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: locationMock() }),
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SpacesQuery) {
      return [
        {
          fetching: false,
          data: {
            spaces: [
              {
                id: "space-1",
                slug: "customer-onboarding",
                name: "Customer Onboarding",
                unreadThreadCount: 2,
                lastActivityAt: "2026-05-19T18:00:00Z",
              },
            ],
          },
        },
      ];
    }
    if (query === queryDocs.ChatGlobalInboxQuery) {
      return [
        {
          fetching: false,
          data: {
            threadsPaged: {
              totalCount: 1,
              items: [
                {
                  id: "thread-inbox",
                  title: "Inbox mention",
                  spaceId: "space-1",
                  space: { id: "space-1", name: "Customer Onboarding" },
                  lastActivityAt: "2026-05-19T18:00:00Z",
                  lastReadAt: null,
                },
              ],
            },
          },
        },
      ];
    }
    if (query === queryDocs.ThreadsPagedQuery) {
      return [
        {
          fetching: false,
          data: {
            threadsPaged: {
              totalCount: 1,
              items: [
                {
                  id: "thread-recent",
                  title: "Recent Space thread",
                  spaceId: "space-1",
                  space: { id: "space-1", name: "Customer Onboarding" },
                  lastActivityAt: new Date().toISOString(),
                  lastReadAt: new Date().toISOString(),
                },
              ],
            },
          },
        },
      ];
    }
    return [{ fetching: false, data: null }];
  },
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : <button {...props}>{children}</button>),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => children,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
}));

import { ChatSidebar } from "./ChatSidebar";

afterEach(() => {
  cleanup();
  tenantMock.mockReset();
  locationMock.mockReset();
});

describe("ChatSidebar", () => {
  it("renders global Inbox above Space nav and recency groups", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads",
      search: { spaceId: "space-1" },
    });

    render(<ChatSidebar />);

    expect(
      screen.getByRole("textbox", { name: /search chat threads/i }),
    ).toBeTruthy();
    expect(screen.getByText("Inbox (1)")).toBeTruthy();
    expect(screen.getByText("Inbox mention")).toBeTruthy();
    expect(screen.getByText("Spaces")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /customer onboarding/i })
        .find(
          (link) => link.getAttribute("href") === "/threads?spaceId=space-1",
        )
        ?.getAttribute("href"),
    ).toBe("/threads?spaceId=space-1");
    const activeSpaceLink = screen
      .getAllByRole("link", { name: /customer onboarding/i })
      .find((link) => link.getAttribute("aria-current") === "page");
    expect(activeSpaceLink?.getAttribute("href")).toBe(
      "/threads?spaceId=space-1",
    );
    expect(screen.getByText("Recent Space thread")).toBeTruthy();
  });

  it("uses Space thread route params as the active Space context", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/spaces/space-1/threads/thread-recent",
      search: {},
    });

    render(<ChatSidebar />);

    expect(screen.getByText("Space:")).toBeTruthy();
    const activeSpaceLink = screen
      .getAllByRole("link", { name: /customer onboarding/i })
      .find((link) => link.getAttribute("aria-current") === "page");
    expect(activeSpaceLink?.getAttribute("href")).toBe(
      "/threads?spaceId=space-1",
    );
  });
});
