import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.fn();
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMock(),
}));

vi.mock("@/components/AppTopBar", () => ({
  AppTopBar: () => <header data-testid="app-top-bar" />,
}));
vi.mock("@/components/ComputerSidebar", () => ({
  ComputerSidebar: () => <aside data-testid="computer-sidebar" />,
}));
vi.mock("@/components/NoTenantAssigned", () => ({
  NoTenantAssigned: () => <div data-testid="no-tenant" />,
}));

vi.mock("@thinkwork/ui", async () => {
  const actual = await vi.importActual<typeof import("@thinkwork/ui")>(
    "@thinkwork/ui",
  );
  return {
    ...actual,
    SidebarProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="sidebar-provider">{children}</div>
    ),
    SidebarInset: ({ children }: { children: React.ReactNode }) => (
      <section>{children}</section>
    ),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
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
});

describe("_authed/_shell layout", () => {
  it("renders <PageSkeleton/> with monospace shimmer Loading while tenant resolves", () => {
    tenantMock.mockReturnValue({ noTenantAssigned: false, isLoading: true });
    render(<ShellLayout />);
    // PageSkeleton wraps LoadingShimmer which renders role="status" and the
    // "Loading..." text per-character with the .tw-shimmer-char class.
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toContain("Loading...");
    const shimmerChars = status.querySelectorAll(".tw-shimmer-char");
    expect(shimmerChars.length).toBeGreaterThan(0);
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
});
