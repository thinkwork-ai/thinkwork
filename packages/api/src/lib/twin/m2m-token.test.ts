import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedM2mToken,
  clearM2mTokenCache,
  m2mCredentialsFromSecret,
  mintM2mToken,
  type M2mClientCredentials,
} from "./m2m-token.js";

const CREDS: M2mClientCredentials = {
  clientId: "client-abc",
  clientSecret: "secret-xyz",
  tokenUrl: "https://pool.auth.us-east-1.amazoncognito.com/oauth2/token",
  scope: "brain-m2m/lane:platform-agent",
};

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: "jwt-1",
      expires_in: 3600,
      ...overrides,
    }),
  } as unknown as Response;
}

beforeEach(() => clearM2mTokenCache());

describe("m2mCredentialsFromSecret", () => {
  it("reads a terraform-shaped lane blob", () => {
    expect(
      m2mCredentialsFromSecret({
        client_id: "c",
        client_secret: "s",
        token_url: "https://t/oauth2/token",
        scope: "brain-m2m/lane:x",
      }),
    ).toEqual({
      clientId: "c",
      clientSecret: "s",
      tokenUrl: "https://t/oauth2/token",
      scope: "brain-m2m/lane:x",
    });
  });

  it("treats scope as optional", () => {
    const creds = m2mCredentialsFromSecret({
      client_id: "c",
      client_secret: "s",
      token_url: "https://t",
    });
    expect(creds).not.toBeNull();
    expect(creds?.scope).toBeUndefined();
  });

  it.each([
    ["missing client_id", { client_secret: "s", token_url: "https://t" }],
    ["missing client_secret", { client_id: "c", token_url: "https://t" }],
    ["missing token_url", { client_id: "c", client_secret: "s" }],
    ["blank field", { client_id: " ", client_secret: "s", token_url: "u" }],
    ["a stored tkt_ bearer", { token: "tkt_abc", tenantId: "t" }],
  ])("is null for %s — a partial blob is not a lane secret", (_label, blob) => {
    expect(
      m2mCredentialsFromSecret(blob as Record<string, unknown>),
    ).toBeNull();
  });

  it("is null for a bare-string secret", () => {
    expect(m2mCredentialsFromSecret("tkt_plain")).toBeNull();
  });
});

describe("mintM2mToken", () => {
  it("posts client_credentials with HTTP Basic and the scope", async () => {
    const doFetch = vi.fn(async () => okResponse());
    const minted = await mintM2mToken(CREDS, {
      fetch: doFetch as unknown as typeof fetch,
      now: () => 1_000_000,
    });
    expect(minted.token).toBe("jwt-1");
    // 3600s lifetime minus the 5-minute refresh margin.
    expect(minted.staleAt).toBe(1_000_000 + 3600_000 - 300_000);
    const [url, init] = doFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(CREDS.tokenUrl);
    expect(init.headers).toMatchObject({
      authorization:
        "Basic " + Buffer.from("client-abc:secret-xyz").toString("base64"),
    });
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain(
      "scope=brain-m2m%2Flane%3Aplatform-agent",
    );
  });

  it("throws on a non-2xx without echoing the body", async () => {
    const doFetch = vi.fn(
      async () => ({ ok: false, status: 401 }) as unknown as Response,
    );
    await expect(
      mintM2mToken(CREDS, { fetch: doFetch as unknown as typeof fetch }),
    ).rejects.toThrow(/401/);
  });

  it("throws when the response has no access_token", async () => {
    const doFetch = vi.fn(async () => okResponse({ access_token: undefined }));
    await expect(
      mintM2mToken(CREDS, { fetch: doFetch as unknown as typeof fetch }),
    ).rejects.toThrow(/no access_token/);
  });
});

describe("cachedM2mToken", () => {
  it("mints once and reuses until 5 minutes before expiry", async () => {
    let clock = 0;
    const doFetch = vi.fn(async () => okResponse());
    const deps = {
      fetch: doFetch as unknown as typeof fetch,
      now: () => clock,
    };

    expect(await cachedM2mToken("ref-1", CREDS, deps)).toBe("jwt-1");
    clock = 3600_000 - 300_001; // just inside the fresh window
    expect(await cachedM2mToken("ref-1", CREDS, deps)).toBe("jwt-1");
    expect(doFetch).toHaveBeenCalledTimes(1);

    clock = 3600_000 - 300_000; // margin reached — re-mint
    await cachedM2mToken("ref-1", CREDS, deps);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("caches per secretRef, not globally", async () => {
    const doFetch = vi.fn(async () => okResponse());
    const deps = { fetch: doFetch as unknown as typeof fetch, now: () => 0 };
    await cachedM2mToken("ref-a", CREDS, deps);
    await cachedM2mToken("ref-b", CREDS, deps);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});
