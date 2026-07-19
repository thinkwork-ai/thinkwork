import { describe, expect, it, vi } from "vitest";
import { fetchCliAuthOptions } from "../src/auth-options.js";

describe("fetchCliAuthOptions", () => {
  it("returns local, Google, and Microsoft route-specific clients in order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          password: { enabled: true, clientId: "local-client" },
          oauthOptions: [
            {
              key: "google",
              label: "Continue with Google",
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
              providerSpecific: true,
              route: {
                type: "cognitoHostedUi",
                clientId: "microsoft-client",
                identityProvider: "MicrosoftOrganizations",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchCliAuthOptions({
        apiBaseUrl: "https://api.example.com/",
        host: "tenant.example.com",
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        key: "local",
        label: "Email and password",
        clientId: "local-client",
      },
      {
        key: "google",
        label: "Continue with Google",
        clientId: "google-client",
        identityProvider: "Google",
        prompt: "select_account",
      },
      {
        key: "microsoft",
        label: "Continue with Microsoft",
        clientId: "microsoft-client",
        identityProvider: "MicrosoftOrganizations",
      },
    ]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://api.example.com/api/auth/options?platform=cli&host=tenant.example.com",
    );
  });

  it("drops malformed or provider-neutral OAuth routes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          password: { enabled: false, clientId: "disabled" },
          oauthOptions: [
            {
              key: "bad",
              label: "Bad",
              providerSpecific: false,
              route: { type: "cognitoHostedUi", clientId: "shared" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      fetchCliAuthOptions({
        apiBaseUrl: "https://api.example.com",
        fetchImpl,
      }),
    ).resolves.toEqual([]);
  });

  it("never fabricates native providers from a legacy WorkOS catalog", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          password: { enabled: true },
          oauthOptions: [
            {
              key: "workos",
              provider: "workos",
              route: { type: "workosAuthorize" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchCliAuthOptions({
        apiBaseUrl: "https://api.example.com",
        fallbackClientId: "deployment-client",
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        key: "local",
        label: "Email and password",
        clientId: "deployment-client",
      },
    ]);
  });
});
