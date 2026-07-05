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

describe("mobile auth options", () => {
  it("parses password-only options without an SSO button", () => {
    const options = parsePublicAuthOptions({
      password: { enabled: true },
      oauthOptions: [],
    });

    expect(deriveAuthOptionsDisplay({ loading: false, failed: false, options }))
      .toMatchObject({
        showSsoButton: false,
        showPasswordForm: true,
        showDivider: false,
      });
  });

  it("parses one WorkOS option into one SSO button above password", () => {
    const options = parsePublicAuthOptions({
      password: { enabled: true },
      oauthOptions: [
        {
          key: "workos",
          label: "Continue with SSO",
          icon: "sso",
          provider: "workos",
          providerSpecific: true,
          route: {
            type: "workosAuthorize",
            authorizePath: "/api/auth/workos/authorize",
          },
        },
      ],
    });
    const display = deriveAuthOptionsDisplay({
      loading: false,
      failed: false,
      options,
    });

    expect(display.showSsoButton).toBe(true);
    expect(display.showDivider).toBe(true);
    expect(display.ssoOption?.key).toBe("workos");
  });

  it("distinguishes loading from loaded and failed states", () => {
    expect(
      deriveAuthOptionsDisplay({
        loading: true,
        failed: false,
        options: FALLBACK_AUTH_OPTIONS,
      }),
    ).toMatchObject({
      showSsoButton: false,
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

    await expect(fetchAuthOptionsForActiveEnvironment(fetchImpl)).resolves.toEqual(
      {
        options: FALLBACK_AUTH_OPTIONS,
        failed: true,
      },
    );
  });

  it("fetches from the active environment apiUrl", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ password: { enabled: false }, oauthOptions: [] }),
    })) as unknown as typeof fetch;

    const result = await fetchAuthOptionsForActiveEnvironment(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/options",
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
