import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const desktopRuntimeMocks = vi.hoisted(() => ({
  isDesktopBuild: vi.fn(() => false),
}));

vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);
vi.mock("@/lib/composer-focus", () => ({
  requestSpacesComposerFocus: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Eric Odom", email: "eric@example.com" },
    signOut: vi.fn(),
  }),
}));
vi.mock("@/components/shell/ChatSidebar", () => ({
  ChatSidebar: () => <nav data-testid="chat-sidebar" />,
}));
vi.mock("@/components/update-banner", () => ({
  DesktopUpdateBadge: () => <button type="button">Update</button>,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    search?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) => {
    const state = { location: { pathname: "/" } };
    return opts?.select ? opts.select(state) : state;
  },
}));
vi.mock("@thinkwork/ui", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Sidebar: ({
    children,
    collapsible,
  }: {
    children: React.ReactNode;
    collapsible?: string;
  }) => (
    <aside data-testid="spaces-sidebar" data-collapsible={collapsible}>
      {children}
    </aside>
  ),
  SidebarContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="sidebar-content" className={className}>
      {children}
    </div>
  ),
  SidebarFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  SidebarHeader: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="sidebar-header">{children}</header>
  ),
  SidebarTrigger: () => <button type="button">Toggle Sidebar</button>,
  useSidebar: () => ({ state: "expanded", setOpen: vi.fn() }),
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

import { SpacesSidebar } from "./SpacesSidebar";

afterEach(() => {
  cleanup();
  desktopRuntimeMocks.isDesktopBuild.mockReturnValue(false);
});

describe("SpacesSidebar", () => {
  it("keeps the brand area in the web shell", () => {
    render(<SpacesSidebar />);

    expect(screen.getByTestId("sidebar-header")).toBeTruthy();
    expect(screen.getByText("ThinkWork")).toBeTruthy();
    expect(screen.getByText("Spaces")).toBeTruthy();
  });

  it("removes the brand area in the Electron shell", () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);

    render(<SpacesSidebar />);

    expect(screen.getByTestId("sidebar-header")).toBeTruthy();
    expect(screen.queryByAltText("ThinkWork")).toBeNull();
    expect(screen.queryByText("ThinkWork")).toBeNull();
    expect(screen.getByTestId("spaces-sidebar").dataset.collapsible).toBe(
      "offcanvas",
    );
    expect(screen.getByTestId("sidebar-content").className).not.toContain(
      "pt-",
    );
    expect(screen.getByTestId("chat-sidebar")).toBeTruthy();
  });
});
