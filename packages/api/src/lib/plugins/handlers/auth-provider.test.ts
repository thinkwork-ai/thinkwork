import { describe, expect, it, vi } from "vitest";
import type { AuthProviderComponent } from "@thinkwork/plugin-catalog";

import {
  fetchOidcDiscovery,
  fetchOidcJwks,
  provisionPluginAuthProviderComponent,
  validateAuthProviderBridge,
  type AuthProviderConfigSnapshot,
  type AuthProviderHandlerDeps,
} from "./auth-provider.js";

const component: AuthProviderComponent = {
  type: "auth-provider",
  key: "workos-auth",
  displayName: "WorkOS Cognito federation",
  provider: "workos",
  settingsSurface: "settings.plugins.workos-auth",
  cognitoIdentityProviderName: "WorkOSAuth",
  configFields: [],
  publicOptions: [],
};

const config: AuthProviderConfigSnapshot = {
  tenantReferenceId: "tenant-ref-1",
  authProviderResourceId: "resource-1",
  tenantReferenceStatus: "enabled",
  providerKey: "workos",
  displayName: "WorkOS Auth",
  cognitoUserPoolId: "us-east-1_pool",
  cognitoAppClientIds: ["admin-client", "mobile-client"],
  cognitoIdentityProviderName: "WorkOSAuth",
  issuerUrl: "https://welcoming-nutmeg-53-staging.authkit.app",
  clientId: "client_123",
  clientSecretRef: "arn:aws:secretsmanager:us-east-1:123:secret:workos",
  authorizeScopes: "openid email profile",
  providerOptions: [
    {
      key: "sso",
      displayName: "Continue with SSO",
      providerSpecific: false,
      recommended: true,
      secret: "must-not-leak",
    },
  ],
  publicOptionsPublished: true,
};

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    issuer: config.issuerUrl,
    authorization_endpoint: `${config.issuerUrl}/oauth2/authorize`,
    token_endpoint: `${config.issuerUrl}/oauth2/token`,
    userinfo_endpoint: `${config.issuerUrl}/oauth2/userinfo`,
    jwks_uri: `${config.issuerUrl}/oauth2/jwks`,
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    id_token_signing_alg_values_supported: ["RS256"],
    ...overrides,
  };
}

function deps(overrides: Partial<AuthProviderHandlerDeps> = {}) {
  const base: AuthProviderHandlerDeps = {
    loadConfig: vi.fn(async () => config),
    fetchDiscovery: vi.fn(async () => discovery()),
    fetchJwks: vi.fn(async () => ({ keys: [{ kid: "key-1" }] })),
    describeIdentityProvider: vi.fn(async () => ({
      providerName: "WorkOSAuth",
      providerType: "OIDC",
      providerDetails: {
        client_id: config.clientId,
        oidc_issuer: config.issuerUrl,
        token_request_method: "POST",
      },
    })),
    describeUserPoolClient: vi.fn(async ({ clientId }) => ({
      clientId,
      supportedIdentityProviders: ["COGNITO", "Google", "WorkOSAuth"],
      callbackUrls: ["http://localhost:5180/auth/callback"],
      logoutUrls: ["http://localhost:5180"],
    })),
    now: () => new Date("2026-06-18T19:00:00.000Z"),
  };
  return { ...base, ...overrides };
}

describe("provisionPluginAuthProviderComponent", () => {
  it("fails closed when the tenant has no auth-provider configuration", async () => {
    const d = deps({ loadConfig: vi.fn(async () => null) });

    const ref = await provisionPluginAuthProviderComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      component,
      deps: d,
    });

    expect(ref).toMatchObject({
      status: "unconfigured",
      provider: "workos",
      cognitoIdentityProviderName: "WorkOSAuth",
      publicOptionsPublished: false,
      providerOptions: [],
      lastValidatedAt: null,
      diagnosticCode: "AUTH_PROVIDER_CONFIG_MISSING",
    });
    expect(d.fetchDiscovery).not.toHaveBeenCalled();
  });

  it("fails closed without discovery when the tenant reference is disabled", async () => {
    const d = deps({
      loadConfig: vi.fn(async () => ({
        ...config,
        tenantReferenceStatus: "disabled",
      })),
    });

    const ref = await provisionPluginAuthProviderComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      component,
      deps: d,
    });

    expect(ref).toMatchObject({
      status: "disabled",
      diagnosticCode: "TENANT_AUTH_PROVIDER_DISABLED",
      publicOptionsPublished: false,
    });
    expect(d.fetchDiscovery).not.toHaveBeenCalled();
  });

  it("records sanitized valid bridge state without leaking secret fields", async () => {
    const ref = await provisionPluginAuthProviderComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      component,
      deps: deps(),
    });

    expect(ref).toEqual({
      status: "valid",
      provider: "workos",
      cognitoIdentityProviderName: "WorkOSAuth",
      issuerHost: "welcoming-nutmeg-53-staging.authkit.app",
      authProviderResourceId: "resource-1",
      tenantAuthProviderReferenceId: "tenant-ref-1",
      publicOptionsPublished: true,
      providerOptions: [
        {
          key: "sso",
          displayName: "Continue with SSO",
          providerSpecific: false,
          recommended: true,
        },
      ],
      lastValidatedAt: "2026-06-18T19:00:00.000Z",
      diagnosticCode: null,
    });
    expect(JSON.stringify(ref)).not.toContain("secret");
    expect(JSON.stringify(ref)).not.toContain(config.clientSecretRef);
  });

  it("invalidates the bridge when a configured app client lacks the WorkOS IdP", async () => {
    const ref = await provisionPluginAuthProviderComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      component,
      deps: deps({
        describeUserPoolClient: vi.fn(async ({ clientId }) => ({
          clientId,
          supportedIdentityProviders: ["COGNITO", "Google"],
          callbackUrls: [],
          logoutUrls: [],
        })),
      }),
    });

    expect(ref).toMatchObject({
      status: "invalid",
      diagnosticCode: "COGNITO_APP_CLIENT_IDP_MISSING",
      publicOptionsPublished: false,
      providerOptions: [],
    });
  });
});

describe("validateAuthProviderBridge", () => {
  it("requires WorkOS discovery to advertise client_secret_post", async () => {
    const result = await validateAuthProviderBridge({
      component,
      config,
      deps: deps({
        fetchDiscovery: vi.fn(async () =>
          discovery({
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
          }),
        ),
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "WORKOS_DISCOVERY_CLIENT_SECRET_POST_MISSING",
    });
  });

  it("requires a Cognito OIDC provider with matching issuer and client id", async () => {
    const result = await validateAuthProviderBridge({
      component,
      config,
      deps: deps({
        describeIdentityProvider: vi.fn(async () => ({
          providerName: "WorkOSAuth",
          providerType: "OIDC",
          providerDetails: {
            client_id: "other-client",
            oidc_issuer: config.issuerUrl,
            token_request_method: "POST",
          },
        })),
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "COGNITO_IDP_CLIENT_ID_MISMATCH",
    });
  });
});

describe("OIDC fetch guardrails", () => {
  it("rejects non-HTTPS issuers before fetching", async () => {
    await expect(
      fetchOidcDiscovery("http://welcoming-nutmeg-53-staging.authkit.app", {
        fetch: vi.fn(),
      }),
    ).rejects.toThrow("WORKOS_URL_NOT_HTTPS");
  });

  it("rejects unapproved issuer hosts before fetching", async () => {
    await expect(
      fetchOidcDiscovery("https://example.com", { fetch: vi.fn() }),
    ).rejects.toThrow("WORKOS_URL_HOST_NOT_ALLOWED");
  });

  it("rejects JWKS URLs that leave the issuer host", async () => {
    await expect(
      fetchOidcJwks(
        "https://other.authkit.app/oauth2/jwks",
        config.issuerUrl,
        { fetch: vi.fn() },
      ),
    ).rejects.toThrow("WORKOS_JWKS_HOST_MISMATCH");
  });
});
