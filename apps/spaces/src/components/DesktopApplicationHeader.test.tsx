import { cleanup, render, screen } from "@testing-library/react";
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
});

describe("DesktopApplicationHeader", () => {
  it("renders page header details in the Electron chrome", () => {
    pageHeaderMock.actions = {
      title: "Build me a quick dashboard",
      subtitle: "Thread",
      action: <button type="button">Thread menu</button>,
    };

    render(<DesktopApplicationHeader />);

    expect(screen.getByText("Build me a quick dashboard")).toBeTruthy();
    expect(screen.getByText("Thread")).toBeTruthy();
    expect(screen.getByText("Thread menu")).toBeTruthy();
    expect(screen.queryByText("ThinkWork Spaces")).toBeNull();
  });

  it("removes the content header when the route hides the top bar and the sidebar is open", () => {
    pageHeaderMock.actions = {
      title: "New thread",
      hideTopBar: true,
      action: <button type="button">Hidden action</button>,
    };

    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild).toBeNull();
    expect(screen.queryByText("Toggle Sidebar")).toBeNull();
    expect(screen.queryByText("New thread")).toBeNull();
    expect(screen.queryByText("Hidden action")).toBeNull();
  });

  it("does not add an empty content header on routes without header actions", () => {
    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild).toBeNull();
  });

  it("moves chrome controls onto the content header when the sidebar is fully collapsed", () => {
    sidebarMock.open = false;

    const { container } = render(<DesktopApplicationHeader />);

    expect(container.firstElementChild?.className).toContain("pl-20");
    expect(screen.getByText("Toggle Sidebar")).toBeTruthy();
  });
});
