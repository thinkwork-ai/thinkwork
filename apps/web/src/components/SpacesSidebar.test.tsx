import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const desktopRuntimeMocks = vi.hoisted(() => ({
  isDesktopBuild: vi.fn(() => false),
}));
const authMocks = vi.hoisted(() => ({ signOut: vi.fn() }));
const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/threads/abc123",
}));

vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);
vi.mock("@/lib/composer-focus", () => ({
  requestSpacesComposerFocus: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Eric Odom", email: "eric@example.com" },
    signOut: authMocks.signOut,
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
  useNavigate: () => routerMocks.navigate,
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) => {
    const state = { location: { pathname: routerMocks.pathname } };
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
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <div role="menuitem" onClick={() => onSelect?.()}>
      {children}
    </div>
  ),
  AlertDialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
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
  authMocks.signOut.mockReset();
  routerMocks.navigate.mockReset();
  routerMocks.pathname = "/threads/abc123";
});

describe("SpacesSidebar", () => {
  it("keeps the brand area in the web shell", () => {
    render(<SpacesSidebar />);

    expect(screen.getByTestId("sidebar-header")).toBeTruthy();
    expect(screen.getByText("ThinkWork")).toBeTruthy();
    expect(screen.getByAltText("ThinkWork")).toBeTruthy();
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

  it("confirms before logging out instead of signing out immediately", () => {
    render(<SpacesSidebar />);

    // The confirm dialog is closed and no logout has fired yet.
    expect(screen.queryByTestId("logout-confirm-dialog")).toBeNull();

    fireEvent.click(screen.getByText("Log out"));

    // Clicking the menu item opens the dialog but does NOT sign out.
    expect(screen.getByTestId("logout-confirm-dialog")).toBeTruthy();
    expect(authMocks.signOut).not.toHaveBeenCalled();

    // Confirming in the dialog performs the sign-out.
    fireEvent.click(screen.getByTestId("logout-confirm"));
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { next: "/threads/abc123" },
      replace: true,
    });
  });
});
