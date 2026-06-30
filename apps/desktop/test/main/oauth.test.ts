import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopOAuthController,
  type DesktopOAuthOptions,
} from "../../src/main/oauth";
import type { ICognitoStorage } from "../../src/main/cognito-storage";

const env = {
  nodeEnv: "test",
  stage: "dev",
  desktopChannel: "dev",
  desktopProductName: "ThinkWork Spaces",
  desktopAppId: "ai.thinkwork.spaces.desktop.dev",
  deepLinkScheme: null,
  rendererUrl: null,
  apiUrl: "https://api.example.test",
  graphqlHttpUrl: "https://api.example.test/graphql",
  graphqlUrl: null,
  graphqlWsUrl: null,
  sandboxFrameSrc: null,
  cognito: {
    userPoolId: "us-east-1_test",
    clientId: "test-client-id",
    domain: "thinkwork-dev",
  },
};

function createStorage(): ICognitoStorage & {
  snapshot(): Record<string, string>;
} {
  const values = new Map<string, string>();
  return {
    setItem(key, value) {
      values.set(key, value);
      return value;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
      return true;
    },
    clear() {
      values.clear();
      return {};
    },
    snapshot() {
      return Object.fromEntries(values);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function publicAuthOptionsResponse(oauthOptions: unknown[] = []): Response {
  return jsonResponse({
    password: { enabled: true },
    oauthOptions,
  });
}

describe("DesktopOAuthController", () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "thinkwork-oauth-"));
  });

  afterEach(async () => {
    await rm(userDataDir, { force: true, recursive: true });
  });

  function createController(
    overrides: Partial<DesktopOAuthOptions> = {},
  ): DesktopOAuthController {
    return new DesktopOAuthController({
      env,
      storage: createStorage(),
      app: { getPath: () => userDataDir },
      shell: { openExternal: vi.fn(async () => undefined) },
      fetch: vi.fn(async () => publicAuthOptionsResponse()),
      evictionIntervalMs: null,
      sleep: vi.fn(async () => undefined),
      ...overrides,
    });
  }

  it("opens the Cognito hosted UI with PKCE S256 and stage-specific redirect", async () => {
    const openExternal = vi.fn(async () => undefined);
    const controller = createController({
      shell: { openExternal },
    });

    const result = await controller.startOAuth({ next: "/automations/123" });
    const url = new URL(result.url);

    expect(openExternal).toHaveBeenCalledWith(result.url);
    expect(url.origin).toBe(
      "https://thinkwork-dev.auth.us-east-1.amazoncognito.com",
    );
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "thinkwork-dev://oauth/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(url.searchParams.get("identity_provider")).toBe("Google");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("uses the published WorkOS authorize option for desktop OAuth when available", async () => {
    const openExternal = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      publicAuthOptionsResponse([
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
      ]),
    );
    const controller = createController({
      fetch: fetchImpl,
      shell: { openExternal },
    });

    const result = await controller.startOAuth();
    const url = new URL(result.url);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/api/auth/options",
      {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
    expect(openExternal).toHaveBeenCalledWith(result.url);
    expect(url.origin).toBe("https://api.example.test");
    expect(url.pathname).toBe("/api/auth/workos/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "thinkwork-dev://oauth/callback",
    );
    expect(url.searchParams.get("return_to")).toBe("/new");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.has("identity_provider")).toBe(false);
    expect(controller.inFlightCount()).toBe(0);
  });

  it("prefers the packaged desktop scheme for canary builds pointed at dev", async () => {
    const openExternal = vi.fn(async () => undefined);
    const controller = createController({
      env: {
        ...env,
        stage: "dev",
        deepLinkScheme: "thinkwork-canary",
      },
      shell: { openExternal },
    });

    const result = await controller.startOAuth();
    const url = new URL(result.url);

    expect(url.searchParams.get("redirect_uri")).toBe(
      "thinkwork-canary://oauth/callback",
    );
  });

  it("exchanges a matching callback and writes Cognito keys by token username", async () => {
    const storage = createStorage();
    const idToken = encodeJwtPayload({
      "cognito:username": "google_123",
      sub: "cognito-sub",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(publicAuthOptionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          id_token: idToken,
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      );
    const controller = createController({
      fetch: fetchImpl,
      storage,
    });

    const started = await controller.startOAuth({ next: "/automations/123" });
    const pending = await controller.completeOAuthCallback({
      code: "auth-code",
      state: started.state,
    });

    expect(pending).toEqual({
      code: "auth-code",
      next: "/automations/123",
      state: started.state,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tokenRequest = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    const tokenBody = tokenRequest.body as URLSearchParams;
    const authorizeUrl = new URL(started.url);
    expect(tokenBody.get("code")).toBe("auth-code");
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      createHash("sha256")
        .update(tokenBody.get("code_verifier") ?? "")
        .digest("base64url"),
    ).toBe(authorizeUrl.searchParams.get("code_challenge"));
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    expect(storage.snapshot()).toEqual({
      "thinkwork:auth-source": "cognito",
      [`${prefix}.LastAuthUser`]: "google_123",
      [`${prefix}.google_123.accessToken`]: "access-token",
      [`${prefix}.google_123.clockDrift`]: "0",
      [`${prefix}.google_123.idToken`]: idToken,
      [`${prefix}.google_123.refreshToken`]: "refresh-token",
    });
  });

  it("keeps token exchange bound to the env captured at OAuth start", async () => {
    const storage = createStorage();
    let activeEnv = {
      ...env,
      cognito: {
        ...env.cognito,
        clientId: "profile-client-a",
        domain: "https://auth-a.example.com",
      },
    };
    const idToken = encodeJwtPayload({
      "cognito:username": "google_123",
      sub: "cognito-sub",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(publicAuthOptionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          id_token: idToken,
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      );
    const controller = createController({
      env: () => activeEnv,
      fetch: fetchImpl,
      storage,
    });

    const started = await controller.startOAuth();
    activeEnv = {
      ...env,
      cognito: {
        ...env.cognito,
        clientId: "profile-client-b",
        domain: "https://auth-b.example.com",
      },
    };
    await controller.completeOAuthCallback({
      code: "auth-code",
      state: started.state,
    });

    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://auth-a.example.com/oauth2/token",
    );
    const tokenRequest = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect((tokenRequest.body as URLSearchParams).get("client_id")).toBe(
      "profile-client-a",
    );
    expect(storage.snapshot()).toHaveProperty(
      "CognitoIdentityServiceProvider.profile-client-a.LastAuthUser",
      "google_123",
    );
  });

  it("exchanges a WorkOS bridge callback and stores a WorkOS-sourced Cognito session", async () => {
    const storage = createStorage();
    const idToken = encodeJwtPayload({
      "cognito:username": "workos_user",
      sub: "cognito-sub",
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id_token: idToken,
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
    );
    const controller = createController({
      fetch: fetchImpl,
      storage,
    });

    await expect(
      controller.completeOAuthCallback({
        workos_bridge: "bridge-code",
        next: "/work-items/123",
      }),
    ).resolves.toEqual({
      workos_bridge: "bridge-code",
      next: "/work-items/123",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/api/auth/workos/bridge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ bridge_code: "bridge-code" }),
      },
    );
    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    expect(storage.snapshot()).toEqual({
      "thinkwork:auth-source": "workos",
      [`${prefix}.LastAuthUser`]: "workos_user",
      [`${prefix}.workos_user.accessToken`]: "access-token",
      [`${prefix}.workos_user.clockDrift`]: "0",
      [`${prefix}.workos_user.idToken`]: idToken,
      [`${prefix}.workos_user.refreshToken`]: "refresh-token",
    });
  });

  it("rejects a mismatched callback state without calling token exchange", async () => {
    const fetchImpl = vi.fn();
    const controller = createController({ fetch: fetchImpl });

    await controller.startOAuth();

    await expect(
      controller.completeOAuthCallback({ code: "auth-code", state: "wrong" }),
    ).rejects.toThrow(/No in-flight OAuth attempt/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/auth/options",
    );
    expect(controller.inFlightCount()).toBe(0);
  });

  it("evicts expired and overflow PKCE attempts", async () => {
    let now = 0;
    const controller = createController({
      maxInFlight: 2,
      now: () => now,
      pkceTtlMs: 10,
    });

    await controller.startOAuth();
    now = 1;
    await controller.startOAuth();
    now = 2;
    await controller.startOAuth();
    expect(controller.inFlightCount()).toBe(2);

    now = 20;
    await controller.startOAuth();
    expect(controller.inFlightCount()).toBe(1);
  });

  it("queues failed refresh-token revocations and drains them later", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const controller = createController({
      fetch: fetchImpl,
      logger: { error: vi.fn(), warn: vi.fn() },
    });

    await expect(
      controller.signOut({
        authSource: null,
        idToken: null,
        refreshToken: "refresh-token",
      }),
    ).resolves.toEqual({
      ok: true,
      revokeFailed: true,
    });
    await expect(
      readFile(join(userDataDir, "pending-revocations.json"), "utf8"),
    ).resolves.toContain("refresh-token");

    await controller.drainPendingRevocations();

    await expect(
      readFile(join(userDataDir, "pending-revocations.json"), "utf8"),
    ).resolves.toBe("[]");
  });

  it("does not persist tokens when the ID token has no Cognito username", async () => {
    const storage = createStorage();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(publicAuthOptionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          id_token: encodeJwtPayload({ email: "user@example.test" }),
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      );
    const controller = createController({ fetch: fetchImpl, storage });

    const started = await controller.startOAuth();

    await expect(
      controller.completeOAuthCallback({
        code: "auth-code",
        state: started.state,
      }),
    ).rejects.toThrow(/Cognito username/);
    expect(storage.snapshot()).toEqual({});
  });

  it("zeroizes in-flight attempts on dispose", async () => {
    const controller = createController();

    await controller.startOAuth();
    expect(controller.inFlightCount()).toBe(1);

    controller.dispose();

    expect(controller.inFlightCount()).toBe(0);
  });

  it("drains a pre-existing pending revocation file", async () => {
    await writeFile(
      join(userDataDir, "pending-revocations.json"),
      JSON.stringify(["refresh-token"]),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    const controller = createController({ fetch: fetchImpl });

    await controller.drainPendingRevocations();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(userDataDir, "pending-revocations.json"), "utf8"),
    ).resolves.toBe("[]");
  });

  it("revokes the server-side WorkOS session before revoking the Cognito refresh token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ logout_url: null }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const controller = createController({ fetch: fetchImpl });

    await expect(
      controller.signOut({
        authSource: "workos",
        idToken: "id-token",
        refreshToken: "refresh-token",
      }),
    ).resolves.toEqual({ ok: true, revokeFailed: false });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/api/auth/workos/logout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer id-token",
        },
        body: JSON.stringify({
          return_to: "thinkwork-dev://oauth/callback",
        }),
      },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://thinkwork-dev.auth.us-east-1.amazoncognito.com/oauth2/revoke",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});

function encodeJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}
