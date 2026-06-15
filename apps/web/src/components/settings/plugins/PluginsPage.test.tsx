import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  installMock,
  navigateMock,
  queryDocs,
  tenantState,
  toggleRef,
  useQueryMock,
} = vi.hoisted(() => ({
  installMock: vi.fn(),
  navigateMock: vi.fn(),
  queryDocs: {
    SettingsInstallPluginMutation: Symbol("installPlugin"),
    SettingsPluginCatalogQuery: Symbol("pluginCatalog"),
    SettingsMyPluginActivationsQuery: Symbol("myPluginActivations"),
  },
  tenantState: { isOperator: true, roleResolved: true },
  toggleRef: { current: undefined as ((value: string) => void) | undefined },
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsInstallPluginMutation) {
      return [{ fetching: false }, installMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: useQueryMock,
}));

// Radix ToggleGroup is finicky under jsdom — mock the @thinkwork/ui pieces this
// page uses (matching the repo's approach in DesktopApplicationHeader.test).
// ToggleGroupItem clicks drive the parent's onValueChange via toggleRef.
vi.mock("@thinkwork/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@thinkwork/ui")>()),
  Badge: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
  Button: ({
    children,
    onClick,
    onKeyDown,
    disabled,
    "aria-label": ariaLabel,
    title,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    "aria-label"?: string;
    title?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  ),
  ToggleGroup: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    toggleRef.current = onValueChange;
    return <div>{children}</div>;
  },
  ToggleGroupItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <button type="button" onClick={() => toggleRef.current?.(value)}>
      {children}
    </button>
  ),
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

import { PluginsPage } from "./PluginsPage";

const refreshCatalog = vi.fn();
const refreshActivations = vi.fn();

function mockQueries({
  catalogError = false,
  activations = [] as Array<{ pluginKey: string; status: string }>,
}: {
  catalogError?: boolean;
  activations?: Array<{ pluginKey: string; status: string }>;
} = {}) {
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
    if (query === queryDocs.SettingsMyPluginActivationsQuery) {
      return [
        { data: { myPluginActivations: activations }, fetching: false },
        refreshActivations,
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
}

beforeEach(() => {
  installMock.mockReset();
  navigateMock.mockReset();
  refreshCatalog.mockReset();
  refreshActivations.mockReset();
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
  it("renders the degraded catalog state with a retry", () => {
    mockQueries({ catalogError: true });
    render(<PluginsPage />);

    expect(
      screen.getByText(
        /Plugin catalog is currently unavailable\. Installed plugins remain active\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("shows a Reconnect needed badge when the user's activation needs reauth", () => {
    mockQueries({
      activations: [{ pluginKey: "lastmile", status: "needs_reauth" }],
    });
    render(<PluginsPage />);

    const lastmileRow = screen.getByRole("link", { name: "Open LastMile" });
    expect(within(lastmileRow).getByText("Reconnect needed")).toBeTruthy();
  });

  it("does not show Reconnect needed for an active activation", () => {
    mockQueries({
      activations: [{ pluginKey: "lastmile", status: "active" }],
    });
    render(<PluginsPage />);

    expect(screen.queryByText("Reconnect needed")).toBeNull();
  });

  it("renders the update-available badge once for the single catalog list", () => {
    render(<PluginsPage />);

    // Single list now (no duplicate Installed section) — one badge.
    expect(screen.getAllByText("Update available").length).toBe(1);
  });

  it("keeps key-gated catalog rows status-only", () => {
    render(<PluginsPage />);

    const brainRow = screen.getByRole("link", {
      name: "Open Company Brain",
    });
    expect(
      within(brainRow).getByText("knowledge graph substrate.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(within(brainRow).queryByText("Premium")).toBeNull();
    expect(within(brainRow).queryByText("Key required")).toBeNull();
    expect(
      within(brainRow).queryByRole("link", { name: /enter key/i }),
    ).toBeNull();
    expect(within(brainRow).getByText("Not installed")).toBeTruthy();
    expect(installMock).not.toHaveBeenCalled();
  });

  it("filters to installed-only when the toggle is switched", () => {
    render(<PluginsPage />);

    // Both plugins visible under "All".
    expect(screen.getByRole("link", { name: "Open Twenty CRM" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /installed \(2\)/i }));

    // Twenty (not installed) drops out; installed plugins remain.
    expect(screen.queryByRole("link", { name: "Open Twenty CRM" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open LastMile" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Docs Sync" })).toBeTruthy();
  });

  it("shows only installed auth-capable plugins to non-operators", () => {
    tenantState.isOperator = false;
    render(<PluginsPage />);

    expect(screen.getByRole("link", { name: "Open LastMile" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Twenty CRM" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Docs Sync" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    expect(screen.queryByText("Not installed")).toBeNull();
    expect(screen.queryByText("Update available")).toBeNull();
  });

  it("installs a catalog plugin and refetches catalog + activations", async () => {
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
      expect(refreshCatalog).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
      expect(refreshActivations).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("opens plugin details from the full catalog row", () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole("link", { name: "Open Company Brain" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "company-brain" },
    });
  });

  it("launches deployed applications without opening plugin details", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PluginsPage />);

    const lastmileRow = screen.getByRole("link", { name: "Open LastMile" });
    fireEvent.click(
      within(lastmileRow).getByRole("button", {
        name: "Open LastMile application",
      }),
    );

    expect(openMock).toHaveBeenCalledWith(
      "https://lastmile.example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Open Docs Sync application" }),
    ).toBeNull();

    openMock.mockRestore();
  });
});

const installedPlugins = [
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
  {
    __typename: "PluginInstall" as const,
    id: "install-3",
    pluginKey: "docs-sync",
    pinnedVersion: "1.0.0",
    state: "installed",
    lastTransitionAt: "2026-06-12T12:00:00Z",
    lastError: null,
    activatedUserCount: 0,
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
    launchUrl: "https://lastmile.example.com",
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
    install: installedPlugins[0],
  },
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "docs-sync",
    displayName: "Docs Sync",
    description: "Tenant-wide document sync with no per-user OAuth.",
    latestVersion: "1.0.0",
    launchUrl: null,
    updateAvailable: false,
    versions: [
      {
        version: "1.0.0",
        payloadSha256: "sha256:d",
        requiredOauthScopes: [],
        components: [],
      },
    ],
    install: installedPlugins[1],
  },
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "company-brain",
    displayName: "Company Brain",
    description: "Premium knowledge graph substrate.",
    latestVersion: "0.1.0",
    launchUrl: null,
    updateAvailable: false,
    premium: {
      entitlementProductKey: "company-brain",
      installKeyRequired: true,
      installKeyPrompt:
        "Enter the Company Brain install key provided by ThinkWork.",
    },
    entitlement: null,
    versions: [
      {
        version: "0.1.0",
        payloadSha256: "sha256:brain",
        requiredOauthScopes: [],
        components: [],
      },
    ],
    install: null,
  },
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "twenty",
    displayName: "Twenty CRM",
    description: "Customer relationship management.",
    latestVersion: "1.0.0",
    launchUrl: null,
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
