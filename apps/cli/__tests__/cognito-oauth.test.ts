import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import {
  decodeIdToken,
  refreshCognitoTokens,
  loginWithCognito,
  CLI_LOOPBACK_PORT,
} from "../src/cognito-oauth.js";
import type { CognitoConfig } from "../src/cognito-discovery.js";

const cognito: CognitoConfig = {
  userPoolId: "us-east-1_TEST",
  clientId: "client-abc",
  domain: "thinkwork-test",
  domainUrl: "https://thinkwork-test.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",
};

function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mintIdToken(claims: Record<string, unknown>): string {
  return [
    b64url({ alg: "RS256", typ: "JWT" }),
    b64url(claims),
    "signature",
  ].join(".");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// decodeIdToken
// ---------------------------------------------------------------------------

describe("decodeIdToken", () => {
  it("decodes a valid id_token into its claims", () => {
    const tok = mintIdToken({
      sub: "sub-123",
      email: "eric@example.com",
      exp: 1000,
      iat: 0,
    });
    const claims = decodeIdToken(tok);
    expect(claims.sub).toBe("sub-123");
    expect(claims.email).toBe("eric@example.com");
  });

  it("tolerates base64url padding quirks", () => {
    // Payload whose base64 has 2 padding chars stripped.
    const tok = mintIdToken({ sub: "x", exp: 1, iat: 0 });
    expect(() => decodeIdToken(tok)).not.toThrow();
  });

  it("throws on a malformed token", () => {
    expect(() => decodeIdToken("not.a.valid.token.too-many.parts")).toThrow(
      /Malformed id_token/,
    );
    expect(() => decodeIdToken("onlyonepart")).toThrow(/Malformed id_token/);
  });
});

// ---------------------------------------------------------------------------
// CLI_LOOPBACK_PORT
// ---------------------------------------------------------------------------

describe("loopback port constant", () => {
  it("is a fixed value that matches the registered callback URL in terraform", () => {
    // If this changes, terraform/modules/foundation/cognito/variables.tf
    // must be updated in lockstep.
    expect(CLI_LOOPBACK_PORT).toBe(42010);
  });
});

// ---------------------------------------------------------------------------
// refreshCognitoTokens — mocked fetch
// ---------------------------------------------------------------------------

describe("refreshCognitoTokens", () => {
  it("exchanges a refresh_token for fresh id/access tokens and computes expiresAt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id_token: "new-id",
            access_token: "new-access",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const beforeSeconds = Math.floor(Date.now() / 1000);
    const refreshed = await refreshCognitoTokens(cognito, "refresh-xyz");
    const afterSeconds = Math.floor(Date.now() / 1000);

    expect(refreshed.idToken).toBe("new-id");
    expect(refreshed.accessToken).toBe("new-access");
    // Window accounts for the second potentially rolling over.
    expect(refreshed.expiresAt).toBeGreaterThanOrEqual(beforeSeconds + 3600);
    expect(refreshed.expiresAt).toBeLessThanOrEqual(afterSeconds + 3600);

    const call = fetchSpy.mock.calls[0];
    const url = String(call[0]);
    const body = String((call[1] as RequestInit).body);
    expect(url).toBe("https://thinkwork-test.auth.us-east-1.amazoncognito.com/oauth2/token");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=client-abc");
    expect(body).toContain("refresh_token=refresh-xyz");
  });

  it("throws a readable error when Cognito returns a non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad refresh token", { status: 401 }),
    );
    await expect(
      refreshCognitoTokens(cognito, "expired"),
    ).rejects.toThrow(/Token refresh failed \(HTTP 401\)/);
  });
});

// ---------------------------------------------------------------------------
// loginWithCognito — end-to-end over a real loopback, with mocked token exchange
// ---------------------------------------------------------------------------

describe("loginWithCognito (loopback)", () => {
  it("completes an OAuth round-trip on the loopback listener", async () => {
    // Spoof the authorization endpoint: instead of opening a real browser we
    // immediately fire a GET to the loopback callback with a fake code.
    const launchBrowser = (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      // Let the listener finish binding before we hit it.
      setImmediate(() => {
        fetch(`${redirectUri}?code=authcode-xyz&state=${state}`).catch(
          () => undefined,
        );
      });
    };

    // Mock the /oauth2/token exchange but let the simulated browser's fetch
    // to 127.0.0.1 fall through to the real implementation so the loopback
    // server can receive the callback.
    const originalFetch = globalThis.fetch;
    const tokenSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/oauth2/token")) {
          const body = String(init?.body ?? "");
          expect(body).toContain("grant_type=authorization_code");
          expect(body).toContain("code=authcode-xyz");
          return new Response(
            JSON.stringify({
              id_token: "id-tok",
              access_token: "acc-tok",
              refresh_token: "ref-tok",
              expires_in: 3600,
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return originalFetch(input as any, init);
      },
    );

    const tokens = await loginWithCognito({
      cognito,
      port: await ephemeralPort(),
      openBrowser: true,
      launchBrowser,
      timeoutMs: 5000,
    });

    expect(tokens.idToken).toBe("id-tok");
    expect(tokens.accessToken).toBe("acc-tok");
    expect(tokens.refreshToken).toBe("ref-tok");
    expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(tokenSpy).toHaveBeenCalled();
  });

  it("rejects a state mismatch (CSRF guard)", async () => {
    const launchBrowser = (url: string) => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      setImmediate(() => {
        // Intentionally wrong state.
        fetch(`${redirectUri}?code=abc&state=not-the-same`).catch(
          () => undefined,
        );
      });
    };

    await expect(
      loginWithCognito({
        cognito,
        port: await ephemeralPort(),
        openBrowser: true,
        launchBrowser,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/state parameter didn't match/i);
  });
});

/**
 * Reserve an ephemeral port by letting the OS pick one, closing the server,
 * then handing the number back. Avoids collisions with the default 42010 and
 * with other tests running in parallel.
 */
async function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
