import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigateMock, queryResultMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  queryResultMock: {
    fetching: false,
    error: null as { message: string } | null,
    data: {
      installedPluginApps: [] as Array<{
        id: string;
        pluginKey: string;
        appKey: string;
        pluginDisplayName: string;
        displayName: string;
        routeSegment: string;
        description?: string | null;
        readiness: {
          state: string;
          message: string;
          nextAction?: string | null;
        };
      }>,
    },
  },
}));

vi.mock("urql", () => ({
  useQuery: () => [queryResultMock, vi.fn()],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search: _search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("@thinkwork/ui", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock(
  "@/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp",
  () => ({
    TwentyClientEngagementApp: ({
      appDisplayName,
    }: {
      appDisplayName: string;
    }) => (
      <section>
        <h1>{appDisplayName}</h1>
        <p>Twenty engagement app shell</p>
      </section>
    ),
  }),
);

import { PluginAppRoute, PluginAppsIndexRoute } from "./PluginAppRoute";

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  queryResultMock.fetching = false;
  queryResultMock.error = null;
  queryResultMock.data.installedPluginApps = [];
});

describe("PluginAppRoute", () => {
  it("renders the selected ready app in the main shell content area", () => {
    queryResultMock.data.installedPluginApps = [
      {
        id: "install-1:client-engagement",
        pluginKey: "twenty",
        appKey: "twenty-client-engagement",
        pluginDisplayName: "Twenty CRM",
        displayName: "Client Engagement",
        routeSegment: "client-engagement",
        description:
          "Account and opportunity engagement workspace for Twenty CRM records.",
        readiness: {
          state: "ready",
          message: "Ready to launch.",
          nextAction: null,
        },
      },
    ];

    render(<PluginAppRoute appRouteSegment="client-engagement" />);

    expect(
      screen.getByRole("heading", { name: "Client Engagement", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("Twenty engagement app shell")).toBeTruthy();
  });

  it("offers the plugin connection action when the selected app is not activated", () => {
    queryResultMock.data.installedPluginApps = [
      {
        id: "install-1:client-engagement",
        pluginKey: "twenty",
        appKey: "twenty-client-engagement",
        pluginDisplayName: "Twenty CRM",
        displayName: "Client Engagement",
        routeSegment: "client-engagement",
        readiness: {
          state: "activation_required",
          message: "Connect this plugin before launching the app.",
          nextAction: "connect_plugin",
        },
      },
    ];

    render(<PluginAppRoute appRouteSegment="client-engagement" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect plugin" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "twenty" },
    });
  });

  it("redirects /apps to the first installed app route", async () => {
    queryResultMock.data.installedPluginApps = [
      {
        id: "install-1:client-engagement",
        pluginKey: "twenty",
        appKey: "twenty-client-engagement",
        pluginDisplayName: "Twenty CRM",
        displayName: "Client Engagement",
        routeSegment: "client-engagement",
        readiness: {
          state: "ready",
          message: "Ready to launch.",
          nextAction: null,
        },
      },
    ];

    render(<PluginAppsIndexRoute />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/apps/$appRouteSegment",
        params: { appRouteSegment: "client-engagement" },
        replace: true,
      }),
    );
  });
});
