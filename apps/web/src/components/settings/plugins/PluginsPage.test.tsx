import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installMock, queryDocs, tenantState, toggleRef, useQueryMock } =
  vi.hoisted(() => ({
    installMock: vi.fn(),
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
    disabled,
    "aria-label": ariaLabel,
    title,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "aria-label"?: string;
    title?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
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

    const lastmileRow = screen.getByRole("link", { name: "LastMile" })
      .parentElement!.parentElement!;
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

  it("filters to installed-only when the toggle is switched", () => {
    render(<PluginsPage />);

    // Both plugins visible under "All".
    expect(screen.getByRole("link", { name: "Twenty CRM" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /installed \(1\)/i }));

    // Twenty (not installed) drops out; LastMile (installed) remains.
    expect(screen.queryByRole("link", { name: "Twenty CRM" })).toBeNull();
    expect(screen.getByRole("link", { name: "LastMile" })).toBeTruthy();
  });

  it("hides the Install action from non-operators", () => {
    tenantState.isOperator = false;
    render(<PluginsPage />);

    expect(screen.queryByRole("button", { name: /^install$/i })).toBeNull();
    expect(screen.getByText("Not installed")).toBeTruthy();
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
