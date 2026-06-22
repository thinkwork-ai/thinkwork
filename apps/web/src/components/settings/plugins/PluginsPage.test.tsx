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
  headerConfigRef,
  navigateMock,
  queryDocs,
  refreshCatalogMutationMock,
  tenantState,
  toggleRef,
  useQueryMock,
} = vi.hoisted(() => ({
  headerConfigRef: {
    current: null as {
      action?: React.ReactNode;
      actionKey?: string;
    } | null,
  },
  navigateMock: vi.fn(),
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsPluginCatalogQuery: Symbol("pluginCatalog"),
    SettingsMyPluginActivationsQuery: Symbol("myPluginActivations"),
    SettingsRefreshPluginCatalogMutation: Symbol("refreshPluginCatalog"),
  },
  refreshCatalogMutationMock: vi.fn(),
  tenantState: { isOperator: true, roleResolved: true },
  toggleRef: { current: undefined as ((value: string) => void) | undefined },
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsRefreshPluginCatalogMutation) {
      return [{ fetching: false }, refreshCatalogMutationMock];
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
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (config: {
    action?: React.ReactNode;
    actionKey?: string;
  }) => {
    headerConfigRef.current = config;
  },
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
const refreshDeployment = vi.fn();

function mockQueries({
  catalogError = false,
  catalogFetching = false,
  catalog = catalogEntries,
  activations = [] as Array<{ pluginKey: string; status: string }>,
  runtimeApps = [],
}: {
  catalogError?: boolean;
  catalogFetching?: boolean;
  catalog?: Array<(typeof catalogEntries)[number]>;
  activations?: Array<{ pluginKey: string; status: string }>;
  runtimeApps?: Array<{ key: string; url: string | null }>;
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
          : {
              data: {
                pluginCatalog: catalog,
                pluginCatalogMetadata: catalogMetadata,
              },
              fetching: catalogFetching,
            },
        refreshCatalog,
      ];
    }
    if (query === queryDocs.SettingsMyPluginActivationsQuery) {
      return [
        { data: { myPluginActivations: activations }, fetching: false },
        refreshActivations,
      ];
    }
    if (query === queryDocs.SettingsDeploymentStatusQuery) {
      return [
        {
          data: {
            deploymentStatus: {
              managedApplications: runtimeApps,
            },
          },
          fetching: false,
        },
        refreshDeployment,
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
}

beforeEach(() => {
  headerConfigRef.current = null;
  navigateMock.mockReset();
  refreshCatalogMutationMock.mockReset();
  refreshCatalog.mockReset();
  refreshActivations.mockReset();
  refreshDeployment.mockReset();
  useQueryMock.mockReset();
  tenantState.isOperator = true;
  tenantState.roleResolved = true;
  refreshCatalogMutationMock.mockResolvedValue({
    data: {
      refreshPluginCatalog: {
        ...catalogMetadata,
        stale: false,
        lastRefreshStatus: "not-modified",
      },
    },
  });
  mockQueries();
});

afterEach(cleanup);

function renderHeaderAction() {
  if (!headerConfigRef.current?.action) {
    throw new Error("Expected PluginsPage to publish a header action");
  }
  return render(<>{headerConfigRef.current.action}</>);
}

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

  it("renders plugin rows alphabetically by display name", () => {
    render(<PluginsPage />);

    const rowLabels = screen
      .getAllByRole("link")
      .map((element) => element.getAttribute("aria-label"))
      .filter((label): label is string =>
        Boolean(label?.startsWith("Open ") && !label.includes("application")),
      );
    expect(rowLabels).toEqual([
      "Open Company Brain",
      "Open Docs Sync",
      "Open LastMile",
      "Open SendGrid Email",
      "Open Twenty CRM",
      "Open WorkOS Auth",
    ]);
  });

  it("renders the update-available badge once for the single catalog list", () => {
    render(<PluginsPage />);

    // Single list now (no duplicate Installed section) — one badge.
    expect(screen.getAllByText("Update available").length).toBe(1);
  });

  it("keeps catalog source metadata on the header refresh action", () => {
    render(<PluginsPage />);
    expect(screen.queryByText("Catalog source")).toBeNull();

    renderHeaderAction();

    const refresh = screen.getByRole("button", {
      name: /refresh plugin catalog/i,
    });
    expect(refresh.getAttribute("title")).toBeNull();
    expect(screen.getByText("Catalog metadata")).toBeTruthy();
    expect(screen.getByText("Stale fallback")).toBeTruthy();
    expect(screen.getByText("Digest")).toBeTruthy();
    expect(screen.getByText("abcdef012345")).toBeTruthy();
    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getByText("thinkwork-ai/thinkwork")).toBeTruthy();
    expect(screen.queryByText("Bundled unsigned")).toBeNull();
    expect(headerConfigRef.current?.actionKey).toContain("abcdef0123456789");

    const lastmileRow = screen.getByRole("link", { name: "Open LastMile" });
    expect(
      within(lastmileRow).getByText(/Installed v1\.0\.0 · Latest v1\.1\.0/),
    ).toBeTruthy();
  });

  it("lets operators force-refresh the trusted catalog through GraphQL", async () => {
    render(<PluginsPage />);
    renderHeaderAction();

    fireEvent.click(
      screen.getByRole("button", { name: /refresh plugin catalog/i }),
    );

    await waitFor(() => {
      expect(refreshCatalogMutationMock).toHaveBeenCalledWith({});
    });
    expect(refreshCatalog).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(refreshActivations).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(refreshDeployment).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("does not spin the refresh icon during background catalog fetching", () => {
    mockQueries({ catalogFetching: true });
    render(<PluginsPage />);
    renderHeaderAction();

    const refresh = screen.getByRole("button", {
      name: /refresh plugin catalog/i,
    });
    expect(refresh.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
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
  });

  it("filters to installed-only when the toggle is switched", () => {
    render(<PluginsPage />);

    // Full catalog rows are visible under "All".
    expect(
      screen.getByRole("link", { name: "Open SendGrid Email" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Twenty CRM" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^installed$/i }));

    // Twenty (not installed) drops out; installed plugins remain.
    expect(screen.queryByRole("link", { name: "Open Twenty CRM" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open SendGrid Email" }),
    ).toBeNull();
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
    expect(
      screen.queryByRole("button", { name: /refresh plugin catalog/i }),
    ).toBeNull();
    expect(screen.queryByText("Not installed")).toBeNull();
    expect(screen.queryByText("Update available")).toBeNull();
  });

  it("shows not-installed status instead of installing from the catalog row", () => {
    render(<PluginsPage />);

    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    const twentyRow = screen.getByRole("link", { name: "Open Twenty CRM" });
    expect(within(twentyRow).getByText("Not installed")).toBeTruthy();
  });

  it("opens plugin details from the full catalog row", () => {
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole("link", { name: "Open Company Brain" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "company-brain" },
    });
  });

  it("opens n8n directly on its workflows tab", () => {
    mockQueries({ catalog: [...catalogEntries, n8nCatalogEntry] });
    render(<PluginsPage />);

    fireEvent.click(screen.getByRole("link", { name: "Open n8n" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/plugins/n8n/workflows",
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

  it("launches configured n8n from managed application status", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockQueries({
      catalog: [...catalogEntries, n8nCatalogEntry],
      runtimeApps: [{ key: "n8n", url: "https://n8n.example.test" }],
    });
    render(<PluginsPage />);

    const n8nRow = screen.getByRole("link", { name: "Open n8n" });
    fireEvent.click(
      within(n8nRow).getByRole("button", {
        name: "Open n8n application",
      }),
    );

    expect(openMock).toHaveBeenCalledWith(
      "https://n8n.example.test",
      "_blank",
      "noopener,noreferrer",
    );
    expect(navigateMock).not.toHaveBeenCalled();

    openMock.mockRestore();
  });

  it("links a configured WorkOS row to the WorkOS dashboard", () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PluginsPage />);

    const workosRow = screen.getByRole("link", { name: "Open WorkOS Auth" });
    fireEvent.click(
      within(workosRow).getByRole("button", {
        name: "Open WorkOS Auth application",
      }),
    );

    expect(openMock).toHaveBeenCalledWith(
      "https://dashboard.workos.com/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(navigateMock).not.toHaveBeenCalled();

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
  {
    __typename: "PluginInstall" as const,
    id: "install-workos",
    pluginKey: "workos-auth",
    pinnedVersion: "0.1.0",
    state: "installed",
    lastTransitionAt: "2026-06-12T12:00:00Z",
    lastError: null,
    activatedUserCount: 0,
    components: [
      {
        __typename: "PluginComponent" as const,
        id: "component-workos-auth",
        componentKey: "workos-auth",
        componentType: "auth-provider",
        state: "provisioned",
        lastError: null,
      },
    ],
  },
];

const catalogMetadata = {
  __typename: "PluginCatalogMetadata" as const,
  source: "github-release-stale",
  repository: "thinkwork-ai/thinkwork",
  ref: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  releaseTag: "plugin-catalog-main",
  assetName: "thinkwork-plugin-catalog-main.json",
  catalogSha256: "sha256:abcdef0123456789",
  generatedAt: "2026-06-17T00:00:00.000Z",
  fetchedAt: "2026-06-17T01:00:00.000Z",
  stale: true,
  lastRefreshStatus: "stale-fallback",
  message: "GitHub catalog release fetch failed (403)",
  rateLimitRemaining: "0",
  rateLimitReset: "1760000000",
};

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
    pluginKey: "sendgrid",
    displayName: "SendGrid Email",
    description: "SendGrid invitation email provider.",
    latestVersion: "0.1.0",
    launchUrl: null,
    updateAvailable: false,
    versions: [
      {
        version: "0.1.0",
        payloadSha256: "sha256:sendgrid",
        requiredOauthScopes: [],
        components: [
          {
            key: "settings",
            type: "ui-surface",
            displayName: "SendGrid Email settings",
          },
        ],
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
  {
    __typename: "PluginCatalogEntry" as const,
    pluginKey: "workos-auth",
    displayName: "WorkOS Auth",
    description:
      "WorkOS-backed SSO broker that federates through Cognito while keeping Cognito as ThinkWork's final session issuer.",
    latestVersion: "0.1.0",
    launchUrl: null,
    updateAvailable: false,
    versions: [
      {
        version: "0.1.0",
        payloadSha256: "sha256:workos",
        requiredOauthScopes: [],
        components: [],
      },
    ],
    install: installedPlugins[2],
  },
];

const n8nCatalogEntry = {
  __typename: "PluginCatalogEntry" as const,
  pluginKey: "n8n",
  displayName: "n8n",
  description: "Self-hosted n8n workflow automation runtime.",
  latestVersion: "0.1.0",
  launchUrl: null,
  updateAvailable: false,
  versions: [
    {
      version: "0.1.0",
      payloadSha256: "sha256:n8n",
      requiredOauthScopes: [],
      components: [],
    },
  ],
  install: {
    __typename: "PluginInstall" as const,
    id: "install-n8n",
    pluginKey: "n8n",
    pinnedVersion: "0.1.0",
    state: "installed",
    lastTransitionAt: "2026-06-12T12:00:00Z",
    lastError: null,
    activatedUserCount: 0,
    components: [],
  },
};
