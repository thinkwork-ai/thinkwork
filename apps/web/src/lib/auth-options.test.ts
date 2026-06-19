import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsePublicAuthOptions", () => {
  it("accepts the single WorkOS SSO fallback contract", async () => {
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
              prompt: "select_account",
            },
          },
        ],
      }),
    ).toEqual({
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
            prompt: "select_account",
          },
        },
      ],
    });
  });

  it("drops malformed OAuth options and keeps password sign-in usable", async () => {
    const { parsePublicAuthOptions } = await import("./auth-options");

    expect(
      parsePublicAuthOptions({
        password: { enabled: true },
        oauthOptions: [
          {
            key: "bad",
            label: "Bad",
            icon: "sso",
            provider: "workos",
            providerSpecific: false,
            route: {
              type: "workosAuthorize",
              authorizePath: "/api/auth/workos/bad",
            },
          },
        ],
      }),
    ).toEqual({ password: { enabled: true }, oauthOptions: [] });
  });

  it("defaults malformed responses to password enabled and no OAuth options", async () => {
    const { parsePublicAuthOptions } = await import("./auth-options");

    expect(parsePublicAuthOptions(null)).toEqual({
      password: { enabled: true },
      oauthOptions: [],
    });
  });
});

describe("fetchPublicAuthOptions", () => {
  it("fetches from VITE_API_URL without caching", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com/");
    const fetchImpl = vi.fn(async () =>
      Response.json({ password: { enabled: false }, oauthOptions: [] }),
    );
    const { fetchPublicAuthOptions } = await import("./auth-options");

    const options = await fetchPublicAuthOptions(fetchImpl as typeof fetch);

    expect(options).toEqual({ password: { enabled: false }, oauthOptions: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/options",
      {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
  });

  it("falls back to the GraphQL HTTP origin when VITE_API_URL is absent", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_GRAPHQL_HTTP_URL", "https://api.example.com/graphql");
    const fetchImpl = vi.fn(async () =>
      Response.json({ password: { enabled: true }, oauthOptions: [] }),
    );
    const { fetchPublicAuthOptions } = await import("./auth-options");

    await fetchPublicAuthOptions(fetchImpl as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/options",
      expect.any(Object),
    );
  });

  it("fails closed when the endpoint errors", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const { fetchPublicAuthOptions } = await import("./auth-options");

    await expect(
      fetchPublicAuthOptions(fetchImpl as typeof fetch),
    ).resolves.toEqual({
      password: { enabled: true },
      oauthOptions: [],
    });
  });
});
