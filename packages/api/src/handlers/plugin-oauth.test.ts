/**
 * Plugin OAuth route tests (plan 2026-06-12-001 U6).
 *
 * Covers the security contract of the route pair:
 *   - authorize binds the CANONICAL auth principal and IGNORES any
 *     caller-supplied userId query parameter;
 *   - the callback redirects to /settings/plugins/{pluginKey} with
 *     pluginOAuth=success|error&reason=... and rejects forged state.
 *
 * The DB layer is mocked at getDb(); the activation flow runs for real
 * against in-memory fakes.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInstallRows, mockUserRows } = vi.hoisted(() => ({
  mockInstallRows: vi.fn(),
  mockUserRows: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: { __probe?: string } & Record<string, unknown>) => ({
          where: () => ({
            limit: () => {
              // pluginInstalls vs users — distinguish by a column only
              // pluginInstalls has.
              if ("plugin_key" in table) {
                return Promise.resolve(mockInstallRows() as unknown[]);
              }
              return Promise.resolve(mockUserRows() as unknown[]);
            },
          }),
        }),
      }),
    }),
  };
});

// eslint-disable-next-line import/first
import type { PluginVersion } from "@thinkwork/plugin-catalog";
// eslint-disable-next-line import/first
import type { AuthResult } from "../lib/cognito-auth.js";
// eslint-disable-next-line import/first
import type { PluginActivationDeps } from "../lib/plugins/activation.js";
// eslint-disable-next-line import/first
import {
  createInMemoryPluginEngineStore,
  createInMemoryPluginSecrets,
  type InMemoryPluginEngineStore,
} from "../lib/plugins/testing.js";
// eslint-disable-next-line import/first
import {
  pluginOAuthAuthorize,
  pluginOAuthCallback,
  pluginOAuthCompletionRedirect,
} from "./plugin-oauth.js";

const TENANT = "tenant-1";
const CANONICAL_USER = "canonical-user-1";
const AUTH_DOMAIN = "https://auth.example.invalid";

const payload: PluginVersion = {
  version: "0.1.0",
  requiredOauthScopes: ["openid"],
  components: [
    {
      type: "mcp-server",
      key: "crm",
      displayName: "CRM",
      endpointUrl: "https://crm.example.invalid/mcp",
      auth: {
        mode: "oauth",
        authDomain: AUTH_DOMAIN,
        resourceIndicator: "https://crm.example.invalid",
      },
    },
  ],
};

function cognitoAuth(principalId: string | null): AuthResult {
  return {
    principalId,
    tenantId: null,
    email: null,
    emailVerified: true,
    authType: "cognito",
    agentId: null,
  };
}

function event(
  qs: Record<string, string>,
  host = "api.example.invalid",
): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/skills/plugin-oauth/authorize",
    requestContext: { http: { method: "GET" } },
    headers: { host },
    queryStringParameters: qs,
  } as unknown as APIGatewayProxyEventV2;
}

let store: InMemoryPluginEngineStore;
let installId: string;
let deps: PluginActivationDeps;

beforeEach(() => {
  vi.clearAllMocks();
  store = createInMemoryPluginEngineStore();
  const install = store.seedInstall({
    tenant_id: TENANT,
    plugin_key: "lastmile",
    pinned_version: "0.1.0",
    pinned_payload_sha256: "sha-0.1.0",
    state: "installed",
  });
  installId = install.id;
  store.seedComponent({
    plugin_install_id: installId,
    component_key: "crm",
    component_type: "mcp-server",
    state: "provisioned",
  });
  mockInstallRows.mockReturnValue([{ id: installId, tenant_id: TENANT }]);
  mockUserRows.mockReturnValue([{ id: CANONICAL_USER }]);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  deps = {
    store,
    secrets: createInMemoryPluginSecrets(),
    resolveVersion: async () => ({
      plugin: { pluginKey: "lastmile" },
      versionEntry: {
        version: "0.1.0",
        payloadSha256: "sha-0.1.0",
        payload,
      },
    }),
    fetchFn: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth-authorization-server")) {
        return json({
          authorization_endpoint: `${AUTH_DOMAIN}/authorize`,
          token_endpoint: `${AUTH_DOMAIN}/token`,
          registration_endpoint: `${AUTH_DOMAIN}/register`,
        });
      }
      if (url.endsWith("/register")) return json({ client_id: "client-1" });
      return json({ error: "unexpected" }, 500);
    }) as typeof fetch,
    stateSecret: () => "route-test-secret",
    apiBaseUrl: () => null,
    stage: () => "test",
    now: () => new Date(),
  };
});

describe("GET /api/skills/plugin-oauth/authorize", () => {
  it("binds the canonical auth principal — a caller-supplied userId query param is IGNORED", async () => {
    const res = await pluginOAuthAuthorize(
      event({
        pluginInstallId: installId,
        // Forged attempt: must have zero effect.
        userId: "attacker-chosen-user",
      }),
      cognitoAuth("cognito-sub-123"),
      deps,
    );
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers!.Location as string);
    const state = location.searchParams.get("state")!;
    const encoded = state.slice(0, state.lastIndexOf("."));
    const statePayload = JSON.parse(
      Buffer.from(encoded, "base64url").toString(),
    ) as { userId: string };
    expect(statePayload.userId).toBe(CANONICAL_USER);
    expect(statePayload.userId).not.toBe("attacker-chosen-user");
    // The callback redirect_uri derives from the request host.
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://api.example.invalid/api/skills/plugin-oauth/callback",
    );
  });

  it("403 when the auth context carries no principal (service-only callers)", async () => {
    const res = await pluginOAuthAuthorize(
      event({ pluginInstallId: installId }),
      cognitoAuth(null),
      deps,
    );
    expect(res.statusCode).toBe(403);
  });

  it("403 when the principal does not resolve to a user in the install's tenant", async () => {
    mockUserRows.mockReturnValue([]);
    const res = await pluginOAuthAuthorize(
      event({ pluginInstallId: installId }),
      cognitoAuth("foreign-sub"),
      deps,
    );
    expect(res.statusCode).toBe(403);
  });

  it("404 on unknown install; 400 without pluginInstallId; 400 on bad returnTo", async () => {
    mockInstallRows.mockReturnValue([]);
    expect(
      (
        await pluginOAuthAuthorize(
          event({ pluginInstallId: "nope" }),
          cognitoAuth("sub"),
          deps,
        )
      ).statusCode,
    ).toBe(404);
    mockInstallRows.mockReturnValue([{ id: installId, tenant_id: TENANT }]);
    expect(
      (await pluginOAuthAuthorize(event({}), cognitoAuth("sub"), deps))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await pluginOAuthAuthorize(
          event({
            pluginInstallId: installId,
            returnTo: "https://evil.example.com/phish",
          }),
          cognitoAuth("sub"),
          deps,
        )
      ).statusCode,
    ).toBe(400);
  });
});

describe("GET /api/skills/plugin-oauth/callback", () => {
  it("forged state redirects to the error landing without consuming any state field", async () => {
    const res = await pluginOAuthCallback(
      {
        rawPath: "/api/skills/plugin-oauth/callback",
        requestContext: { http: { method: "GET" } },
        headers: {},
        queryStringParameters: { state: "forged.deadbeef", code: "c" },
      } as unknown as APIGatewayProxyEventV2,
      deps,
    );
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers!.Location as string);
    expect(location.pathname).toBe("/settings/plugins"); // no pluginKey leaked
    expect(location.searchParams.get("pluginOAuth")).toBe("error");
    expect(location.searchParams.get("reason")).toBe("invalid_state_signature");
    expect(store.activations.size).toBe(0);
  });

  it("completion redirect targets /settings/plugins/{pluginKey}?pluginOAuth=...", () => {
    const success = pluginOAuthCompletionRedirect({
      ok: true,
      pluginKey: "lastmile",
      returnTo: null,
    });
    const successUrl = new URL(success);
    expect(successUrl.pathname).toBe("/settings/plugins/lastmile");
    expect(successUrl.searchParams.get("pluginOAuth")).toBe("success");
    expect(successUrl.searchParams.get("reason")).toBeNull();

    const denied = pluginOAuthCompletionRedirect({
      ok: false,
      reason: "denied",
      pluginKey: "lastmile",
      returnTo: null,
    });
    const deniedUrl = new URL(denied);
    expect(deniedUrl.pathname).toBe("/settings/plugins/lastmile");
    expect(deniedUrl.searchParams.get("pluginOAuth")).toBe("error");
    expect(deniedUrl.searchParams.get("reason")).toBe("denied");
  });

  it("an explicit returnTo from the signed state wins over the default landing", () => {
    const redirect = pluginOAuthCompletionRedirect({
      ok: true,
      pluginKey: "lastmile",
      returnTo: "https://app.thinkwork.ai/settings/plugins/lastmile?tab=conn",
    });
    const url = new URL(redirect);
    expect(url.searchParams.get("tab")).toBe("conn");
    expect(url.searchParams.get("pluginOAuth")).toBe("success");
  });
});
