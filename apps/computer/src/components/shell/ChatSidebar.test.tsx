import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryDocs,
  tenantMock,
  locationMock,
  navigateMock,
  recentThreadItemsMock,
  recentReexecuteMock,
  searchReexecuteMock,
} = vi.hoisted(() => ({
  tenantMock: vi.fn(),
  locationMock: vi.fn(),
  navigateMock: vi.fn(),
  recentThreadItemsMock: [] as Array<{
    id: string;
    title: string;
    spaceId?: string;
    space?: { id: string; name: string };
    lastActivityAt?: string;
    lastReadAt?: string | null;
  }>,
  recentReexecuteMock: vi.fn(),
  searchReexecuteMock: vi.fn(),
  queryDocs: {
    ChatGlobalInboxQuery: Symbol("ChatGlobalInboxQuery"),
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
        vi.fn(),
      ];
    }
    if (query === queryDocs.ThreadsPagedQuery) {
      return [
        {
          fetching: false,
          data: {
            threadsPaged: {
              totalCount: recentThreadItemsMock.length,
              items: recentThreadItemsMock,
            },
          },
        },
        recentThreadItemsMock.length > 1
          ? recentReexecuteMock
          : searchReexecuteMock,
      ];
    }
    return [{ fetching: false, data: null }, vi.fn()];
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

import { selectNextThreadBelowDeleted } from "./chat-sidebar-types";
import { ChatSidebar } from "./ChatSidebar";

afterEach(() => {
  cleanup();
  tenantMock.mockReset();
  locationMock.mockReset();
  navigateMock.mockReset();
  recentReexecuteMock.mockReset();
  searchReexecuteMock.mockReset();
  recentThreadItemsMock.length = 0;
});

describe("ChatSidebar", () => {
  beforeEach(() => {
    recentThreadItemsMock.push({
      id: "thread-recent",
      title: "Recent Space thread",
      spaceId: "space-1",
      space: { id: "space-1", name: "Customer Onboarding" },
      lastActivityAt: new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
    });
  });

  it("selects the visible row below a deleted thread", () => {
    expect(
      selectNextThreadBelowDeleted(
        [
          {
            id: "above",
            title: "Above",
            lastActivityAt: "2026-05-10T12:00:00Z",
          },
          {
            id: "deleted",
            title: "Deleted",
            lastActivityAt: "2026-05-10T11:00:00Z",
          },
          {
            id: "below",
            title: "Below",
            lastActivityAt: "2026-05-10T10:00:00Z",
          },
        ],
        "deleted",
        new Set(["deleted"]),
      ),
    ).toBe("below");
  });

  it("renders Codex-style action nav and global recency groups without Inbox or Space filters", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads",
      search: { spaceId: "space-general" },
    });

    render(<ChatSidebar />);

    expect(screen.queryByText("Inbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /switch space/i })).toBeNull();
    expect(screen.queryByText("General")).toBeNull();
    expect(screen.getByRole("link", { name: /new thread/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /new thread/i })
        .compareDocumentPosition(
          screen.getByRole("button", { name: /^search/i }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spaces" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /recent space thread/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-recent");
    expect(screen.getByText("Recent Space thread")).toBeTruthy();
    expect(screen.getByText("Today").className).toContain(
      "text-sidebar-foreground/45",
    );
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

  it("highlights the replacement thread selected after delete", () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads/deleted-thread",
      search: {},
    });

    render(<ChatSidebar />);

    const replacementLink = screen.getByRole("link", {
      name: /recent space thread/i,
    });
    expect(replacementLink.className).not.toMatch(
      /(?:^|\s)bg-sidebar-accent(?:\s|$)/,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("thinkwork:thread-selected", {
          detail: { threadId: "thread-recent", spaceId: "space-1" },
        }),
      );
    });

    expect(replacementLink.className).toMatch(
      /(?:^|\s)bg-sidebar-accent(?:\s|$)/,
    );
  });

  it("navigates to the row directly below the deleted thread and marks it active", () => {
    recentThreadItemsMock.length = 0;
    recentThreadItemsMock.push(
      {
        id: "above-thread",
        title: "Computer deterministic streaming",
        lastActivityAt: "2026-05-10T12:00:00Z",
        lastReadAt: null,
      },
      {
        id: "deleted-thread",
        title: "Computer streaming smoke",
        lastActivityAt: "2026-05-10T11:00:00Z",
        lastReadAt: null,
      },
      {
        id: "below-thread",
        title: "E2E after force Strands",
        lastActivityAt: "2026-05-10T10:00:00Z",
        lastReadAt: null,
      },
    );
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads/deleted-thread",
      search: {},
    });

    render(<ChatSidebar />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("thinkwork:thread-deleted", {
          detail: { threadId: "deleted-thread" },
        }),
      );
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/threads/$id",
      params: { id: "below-thread" },
      replace: true,
    });
    expect(
      screen.getByRole("link", { name: /e2e after force strands/i }).className,
    ).toMatch(/(?:^|\s)bg-sidebar-accent(?:\s|$)/);
  });
});
