import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryDocs,
  tenantMock,
  locationMock,
  navigateMock,
  deleteThreadMock,
  updateThreadMock,
  pinThreadMock,
  unpinThreadMock,
  reorderPinnedThreadsMock,
  recentThreadItemsMock,
  searchThreadItemsMock,
  pinnedThreadItemsMock,
  recentReexecuteMock,
  searchReexecuteMock,
  pinnedReexecuteMock,
} = vi.hoisted(() => ({
  tenantMock: vi.fn(),
  locationMock: vi.fn(),
  navigateMock: vi.fn(),
  deleteThreadMock: vi.fn(),
  updateThreadMock: vi.fn(),
  pinThreadMock: vi.fn(),
  unpinThreadMock: vi.fn(),
  reorderPinnedThreadsMock: vi.fn(),
  recentThreadItemsMock: [] as Array<{
    id: string;
    title: string;
    spaceId?: string;
    space?: { id: string; name: string };
    lastActivityAt?: string;
    lastReadAt?: string | null;
  }>,
  searchThreadItemsMock: [] as Array<{
    id: string;
    title: string;
    spaceId?: string;
    space?: { id: string; name: string };
    lastActivityAt?: string;
    lastReadAt?: string | null;
  }>,
  pinnedThreadItemsMock: [] as Array<{
    id: string;
    title: string;
    spaceId?: string;
    space?: { id: string; name: string };
    lastActivityAt?: string;
    lastReadAt?: string | null;
  }>,
  recentReexecuteMock: vi.fn(),
  searchReexecuteMock: vi.fn(),
  pinnedReexecuteMock: vi.fn(),
  queryDocs: {
    ChatGlobalInboxQuery: Symbol("ChatGlobalInboxQuery"),
    DeleteThreadMutation: Symbol("DeleteThreadMutation"),
    PinThreadMutation: Symbol("PinThreadMutation"),
    PinnedThreadsQuery: Symbol("PinnedThreadsQuery"),
    ReorderPinnedThreadsMutation: Symbol("ReorderPinnedThreadsMutation"),
    SpacesQuery: Symbol("SpacesQuery"),
    ThreadsPagedQuery: Symbol("ThreadsPagedQuery"),
    UnpinThreadMutation: Symbol("UnpinThreadMutation"),
    UpdateThreadMutation: Symbol("UpdateThreadMutation"),
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
    state: _state,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    state?: unknown;
  }) => {
    const href = to
      .replace("$spaceId", params?.spaceId ?? "$spaceId")
      .replace("$threadId", params?.threadId ?? "$threadId")
      .replace("$id", params?.id ?? "$id");
    const query = search
      ? new URLSearchParams(
          Object.entries(search).filter((entry): entry is [string, string] =>
            Boolean(entry[1]),
          ),
        ).toString()
      : "";
    return (
      <a href={`${href}${query ? `?${query}` : ""}`} {...props}>
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
    if (mutation === queryDocs.UpdateThreadMutation) {
      return [{ fetching: false }, updateThreadMock];
    }
    if (mutation === queryDocs.PinThreadMutation) {
      return [{ fetching: false }, pinThreadMock];
    }
    if (mutation === queryDocs.UnpinThreadMutation) {
      return [{ fetching: false }, unpinThreadMock];
    }
    if (mutation === queryDocs.ReorderPinnedThreadsMutation) {
      return [{ fetching: false }, reorderPinnedThreadsMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: ({
    query,
    variables,
  }: {
    query: unknown;
    variables?: Record<string, unknown>;
  }) => {
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
      const isSearchQuery =
        variables?.limit === 30 || Object.hasOwn(variables ?? {}, "search");
      const items = isSearchQuery
        ? searchThreadItemsMock.length > 0
          ? searchThreadItemsMock
          : recentThreadItemsMock
        : recentThreadItemsMock;
      return [
        {
          fetching: false,
          data: {
            threadsPaged: {
              totalCount: items.length,
              items,
            },
          },
        },
        isSearchQuery ? searchReexecuteMock : recentReexecuteMock,
      ];
    }
    if (query === queryDocs.PinnedThreadsQuery) {
      return [
        {
          fetching: false,
          data: {
            pinnedThreads: pinnedThreadItemsMock.map((thread, index) => ({
              pinnedAt: "2026-05-19T20:00:00Z",
              pinOrder: index + 1,
              thread,
            })),
          },
        },
        pinnedReexecuteMock,
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
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : <button {...props}>{children}</button>),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : <button>{children}</button>),
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: (event: Event) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect?.({ preventDefault: vi.fn() } as unknown as Event)
      }
    >
      {children}
    </button>
  ),
  CommandDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
  }) => (open ? <div role="dialog">{children}</div> : null),
  Command: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
    ...props
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      {...props}
      aria-label={placeholder}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({
    children,
    heading,
  }: {
    children: React.ReactNode;
    heading?: React.ReactNode;
  }) => (
    <section>
      <h3>{heading}</h3>
      {children}
    </section>
  ),
  CommandItem: ({
    children,
    onSelect,
    value,
  }: {
    children: React.ReactNode;
    onSelect?: (value: string) => void;
    value?: string;
  }) => (
    <button type="button" onClick={() => onSelect?.(value ?? "")}>
      {children}
    </button>
  ),
  CommandShortcut: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
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

const ORIGINAL_LOCAL_STORAGE = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
});

afterEach(() => {
  cleanup();
  tenantMock.mockReset();
  locationMock.mockReset();
  navigateMock.mockReset();
  deleteThreadMock.mockReset();
  updateThreadMock.mockReset();
  pinThreadMock.mockReset();
  unpinThreadMock.mockReset();
  reorderPinnedThreadsMock.mockReset();
  recentReexecuteMock.mockReset();
  searchReexecuteMock.mockReset();
  pinnedReexecuteMock.mockReset();
  recentThreadItemsMock.length = 0;
  searchThreadItemsMock.length = 0;
  pinnedThreadItemsMock.length = 0;
  window.localStorage.clear();
  if (ORIGINAL_LOCAL_STORAGE) {
    Object.defineProperty(window, "localStorage", ORIGINAL_LOCAL_STORAGE);
  }
});

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("ChatSidebar", () => {
  beforeEach(() => {
    deleteThreadMock.mockResolvedValue({ data: { deleteThread: true } });
    updateThreadMock.mockResolvedValue({ data: { updateThread: { id: "t" } } });
    pinThreadMock.mockResolvedValue({
      data: { pinThread: { thread: { id: "t" } } },
    });
    unpinThreadMock.mockResolvedValue({ data: { unpinThread: true } });
    reorderPinnedThreadsMock.mockResolvedValue({
      data: { reorderPinnedThreads: [] },
    });
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
    expect(screen.getByRole("link", { name: /new thread/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /open space menu/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Default" }).getAttribute("href"),
    ).toBe("/spaces/space-default");
    expect(
      screen.getByRole("link", { name: "General" }).getAttribute("href"),
    ).toBe("/spaces/space-general");
    expect(screen.getByRole("button", { name: /toggle chats/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /toggle customer onboarding/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /detail/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^search/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
    expect(screen.getByRole("link", { name: /automations/i })).toBeTruthy();
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
          screen.getByRole("link", { name: /automations/i }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chats" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spaces" })).toBeNull();
    expect(container.querySelector(".tabler-icon-planet")).toBeNull();
    expect(container.querySelector(".lucide-folder")).toBeNull();
    expect(
      screen.getByRole("link", { name: /default chat/i }).getAttribute("href"),
    ).toBe("/threads/thread-default");
    expect(
      screen.getByRole("link", { name: /general chat/i }).getAttribute("href"),
    ).toBe("/threads/thread-general");
    const spaceThreadLink = screen.getByRole("link", {
      name: /recent space thread/i,
    });
    expect(spaceThreadLink.getAttribute("href")).toBe(
      "/spaces/space-1/threads/thread-recent",
    );
    expect(spaceThreadLink.className).not.toContain("ml-5");
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

  it("renders pinned threads even when they are absent from recent threads", () => {
    pinnedThreadItemsMock.push({
      id: "thread-pinned-old",
      title: "Older pinned opportunity",
      lastActivityAt: "2026-05-10T12:00:00Z",
      lastReadAt: "2026-05-10T12:30:00Z",
    });
    tenantMock.mockReturnValue({ tenantId: "tenant-1", userId: "user-1" });
    locationMock.mockReturnValue({ pathname: "/threads", search: {} });

    render(<ChatSidebar />);

    expect(
      screen
        .getByRole("link", { name: /older pinned opportunity/i })
        .getAttribute("href"),
    ).toBe("/threads/thread-pinned-old");
  });

  it("pins a thread through the server and refreshes thread lists", async () => {
    tenantMock.mockReturnValue({ tenantId: "tenant-1", userId: "user-1" });
    locationMock.mockReturnValue({ pathname: "/threads", search: {} });

    render(<ChatSidebar />);
    fireEvent.click(
      screen.getByRole("button", { name: /pin recent space thread/i }),
    );

    await waitFor(() =>
      expect(pinThreadMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        threadId: "thread-recent",
      }),
    );
    await waitFor(() =>
      expect(pinnedReexecuteMock).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      }),
    );
    expect(recentReexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("imports missing localStorage pins once without making localStorage authoritative", async () => {
    pinnedThreadItemsMock.push({
      id: "server-thread",
      title: "Already server pinned",
      lastActivityAt: "2026-05-19T20:00:00Z",
      lastReadAt: "2026-05-19T20:30:00Z",
    });
    localStorage.setItem(
      "thinkwork:spaces:pinned-threads:tenant-1:user-1",
      JSON.stringify(["server-thread", "local-thread", "local-thread", 42]),
    );
    tenantMock.mockReturnValue({ tenantId: "tenant-1", userId: "user-1" });
    locationMock.mockReturnValue({ pathname: "/threads", search: {} });

    render(<ChatSidebar />);

    await waitFor(() =>
      expect(pinThreadMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        threadId: "local-thread",
      }),
    );
    expect(pinThreadMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        localStorage.getItem(
          "thinkwork:spaces:pinned-threads:tenant-1:user-1:server-migrated:v1",
        ),
      ).toBe("true"),
    );
  });

  it("groups command search results by pinned, chats, and Spaces", async () => {
    recentThreadItemsMock.length = 0;
    pinnedThreadItemsMock.push({
      id: "pinned-thread",
      title: "Bill's Oil pinned",
      lastActivityAt: "2026-05-19T19:30:00Z",
      lastReadAt: new Date().toISOString(),
    });
    searchThreadItemsMock.push(
      {
        id: "pinned-thread",
        title: "Bill's Oil pinned",
        lastActivityAt: "2026-05-19T19:30:00Z",
        lastReadAt: new Date().toISOString(),
      },
      {
        id: "chat-thread",
        title: "Bill's Oil chat",
        lastActivityAt: "2026-05-19T19:15:00Z",
        lastReadAt: new Date().toISOString(),
      },
      {
        id: "space-thread",
        title: "Bill's Oil onboarding",
        spaceId: "space-1",
        space: { id: "space-1", name: "Customer Onboarding" },
        lastActivityAt: "2026-05-19T19:00:00Z",
        lastReadAt: new Date().toISOString(),
      },
    );
    tenantMock.mockReturnValue({ tenantId: "tenant-1", userId: "user-1" });
    locationMock.mockReturnValue({ pathname: "/threads", search: {} });

    render(<ChatSidebar />);
    fireEvent.click(screen.getByRole("button", { name: /^search/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(
      within(dialog).getAllByRole("heading", { name: "Pinned" }).length,
    ).toBeGreaterThan(0);
    expect(
      within(dialog).getAllByRole("heading", { name: "Chats" }).length,
    ).toBeGreaterThan(0);
    expect(
      within(dialog).getAllByRole("heading", { name: "Customer Onboarding" })
        .length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      within(dialog).getByRole("button", { name: /bill's oil onboarding/i }),
    );

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/spaces/$spaceId/threads/$threadId",
        params: { spaceId: "space-1", threadId: "space-thread" },
      }),
    );
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

    const deleteButton = () =>
      screen.getByRole("button", { name: /delete delete me/i });

    fireEvent.click(deleteButton());
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    fireEvent.mouseLeave(confirmButton);

    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(deleteButton()).toBeTruthy();
    expect(deleteThreadMock).not.toHaveBeenCalled();

    fireEvent.click(deleteButton());
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

  it("clears the unread dot immediately and persists read state when a thread is viewed", async () => {
    recentThreadItemsMock.length = 0;
    recentThreadItemsMock.push({
      id: "unread-thread",
      title: "Unread thread",
      lastActivityAt: "2026-05-10T12:00:00Z",
      lastReadAt: null,
    });
    tenantMock.mockReturnValue({ tenantId: "tenant-1" });
    locationMock.mockReturnValue({
      pathname: "/threads",
      search: {},
    });

    render(<ChatSidebar />);

    const unreadLink = screen.getByRole("link", { name: /unread thread/i });
    expect(unreadLink.innerHTML).toContain("bg-blue-500");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("thinkwork:thread-selected", {
          detail: { threadId: "unread-thread" },
        }),
      );
    });

    expect(unreadLink.innerHTML).not.toContain("bg-blue-500");
    await waitFor(() =>
      expect(updateThreadMock).toHaveBeenCalledWith({
        id: "unread-thread",
        input: { lastReadAt: expect.any(String) },
      }),
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
