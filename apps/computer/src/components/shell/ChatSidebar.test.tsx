import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryDocs, tenantMock, locationMock, navigateMock } = vi.hoisted(
  () => ({
    tenantMock: vi.fn(),
    locationMock: vi.fn(),
    navigateMock: vi.fn(),
    queryDocs: {
      ChatGlobalInboxQuery: Symbol("ChatGlobalInboxQuery"),
      SpacesQuery: Symbol("SpacesQuery"),
      ThreadsPagedQuery: Symbol("ThreadsPagedQuery"),
    },
  }),
);

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const href = to
      .replace("$spaceId", params?.spaceId ?? "$spaceId")
      .replace("$threadId", params?.threadId ?? "$threadId")
      .replace("$id", params?.id ?? "$id");
    return (
      <a
        href={`${href}${search?.spaceId ? `?spaceId=${search.spaceId}` : ""}`}
        {...props}
      >
        {children}
      </a>
    );
  },
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: locationMock() }),
  useNavigate: () => navigateMock,
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
                id: "space-general",
                slug: "general",
                name: "General",
                unreadThreadCount: 0,
                lastActivityAt: "2026-05-19T19:00:00Z",
              },
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
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
  }) => <div data-value={value}>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <div role="option" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
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
  navigateMock.mockReset();
});

describe("ChatSidebar", () => {
  it("renders Codex-style action nav and recency groups without Inbox", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads",
      search: { spaceId: "space-general" },
    });

    render(<ChatSidebar />);

    expect(screen.getByRole("button", { name: /switch space/i })).toBeTruthy();
    expect(screen.queryByText("Inbox")).toBeNull();
    expect(screen.queryByRole("option", { name: /all spaces/i })).toBeNull();
    expect(screen.getByRole("option", { name: /general/i })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /customer onboarding/i }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /new chat/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spaces" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /recent space thread/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-recent");
    expect(screen.getByText("Recent Space thread")).toBeTruthy();
  });

  it("uses Space thread route params without showing a list title above Today", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/spaces/space-1/threads/thread-recent",
      search: {},
    });

    render(<ChatSidebar />);

    expect(
      screen.queryByRole("heading", { name: "Customer Onboarding" }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Conversations" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /recent space thread/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-recent");
  });
});
