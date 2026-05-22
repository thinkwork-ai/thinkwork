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
}));
vi.mock("@thinkwork/ui", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
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
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <aside>{children}</aside>
  ),
  SidebarContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  SidebarHeader: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="sidebar-brand">{children}</header>
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

    expect(screen.getByTestId("sidebar-brand")).toBeTruthy();
    expect(screen.getByText("ThinkWork")).toBeTruthy();
    expect(screen.getByText("Spaces")).toBeTruthy();
  });

  it("removes the brand area in the Electron shell", () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);

    render(<SpacesSidebar />);

    expect(screen.queryByTestId("sidebar-brand")).toBeNull();
    expect(screen.queryByAltText("ThinkWork")).toBeNull();
    expect(screen.getByTestId("chat-sidebar")).toBeTruthy();
  });
});
