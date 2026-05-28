import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pageHeaderMock = vi.hoisted(() => ({
  actions: null as unknown,
}));
const sidebarMock = vi.hoisted(() => ({
  open: true,
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeader: () => ({ actions: pageHeaderMock.actions }),
}));

vi.mock("@/components/update-banner", () => ({
  DesktopUpdateBadge: () => <button type="button">Update</button>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => "/threads/thread-1",
}));

vi.mock("@thinkwork/ui", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  SidebarTrigger: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      Toggle Sidebar
    </button>
  ),
  ToggleGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToggleGroupItem: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
  useSidebar: () => ({ open: sidebarMock.open }),
}));

import { DesktopApplicationHeader } from "./DesktopApplicationHeader";

afterEach(() => {
  cleanup();
  pageHeaderMock.actions = null;
  sidebarMock.open = true;
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
});

describe("DesktopApplicationHeader", () => {
  it("renders page header details in the Electron chrome", () => {
    pageHeaderMock.actions = {
      title: "Build me a quick dashboard",
      subtitle: "Thread",
      action: <button type="button">Thread menu</button>,
    };

    const { container } = render(<DesktopApplicationHeader />);

    expect(screen.getByText("Build me a quick dashboard")).toBeTruthy();
    expect(screen.getByText("Thread")).toBeTruthy();
    expect(screen.getByText("Thread menu")).toBeTruthy();
    expect(screen.queryByText("ThinkWork Spaces")).toBeNull();
    expect(container.firstElementChild?.className).toContain("border-b");
  });

  it("keeps a hidden drag region when the route hides the top bar and the sidebar is open", () => {
    pageHeaderMock.actions = {
      title: "New thread",
      hideTopBar: true,
      action: <button type="button">Hidden action</button>,
    };

    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild?.className).toContain(
      "desktop-app-header",
    );
    expect(screen.getByTestId("desktop-hidden-drag-region")).toBeTruthy();
    expect(screen.queryByText("Toggle Sidebar")).toBeNull();
    expect(screen.queryByText("New thread")).toBeNull();
    expect(screen.queryByText("Hidden action")).toBeNull();
  });

  it("adds only the hidden drag region on routes without header actions", () => {
    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild?.className).toContain(
      "desktop-app-header",
    );
    expect(screen.getByTestId("desktop-hidden-drag-region")).toBeTruthy();
  });

  it("moves chrome controls onto the content header when the sidebar is fully collapsed", () => {
    sidebarMock.open = false;

    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild?.className).toContain("pl-20");
    expect(screen.getByText("Toggle Sidebar")).toBeTruthy();
  });

  it("renders muted desktop navigation controls", () => {
    sidebarMock.open = false;

    render(<DesktopApplicationHeader />);

    expect(screen.getByText("Toggle Sidebar").className).toContain(
      "text-muted-foreground/70",
    );
    expect(
      screen.getByRole("button", { name: "Refresh thread" }).className,
    ).toContain("text-muted-foreground/70");
    expect(screen.getByRole("button", { name: "Back" }).className).toContain(
      "text-muted-foreground/70",
    );
  });

  it("emits a desktop refresh event from the navigation controls", () => {
    const onRefresh = vi.fn();
    sidebarMock.open = false;
    window.addEventListener("thinkwork:desktop-refresh", onRefresh);

    render(<DesktopApplicationHeader />);
    screen.getByRole("button", { name: "Refresh thread" }).click();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    window.removeEventListener("thinkwork:desktop-refresh", onRefresh);
  });

  it("spins the refresh icon until the active route completes the refresh", async () => {
    const onRefresh = vi.fn((event: Event) => event.preventDefault());
    sidebarMock.open = false;
    window.addEventListener("thinkwork:desktop-refresh", onRefresh);

    render(<DesktopApplicationHeader />);
    const refreshButton = screen.getByRole("button", {
      name: "Refresh thread",
    });

    fireEvent.click(refreshButton);

    expect(refreshButton.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );
    fireEvent(window, new CustomEvent("thinkwork:desktop-refresh-complete"));

    await waitFor(() => {
      expect(
        refreshButton.querySelector("svg")?.getAttribute("class"),
      ).not.toContain("animate-spin");
    });
    window.removeEventListener("thinkwork:desktop-refresh", onRefresh);
  });

  it("renders compact local Pi status in the desktop header", async () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    pageHeaderMock.actions = { title: "Thread" };
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {
        pi: {
          status: "healthy",
          getStatus: vi.fn(async () => ({
            status: "healthy",
            pid: 123,
            version: "0.1.0",
            restartCount: 0,
            startedAt: "2026-05-28T12:00:00.000Z",
            updatedAt: "2026-05-28T12:00:01.000Z",
            lastExitCode: null,
            lastError: null,
          })),
          onStatusChanged: vi.fn(() => () => {}),
        },
      },
    });

    render(<DesktopApplicationHeader />);

    await waitFor(() => {
      expect(screen.getByLabelText("Local Pi sidecar ready")).toBeTruthy();
    });
    expect(screen.getByText("Pi local")).toBeTruthy();
  });
});
