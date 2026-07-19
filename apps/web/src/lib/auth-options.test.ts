import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsePublicAuthOptions", () => {
  it("accepts direct Cognito Google and Microsoft routes", async () => {
    const { parsePublicAuthOptions } = await import("./auth-options");
    expect(
      parsePublicAuthOptions({
        password: { enabled: true, clientId: "local-client" },
        oauthOptions: [
          option("google", "Google", "google-client"),
          option("microsoft", "MicrosoftOrganizations", "microsoft-client"),
        ],
      }),
    ).toEqual({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        option("google", "Google", "google-client"),
        option("microsoft", "MicrosoftOrganizations", "microsoft-client"),
      ],
    });
  });

  it("never fabricates native providers from a legacy WorkOS catalog", async () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "deployed-legacy-client");
    const { parsePublicAuthOptions } = await import("./auth-options");
    expect(
      parsePublicAuthOptions({
        password: { enabled: true },
        oauthOptions: [
          {
            key: "workos-sso",
            label: "Continue with SSO",
            icon: "sso",
            provider: "workos",
            providerSpecific: false,
            route: {
              type: "workosAuthorize",
              authorizePath: "/api/auth/workos/authorize",
            },
          },
        ],
      }),
    ).toEqual({
      password: { enabled: true, clientId: "deployed-legacy-client" },
      oauthOptions: [],
    });
  });

  it("parses the bounded migration entry separately from normal sign-in options", async () => {
    const { parsePublicAuthOptions } = await import("./auth-options");
    expect(
      parsePublicAuthOptions({
        password: { enabled: false },
        oauthOptions: [],
        legacyMigration: {
          authorizePath: "/api/auth/workos/authorize",
        },
      }),
    ).toEqual({
      password: { enabled: false },
      oauthOptions: [],
      legacyMigration: { authorizePath: "/api/auth/workos/authorize" },
    });
  });

  it("drops malformed non-legacy routes", async () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "deployed-client");
    const { parsePublicAuthOptions } = await import("./auth-options");
    expect(
      parsePublicAuthOptions({
        password: { enabled: false },
        oauthOptions: [{ provider: "unknown", route: {} }],
      }),
    ).toEqual({ password: { enabled: false }, oauthOptions: [] });
  });

  it("fails closed for malformed responses", async () => {
    const { parsePublicAuthOptions } = await import("./auth-options");
    expect(parsePublicAuthOptions(null)).toEqual({
      password: { enabled: false },
      oauthOptions: [],
    });
  });
});

describe("fetchPublicAuthOptions", () => {
  it("sends host and platform as non-authoritative routing input", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com/");
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ password: { enabled: false }, oauthOptions: [] }),
    );
    const { fetchPublicAuthOptions } = await import("./auth-options");
    await fetchPublicAuthOptions(fetchImpl as typeof fetch);

    const [rawUrl, init] = fetchImpl.mock.calls[0];
    const url = new URL(String(rawUrl));
    expect(url.origin + url.pathname).toBe(
      "https://api.example.com/api/auth/options",
    );
    expect(url.searchParams.get("host")).toBe(window.location.hostname);
    expect(url.searchParams.get("platform")).toBe("web");
    expect(init).toEqual({
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it("fails closed when the endpoint errors", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const { fetchPublicAuthOptions } = await import("./auth-options");
    await expect(
      fetchPublicAuthOptions(fetchImpl as typeof fetch),
    ).resolves.toEqual({
      password: { enabled: false },
      oauthOptions: [],
    });
  });
});

function option(
  provider: "google" | "microsoft",
  identityProvider: string,
  clientId: string,
) {
  return {
    key: provider,
    label: `Continue with ${provider === "google" ? "Google" : "Microsoft"}`,
    icon: provider,
    provider,
    providerSpecific: true,
    route: {
      type: "cognitoHostedUi",
      clientId,
      identityProvider,
      prompt: "select_account",
    },
  } as const;
}
