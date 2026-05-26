import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.fn();
const desktopRuntimeMocks = vi.hoisted(() => ({
  getDesktopBridge: vi.fn(() => null),
  isDesktopBuild: vi.fn(() => false),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));
vi.mock("@/lib/desktop-runtime", () => desktopRuntimeMocks);

vi.mock("@/components/AppTopBar", () => ({
  AppTopBar: () => <header data-testid="app-top-bar" />,
}));
vi.mock("@/components/DesktopApplicationHeader", () => ({
  DesktopApplicationHeader: () => (
    <header data-testid="desktop-application-header" />
  ),
}));
vi.mock("@/components/SpacesSidebar", () => ({
  SpacesSidebar: () => <aside data-testid="computer-sidebar" />,
}));
vi.mock("@/components/NoTenantAssigned", () => ({
  NoTenantAssigned: () => <div data-testid="no-tenant" />,
}));

vi.mock("@thinkwork/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@thinkwork/ui")>("@thinkwork/ui");
  return {
    ...actual,
    SidebarProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="sidebar-provider">{children}</div>
    ),
    SidebarInset: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <section data-testid="sidebar-inset" className={className}>
        {children}
      </section>
    ),
    useSidebar: () => ({ open: true }),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    createFileRoute: () => (config: { component: React.ComponentType }) =>
      config,
    Outlet: () => <div data-testid="outlet" />,
  };
});

import { Route } from "../_shell";

const ShellLayout = (Route as unknown as { component: React.ComponentType })
  .component;

afterEach(() => {
  cleanup();
  tenantMock.mockReset();
  desktopRuntimeMocks.getDesktopBridge.mockReturnValue(null);
  desktopRuntimeMocks.isDesktopBuild.mockReturnValue(false);
});

describe("_authed/_shell layout", () => {
  it("renders centered monospace shimmer Loading while tenant resolves", () => {
    tenantMock.mockReturnValue({ noTenantAssigned: false, isLoading: true });
    const { container } = render(<ShellLayout />);
    // LoadingShimmer renders role="status" with the "Loading..." text
    // per-character (.tw-shimmer-char class) — its wrapper must use
    // viewport-height sizing so the shimmer sits in the middle of the
    // page at boot, before any shell chrome exists.
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toContain("Loading...");
    const shimmerChars = status.querySelectorAll(".tw-shimmer-char");
    expect(shimmerChars.length).toBeGreaterThan(0);
    const wrapper = container.querySelector("main");
    expect(wrapper?.className).toContain("min-h-svh");
    expect(wrapper?.className).toContain("items-center");
    expect(wrapper?.className).toContain("justify-center");
  });

  it("renders <NoTenantAssigned/> when the user has no tenant", () => {
    tenantMock.mockReturnValue({ noTenantAssigned: true, isLoading: false });
    render(<ShellLayout />);
    expect(screen.getByTestId("no-tenant")).toBeTruthy();
  });

  it("renders the shell chrome (sidebar + top bar + outlet) when ready", () => {
    tenantMock.mockReturnValue({ noTenantAssigned: false, isLoading: false });
    render(<ShellLayout />);
    expect(screen.getByTestId("computer-sidebar")).toBeTruthy();
    expect(screen.getByTestId("app-top-bar")).toBeTruthy();
    expect(screen.getByTestId("outlet")).toBeTruthy();
  });

  it("adds the desktop application header for Electron builds", () => {
    desktopRuntimeMocks.isDesktopBuild.mockReturnValue(true);
    tenantMock.mockReturnValue({ noTenantAssigned: false, isLoading: false });

    render(<ShellLayout />);

    expect(screen.getByTestId("desktop-application-header")).toBeTruthy();
    expect(screen.getByTestId("computer-sidebar")).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: /resize sidebar/i }),
    ).toBeTruthy();
    expect(screen.queryByTestId("app-top-bar")).toBeNull();
    expect(screen.getByTestId("sidebar-inset").className).not.toContain("pt-");
    expect(screen.getByTestId("outlet")).toBeTruthy();
  });
});
