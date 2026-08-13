import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pageHeaderMock = vi.hoisted(() => ({
  actions: null as unknown,
}));
const routerPathMock = vi.hoisted(() => ({
  pathname: "/settings/activity",
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeader: () => ({ actions: pageHeaderMock.actions }),
}));

const viewportMock = vi.hoisted(() => ({
  isMobile: false,
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useIsMobile: () => viewportMock.isMobile,
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => (
    <div role="tablist">{children}</div>
  ),
  TabsTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    search?: Record<string, unknown>;
  }) => {
    const query = search
      ? Object.entries(search)
          .filter(([, value]) => value != null)
          .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
          .join("&")
      : "";
    return (
      <a href={query ? `${to}?${query}` : to} {...props}>
        {children}
      </a>
    );
  },
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: routerPathMock.pathname } }),
}));

import { SettingsHeaderBar } from "./SettingsHeaderBar";

afterEach(() => {
  cleanup();
  pageHeaderMock.actions = null;
  routerPathMock.pathname = "/settings/activity";
  viewportMock.isMobile = false;
});

// THINK-285: the Connectors header — three tabs plus the active tab's action.
const connectorsActions = () => ({
  title: "Connectors",
  breadcrumbs: [{ label: "Connectors" }],
  tabs: [
    { to: "/settings/mcp-servers", label: "MCP Servers" },
    { to: "/settings/mcp-servers/accounts", label: "Linked Accounts" },
    { to: "/settings/mcp-servers/data-sources", label: "Data Sources" },
  ],
  action: <button aria-label="Register data source">Register</button>,
});

describe("SettingsHeaderBar", () => {
  it("preserves breadcrumb search params on clickable crumbs", () => {
    pageHeaderMock.actions = {
      breadcrumbs: [
        { label: "Activity", href: "/settings/activity" },
        {
          label: "May 31",
          href: "/settings/activity",
          search: { day: "2026-05-31" },
        },
        { label: "CHAT-979 AgentCore retry" },
      ],
    };

    render(<SettingsHeaderBar />);

    expect(
      screen.getByRole("link", { name: "Activity" }).getAttribute("href"),
    ).toBe("/settings/activity");
    expect(
      screen.getByRole("link", { name: "May 31" }).getAttribute("href"),
    ).toBe("/settings/activity?day=2026-05-31");
    expect(screen.getByText("CHAT-979 AgentCore retry")).toBeTruthy();
  });

  // THINK-285 repair regression: at mobile widths the three-tab strip's
  // intrinsic width exceeds the header row, which pushed the action slot off
  // the viewport with no scroll path (dogfood scenario 7 at 390×844). The tab
  // strip must stack on its own scrollable row below the breadcrumb/action
  // row so the action's right edge stays inside the viewport.
  it("stacks tabs below the action row on mobile so the action stays reachable", () => {
    viewportMock.isMobile = true;
    routerPathMock.pathname = "/settings/mcp-servers/data-sources";
    pageHeaderMock.actions = connectorsActions();

    render(<SettingsHeaderBar />);

    const header = screen.getByRole("banner");
    const action = screen.getByRole("button", { name: "Register data source" });
    const tablist = screen.getByRole("tablist");

    // Two stacked rows: breadcrumb + action share the top row; the tab strip
    // lives alone on the second row and may scroll horizontally.
    expect(header.children).toHaveLength(2);
    const [topRow, tabRow] = Array.from(header.children);
    expect(topRow!.contains(action)).toBe(true);
    expect(topRow!.contains(tablist)).toBe(false);
    expect(tabRow!.contains(tablist)).toBe(true);
    expect(tabRow!.className).toContain("overflow-x-auto");
    // All three tabs are still rendered.
    expect(screen.getByText("MCP Servers")).toBeTruthy();
    expect(screen.getByText("Linked Accounts")).toBeTruthy();
    expect(screen.getByText("Data Sources")).toBeTruthy();
  });

  it("keeps the single-row grid with centered tabs and the action slot on desktop", () => {
    viewportMock.isMobile = false;
    routerPathMock.pathname = "/settings/mcp-servers/data-sources";
    pageHeaderMock.actions = connectorsActions();

    render(<SettingsHeaderBar />);

    const header = screen.getByRole("banner");
    expect(header.className).toContain(
      "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
    );
    expect(header.children).toHaveLength(3);
    const [nav, tabsCell, actionCell] = Array.from(header.children);
    expect(nav!.getAttribute("aria-label")).toBe("Breadcrumb");
    expect(tabsCell!.className).toContain("col-start-2");
    expect(tabsCell!.contains(screen.getByRole("tablist"))).toBe(true);
    expect(
      actionCell!.contains(
        screen.getByRole("button", { name: "Register data source" }),
      ),
    ).toBe(true);
  });
});
