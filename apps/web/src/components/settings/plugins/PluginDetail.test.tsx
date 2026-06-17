import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { desktopState, mocks, queryDocs, tenantState, paramsState } = vi.hoisted(
  () => ({
    desktopState: {
      bridge: null as null | { getDesktopConfig: ReturnType<typeof vi.fn> },
    },
    paramsState: { pluginKey: "lastmile" },
    mocks: {
      activate: vi.fn(),
      activateCredentials: vi.fn(),
      deactivate: vi.fn(),
      install: vi.fn(),
      navigate: vi.fn(),
      retry: vi.fn(),
      setHeader: vi.fn(),
      uninstall: vi.fn(),
      upgrade: vi.fn(),
      useQuery: vi.fn(),
    },
    queryDocs: {
      SettingsActivatePluginMutation: Symbol("activatePlugin"),
      SettingsActivatePluginWithCredentialsMutation: Symbol(
        "activatePluginWithCredentials",
      ),
      SettingsDeactivatePluginMutation: Symbol("deactivatePlugin"),
      SettingsInstallPluginMutation: Symbol("installPlugin"),
      SettingsEmailChannelQuery: Symbol("emailChannel"),
      SettingsSaveEmailProviderCredentialMutation: Symbol(
        "saveEmailProviderCredential",
      ),
      SettingsRunEmailReadinessProbeMutation: Symbol("runEmailReadinessProbe"),
      SettingsUpsertEmailSpacePolicyMutation: Symbol("upsertEmailSpacePolicy"),
      SettingsAddEmailSpaceSenderAllowlistMutation: Symbol(
        "addEmailSpaceSenderAllowlist",
      ),
      SettingsRemoveEmailSpaceSenderAllowlistMutation: Symbol(
        "removeEmailSpaceSenderAllowlist",
      ),
      SettingsManagedApplicationDeploymentQuery: Symbol(
        "managedApplicationDeployment",
      ),
      SettingsMyPluginActivationsQuery: Symbol("myPluginActivations"),
      SettingsPluginCatalogQuery: Symbol("pluginCatalog"),
      SettingsPluginInstallsQuery: Symbol("pluginInstalls"),
      SettingsRetryPluginComponentMutation: Symbol("retryPluginComponent"),
      SettingsUninstallPluginMutation: Symbol("uninstallPlugin"),
      SettingsUpgradePluginMutation: Symbol("upgradePlugin"),
    },
    tenantState: { isOperator: true, roleResolved: true },
  }),
);

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsActivatePluginMutation) {
      return [{ fetching: false }, mocks.activate];
    }
    if (doc === queryDocs.SettingsActivatePluginWithCredentialsMutation) {
      return [{ fetching: false }, mocks.activateCredentials];
    }
    if (doc === queryDocs.SettingsDeactivatePluginMutation) {
      return [{ fetching: false }, mocks.deactivate];
    }
    if (doc === queryDocs.SettingsInstallPluginMutation) {
      return [{ fetching: false }, mocks.install];
    }
    if (doc === queryDocs.SettingsRetryPluginComponentMutation) {
      return [{ fetching: false }, mocks.retry];
    }
    if (doc === queryDocs.SettingsUninstallPluginMutation) {
      return [{ fetching: false }, mocks.uninstall];
    }
    if (doc === queryDocs.SettingsUpgradePluginMutation) {
      return [{ fetching: false }, mocks.upgrade];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: mocks.useQuery,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState,
}));

vi.mock("@/lib/desktop-runtime", () => ({
  getDesktopBridge: () => desktopState.bridge,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ pluginKey: paramsState.pluginKey }),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children?: unknown;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children as never}
    </a>
  ),
}));

// The plan dialog is the EXISTING managed-applications approval surface —
// PluginDetail only hands the linked job to it. Stubbed here so the test
// asserts the handoff (job id + open state), not the dialog internals.
vi.mock(
  "@/components/settings/managed-applications/ManagedApplicationPlanDialog",
  () => ({
    ManagedApplicationPlanDialog: ({
      job,
      open,
    }: {
      job?: { id: string } | null;
      open: boolean;
    }) =>
      open ? (
        <div data-testid="plan-dialog">{job ? job.id : "no-job"}</div>
      ) : null,
  }),
);

import { PluginDetail } from "./PluginDetail";

const refreshCatalog = vi.fn();
const refreshInstalls = vi.fn();
const refreshActivations = vi.fn();

type Fixtures = {
  install?: Record<string, unknown> | null;
  activations?: Array<Record<string, unknown>>;
  catalog?: Array<Record<string, unknown>>;
};

function mockQueries({
  install = baseInstall,
  activations = [needsReauthActivation],
  catalog = [catalogEntry],
}: Fixtures = {}) {
  mocks.useQuery.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsPluginCatalogQuery) {
      return [
        { data: { pluginCatalog: catalog }, fetching: false },
        refreshCatalog,
      ];
    }
    if (query === queryDocs.SettingsPluginInstallsQuery) {
      return [
        {
          data: { pluginInstalls: install ? [install] : [] },
          fetching: false,
        },
        refreshInstalls,
      ];
    }
    if (query === queryDocs.SettingsMyPluginActivationsQuery) {
      return [
        { data: { myPluginActivations: activations }, fetching: false },
        refreshActivations,
      ];
    }
    if (query === queryDocs.SettingsManagedApplicationDeploymentQuery) {
      return [
        {
          data: { managedApplicationDeployment: deploymentJob },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsEmailChannelQuery) {
      return [
        {
          data: {
            emailChannelSummary,
          },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  refreshCatalog.mockReset();
  refreshInstalls.mockReset();
  refreshActivations.mockReset();
  tenantState.isOperator = true;
  tenantState.roleResolved = true;
  desktopState.bridge = null;
  mocks.upgrade.mockResolvedValue({
    data: { upgradePlugin: { id: "install-1", state: "installing" } },
  });
  mocks.retry.mockResolvedValue({
    data: { retryPluginComponent: { id: "install-1", state: "installing" } },
  });
  mocks.uninstall.mockResolvedValue({
    data: { uninstallPlugin: { id: "install-1", state: "uninstalling" } },
  });
  mocks.activate.mockResolvedValue({
    data: { activatePlugin: { authorizeUrl: "https://auth.example/start" } },
  });
  mocks.activateCredentials.mockResolvedValue({
    data: {
      activatePluginWithCredentials: {
        id: "act-plane",
        pluginInstallId: "install-plane",
        pluginKey: "plane",
        status: "active",
      },
    },
  });
  mocks.deactivate.mockResolvedValue({
    data: { deactivatePlugin: { id: "act-1", status: "revoked" } },
  });
  mockQueries();
  paramsState.pluginKey = "lastmile";
  window.history.replaceState({}, "", "/settings/plugins/lastmile");
});

afterEach(cleanup);

describe("PluginDetail", () => {
  it("shows the version diff with a scope warning and installs the update", async () => {
    render(<PluginDetail />);

    expect(screen.getByText("v1.0.0 → v1.1.0")).toBeTruthy();
    // 1.1.0 adds the "admin" scope over the pinned 1.0.0 — the update section
    // must warn that re-auth will be required.
    expect(
      screen.getByText(/requests new permissions \(admin\)/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /install update/i }));

    await waitFor(() => {
      expect(mocks.upgrade).toHaveBeenCalledWith({
        input: expect.objectContaining({
          installId: "install-1",
          version: "1.1.0",
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
      expect(refreshActivations).toHaveBeenCalledWith({
        requestPolicy: "network-only",
      });
    });
  });

  it("shows Connect to non-operators without install/update/uninstall/retry actions", () => {
    tenantState.isOperator = false;
    mockQueries({ activations: [] });
    render(<PluginDetail />);

    expect(screen.getByRole("button", { name: /^connect$/i })).toBeTruthy();
    expect(screen.queryByText("Partially installed")).toBeNull();
    expect(screen.queryByText("Components")).toBeNull();
    expect(screen.queryByText("S3 prefix seed failed")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /install update/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /uninstall plugin/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("renders per-component errors with a retry action when partially installed", async () => {
    render(<PluginDetail />);

    expect(screen.getByText("Partially installed")).toBeTruthy();
    expect(screen.getByText("S3 prefix seed failed")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /retry lastmile-skills/i }),
    );

    await waitFor(() => {
      expect(mocks.retry).toHaveBeenCalledWith({
        input: { installId: "install-1", componentKey: "lastmile-skills" },
      });
    });
  });

  it("renders the Reconnect badge and button for a needs_reauth activation", () => {
    render(<PluginDetail />);

    // Badge + button both read "Reconnect" (SettingsMcpServerDetail Expired
    // pattern).
    expect(screen.getAllByText("Reconnect").length).toBe(2);
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
  });

  it("starts plugin OAuth when Reconnect is clicked", async () => {
    mocks.activate.mockResolvedValue({
      error: new Error("navigation stopped for test"),
    });
    render(<PluginDetail />);

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));

    await waitFor(() => {
      expect(mocks.activate).toHaveBeenCalledWith({
        input: {
          installId: "install-1",
          returnTo: "http://localhost:3000/settings/plugins/lastmile",
        },
      });
    });
    expect(
      await screen.findByText(
        "Could not start connection: navigation stopped for test",
      ),
    ).toBeTruthy();
  });

  it("uses the stage-scoped desktop app route as the OAuth return URL", async () => {
    desktopState.bridge = {
      getDesktopConfig: vi.fn().mockResolvedValue({
        oauthRedirectUri: "thinkwork-canary://oauth/callback",
      }),
    };
    mocks.activate.mockResolvedValue({
      error: new Error("navigation stopped for test"),
    });
    render(<PluginDetail />);

    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));

    await waitFor(() => {
      expect(mocks.activate).toHaveBeenCalledWith({
        input: {
          installId: "install-1",
          returnTo: "thinkwork-canary://app/settings/plugins/lastmile",
        },
      });
    });
  });

  it("saves Plane credentials instead of starting OAuth", async () => {
    paramsState.pluginKey = "plane";
    mockQueries({
      install: {
        ...baseInstall,
        id: "install-plane",
        pluginKey: "plane",
        state: "installed",
      },
      activations: [],
      catalog: [planeEntry],
    });
    render(<PluginDetail />);

    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^connect$/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("Plane personal access token"), {
      target: { value: "pat_test" },
    });
    fireEvent.change(screen.getByLabelText("Workspace slug"), {
      target: { value: "engineering" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));

    await waitFor(() => {
      expect(mocks.activateCredentials).toHaveBeenCalledWith({
        input: {
          installId: "install-plane",
          credentials: [
            { key: "apiKey", value: "pat_test" },
            { key: "workspaceSlug", value: "engineering" },
          ],
        },
      });
    });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("shows the success notice, refetches activations, and clears the OAuth return params", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/plugins/lastmile?pluginOAuth=success",
    );
    render(<PluginDetail />);

    expect(await screen.findByText("Connected.")).toBeTruthy();
    expect(refreshActivations).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(window.location.search).not.toContain("pluginOAuth");
  });

  it("requires typing the exact plugin key before uninstalling", async () => {
    render(<PluginDetail />);

    fireEvent.click(screen.getByRole("button", { name: /uninstall plugin/i }));

    // The dialog lists the component inventory and the activated-user impact.
    expect(
      screen.getByText(/3 users will lose access to this plugin/i),
    ).toBeTruthy();

    const confirm = screen
      .getAllByRole("button", { name: /uninstall plugin/i })
      .find((button) => (button as HTMLButtonElement).disabled);
    expect(confirm).toBeTruthy();

    const input = screen.getByPlaceholderText("lastmile");
    fireEvent.change(input, { target: { value: "wrong-key" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "lastmile" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm as HTMLButtonElement);
    await waitFor(() => {
      expect(mocks.uninstall).toHaveBeenCalledWith({
        input: {
          installId: "install-1",
          destructiveConfirmation: "lastmile",
        },
      });
    });
  });

  it("renders the Review-deployment-plan handoff for awaiting_approval and opens the dialog with the linked job", async () => {
    mockQueries({ install: awaitingApprovalInstall });
    render(<PluginDetail />);

    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    const review = screen.getByRole("button", {
      name: /review deployment plan/i,
    });
    expect(review).toBeTruthy();
    expect(screen.queryByTestId("plan-dialog")).toBeNull();

    fireEvent.click(review);

    // The dialog receives the deployment job linked from the infra
    // component's handler_ref.
    const dialog = await screen.findByTestId("plan-dialog");
    expect(dialog.textContent).toBe("job-77");
  });

  it("hides pending-approval deployment details from non-operators", () => {
    tenantState.isOperator = false;
    mockQueries({ install: awaitingApprovalInstall, activations: [] });
    render(<PluginDetail />);

    expect(screen.getByRole("button", { name: /^connect$/i })).toBeTruthy();
    expect(screen.queryByText("Awaiting approval")).toBeNull();
    expect(
      screen.queryByText(/an operator must review and approve/i),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /review deployment plan/i }),
    ).toBeNull();
  });

  it("links operators on the twenty plugin to the deployment detail page (U10)", () => {
    paramsState.pluginKey = "twenty";
    mockQueries({
      install: { ...baseInstall, pluginKey: "twenty" },
      activations: [],
    });
    render(<PluginDetail />);

    const link = screen.getByRole("link", {
      name: /open deployment details/i,
    });
    expect(link.getAttribute("href")).toBe("/settings/crm");
  });

  it("hides the twenty deployment link from non-operators", () => {
    paramsState.pluginKey = "twenty";
    tenantState.isOperator = false;
    mockQueries({
      install: { ...baseInstall, pluginKey: "twenty" },
      activations: [],
    });
    render(<PluginDetail />);

    expect(
      screen.queryByRole("link", { name: /open deployment details/i }),
    ).toBeNull();
  });

  it("renders Email channel readiness and Resend key guidance for operators", () => {
    paramsState.pluginKey = "email-channel";
    mockQueries({
      install: {
        ...baseInstall,
        pluginKey: "email-channel",
        state: "installed",
      },
      activations: [],
      catalog: [emailChannelEntry],
    });
    render(<PluginDetail />);

    expect(screen.getByText("Production email blocked")).toBeTruthy();
    expect(screen.getAllByText("Resend API key").length).toBeGreaterThan(1);
    expect(
      screen.getByText(/dedicated ThinkWork production key/i),
    ).toBeTruthy();
    expect(screen.getByText(/one-key setup/i)).toBeTruthy();
    expect(screen.getAllByText(/\*\.thinkwork\.ai/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Resend API key")).toBeTruthy();
    expect(screen.queryByLabelText("Dedicated domain")).toBeNull();
    expect(
      screen.queryByLabelText("Webhook signing secret reference"),
    ).toBeNull();
    expect(screen.getByText("Not stored")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Resend API key"), {
      target: { value: "re_test_123" },
    });

    expect(screen.getByDisplayValue("re_test_123")).toBeTruthy();
    expect(screen.getByText("Save API key")).toBeTruthy();
  });

  it("shows stored Resend credentials without an empty password field", () => {
    paramsState.pluginKey = "email-channel";
    mockQueries({
      install: {
        ...baseInstall,
        pluginKey: "email-channel",
        state: "installed",
      },
      activations: [],
      catalog: [emailChannelEntry],
    });
    mocks.useQuery.mockImplementation(({ query }: { query: unknown }) => {
      if (query === queryDocs.SettingsEmailChannelQuery) {
        return [
          {
            data: {
              emailChannelSummary: storedEmailChannelSummary,
            },
            fetching: false,
          },
          vi.fn(),
        ];
      }
      if (query === queryDocs.SettingsPluginCatalogQuery) {
        return [
          { data: { pluginCatalog: [emailChannelEntry] }, fetching: false },
          refreshCatalog,
        ];
      }
      if (query === queryDocs.SettingsPluginInstallsQuery) {
        return [
          {
            data: {
              pluginInstalls: [
                {
                  ...baseInstall,
                  pluginKey: "email-channel",
                  state: "installed",
                },
              ],
            },
            fetching: false,
          },
          refreshInstalls,
        ];
      }
      if (query === queryDocs.SettingsMyPluginActivationsQuery) {
        return [
          { data: { myPluginActivations: [] }, fetching: false },
          refreshActivations,
        ];
      }
      return [{ fetching: false }, vi.fn()];
    });

    render(<PluginDetail />);

    expect(screen.getByText("API key configured")).toBeTruthy();
    expect(screen.getByText("Stored")).toBeTruthy();
    expect(screen.queryByLabelText("Resend API key")).toBeNull();
    expect(
      screen.getByRole("button", { name: /rotate api key/i }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /rotate api key/i }));

    expect(screen.getByLabelText("New Resend API key")).toBeTruthy();
    expect(screen.getByText("Save rotated key")).toBeTruthy();
  });

  it("opens an install-key dialog for unentitled Company Brain installs", async () => {
    paramsState.pluginKey = "company-brain";
    mockQueries({
      install: null,
      activations: [],
      catalog: [companyBrainEntry],
    });
    mocks.install.mockResolvedValue({
      data: {
        installPlugin: {
          id: "install-brain",
          pluginKey: "company-brain",
          state: "installing",
        },
      },
    });
    render(<PluginDetail />);

    expect(screen.queryByText("Premium access")).toBeNull();
    expect(screen.queryByText("Install key required")).toBeNull();
    expect(
      screen.getByText("knowledge graph substrate.", { exact: false }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /enter key/i }));

    const input = screen.getByLabelText("Install key");
    fireEvent.change(input, { target: { value: "twpi_valid" } });
    fireEvent.click(
      screen.getByRole("button", { name: /unlock and install/i }),
    );

    await waitFor(() => {
      expect(mocks.install).toHaveBeenCalledWith({
        input: expect.objectContaining({
          pluginKey: "company-brain",
          installKey: "twpi_valid",
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

  it("shows Company Brain operations, workspace, and adoption evidence once entitled", () => {
    paramsState.pluginKey = "company-brain";
    mockQueries({
      install: companyBrainInstall,
      activations: [],
      catalog: [{ ...companyBrainEntry, entitlement: companyBrainEntitlement }],
    });
    render(<PluginDetail />);

    expect(screen.queryByText("Premium access")).toBeNull();
    expect(screen.queryByText("Entitled")).toBeNull();
    expect(screen.getByText(/Adoption plan verifies/i)).toBeTruthy();
    const operations = screen.getByRole("link", { name: /open operations/i });
    expect(operations.getAttribute("href")).toBe("/settings/brain-operations");
    const link = screen.getByRole("link", { name: /open ontology/i });
    expect(link.getAttribute("href")).toBe("/settings/memory/knowledge-graph");
  });
});

const baseInstall = {
  __typename: "PluginInstall" as const,
  id: "install-1",
  pluginKey: "lastmile",
  pinnedVersion: "1.0.0",
  state: "partially_installed",
  lastTransitionAt: "2026-06-12T12:00:00Z",
  lastError: null,
  activatedUserCount: 3,
  components: [
    {
      __typename: "PluginComponent" as const,
      id: "component-1",
      componentKey: "lastmile-mcp",
      componentType: "mcp-server",
      state: "provisioned",
      lastError: null,
    },
    {
      __typename: "PluginComponent" as const,
      id: "component-2",
      componentKey: "lastmile-skills",
      componentType: "skills",
      state: "failed",
      lastError: "S3 prefix seed failed",
    },
  ],
};

const awaitingApprovalInstall = {
  ...baseInstall,
  state: "awaiting_approval",
  components: [
    ...baseInstall.components.map((component) => ({
      ...component,
      state: "provisioned",
      lastError: null,
    })),
    {
      __typename: "PluginComponent" as const,
      id: "component-3",
      componentKey: "twenty-infra",
      componentType: "infrastructure",
      state: "pending",
      handlerRef: {
        managedAppKey: "twenty",
        managedApplicationId: "app-1",
        deploymentJobId: "job-77",
        operation: "ENABLE",
        attempt: 1,
      },
      lastError: null,
    },
  ],
};

const deploymentJob = {
  __typename: "ManagedApplicationDeploymentJob" as const,
  id: "job-77",
  appKey: "twenty",
  operation: "ENABLE",
  status: "awaiting_approval",
};

const needsReauthActivation = {
  __typename: "UserPluginActivation" as const,
  id: "act-1",
  pluginInstallId: "install-1",
  pluginKey: "lastmile",
  status: "needs_reauth",
  grantedScopes: ["read"],
  grantedAt: "2026-06-10T12:00:00Z",
  revokedAt: null,
};

const catalogEntry = {
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
      requiredOauthScopes: ["read", "write", "admin"],
      components: [
        {
          key: "lastmile-mcp",
          type: "mcp-server",
          displayName: "LastMile MCP",
        },
        { key: "lastmile-skills", type: "skills", displayName: null },
      ],
    },
    {
      version: "1.0.0",
      payloadSha256: "sha256:a",
      requiredOauthScopes: ["read", "write"],
      components: [
        {
          key: "lastmile-mcp",
          type: "mcp-server",
          displayName: "LastMile MCP",
        },
        { key: "lastmile-skills", type: "skills", displayName: null },
      ],
    },
  ],
  install: null,
};

const planeEntry = {
  __typename: "PluginCatalogEntry" as const,
  pluginKey: "plane",
  displayName: "Plane",
  description: "Plane work item tools.",
  latestVersion: "0.1.2",
  updateAvailable: false,
  premium: null,
  entitlement: null,
  versions: [
    {
      version: "0.1.2",
      payloadSha256: "sha256:plane",
      requiredOauthScopes: [],
      components: [
        {
          key: "issues",
          type: "mcp-server",
          displayName: "Plane work items",
        },
      ],
    },
  ],
  install: null,
};

const emailChannelEntry = {
  __typename: "PluginCatalogEntry" as const,
  pluginKey: "email-channel",
  displayName: "Email",
  description: "Tenant agent and Space email channel.",
  latestVersion: "0.1.0",
  updateAvailable: false,
  premium: null,
  entitlement: null,
  versions: [
    {
      version: "0.1.0",
      payloadSha256: "sha256:email",
      requiredOauthScopes: [],
      components: [
        {
          key: "email-channel",
          type: "email-channel",
          displayName: "Email channel",
        },
      ],
    },
  ],
  install: null,
};

const emailChannelSummary = {
  __typename: "EmailChannelSummary" as const,
  productionReady: false,
  ledgerEventCount: 0,
  providers: [],
  domains: [],
  readinessChecks: [
    {
      __typename: "EmailReadinessCheck" as const,
      id: "check-credentials",
      providerInstallId: "provider-resend",
      domainId: null,
      checkKey: "CREDENTIALS",
      status: "BLOCKED",
      failureCode: "missing_credentials",
      failureMessage: "Provider credentials are not configured.",
      metadata: "{}",
      createdAt: "2026-06-17T12:00:00Z",
      updatedAt: "2026-06-17T12:00:00Z",
      lastCheckedAt: "2026-06-17T12:00:00Z",
    },
  ],
  blockingReadinessChecks: [],
  spacePolicies: [],
};

const storedEmailChannelSummary = {
  ...emailChannelSummary,
  providers: [
    {
      __typename: "EmailProviderInstall" as const,
      id: "provider-resend",
      provider: "RESEND",
      displayName: "Resend",
      status: "PENDING",
      activeForProduction: false,
      credentialConfigured: true,
      webhookConfigured: true,
      defaultFromEmail: "noreply@thinkwork.ai",
      metadata: "{}",
      createdAt: "2026-06-17T12:00:00Z",
      updatedAt: "2026-06-17T12:00:00Z",
    },
  ],
  domains: [
    {
      __typename: "EmailDomain" as const,
      id: "domain-thinkwork",
      providerInstallId: "provider-resend",
      domain: "thinkwork.ai",
      ownershipType: "THINKWORK_OWNED",
      status: "VERIFIED",
      sendingVerifiedAt: "2026-06-17T12:00:00Z",
      inboundVerifiedAt: "2026-06-17T12:00:00Z",
      dnsRecords: null,
      providerMetadata: null,
      createdAt: "2026-06-17T12:00:00Z",
      updatedAt: "2026-06-17T12:00:00Z",
    },
  ],
};

const companyBrainEntitlement = {
  __typename: "PluginEntitlement" as const,
  id: "entitlement-brain",
  status: "active",
  source: "install_key",
  grantedAt: "2026-06-13T12:00:00Z",
};

const companyBrainEntry = {
  __typename: "PluginCatalogEntry" as const,
  pluginKey: "company-brain",
  displayName: "Company Brain",
  description: "Premium knowledge graph substrate.",
  latestVersion: "0.1.0",
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
      components: [
        {
          key: "brain-substrate",
          type: "infrastructure",
          displayName: "Brain substrate",
        },
      ],
    },
  ],
  install: null,
};

const companyBrainInstall = {
  ...baseInstall,
  id: "install-brain",
  pluginKey: "company-brain",
  state: "awaiting_approval",
  components: [
    {
      __typename: "PluginComponent" as const,
      id: "component-brain",
      componentKey: "brain-substrate",
      componentType: "infrastructure",
      state: "pending",
      handlerRef: {
        managedAppKey: "cognee",
        deploymentJobId: "job-brain",
        adoptionRequiresNoChange: true,
      },
      lastError: null,
    },
  ],
};
