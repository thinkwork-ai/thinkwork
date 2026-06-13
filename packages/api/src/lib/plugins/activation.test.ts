/**
 * App-level OAuth activation tests (plan 2026-06-12-001 U6).
 *
 * Runs the activation flow against the in-memory store + secrets fakes
 * and a scripted fetch fake (discovery, DCR, token endpoint) — no DB,
 * no AWS, no network. Covers: HMAC state integrity (forged/expired
 * rejected BEFORE any field is consumed), single- and multi-resource
 * minting, the sharedAudience fallback, denial/abandon leaving nothing
 * behind, full-secret-deletion deactivation, needs_reauth on refresh
 * failure, and dispatch-time token resolution.
 */

import { describe, expect, it, vi } from "vitest";
import type { PluginVersion } from "@thinkwork/plugin-catalog";
import {
  completeActivation,
  createPluginDispatchAuthResolver,
  deactivateActivation,
  markActivationNeedsReauth,
  MAX_STATE_AGE_MS,
  pluginTokenSecretName,
  resourceKeyFor,
  signPluginOAuthState,
  startActivation,
  verifyPluginOAuthState,
  type PluginActivationDeps,
  type PluginOAuthState,
} from "./activation.js";
import {
  createInMemoryPluginEngineStore,
  createInMemoryPluginSecrets,
  type InMemoryPluginEngineStore,
  type InMemoryPluginSecrets,
} from "./testing.js";

const TENANT = "tenant-1";
const USER = "user-1";
const STATE_SECRET = "test-state-secret";
const AUTH_DOMAIN = "https://auth.example.invalid";
const API_BASE = "https://api.example.invalid";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function lastmileVersion(
  opts: { sharedResource?: boolean } = {},
): PluginVersion {
  const resource = (key: string) =>
    opts.sharedResource
      ? "https://api.lastmile.invalid"
      : `https://${key}.lastmile.invalid`;
  return {
    version: "0.1.0",
    requiredOauthScopes: ["openid", "offline_access"],
    components: [
      ...(["crm", "tasks", "routing"] as const).map((key) => ({
        type: "mcp-server" as const,
        key,
        displayName: key.toUpperCase(),
        endpointUrl: `https://${key}.lastmile.invalid/mcp`,
        auth: {
          mode: "oauth" as const,
          authDomain: AUTH_DOMAIN,
          resourceIndicator: resource(key),
        },
      })),
      {
        type: "skills" as const,
        key: "skills",
        skills: [{ slug: "lastmile--crm-basics", skillMd: "# s" }],
      },
    ],
  };
}

interface Harness {
  deps: PluginActivationDeps;
  store: InMemoryPluginEngineStore;
  secrets: InMemoryPluginSecrets;
  fetchCalls: Array<{ url: string; body: URLSearchParams | null }>;
  installId: string;
  /** Per-test switch: reject refresh-grant mints (sharedAudience path). */
  rejectRefreshMints: { value: boolean };
  /** Per-test switch: token responses omit refresh_token. */
  omitRefreshToken: { value: boolean };
}

function buildHarness(payload: PluginVersion = lastmileVersion()): Harness {
  const store = createInMemoryPluginEngineStore();
  const secrets = createInMemoryPluginSecrets();
  const fetchCalls: Harness["fetchCalls"] = [];
  const rejectRefreshMints = { value: false };
  const omitRefreshToken = { value: false };
  let tokenSerial = 0;

  const install = store.seedInstall({
    tenant_id: TENANT,
    plugin_key: "lastmile",
    pinned_version: "0.1.0",
    pinned_payload_sha256: "sha-0.1.0",
    state: "installed",
  });
  store.seedComponent({
    plugin_install_id: install.id,
    component_key: "crm",
    component_type: "mcp-server",
    state: "provisioned",
    handler_ref: { tenantMcpServerId: "srv-crm" },
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string" && init.body.includes("=")
        ? new URLSearchParams(init.body)
        : null;
    fetchCalls.push({ url, body });

    if (url === `${AUTH_DOMAIN}/.well-known/oauth-authorization-server`) {
      return json({
        authorization_endpoint: `${AUTH_DOMAIN}/authorize`,
        token_endpoint: `${AUTH_DOMAIN}/token`,
        registration_endpoint: `${AUTH_DOMAIN}/register`,
      });
    }
    if (url === `${AUTH_DOMAIN}/register`) {
      return json({ client_id: "client-123" });
    }
    if (url === `${AUTH_DOMAIN}/token`) {
      const grantType = body?.get("grant_type");
      if (grantType === "authorization_code") {
        tokenSerial += 1;
        return json({
          access_token: `access-${tokenSerial}`,
          refresh_token: omitRefreshToken.value
            ? undefined
            : `refresh-${tokenSerial}`,
          token_type: "Bearer",
          scope: "openid offline_access",
          expires_in: 3600,
        });
      }
      if (grantType === "refresh_token") {
        if (rejectRefreshMints.value) {
          return json({ error: "invalid_target" }, 400);
        }
        tokenSerial += 1;
        return json({
          access_token: `access-${tokenSerial}`,
          refresh_token: `refresh-${tokenSerial}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
    }
    return json({ error: "unexpected_request" }, 500);
  }) as typeof fetch;

  const deps: PluginActivationDeps = {
    store,
    secrets,
    resolveVersion: async (pluginKey, version) =>
      pluginKey === "lastmile" && (!version || version === "0.1.0")
        ? {
            plugin: { pluginKey: "lastmile" },
            versionEntry: {
              version: "0.1.0",
              payloadSha256: "sha-0.1.0",
              payload,
            },
          }
        : null,
    fetchFn,
    stateSecret: () => STATE_SECRET,
    apiBaseUrl: () => API_BASE,
    stage: () => "test",
    now: () => new Date(),
  };

  return {
    deps,
    store,
    secrets,
    fetchCalls,
    installId: install.id,
    rejectRefreshMints,
    omitRefreshToken,
  };
}

async function startAndGetState(h: Harness): Promise<string> {
  const { authorizeUrl } = await startActivation(
    { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
    h.deps,
  );
  const state = new URL(authorizeUrl).searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

// ---------------------------------------------------------------------------
// State integrity
// ---------------------------------------------------------------------------

describe("HMAC-signed state", () => {
  it("round-trips sign → verify", () => {
    const payload: PluginOAuthState = {
      v: 1,
      userId: USER,
      tenantId: TENANT,
      pluginInstallId: "install-1",
      pluginKey: "lastmile",
      tokenEndpoint: `${AUTH_DOMAIN}/token`,
      clientId: "client-123",
      redirectUri: `${API_BASE}/api/skills/plugin-oauth/callback`,
      codeVerifier: "verifier",
      resources: ["https://crm.lastmile.invalid"],
      scope: "openid",
      returnTo: null,
      nonce: "n",
      iat: Date.now(),
    };
    const state = signPluginOAuthState(payload, STATE_SECRET);
    const verified = verifyPluginOAuthState(state, STATE_SECRET, new Date());
    expect(verified).toEqual({ ok: true, payload });
  });

  it("MANDATORY: a forged/unsigned state is rejected before ANY field is consumed", async () => {
    const h = buildHarness();
    // Attacker crafts a perfectly-shaped payload binding ANOTHER user —
    // but cannot produce the HMAC.
    const forgedPayload: PluginOAuthState = {
      v: 1,
      userId: "attacker-target-user",
      tenantId: TENANT,
      pluginInstallId: h.installId,
      pluginKey: "lastmile",
      tokenEndpoint: `${AUTH_DOMAIN}/token`,
      clientId: "client-123",
      redirectUri: `${API_BASE}/api/skills/plugin-oauth/callback`,
      codeVerifier: "verifier",
      resources: ["https://crm.lastmile.invalid"],
      scope: "openid",
      returnTo: null,
      nonce: "n",
      iat: Date.now(),
    };
    const encoded = Buffer.from(JSON.stringify(forgedPayload)).toString(
      "base64url",
    );
    for (const forged of [
      encoded, // unsigned
      `${encoded}.deadbeef`, // wrong signature
      signPluginOAuthState(forgedPayload, "wrong-secret"), // wrong key
    ]) {
      const result = await completeActivation(
        { state: forged, code: "code-1" },
        h.deps,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/invalid_state/);
        // No state field was consumed: no pluginKey echoed back.
        expect(result.pluginKey).toBeUndefined();
      }
    }
    // Nothing happened: no token exchange, no rows, no secrets.
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.store.activations.size).toBe(0);
    expect(h.store.tokens.size).toBe(0);
    expect(h.secrets.values.size).toBe(0);
  });

  it("a tampered (re-encoded) payload under a valid-looking blob is rejected", async () => {
    const h = buildHarness();
    const state = await startAndGetState(h);
    const [encoded, sig] = [
      state.slice(0, state.lastIndexOf(".")),
      state.slice(state.lastIndexOf(".") + 1),
    ];
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString(),
    ) as PluginOAuthState;
    payload.userId = "someone-else";
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    h.fetchCalls.length = 0;
    const result = await completeActivation(
      { state: tampered, code: "code-1" },
      h.deps,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_state_signature",
    });
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("expired state is rejected", async () => {
    const h = buildHarness();
    const state = await startAndGetState(h);
    h.deps.now = () => new Date(Date.now() + MAX_STATE_AGE_MS + 1000);
    h.fetchCalls.length = 0;
    const result = await completeActivation({ state, code: "code-1" }, h.deps);
    expect(result).toMatchObject({ ok: false, reason: "expired_state" });
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.store.activations.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// startActivation
// ---------------------------------------------------------------------------

describe("startActivation", () => {
  it("builds the authorize URL with PKCE, declared scopes, and only the primary resource (AuthKit rejects repeated resource params)", async () => {
    const h = buildHarness();
    const { authorizeUrl } = await startActivation(
      { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${AUTH_DOMAIN}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${API_BASE}/api/skills/plugin-oauth/callback`,
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    // Only the primary resource rides the authorize request; the remaining
    // resources mint via refresh grants in completeActivation (state still
    // carries the full list).
    expect(url.searchParams.getAll("resource")).toEqual([
      "https://crm.lastmile.invalid",
    ]);
  });

  it("caches the DCR client on the component handler_ref (one registration per install)", async () => {
    const h = buildHarness();
    await startActivation(
      { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );
    const dcrCalls = () =>
      h.fetchCalls.filter((call) => call.url === `${AUTH_DOMAIN}/register`);
    expect(dcrCalls()).toHaveLength(1);
    await startActivation(
      { userId: "user-2", tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );
    expect(dcrCalls()).toHaveLength(1); // cached — no second registration
  });

  it("rejects an install outside the caller's tenant", async () => {
    const h = buildHarness();
    await expect(
      startActivation(
        {
          userId: USER,
          tenantId: "other-tenant",
          pluginInstallId: h.installId,
        },
        h.deps,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

// ---------------------------------------------------------------------------
// completeActivation
// ---------------------------------------------------------------------------

describe("completeActivation", () => {
  it("single shared resource: one consent mints exactly ONE token record covering all three servers", async () => {
    const h = buildHarness(lastmileVersion({ sharedResource: true }));
    const state = await startAndGetState(h);
    const result = await completeActivation({ state, code: "code-1" }, h.deps);
    expect(result).toEqual({
      ok: true,
      pluginKey: "lastmile",
      returnTo: null,
    });

    expect(h.store.activations.size).toBe(1);
    const activation = [...h.store.activations.values()][0]!;
    expect(activation).toMatchObject({
      user_id: USER,
      plugin_install_id: h.installId,
      status: "active",
      granted_scopes: ["openid", "offline_access"],
    });
    const tokens = await h.store.listActivationTokens(activation.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.resource_indicator).toBe("https://api.lastmile.invalid");
    expect(h.secrets.values.size).toBe(1);
    // ONE token exchange round-trip — no refresh-grant mints needed.
    const tokenCalls = h.fetchCalls.filter(
      (call) => call.url === `${AUTH_DOMAIN}/token`,
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.body?.get("resource")).toBe(
      "https://api.lastmile.invalid",
    );
    // Compliance: granted event recorded transactionally with the upsert.
    expect(h.store.audits.at(-1)).toMatchObject({
      eventType: "plugin.activation_granted",
      actorId: USER,
      payload: { tokenCount: 1, sharedAudience: false },
    });
  });

  it("distinct resources: initial exchange + refresh-grant re-mints produce one token record per resource", async () => {
    const h = buildHarness(); // 3 distinct resource indicators
    const state = await startAndGetState(h);
    const result = await completeActivation({ state, code: "code-1" }, h.deps);
    expect(result.ok).toBe(true);

    const activation = [...h.store.activations.values()][0]!;
    const tokens = await h.store.listActivationTokens(activation.id);
    expect(tokens.map((token) => token.resource_indicator).sort()).toEqual([
      "https://crm.lastmile.invalid",
      "https://routing.lastmile.invalid",
      "https://tasks.lastmile.invalid",
    ]);
    expect(h.secrets.values.size).toBe(3);
    // Distinct access tokens per audience.
    const accessTokens = [...h.secrets.values.values()].map(
      (value) => (JSON.parse(value) as { access_token: string }).access_token,
    );
    expect(new Set(accessTokens).size).toBe(3);
    // 1 code exchange + 2 refresh-grant mints, each with its resource.
    const tokenCalls = h.fetchCalls.filter(
      (call) => call.url === `${AUTH_DOMAIN}/token`,
    );
    expect(tokenCalls.map((call) => call.body?.get("grant_type"))).toEqual([
      "authorization_code",
      "refresh_token",
      "refresh_token",
    ]);
    expect(h.store.audits.at(-1)).toMatchObject({
      eventType: "plugin.activation_granted",
      payload: { tokenCount: 3, sharedAudience: false },
    });
  });

  it("sharedAudience fallback: an AS rejecting multi-resource mints stores the single token for ALL resource records", async () => {
    const h = buildHarness();
    h.rejectRefreshMints.value = true;
    const state = await startAndGetState(h);
    const result = await completeActivation({ state, code: "code-1" }, h.deps);
    expect(result.ok).toBe(true);

    const activation = [...h.store.activations.values()][0]!;
    const tokens = await h.store.listActivationTokens(activation.id);
    expect(tokens).toHaveLength(3); // one record per resource, same token
    const secretsParsed = tokens.map(
      (token) =>
        JSON.parse(h.secrets.values.get(token.secret_ref)!) as {
          access_token: string;
          shared_audience: boolean;
        },
    );
    expect(new Set(secretsParsed.map((s) => s.access_token)).size).toBe(1);
    expect(
      secretsParsed.filter((secret) => secret.shared_audience),
    ).toHaveLength(2);
    expect(h.store.audits.at(-1)).toMatchObject({
      eventType: "plugin.activation_granted",
      payload: { tokenCount: 3, sharedAudience: true },
    });
  });

  it("no refresh token from the AS: falls straight to sharedAudience without extra mint attempts", async () => {
    const h = buildHarness();
    h.omitRefreshToken.value = true;
    const state = await startAndGetState(h);
    const result = await completeActivation({ state, code: "code-1" }, h.deps);
    expect(result.ok).toBe(true);
    const tokenCalls = h.fetchCalls.filter(
      (call) => call.url === `${AUTH_DOMAIN}/token`,
    );
    expect(tokenCalls).toHaveLength(1); // no refresh grants attempted
    const activation = [...h.store.activations.values()][0]!;
    expect(await h.store.listActivationTokens(activation.id)).toHaveLength(3);
  });

  it("OAuth denial/abandonment leaves NO activation row and NO secrets", async () => {
    const h = buildHarness();
    const state = await startAndGetState(h);
    h.fetchCalls.length = 0;
    const result = await completeActivation(
      { state, error: "access_denied" },
      h.deps,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "denied",
      pluginKey: "lastmile",
    });
    expect(h.fetchCalls).toHaveLength(0); // no token exchange attempted
    expect(h.store.activations.size).toBe(0);
    expect(h.store.tokens.size).toBe(0);
    expect(h.secrets.values.size).toBe(0);
    expect(
      h.store.audits.filter(
        (audit) => audit.eventType === "plugin.activation_granted",
      ),
    ).toHaveLength(0);
  });

  it("stores secrets at thinkwork/{stage}/plugin-tokens/{userId}/{installId}/{resourceKey}", async () => {
    const h = buildHarness(lastmileVersion({ sharedResource: true }));
    const state = await startAndGetState(h);
    await completeActivation({ state, code: "code-1" }, h.deps);
    const expected = pluginTokenSecretName({
      stage: "test",
      userId: USER,
      pluginInstallId: h.installId,
      resourceIndicator: "https://api.lastmile.invalid",
    });
    expect(expected).toMatch(
      new RegExp(`^thinkwork/test/plugin-tokens/${USER}/${h.installId}/`),
    );
    expect(h.secrets.values.has(expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deactivateActivation
// ---------------------------------------------------------------------------

describe("deactivateActivation", () => {
  it("deletes EVERY token secret via the secrets client, drops token rows, and revokes", async () => {
    const h = buildHarness();
    const state = await startAndGetState(h);
    await completeActivation({ state, code: "code-1" }, h.deps);
    const secretNames = [...h.secrets.values.keys()];
    expect(secretNames).toHaveLength(3);

    const revoked = await deactivateActivation(
      { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );

    expect(revoked.status).toBe("revoked");
    expect(revoked.revoked_at).toBeTruthy();
    // Asserted against the secrets client, not just the DB rows.
    expect(h.secrets.deleted.sort()).toEqual(secretNames.sort());
    expect(h.secrets.values.size).toBe(0);
    expect(h.store.tokens.size).toBe(0);
    expect(h.store.audits.at(-1)).toMatchObject({
      eventType: "plugin.activation_revoked",
      actorId: USER,
      payload: { pluginKey: "lastmile" },
    });
  });

  it("throws NOT_FOUND when the caller has no activation", async () => {
    const h = buildHarness();
    await expect(
      deactivateActivation(
        { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
        h.deps,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

// ---------------------------------------------------------------------------
// markActivationNeedsReauth + dispatch resolver
// ---------------------------------------------------------------------------

describe("dispatch token resolution", () => {
  async function activatedHarness() {
    const h = buildHarness();
    const state = await startAndGetState(h);
    await completeActivation({ state, code: "code-1" }, h.deps);
    const activation = [...h.store.activations.values()][0]!;
    return { h, activation };
  }

  it("markActivationNeedsReauth flips the activation status", async () => {
    const { h, activation } = await activatedHarness();
    await markActivationNeedsReauth(activation.id, { store: h.store });
    expect(h.store.activations.get(activation.id)!.status).toBe("needs_reauth");
  });

  it("resolves a fresh token per resource record", async () => {
    const { h } = await activatedHarness();
    const resolver = createPluginDispatchAuthResolver({
      store: h.store,
      secrets: h.secrets,
      fetchFn: h.deps.fetchFn,
      now: () => new Date(),
    });
    const token = await resolver.resolveToken({
      requesterUserId: USER,
      pluginInstallId: h.installId,
      resource: "https://crm.lastmile.invalid",
      slug: "lastmile--crm",
      logPrefix: "[test]",
    });
    expect(token).toMatch(/^access-/);
  });

  it("refresh failure marks the activation needs_reauth and skips WITHOUT throwing", async () => {
    const { h, activation } = await activatedHarness();
    // Expire every token record, then make the AS reject refreshes.
    for (const token of h.store.tokens.values()) {
      token.expires_at = new Date(Date.now() - 1000);
    }
    h.rejectRefreshMints.value = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = createPluginDispatchAuthResolver({
      store: h.store,
      secrets: h.secrets,
      fetchFn: h.deps.fetchFn,
      now: () => new Date(),
    });
    const token = await resolver.resolveToken({
      requesterUserId: USER,
      pluginInstallId: h.installId,
      resource: "https://crm.lastmile.invalid",
      slug: "lastmile--crm",
      logPrefix: "[test]",
    });
    expect(token).toBeNull();
    expect(h.store.activations.get(activation.id)!.status).toBe("needs_reauth");
    // The whole plugin is poisoned for this resolution pass.
    const second = await resolver.resolveToken({
      requesterUserId: USER,
      pluginInstallId: h.installId,
      resource: "https://tasks.lastmile.invalid",
      slug: "lastmile--tasks",
      logPrefix: "[test]",
    });
    expect(second).toBeNull();
    expect(await resolver.hasActiveActivation(USER, h.installId)).toBe(false);
    warn.mockRestore();
  });

  it("refresh-on-expiry rotates the stored secret and expiry", async () => {
    const { h } = await activatedHarness();
    const tokenRow = [...h.store.tokens.values()].find(
      (row) => row.resource_indicator === "https://crm.lastmile.invalid",
    )!;
    tokenRow.expires_at = new Date(Date.now() - 1000);
    const before = h.secrets.values.get(tokenRow.secret_ref)!;
    const resolver = createPluginDispatchAuthResolver({
      store: h.store,
      secrets: h.secrets,
      fetchFn: h.deps.fetchFn,
      now: () => new Date(),
    });
    const token = await resolver.resolveToken({
      requesterUserId: USER,
      pluginInstallId: h.installId,
      resource: "https://crm.lastmile.invalid",
      slug: "lastmile--crm",
      logPrefix: "[test]",
    });
    expect(token).toBeTruthy();
    const after = h.secrets.values.get(tokenRow.secret_ref)!;
    expect(after).not.toBe(before);
    const updated = h.store.tokens.get(tokenRow.id)!;
    expect(updated.expires_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a revoked activation resolves nothing (deactivation drops servers next resolution)", async () => {
    const { h } = await activatedHarness();
    await deactivateActivation(
      { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = createPluginDispatchAuthResolver({
      store: h.store,
      secrets: h.secrets,
      fetchFn: h.deps.fetchFn,
      now: () => new Date(),
    });
    const token = await resolver.resolveToken({
      requesterUserId: USER,
      pluginInstallId: h.installId,
      resource: "https://crm.lastmile.invalid",
      slug: "lastmile--crm",
      logPrefix: "[test]",
    });
    expect(token).toBeNull();
    expect(await resolver.hasActiveActivation(USER, h.installId)).toBe(false);
    warn.mockRestore();
  });
});

describe("resourceKeyFor", () => {
  it("is stable, slug-shaped, and collision-resistant", () => {
    const a = resourceKeyFor("https://crm.lastmile.invalid");
    expect(a).toBe(resourceKeyFor("https://crm.lastmile.invalid/")); // trailing slash normalized
    expect(a).toMatch(/^[a-z0-9-]+$/);
    expect(a).not.toBe(resourceKeyFor("https://tasks.lastmile.invalid"));
  });
});

// ---------------------------------------------------------------------------
// Per-instance OAuth (U10 Twenty): derived auth domain + resource
// ---------------------------------------------------------------------------

describe("startActivation with oauth-per-instance components (U10)", () => {
  const INSTANCE = "https://crm.tenant.invalid";

  function twentyVersion(): PluginVersion {
    return {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "mcp-server" as const,
          key: "crm",
          displayName: "Twenty CRM",
          endpointFrom: {
            managedApp: "twenty",
            configKey: "publicUrl",
            path: "/mcp",
          },
          auth: { mode: "oauth-per-instance" as const },
        },
        {
          type: "infrastructure" as const,
          key: "runtime",
          managedAppKey: "twenty",
          terraformInputs: {},
        },
      ],
    };
  }

  function buildTwentyHarness(opts: { resolvedEndpoint?: string | null } = {}) {
    const store = createInMemoryPluginEngineStore();
    const secrets = createInMemoryPluginSecrets();
    const fetchCalls: Array<{ url: string }> = [];
    const resolvedEndpoint =
      opts.resolvedEndpoint === undefined
        ? `${INSTANCE}/mcp`
        : opts.resolvedEndpoint;

    const install = store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "twenty",
      pinned_version: "0.1.0",
      pinned_payload_sha256: "sha-0.1.0",
      state: "installed",
    });
    store.seedComponent({
      plugin_install_id: install.id,
      component_key: "crm",
      component_type: "mcp-server",
      state: resolvedEndpoint ? "provisioned" : "pending",
      handler_ref: resolvedEndpoint
        ? {
            tenantMcpServerId: "srv-twenty",
            resolvedEndpointUrl: resolvedEndpoint,
          }
        : {},
    });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push({ url });
      // RFC 9728 protected-resource metadata on the Twenty instance.
      if (url === `${INSTANCE}/.well-known/oauth-protected-resource/mcp`) {
        return json({ authorization_servers: [INSTANCE] });
      }
      // RFC 8414 discovery against the derived (instance) auth domain.
      if (url === `${INSTANCE}/.well-known/oauth-authorization-server`) {
        return json({
          authorization_endpoint: `${INSTANCE}/authorize`,
          token_endpoint: `${INSTANCE}/token`,
          registration_endpoint: `${INSTANCE}/register`,
        });
      }
      if (url === `${INSTANCE}/register`) {
        return json({ client_id: "twenty-client-1" });
      }
      return json({ error: "unexpected_request" }, 500);
    }) as typeof fetch;

    const deps: PluginActivationDeps = {
      store,
      secrets,
      resolveVersion: async (pluginKey, version) =>
        pluginKey === "twenty" && (!version || version === "0.1.0")
          ? {
              plugin: { pluginKey: "twenty" },
              versionEntry: {
                version: "0.1.0",
                payloadSha256: "sha-0.1.0",
                payload: twentyVersion(),
              },
            }
          : null,
      fetchFn,
      stateSecret: () => STATE_SECRET,
      apiBaseUrl: () => API_BASE,
      stage: () => "test",
      now: () => new Date(),
    };

    return { deps, fetchCalls, installId: install.id };
  }

  it("derives the auth domain from RFC 9728 metadata and the resource from the resolved endpoint", async () => {
    const h = buildTwentyHarness();
    const { authorizeUrl } = await startActivation(
      { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
      h.deps,
    );
    const url = new URL(authorizeUrl);
    // DCR ran against the Twenty INSTANCE itself (per-instance auth domain).
    expect(url.origin + url.pathname).toBe(`${INSTANCE}/authorize`);
    expect(url.searchParams.get("client_id")).toBe("twenty-client-1");
    expect(url.searchParams.getAll("resource")).toEqual([`${INSTANCE}/mcp`]);
    // Empty manifest scopes degrade to the activation default scope set.
    expect(url.searchParams.get("scope")).toBe(
      "openid email profile offline_access",
    );
    expect(
      h.fetchCalls.some(
        (call) =>
          call.url === `${INSTANCE}/.well-known/oauth-protected-resource/mcp`,
      ),
    ).toBe(true);
  });

  it("fails closed with a readable error when the component has no resolved endpoint yet", async () => {
    const h = buildTwentyHarness({ resolvedEndpoint: null });
    await expect(
      startActivation(
        { userId: USER, tenantId: TENANT, pluginInstallId: h.installId },
        h.deps,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "PLUGIN_COMPONENT_NOT_PROVISIONED" },
    });
  });
});
