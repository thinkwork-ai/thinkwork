import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_AUTH_OPTIONS,
  deriveAuthOptionsDisplay,
  fetchAuthOptionsForActiveEnvironment,
  parsePublicAuthOptions,
} from "./auth-options";

vi.mock("./platform-config", () => ({
  getPlatformConfig: () => ({ apiUrl: "https://api.example.com/" }),
}));
vi.mock("./environments/store", () => ({
  getActiveEnvironmentEntry: () => ({ host: "customer.example.com" }),
}));

describe("mobile auth options", () => {
  it("parses password-only options without an SSO button", () => {
    const options = parsePublicAuthOptions({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [],
    });

    expect(
      deriveAuthOptionsDisplay({ loading: false, failed: false, options }),
    ).toMatchObject({
      showOAuthButtons: false,
      showPasswordForm: true,
      showDivider: false,
    });
  });

  it("parses direct Cognito Google and Microsoft options above password", () => {
    const options = parsePublicAuthOptions({
      password: { enabled: true, clientId: "local-client" },
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
    const display = deriveAuthOptionsDisplay({
      loading: false,
      failed: false,
      options,
    });

    expect(display.showOAuthButtons).toBe(true);
    expect(display.showDivider).toBe(true);
    expect(display.oauthOptions.map((option) => option.key)).toEqual([
      "google",
      "microsoft",
    ]);
  });

  it("distinguishes loading from loaded and failed states", () => {
    expect(
      deriveAuthOptionsDisplay({
        loading: true,
        failed: false,
        options: FALLBACK_AUTH_OPTIONS,
      }),
    ).toMatchObject({
      showOAuthButtons: false,
      showPasswordForm: true,
      showRetry: false,
    });

    expect(
      deriveAuthOptionsDisplay({
        loading: false,
        failed: true,
        options: FALLBACK_AUTH_OPTIONS,
      }),
    ).toMatchObject({
      showPasswordForm: true,
      showRetry: true,
    });
  });

  it("falls back to password options and marks fetch failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(
      fetchAuthOptionsForActiveEnvironment(fetchImpl),
    ).resolves.toEqual({
      options: FALLBACK_AUTH_OPTIONS,
      failed: true,
    });
  });

  it("fetches from the active environment apiUrl", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ password: { enabled: false }, oauthOptions: [] }),
    })) as unknown as typeof fetch;

    const result = await fetchAuthOptionsForActiveEnvironment(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/options?platform=mobile&host=customer.example.com",
      expect.objectContaining({
        method: "GET",
        headers: { accept: "application/json" },
      }),
    );
    expect(result).toEqual({
      options: { password: { enabled: false }, oauthOptions: [] },
      failed: false,
    });
  });
});
