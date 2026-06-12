import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installMock, queryDocs, tenantState, useQueryMock } = vi.hoisted(
  () => ({
    installMock: vi.fn(),
    queryDocs: {
      SettingsInstallPluginMutation: Symbol("installPlugin"),
      SettingsPluginCatalogQuery: Symbol("pluginCatalog"),
      SettingsPluginInstallsQuery: Symbol("pluginInstalls"),
    },
    tenantState: { isOperator: true, roleResolved: true },
    useQueryMock: vi.fn(),
  }),
);

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsInstallPluginMutation) {
      return [{ fetching: false }, installMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { PluginsPage } from "./PluginsPage";

const refreshCatalog = vi.fn();
const refreshInstalls = vi.fn();

function mockQueries({
  catalogError = false,
}: { catalogError?: boolean } = {}) {
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsPluginCatalogQuery) {
      return [
        catalogError
          ? {
              data: undefined,
              error: new Error("catalog down"),
              fetching: false,
            }
          : { data: { pluginCatalog: catalogEntries }, fetching: false },
        refreshCatalog,
      ];
    }
    if (query === queryDocs.SettingsPluginInstallsQuery) {
      return [
        { data: { pluginInstalls: installs }, fetching: false },
        refreshInstalls,
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
}

beforeEach(() => {
  installMock.mockReset();
  refreshCatalog.mockReset();
  refreshInstalls.mockReset();
  useQueryMock.mockReset();
  tenantState.isOperator = true;
  tenantState.roleResolved = true;
  installMock.mockResolvedValue({
    data: {
      installPlugin: {
        id: "install-2",
        pluginKey: "twenty",
        pinnedVersion: "1.0.0",
        state: "installing",
      },
    },
  });
  mockQueries();
});

afterEach(cleanup);

describe("PluginsPage", () => {
  it("renders the degraded catalog state while installed plugins still render", () => {
    mockQueries({ catalogError: true });
    render(<PluginsPage />);

    expect(
      screen.getByText(
        /Plugin catalog is currently unavailable\. Installed plugins remain active\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    // The installed plugin still renders (by key — the catalog display name
    // is unavailable) with its state chip.
    const installedRow = screen.getByRole("link", { name: /open lastmile/i });
    expect(within(installedRow).getByText("Installed")).toBeTruthy();
  });

  it("renders the update-available badge for installed catalog entries", () => {
    render(<PluginsPage />);

    // Once on the installed row, once on the catalog entry.
    expect(screen.getAllByText("Update available").length).toBe(2);
  });

  it("hides the Install action from non-operators", () => {
    tenantState.isOperator = false;
    render(<PluginsPage />);

    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    expect(screen.getByText("Not installed")).toBeTruthy();
  });

  it("installs a catalog plugin and refetches installs + catalog", async () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          pluginKey: "twenty",
          idempotencyKey: expect.any(String),
        }),
      });
    });
    await waitFor(() => {
      expect(refreshInstalls).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
      expect(refreshCatalog).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
  });
});

const installs = [
  {
    __typename: "PluginInstall" as const,
    id: "install-1",
    pluginKey: "lastmile",
    pinnedVersion: "1.0.0",
    state: "installed",
    lastTransitionAt: "2026-06-12T12:00:00Z",
    lastError: null,
    activatedUserCount: 2,
    components: [],
  },
];

const catalogEntries = [
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "lastmile",
    displayName: "LastMile",
    description: "LastMile logistics tools and skills.",
    latestVersion: "1.1.0",
    updateAvailable: true,
    versions: [
      {
        version: "1.1.0",
        payloadSha256: "sha256:b",
        requiredOauthScopes: ["read", "write"],
        components: [],
      },
      {
        version: "1.0.0",
        payloadSha256: "sha256:a",
        requiredOauthScopes: ["read"],
        components: [],
      },
    ],
    install: installs[0],
  },
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "twenty",
    displayName: "Twenty CRM",
    description: "Customer relationship management.",
    latestVersion: "1.0.0",
    updateAvailable: false,
    versions: [
      {
        version: "1.0.0",
        payloadSha256: "sha256:c",
        requiredOauthScopes: ["read"],
        components: [],
      },
    ],
    install: null,
  },
];
