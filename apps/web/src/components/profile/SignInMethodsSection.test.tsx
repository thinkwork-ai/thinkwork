import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInMethodsSection } from "./SignInMethodsSection";

const authMocks = vi.hoisted(() => ({
  getActiveAuthClientId: vi.fn(() => "microsoft-client"),
  getAuthOptionProviderSwitchUrl: vi.fn(),
}));

const optionsMocks = vi.hoisted(() => ({
  fetchPublicAuthOptions: vi.fn(),
}));

vi.mock("@/lib/auth", () => authMocks);
vi.mock("@/lib/auth-options", () => optionsMocks);

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  optionsMocks.fetchPublicAuthOptions.mockResolvedValue({
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
          prompt: "select_account",
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
          prompt: "select_account",
        },
      },
    ],
  });
  authMocks.getActiveAuthClientId.mockReturnValue("microsoft-client");
  authMocks.getAuthOptionProviderSwitchUrl.mockResolvedValue(
    "https://cognito.example/oauth2/authorize",
  );
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "https://app.example/profile",
      origin: "https://app.example",
      hostname: "app.example",
      pathname: "/profile",
      search: "",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("SignInMethodsSection", () => {
  it("marks the current provider and switches through the proof-bound flow", async () => {
    render(<SignInMethodsSection />);

    expect(await screen.findByText("Sign-in methods")).toBeTruthy();
    expect(screen.getByText("Current session")).toBeTruthy();
    const switchButton = screen.getByRole("button", {
      name: "Switch to Google",
    });

    fireEvent.click(switchButton);

    await waitFor(() =>
      expect(authMocks.getAuthOptionProviderSwitchUrl).toHaveBeenCalledWith(
        expect.objectContaining({ key: "google" }),
        "/profile",
      ),
    );
    expect(window.location.href).toBe(
      "https://cognito.example/oauth2/authorize",
    );
  });

  it("surfaces a switch failure without changing the active session", async () => {
    authMocks.getAuthOptionProviderSwitchUrl.mockRejectedValue(
      new Error("The previous provider session could not be revoked (502)."),
    );
    render(<SignInMethodsSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to Google" }),
    );

    expect(
      await screen.findByText(
        "The previous provider session could not be revoked (502).",
      ),
    ).toBeTruthy();
    expect(window.location.href).toBe("https://app.example/profile");
  });

  it("offers Microsoft when the current session uses Google", async () => {
    authMocks.getActiveAuthClientId.mockReturnValue("google-client");

    render(<SignInMethodsSection />);

    expect(
      await screen.findByRole("button", { name: "Switch to Microsoft" }),
    ).toBeTruthy();
    expect(screen.getByText("Current session")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Switch to Google" }),
    ).toBeNull();
  });
});
