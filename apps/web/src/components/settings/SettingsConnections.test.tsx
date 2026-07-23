import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRow } from "@/lib/connections-api";

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  disconnectConnection: vi.fn(),
  unlinkSlack: vi.fn(),
  refetchSlackLinks: vi.fn(),
  slackLinksQuery: {
    data: { mySlackLinks: [] } as { mySlackLinks: unknown[] } | undefined,
    fetching: false,
    error: undefined as unknown,
  },
  tenantContext: {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1" as string | null,
  },
  authUser: { email: "member@example.com", sub: "cognito-sub-1", groups: [] },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => mocks.tenantContext,
}));

vi.mock("urql", () => ({
  useQuery: () => [mocks.slackLinksQuery, mocks.refetchSlackLinks],
  useMutation: () => [{ fetching: false }, mocks.unlinkSlack],
}));

vi.mock("@/lib/connections-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connections-api")>();
  return {
    ...actual,
    listConnections: mocks.listConnections,
    disconnectConnection: mocks.disconnectConnection,
  };
});

import {
  SettingsConnections,
  bestConnectionForProvider,
} from "./SettingsConnections";

function connection(overrides: Partial<ConnectionRow>): ConnectionRow {
  return {
    id: "conn-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    provider_id: "prov-google",
    status: "active",
    external_id: "eric@example.com",
    metadata: { requested_scopes: ["gmail", "calendar"] },
    connected_at: "2026-07-01T00:00:00Z",
    provider_name: "google_productivity",
    provider_display_name: "Google Workspace",
    provider_type: "productivity",
    ...overrides,
  };
}

const ORIGINAL_LOCATION = window.location;
const ORIGINAL_HISTORY = window.history;
const locationAssign = vi.fn();

function setWindowLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      assign: locationAssign,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  mocks.listConnections.mockReset();
  mocks.disconnectConnection.mockReset();
  mocks.unlinkSlack.mockReset();
  mocks.refetchSlackLinks.mockReset();
  mocks.slackLinksQuery = {
    data: { mySlackLinks: [] },
    fetching: false,
    error: undefined,
  };
  mocks.tenantContext = {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1",
  };
  locationAssign.mockReset();
  setWindowLocation("https://app.example.com/settings/mcp-servers");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  Object.defineProperty(window, "history", {
    configurable: true,
    value: ORIGINAL_HISTORY,
  });
});

describe("bestConnectionForProvider", () => {
  it("prefers active over expired over pending and ignores inactive", () => {
    const rows = [
      connection({ id: "a", status: "pending" }),
      connection({ id: "b", status: "active" }),
      connection({ id: "c", status: "inactive" }),
      connection({ id: "d", status: "expired" }),
    ];
    expect(bestConnectionForProvider(rows, "google_productivity")?.id).toBe(
      "b",
    );
    expect(
      bestConnectionForProvider(
        rows.filter((r) => r.id !== "b"),
        "google_productivity",
      )?.id,
    ).toBe("d");
    expect(bestConnectionForProvider(rows, "microsoft_365")).toBeNull();
  });
});

describe("SettingsConnections", () => {
  it("renders every registry provider with a not-connected state", async () => {
    mocks.listConnections.mockResolvedValue([]);

    render(<SettingsConnections />);

    expect(await screen.findByText("Google Workspace")).toBeTruthy();
    expect(screen.getByText("Microsoft 365")).toBeTruthy();
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getAllByText("not connected")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(3);
    expect(mocks.listConnections).toHaveBeenCalledWith("tenant-1", "user-1");
  });

  it("shows the active connection with account, scopes, and Disconnect", async () => {
    mocks.listConnections.mockResolvedValue([connection({})]);

    render(<SettingsConnections />);

    expect(await screen.findByText("active")).toBeTruthy();
    expect(screen.getByText("eric@example.com")).toBeTruthy();
    expect(screen.getByText("gmail")).toBeTruthy();
    expect(screen.getByText("calendar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    // The other providers stay connectable.
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(2);
  });

  it("shows expired connections with a Reconnect action that starts OAuth", async () => {
    mocks.listConnections.mockResolvedValue([
      connection({ status: "expired" }),
    ]);

    render(<SettingsConnections />);

    expect(await screen.findByText("expired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(locationAssign).toHaveBeenCalledTimes(1);
    const url = new URL(locationAssign.mock.calls[0]![0] as string);
    expect(url.origin).toBe("https://api.example.com");
    expect(url.pathname).toBe("/api/oauth/authorize");
    expect(url.searchParams.get("provider")).toBe("google_productivity");
    expect(url.searchParams.get("userId")).toBe("user-1");
    expect(url.searchParams.get("tenantId")).toBe("tenant-1");
    expect(url.searchParams.get("returnUrl")).toBe(
      "https://app.example.com/settings/mcp-servers",
    );
  });

  it("shows a pending badge while still offering Connect", async () => {
    mocks.listConnections.mockResolvedValue([
      connection({ status: "pending", external_id: null, metadata: {} }),
    ]);

    render(<SettingsConnections />);

    expect(await screen.findByText("pending")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(3);
  });

  it("starts the Connect OAuth flow for a provider", async () => {
    mocks.listConnections.mockResolvedValue([]);

    render(<SettingsConnections />);
    await screen.findByText("Google Workspace");

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[1]!);
    const url = new URL(locationAssign.mock.calls[0]![0] as string);
    expect(url.searchParams.get("provider")).toBe("microsoft_365");
  });

  it("disconnects only after the confirmation dialog", async () => {
    mocks.listConnections.mockResolvedValue([connection({})]);
    mocks.disconnectConnection.mockResolvedValue({ ok: true, id: "conn-1" });

    render(<SettingsConnections />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    // Nothing happens until the dialog confirms.
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Disconnect Google Workspace?"),
    ).toBeTruthy();

    // Cancel closes without deleting.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();

    // Confirm deletes and refetches.
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirmButtons = await screen.findAllByRole("button", {
      name: "Disconnect",
    });
    fireEvent.click(confirmButtons.at(-1)!);
    await waitFor(() =>
      expect(mocks.disconnectConnection).toHaveBeenCalledWith(
        "tenant-1",
        "conn-1",
      ),
    );
    await waitFor(() => expect(mocks.listConnections).toHaveBeenCalledTimes(2));
  });

  it("renders Slack identity links and unlinks through the confirm dialog", async () => {
    mocks.listConnections.mockResolvedValue([]);
    mocks.slackLinksQuery = {
      data: {
        mySlackLinks: [
          {
            id: "link-1",
            slackTeamId: "T123",
            slackTeamName: "Acme",
            slackUserId: "U123",
            slackUserName: "eric",
            slackUserEmail: "eric@acme.com",
            status: "active",
            linkedAt: "2026-07-01T00:00:00Z",
          },
        ],
      },
      fetching: false,
      error: undefined,
    };
    mocks.unlinkSlack.mockResolvedValue({ data: {} });

    render(<SettingsConnections />);

    expect(await screen.findByText("Acme · eric@acme.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Disconnect Acme?")).toBeTruthy();

    const confirmButtons = screen.getAllByRole("button", {
      name: "Disconnect",
    });
    fireEvent.click(confirmButtons.at(-1)!);
    await waitFor(() =>
      expect(mocks.unlinkSlack).toHaveBeenCalledWith({ id: "link-1" }),
    );
    expect(mocks.refetchSlackLinks).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("surfaces the OAuth deep-link outcome from the return URL", async () => {
    mocks.listConnections.mockResolvedValue([connection({})]);
    setWindowLocation(
      "https://app.example.com/settings/mcp-servers?status=connected&provider=google_productivity",
    );
    const replaceState = vi.fn();
    Object.defineProperty(window, "history", {
      configurable: true,
      value: { replaceState },
    });

    render(<SettingsConnections />);

    expect(await screen.findByText("Google Workspace connected.")).toBeTruthy();
    expect(replaceState).toHaveBeenCalledWith(
      {},
      "",
      "https://app.example.com/settings/mcp-servers",
    );
  });

  it("shows extra registry providers the caller has live rows for", async () => {
    mocks.listConnections.mockResolvedValue([
      connection({
        id: "conn-x",
        provider_name: "github",
        provider_display_name: "GitHub",
        provider_type: "code",
        external_id: "eric",
      }),
    ]);

    render(<SettingsConnections />);

    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });
});
