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

vi.mock("@/lib/desktop-runtime", () => ({
  isDesktopBuild: () => false,
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useIsMobile: () => false,
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
});
