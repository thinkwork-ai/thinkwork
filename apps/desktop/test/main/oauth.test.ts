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
      fetch: vi.fn(),
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
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get("state")).toBe(result.state);
  });

  it("exchanges a matching callback, resolves the DB user id, and writes Cognito keys", async () => {
    const storage = createStorage();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id_token: "id-token",
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { me: { id: "db-user-id" } } }),
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
    const tokenRequest = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const tokenBody = tokenRequest.body as URLSearchParams;
    const authorizeUrl = new URL(started.url);
    expect(tokenBody.get("code")).toBe("auth-code");
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      createHash("sha256")
        .update(tokenBody.get("code_verifier") ?? "")
        .digest("base64url"),
    ).toBe(authorizeUrl.searchParams.get("code_challenge"));
    const meRequest = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect(meRequest.headers).toMatchObject({
      Authorization: "Bearer id-token",
    });

    const prefix = "CognitoIdentityServiceProvider.test-client-id";
    expect(storage.snapshot()).toEqual({
      [`${prefix}.LastAuthUser`]: "db-user-id",
      [`${prefix}.db-user-id.accessToken`]: "access-token",
      [`${prefix}.db-user-id.clockDrift`]: "0",
      [`${prefix}.db-user-id.idToken`]: "id-token",
      [`${prefix}.db-user-id.refreshToken`]: "refresh-token",
    });
  });

  it("rejects a mismatched callback state without calling token exchange", async () => {
    const fetchImpl = vi.fn();
    const controller = createController({ fetch: fetchImpl });

    await controller.startOAuth();

    await expect(
      controller.completeOAuthCallback({ code: "auth-code", state: "wrong" }),
    ).rejects.toThrow(/No in-flight OAuth attempt/);
    expect(fetchImpl).not.toHaveBeenCalled();
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

    await expect(controller.signOut("refresh-token")).resolves.toEqual({
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

  it("does not persist tokens when user id resolution fails", async () => {
    const storage = createStorage();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id_token: "id-token",
          access_token: "access-token",
          refresh_token: "refresh-token",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { me: null } }));
    const controller = createController({ fetch: fetchImpl, storage });

    const started = await controller.startOAuth();

    await expect(
      controller.completeOAuthCallback({
        code: "auth-code",
        state: started.state,
      }),
    ).rejects.toThrow(/did not resolve/);
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
});
