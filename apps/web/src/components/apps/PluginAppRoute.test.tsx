import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigateMock, queryResultMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  queryResultMock: {
    fetching: false,
    error: null as { message: string } | null,
    data: {
      installedPluginApps: [] as Array<{
        id: string;
        pluginInstallId?: string;
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
    params,
    search: _search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
  }) => {
    const href =
      params && to === "/apps/$pluginKey/$appRouteSegment"
        ? `/apps/${params.pluginKey}/${params.appRouteSegment}`
        : to;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useNavigate: () => navigateMock,
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DataTable: ({
    columns,
    data,
    onRowClick,
  }: {
    columns: Array<any>;
    data: Array<any>;
    onRowClick?: (row: any) => void;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={String(column.accessorKey ?? column.id)}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={row.id}
            role="button"
            tabIndex={0}
            aria-label={`${row.pluginName} ${row.appName}`}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((column) => (
              <td key={String(column.accessorKey ?? column.id)}>
                {column.cell
                  ? column.cell({ row: { original: row } } as any)
                  : row[column.accessorKey]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock(
  "@/components/plugin-apps/twenty-client-engagement/TwentyClientEngagementApp",
  () => ({
    TwentyClientEngagementApp: ({
      appDisplayName,
      pluginDisplayName,
    }: {
      appDisplayName: string;
      pluginDisplayName: string;
    }) => (
      <section>
        <h1>{appDisplayName}</h1>
        <p>{pluginDisplayName}</p>
        <p>Twenty engagement app shell</p>
      </section>
    ),
  }),
);

vi.mock(
  "@/components/plugin-apps/n8n-workflows/N8nWorkflowOperationsApp",
  () => ({
    N8nWorkflowOperationsApp: ({
      pluginInstallId,
      appDisplayName,
      pluginDisplayName,
    }: {
      pluginInstallId: string;
      appDisplayName: string;
      pluginDisplayName: string;
    }) => (
      <section>
        <h1>{appDisplayName}</h1>
        <p>{pluginDisplayName}</p>
        <p>{pluginInstallId}</p>
        <p>n8n workflow operations app shell</p>
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

    render(
      <PluginAppRoute pluginKey="twenty" appRouteSegment="client-engagement" />,
    );

    expect(
      screen.getByRole("heading", { name: "Client Engagement", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("Twenty engagement app shell")).toBeTruthy();
  });

  it("renders the selected n8n app with the installed plugin id", () => {
    queryResultMock.data.installedPluginApps = [
      {
        id: "install-n8n:workflow-operations",
        pluginInstallId: "install-n8n",
        pluginKey: "n8n",
        appKey: "n8n-workflow-operations",
        pluginDisplayName: "n8n",
        displayName: "n8n Workflows",
        routeSegment: "workflows",
        description:
          "Read-only workflow and execution operations surface for n8n.",
        readiness: {
          state: "ready",
          message: "Ready to launch.",
          nextAction: null,
        },
      },
    ];

    render(<PluginAppRoute pluginKey="n8n" appRouteSegment="workflows" />);

    expect(
      screen.getByRole("heading", { name: "n8n Workflows", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("n8n workflow operations app shell")).toBeTruthy();
    expect(screen.getByText("install-n8n")).toBeTruthy();
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

    render(
      <PluginAppRoute pluginKey="twenty" appRouteSegment="client-engagement" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect plugin" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "twenty" },
    });
  });

  it("renders installed applications on /apps", () => {
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

    const row = screen.getByRole("button", {
      name: "Twenty CRM Client Engagement",
    });
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/apps/$pluginKey/$appRouteSegment",
      params: {
        pluginKey: "twenty",
        appRouteSegment: "client-engagement",
      },
    });
    expect(
      screen
        .getByRole("columnheader", { name: "Plugin" })
        .compareDocumentPosition(
          screen.getByRole("columnheader", { name: "Application" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows an empty applications page state when no apps are installed", () => {
    render(<PluginAppsIndexRoute />);

    expect(screen.getByText("No applications installed")).toBeTruthy();
    expect(
      screen.getByText("Install a plugin application to open it here."),
    ).toBeTruthy();
  });
});
