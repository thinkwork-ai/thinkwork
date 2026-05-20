import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryDocs,
  tenantMock,
  locationMock,
  navigateMock,
  deleteThreadMock,
  recentThreadItemsMock,
  recentReexecuteMock,
  searchReexecuteMock,
} = vi.hoisted(() => ({
  tenantMock: vi.fn(),
  locationMock: vi.fn(),
  navigateMock: vi.fn(),
  deleteThreadMock: vi.fn(),
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
    DeleteThreadMutation: Symbol("DeleteThreadMutation"),
    SpacesQuery: Symbol("SpacesQuery"),
    ThreadsPagedQuery: Symbol("ThreadsPagedQuery"),
  },
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

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
  useMutation: (mutation: unknown) => {
    if (mutation === queryDocs.DeleteThreadMutation) {
      return [{ fetching: false }, deleteThreadMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SpacesQuery) {
      return [
        {
          fetching: false,
          data: {
            spaces: [
              {
                id: "space-default",
                slug: "default",
                name: "Default",
                unreadThreadCount: 0,
                lastActivityAt: "2026-05-19T19:00:00Z",
              },
              {
                id: "space-general",
                slug: "general",
                name: "General",
                unreadThreadCount: 0,
                lastActivityAt: "2026-05-19T18:30:00Z",
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
        vi.fn(),
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
  Collapsible: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : <button>{children}</button>),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
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

import { selectNextThreadBelowDeleted } from "./chat-sidebar-types";
import { ChatSidebar } from "./ChatSidebar";

afterEach(() => {
  cleanup();
  tenantMock.mockReset();
  locationMock.mockReset();
  navigateMock.mockReset();
  deleteThreadMock.mockReset();
  recentReexecuteMock.mockReset();
  searchReexecuteMock.mockReset();
  recentThreadItemsMock.length = 0;
});

describe("ChatSidebar", () => {
  beforeEach(() => {
    deleteThreadMock.mockResolvedValue({ data: { deleteThread: true } });
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

  it("renders Codex-style action nav and Space sections without Inbox or Space filters", () => {
    recentThreadItemsMock.push({
      id: "thread-default",
      title: "Default chat",
      spaceId: "space-default",
      space: { id: "space-default", name: "Default" },
      lastActivityAt: "2026-05-19T19:30:00Z",
      lastReadAt: new Date().toISOString(),
    });
    recentThreadItemsMock.push({
      id: "thread-general",
      title: "General chat",
      spaceId: "space-general",
      space: { id: "space-general", name: "General" },
      lastActivityAt: "2026-05-19T19:15:00Z",
      lastReadAt: new Date().toISOString(),
    });
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads",
      search: { spaceId: "space-default" },
    });

    const { container } = render(<ChatSidebar />);

    expect(screen.queryByText("Inbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /switch space/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /all spaces/i })).toBeNull();
    expect(screen.queryByText("Default")).toBeNull();
    expect(screen.queryByText("General")).toBeNull();
    expect(screen.getByRole("link", { name: /new thread/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /toggle chats/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /toggle customer onboarding/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^search/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /new thread/i })
        .compareDocumentPosition(
          screen.getByRole("button", { name: /^search/i }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^search/i })
        .compareDocumentPosition(
          screen.getByRole("button", { name: /settings/i }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chats" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Spaces" })).toBeTruthy();
    expect(container.querySelector(".lucide-folder-open")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /default chat/i }).getAttribute("href"),
    ).toBe("/threads/thread-default");
    expect(
      screen.getByRole("link", { name: /general chat/i }).getAttribute("href"),
    ).toBe("/threads/thread-general");
    expect(
      screen
        .getByRole("link", { name: /recent space thread/i })
        .getAttribute("href"),
    ).toBe("/spaces/space-1/threads/thread-recent");
    expect(screen.getByText("Recent Space thread")).toBeTruthy();
  });

  it("uses Space thread route params without showing a list title above thread rows", () => {
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
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Yesterday")).toBeNull();
    expect(screen.queryByText("Older")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /recent space thread/i })
        .getAttribute("href"),
    ).toBe("/spaces/space-1/threads/thread-recent");
  });

  it("limits chat sections to five rows until Show more is clicked", () => {
    recentThreadItemsMock.length = 0;
    for (let index = 1; index <= 12; index += 1) {
      recentThreadItemsMock.push({
        id: `thread-${index}`,
        title: `Chat ${index}`,
        lastActivityAt: new Date(Date.now() - index * 60_000).toISOString(),
        lastReadAt: new Date().toISOString(),
      });
    }
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({ pathname: "/threads", search: {} });

    render(<ChatSidebar />);

    expect(screen.getByText("Chat 1")).toBeTruthy();
    expect(screen.getByText("Chat 5")).toBeTruthy();
    expect(screen.queryByText("Chat 6")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("Yesterday")).toBeNull();
    expect(screen.queryByText("Older")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more (7)" }));

    expect(screen.getByText("Chat 6")).toBeTruthy();
    expect(screen.getByText("Chat 10")).toBeTruthy();
    expect(screen.queryByText("Chat 11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more (2)" }));

    expect(screen.getByText("Chat 11")).toBeTruthy();
    expect(screen.getByText("Chat 12")).toBeTruthy();
  });

  it("shows compact relative dates and deletes after inline confirmation", async () => {
    recentThreadItemsMock.length = 0;
    recentThreadItemsMock.push({
      id: "delete-me",
      title: "Delete me",
      lastActivityAt: new Date(
        Date.now() - 4 * 60 * 60_000 - 5 * 60_000,
      ).toISOString(),
      lastReadAt: new Date().toISOString(),
    });
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads/delete-me",
      search: {},
    });

    render(<ChatSidebar />);

    expect(screen.getByText("4h")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /delete delete me/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(deleteThreadMock).toHaveBeenCalledWith({ id: "delete-me" }),
    );
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/new",
        search: { spaceId: undefined },
        replace: true,
      }),
    );
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
