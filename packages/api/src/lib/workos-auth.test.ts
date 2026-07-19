import { describe, expect, it, vi } from "vitest";
import {
  WorkosAuthError,
  completeWorkosCallback,
  createWorkosAuthorizeRedirect,
  digestBridgeCode,
  normalizeRedirectUri,
  normalizeReturnTo,
  signWorkosAuthorizeState,
  type WorkosAuthDeps,
  type WorkosBridgeRecordInput,
} from "./workos-auth.js";

const publication = {
  tenantId: "tenant-123",
  tenantReferenceId: "tenant-ref-123",
  authProviderResourceId: "resource-123",
  clientId: "client_123",
  clientSecretRef: "thinkwork/dev/workos/client-secret",
  authorizeScopes: "openid email profile",
  hostnames: ["api.customer.example"],
  metadata: {
    allowedRedirectOrigins: ["https://app.customer.example"],
  },
  componentHandlerRef: {
    status: "valid",
    publicOptionsPublished: true,
  },
};

describe("createWorkosAuthorizeRedirect", () => {
  it("builds a direct WorkOS authorize URL with signed state and no Cognito first hop", async () => {
    const deps = depsForTest();

    const redirect = await createWorkosAuthorizeRedirect({
      trustedDomainName: "API.CUSTOMER.EXAMPLE.",
      redirectUri: "https://app.customer.example/auth/callback",
      returnTo: "/new?from=sso",
      prompt: "select_account",
      deps,
    });
    const url = new URL(redirect);

    expect(url.origin).toBe("https://api.workos.com");
    expect(url.pathname).toBe("/user_management/authorize");
    expect(url.searchParams.get("provider")).toBe("authkit");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("client_id")).toBe("client_123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.customer.example/api/auth/workos/callback",
    );
    expect(deps.loadPublicationForHost).toHaveBeenCalledWith(
      "api.customer.example",
    );
    expect(redirect).not.toContain("amazoncognito.com");
  });

  it("fails closed before lookup when API Gateway trusted host is missing", async () => {
    const deps = depsForTest();

    await expect(
      createWorkosAuthorizeRedirect({
        redirectUri: "https://app.customer.example/auth/callback",
        deps,
      }),
    ).rejects.toThrow(WorkosAuthError);
    expect(deps.loadPublicationForHost).not.toHaveBeenCalled();
  });

  it("rejects unsafe redirect URIs", () => {
    expect(() => normalizeRedirectUri("https://evil.example/callback")).toThrow(
      /path/,
    );
    expect(() =>
      normalizeRedirectUri("http://evil.example/auth/callback"),
    ).toThrow(/https/);
    expect(() =>
      normalizeRedirectUri("https://evil.example/auth/callback"),
    ).toThrow(/origin/);
    expect(normalizeRedirectUri("http://localhost:5180/auth/callback")).toBe(
      "http://localhost:5180/auth/callback",
    );
    expect(normalizeRedirectUri("thinkwork-canary://oauth/callback")).toBe(
      "thinkwork-canary://oauth/callback",
    );
    expect(() =>
      normalizeRedirectUri("thinkwork-canary://oauth/other"),
    ).toThrow(/path/);
  });

  it("normalizes unsafe return destinations to /new", () => {
    expect(normalizeReturnTo("//evil.example")).toBe("/new");
    expect(normalizeReturnTo("https://evil.example")).toBe("/new");
    expect(normalizeReturnTo("/threads/123?tab=work")).toBe(
      "/threads/123?tab=work",
    );
  });
});

describe("completeWorkosCallback", () => {
  it("exchanges the WorkOS code, stores a digest-only bridge, and redirects to the web callback", async () => {
    const persisted: WorkosBridgeRecordInput[] = [];
    const deps = depsForTest({
      randomTokens: ["bridge-code"],
      persistBridge: async (record) => {
        persisted.push(record);
      },
    });
    const state = signWorkosAuthorizeState(
      {
        kind: "workos_authorize_state",
        nonce: "nonce-123",
        host: "api.customer.example",
        tenantId: "tenant-123",
        tenantReferenceId: "tenant-ref-123",
        authProviderResourceId: "resource-123",
        redirectUri: "https://app.customer.example/auth/callback",
        returnTo: "/new",
      },
      "state-secret",
    );

    const redirect = await completeWorkosCallback({
      trustedDomainName: "api.customer.example",
      code: "workos-code",
      state,
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
      deps,
    });

    expect(deps.exchangeCode).toHaveBeenCalledWith({
      clientId: "client_123",
      clientSecret: "secret_123",
      code: "workos-code",
      ipAddress: "203.0.113.10",
      userAgent: "vitest",
    });
    expect(redirect).toBe(
      "https://app.customer.example/auth/callback?workos_bridge=bridge-code&next=%2Fnew",
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      bridgeCodeDigest: digestBridgeCode("bridge-code"),
      workosUserId: "user_123",
      workosSessionId: "session_123",
      workosEmail: "eric@homecareintel.com",
      stateNonce: "nonce-123",
    });
    expect(JSON.stringify(persisted[0])).not.toContain("bridge-code");
    expect(JSON.stringify(persisted[0])).not.toContain("secret_123");
  });

  it("redirects desktop WorkOS callbacks back to the custom scheme bridge", async () => {
    const deps = depsForTest({
      randomTokens: ["bridge-code"],
    });
    const state = signWorkosAuthorizeState(
      {
        kind: "workos_authorize_state",
        nonce: "nonce-123",
        host: "api.customer.example",
        tenantId: "tenant-123",
        tenantReferenceId: "tenant-ref-123",
        authProviderResourceId: "resource-123",
        redirectUri: "thinkwork-canary://oauth/callback",
        returnTo: "/work-items/123",
      },
      "state-secret",
    );

    await expect(
      completeWorkosCallback({
        trustedDomainName: "api.customer.example",
        code: "workos-code",
        state,
        deps,
      }),
    ).resolves.toBe(
      "thinkwork-canary://oauth/callback?workos_bridge=bridge-code&next=%2Fwork-items%2F123",
    );
  });

  it("rejects WorkOS responses without a verified email", async () => {
    const deps = depsForTest({
      exchangeCode: async () => ({
        access_token: jwt({ sid: "session_123" }),
        user: {
          id: "user_123",
          email: "eric@homecareintel.com",
          email_verified: false,
        },
      }),
    });
    const state = signWorkosAuthorizeState(
      {
        kind: "workos_authorize_state",
        nonce: "nonce-123",
        host: "api.customer.example",
        tenantId: "tenant-123",
        tenantReferenceId: "tenant-ref-123",
        authProviderResourceId: "resource-123",
        redirectUri: "https://app.customer.example/auth/callback",
        returnTo: "/new",
      },
      "state-secret",
    );

    await expect(
      completeWorkosCallback({
        trustedDomainName: "api.customer.example",
        code: "workos-code",
        state,
        deps,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("fails when the configured secret ref is empty", async () => {
    const deps = depsForTest({ secret: null });
    const state = signWorkosAuthorizeState(
      {
        kind: "workos_authorize_state",
        nonce: "nonce-123",
        host: "api.customer.example",
        tenantId: "tenant-123",
        tenantReferenceId: "tenant-ref-123",
        authProviderResourceId: "resource-123",
        redirectUri: "https://app.customer.example/auth/callback",
        returnTo: "/new",
      },
      "state-secret",
    );

    await expect(
      completeWorkosCallback({
        trustedDomainName: "api.customer.example",
        code: "workos-code",
        state,
        deps,
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

function depsForTest(
  overrides: {
    randomTokens?: string[];
    secret?: string | null;
    exchangeCode?: WorkosAuthDeps["exchangeCode"];
    persistBridge?: WorkosAuthDeps["persistBridge"];
  } = {},
): WorkosAuthDeps {
  const randomTokens = [...(overrides.randomTokens ?? [])];
  return {
    loadPublicationForHost: vi.fn(async (host: string) =>
      host === "api.customer.example" ? publication : null,
    ),
    getSecret: vi.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, "secret")
        ? overrides.secret!
        : "secret_123",
    ),
    exchangeCode: vi.fn(
      overrides.exchangeCode ??
        (async () => ({
          access_token: jwt({ sid: "session_123", sub: "user_123" }),
          user: {
            id: "user_123",
            email: "Eric@HomeCareIntel.com",
            email_verified: true,
            first_name: "Eric",
            last_name: "Odom",
          },
        })),
    ),
    persistBridge: vi.fn(overrides.persistBridge ?? (async () => undefined)),
    signingSecret: () => "state-secret",
    now: () => new Date("2026-06-19T10:00:00Z"),
    randomToken: () => randomTokens.shift() ?? "nonce-token",
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}
