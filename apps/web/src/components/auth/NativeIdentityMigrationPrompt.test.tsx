import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, fetchPublicAuthOptions, isDesktopBuild } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  fetchPublicAuthOptions: vi.fn(),
  isDesktopBuild: vi.fn(() => false),
}));

vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@/lib/auth", () => ({
  getAuthOptionIdentityMigrationUrl: vi.fn(),
}));
vi.mock("@/lib/auth-options", () => ({ fetchPublicAuthOptions }));
vi.mock("@/lib/desktop-runtime", () => ({ isDesktopBuild }));

import { NativeIdentityMigrationPrompt } from "./NativeIdentityMigrationPrompt";

beforeEach(() => {
  sessionStorage.clear();
  apiFetch.mockReset();
  fetchPublicAuthOptions.mockReset();
  isDesktopBuild.mockReturnValue(false);
  apiFetch.mockResolvedValue({
    migrationRequired: true,
    migrationRecoveryDeadline: null,
  });
  fetchPublicAuthOptions.mockResolvedValue({
    password: { enabled: true, clientId: "password-client" },
    oauthOptions: [
      {
        key: "google",
        label: "Continue with Google",
        icon: "google",
        provider: "google",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "google-client",
          identityProvider: "Google",
        },
      },
      {
        key: "microsoft",
        label: "Continue with Microsoft",
        icon: "microsoft",
        provider: "microsoft",
        providerSpecific: true,
        route: {
          type: "cognitoHostedUi",
          clientId: "microsoft-client",
          identityProvider: "MicrosoftOrganizations",
        },
      },
    ],
  });
});

afterEach(() => cleanup());

describe("NativeIdentityMigrationPrompt", () => {
  it("offers direct Google and Microsoft migration for a legacy session", async () => {
    render(<NativeIdentityMigrationPrompt />);

    expect(
      await screen.findByRole("heading", {
        name: "Secure your ThinkWork sign-in",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Microsoft" })).toBeTruthy();
    expect(screen.queryByText(/WorkOS/i)).toBeNull();
  });

  it("allows deferral only in the current browser session", async () => {
    render(<NativeIdentityMigrationPrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      sessionStorage.getItem("thinkwork:native-identity-migration-dismissed"),
    ).toBe("true");
  });

  it("does not interrupt users who already authenticate natively", async () => {
    apiFetch.mockResolvedValue({ migrationRequired: false });
    render(<NativeIdentityMigrationPrompt />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
