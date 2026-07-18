import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createProofOauthProviderHandler,
  handler as deployedProviderHandler,
  proofOwnerAllowlistFromEnv,
  verifyProofProviderAccessToken,
} from "../agentcore-proof-oauth-provider.js";

const ISSUER = "https://api.example.test/agentcore-proof/oauth";
const CLIENT_ID = "thinkwork-proof";
const CLIENT_SECRET = "test-client-secret-that-is-long";
const NOW = 1_700_000_000;

function event(
  method: string,
  path: string,
  args: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: args.headers ?? {},
    queryStringParameters: args.query,
    body: args.body,
    isBase64Encoded: false,
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.test",
      domainPrefix: "api",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request",
      routeKey: "$default",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
  };
}

function handler() {
  let sequence = 0;
  return createProofOauthProviderHandler({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    nowSeconds: () => NOW,
    randomToken: () => `random-${++sequence}`,
  });
}

describe("AgentCore proof OAuth provider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("runs an authorization-code exchange and issues a distinct owner token", async () => {
    const invoke = handler();
    const authorization = await invoke(
      event("GET", "/agentcore-proof/oauth/authorize", {
        query: {
          client_id: CLIENT_ID,
          redirect_uri: "https://identity.example.test/callback",
          response_type: "code",
          scope: "owner.read",
          state: "state-1",
          proof_owner: "alice",
        },
      }),
    );
    expect(authorization.statusCode).toBe(302);
    const redirect = new URL(authorization.headers?.location as string);
    expect(redirect.searchParams.get("state")).toBe("state-1");

    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64",
    );
    const exchange = await invoke(
      event("POST", "/agentcore-proof/oauth/token", {
        headers: { authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: redirect.searchParams.get("code")!,
          redirect_uri: "https://identity.example.test/callback",
        }).toString(),
      }),
    );
    expect(exchange.statusCode).toBe(200);
    const body = JSON.parse(exchange.body!);
    expect(body).toMatchObject({
      expires_in: 300,
      scope: "owner.read",
      token_type: "Bearer",
    });
    expect(
      verifyProofProviderAccessToken(body.access_token, {
        issuer: ISSUER,
        audience: `${ISSUER}/target`,
        secret: CLIENT_SECRET,
        nowSeconds: NOW,
      }).sub,
    ).toBe("alice");
  });

  it("rejects unknown owners and invalid clients without reflecting secrets", async () => {
    const invoke = handler();
    const badOwner = await invoke(
      event("GET", "/agentcore-proof/oauth/authorize", {
        query: {
          client_id: CLIENT_ID,
          redirect_uri: "https://identity.example.test/callback",
          response_type: "code",
          scope: "owner.read",
          state: "state-1",
          proof_owner: "mallory",
        },
      }),
    );
    expect(badOwner.statusCode).toBe(400);

    const badClient = await invoke(
      event("POST", "/agentcore-proof/oauth/token", {
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: "wrong",
          code: "bad",
          redirect_uri: "https://identity.example.test/callback",
        }).toString(),
      }),
    );
    expect(badClient.statusCode).toBe(401);
    expect(badClient.body).not.toContain(CLIENT_SECRET);
  });

  it("exchanges a validated Harness subject through the OBO seam", async () => {
    const exchanged: Array<{ subjectToken: string; scope: string }> = [];
    const invoke = createProofOauthProviderHandler({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      nowSeconds: () => NOW,
      randomToken: () => "random",
      exchangeSubjectToken: async (subjectToken, scope) => {
        exchanged.push({ subjectToken, scope });
        return "signed-gateway-token";
      },
    });
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64",
    );
    const response = await invoke(
      event("POST", "/agentcore-proof/oauth/token", {
        headers: { authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: "harness-subject-token",
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          scope: "gateway:invoke",
        }).toString(),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toMatchObject({
      access_token: "signed-gateway-token",
      scope: "gateway:invoke",
      token_type: "Bearer",
    });
    expect(exchanged).toEqual([
      { subjectToken: "harness-subject-token", scope: "gateway:invoke" },
    ]);
  });

  it("supports the downstream OBO exchange without a second consent flow", async () => {
    const exchanged: Array<{ subjectToken: string; scope: string }> = [];
    const invoke = createProofOauthProviderHandler({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      nowSeconds: () => NOW,
      randomToken: () => "random",
      exchangeSubjectToken: async (subjectToken, scope) => {
        exchanged.push({ subjectToken, scope });
        return "signed-target-token";
      },
    });
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64",
    );
    const response = await invoke(
      event("POST", "/agentcore-proof/oauth/token", {
        headers: { authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: "gateway-subject-token",
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          scope: "owner.read",
        }).toString(),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toMatchObject({
      access_token: "signed-target-token",
      scope: "owner.read",
      token_type: "Bearer",
    });
    expect(exchanged).toEqual([
      { subjectToken: "gateway-subject-token", scope: "owner.read" },
    ]);
  });

  it("fails closed when deployed proof secrets are missing", async () => {
    vi.stubEnv("AGENTCORE_PROOF_OWNER_ALLOWLIST", "alice,bob");
    vi.stubEnv("AGENTCORE_PROOF_OAUTH_ISSUER", "");
    vi.stubEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET", "");
    await expect(
      deployedProviderHandler(event("POST", "/agentcore-proof/oauth/token")),
    ).rejects.toThrow("AGENTCORE_PROOF_OAUTH_ISSUER is required");
  });

  it("requires an explicit deployed exact-user allowlist", () => {
    expect(() => proofOwnerAllowlistFromEnv("")).toThrow(
      "AGENTCORE_PROOF_OWNER_ALLOWLIST is required",
    );
  });
});
