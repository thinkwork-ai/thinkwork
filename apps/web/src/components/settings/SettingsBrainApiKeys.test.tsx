import * as React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setHeader: vi.fn(),
  listBrainApiKeys: vi.fn(),
  createBrainApiKey: vi.fn(),
  revokeBrainApiKey: vi.fn(),
  tenantContext: {
    tenant: { id: "tenant-1", slug: "thinkwork", name: "ThinkWork" },
    tenantId: "tenant-1",
    userId: "user-1",
    isOperator: true,
  },
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => mocks.tenantContext,
}));

// Render the @thinkwork/ui Select as a native <select> keyed by aria-label so
// the expiration picker is driveable in jsdom (Radix Select's pointer capture
// doesn't work here). Everything else stays the real component.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@thinkwork/ui")>();
  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
      "aria-label": ariaLabel,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
      value: string;
      "aria-label"?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {children}
      </select>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    SelectItem: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => <option value={value}>{children}</option>,
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

vi.mock("@/lib/brain-api-keys-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/brain-api-keys-api")>();
  return {
    ...actual,
    listBrainApiKeys: mocks.listBrainApiKeys,
    createBrainApiKey: mocks.createBrainApiKey,
    revokeBrainApiKey: mocks.revokeBrainApiKey,
  };
});

import { SettingsBrainApiKeys } from "./SettingsBrainApiKeys";

const KEYS = {
  keys: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "default",
      key_suffix: "a1b2c3d4",
      created_at: "2026-07-01T00:00:00.000Z",
      expires_at: null,
      created_by_user_id: null,
      last_used_at: null,
      revoked_at: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "legacy-key",
      key_suffix: null,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-04-01T00:00:00.000Z",
      created_by_user_id: "user-1",
      last_used_at: null,
      revoked_at: null,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "old-revoked",
      key_suffix: "deadbeef",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      created_by_user_id: "user-1",
      last_used_at: null,
      revoked_at: "2026-06-01T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  mocks.setHeader.mockReset();
  mocks.listBrainApiKeys.mockReset();
  mocks.createBrainApiKey.mockReset();
  mocks.revokeBrainApiKey.mockReset();
});

afterEach(cleanup);

describe("SettingsBrainApiKeys", () => {
  it("renders active rows with suffix formatting and hides revoked rows by default", async () => {
    mocks.listBrainApiKeys.mockResolvedValue(KEYS);

    render(<SettingsBrainApiKeys />);

    expect(await screen.findByText("default")).toBeTruthy();
    expect(mocks.listBrainApiKeys).toHaveBeenCalledWith("thinkwork");
    // Suffix renders as an ellipsis-prefixed monospace handle; a null suffix
    // (older rows) renders the em-dash placeholder.
    expect(screen.getByText("…a1b2c3d4")).toBeTruthy();
    expect(screen.getByText("legacy-key")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    // Never-expiring vs expired keys.
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getAllByText("Active")).toHaveLength(2);

    // Revoked rows hide behind the toggle.
    expect(screen.queryByText("old-revoked")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Show revoked" }));
    expect(screen.getByText("old-revoked")).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
    // Revoked rows carry no Revoke action.
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2);
  });

  it("creates a key and shows the raw token exactly once", async () => {
    mocks.listBrainApiKeys.mockResolvedValue({ keys: [] });
    mocks.createBrainApiKey.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      name: "ci-pipeline",
      token: "tkt_secret_raw_value_1234abcd",
      key_suffix: "1234abcd",
      created_at: "2026-07-28T00:00:00.000Z",
      expires_at: "2026-08-27T00:00:00.000Z",
    });

    render(<SettingsBrainApiKeys />);
    expect(await screen.findByText("No Brain API keys yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText("Create Brain API key")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "ci-pipeline" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Expiration" }), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() =>
      expect(mocks.createBrainApiKey).toHaveBeenCalledWith("thinkwork", {
        name: "ci-pipeline",
        expiresInDays: 30,
      }),
    );

    // Show-once view: the raw token in a read-only field with the warning.
    const tokenField = (await screen.findByLabelText(
      "Brain API key",
    )) as HTMLInputElement;
    expect(tokenField.value).toBe("tkt_secret_raw_value_1234abcd");
    expect(tokenField.readOnly).toBe(true);
    expect(
      screen.getByText(/won't be able to see this key again/),
    ).toBeTruthy();

    // Closing refreshes the list.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(mocks.listBrainApiKeys.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("surfaces a duplicate-name error inline in the dialog", async () => {
    mocks.listBrainApiKeys.mockResolvedValue({ keys: [] });
    mocks.createBrainApiKey.mockRejectedValue(
      new Error('an active key named "ci-pipeline" already exists'),
    );

    render(<SettingsBrainApiKeys />);
    expect(await screen.findByText("No Brain API keys yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "ci-pipeline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(
      await screen.findByText(
        'an active key named "ci-pipeline" already exists',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Brain API key")).toBeNull();
  });

  it("revokes a key after confirmation and warns on the default key", async () => {
    mocks.listBrainApiKeys.mockResolvedValue(KEYS);
    mocks.revokeBrainApiKey.mockResolvedValue({});

    render(<SettingsBrainApiKeys />);
    expect(await screen.findByText("default")).toBeTruthy();

    // The default row's Revoke opens the confirm dialog with the
    // platform-connector warning.
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    expect(await screen.findByText("Revoke Brain API key")).toBeTruthy();
    expect(
      screen.getByText(/breaks the platform-managed Brain connector/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() =>
      expect(mocks.revokeBrainApiKey).toHaveBeenCalledWith(
        "thinkwork",
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    // The list reloads after a successful revoke.
    await waitFor(() =>
      expect(mocks.listBrainApiKeys.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("keeps the warning off non-default keys", async () => {
    mocks.listBrainApiKeys.mockResolvedValue(KEYS);

    render(<SettingsBrainApiKeys />);
    expect(await screen.findByText("legacy-key")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[1]!);
    expect(await screen.findByText("Revoke Brain API key")).toBeTruthy();
    expect(
      screen.queryByText(/breaks the platform-managed Brain connector/),
    ).toBeNull();
    expect(mocks.revokeBrainApiKey).not.toHaveBeenCalled();
  });
});
