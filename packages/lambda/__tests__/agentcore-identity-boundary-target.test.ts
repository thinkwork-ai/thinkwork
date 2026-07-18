import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createProofOauthProviderHandler } from "../agentcore-proof-oauth-provider.js";
import {
  createIdentityBoundaryTargetHandler,
  handler as deployedTargetHandler,
} from "../agentcore-identity-boundary-target.js";

const ISSUER = "https://api.example.test/agentcore-proof/oauth";
const SECRET = "test-client-secret-that-is-long";
const NOW = 1_700_000_000;

function event(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  queryStringParameters?: Record<string, string>,
  body?: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers,
    queryStringParameters,
    body,
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

async function aliceAccessToken(): Promise<string> {
  let sequence = 0;
  const provider = createProofOauthProviderHandler({
    issuer: ISSUER,
    clientId: "client",
    clientSecret: SECRET,
    nowSeconds: () => NOW,
    randomToken: () => `random-${++sequence}`,
  });
  const authorize = await provider(
    event(
      "GET",
      "/agentcore-proof/oauth/authorize",
      {},
      {
        client_id: "client",
        redirect_uri: "https://identity.example.test/callback",
        response_type: "code",
        scope: "owner.read",
        state: "state",
        proof_owner: "alice",
      },
    ),
  );
  const code = new URL(authorize.headers?.location as string).searchParams.get(
    "code",
  )!;
  const token = await provider(
    event(
      "POST",
      "/agentcore-proof/oauth/token",
      {
        authorization: `Basic ${Buffer.from(`client:${SECRET}`).toString("base64")}`,
      },
      undefined,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://identity.example.test/callback",
      }).toString(),
    ),
  );
  return JSON.parse(token.body!).access_token;
}

describe("AgentCore identity boundary target", () => {
  afterEach(() => vi.unstubAllEnvs());

  const target = createIdentityBoundaryTargetHandler({
    issuer: ISSUER,
    audience: `${ISSUER}/target`,
    clientSecret: SECRET,
    allowedOwners: new Set(["alice", "bob"]),
    nowSeconds: () => NOW,
  });

  it("returns only the sanitized owner projection for a provider token", async () => {
    const response = await target(
      event(
        "GET",
        "/agentcore-proof/target/owner",
        { authorization: `Bearer ${await aliceAccessToken()}` },
        { requested_owner: "alice" },
      ),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toEqual({
      ownerAlias: "alice",
      harmlessValue: "fixture-alice",
    });
    expect(response.body).not.toMatch(/private|SECRET_SENTINEL/);
  });

  it("rejects direct turn tokens and caller identity overrides", async () => {
    const turnToken = await target(
      event(
        "GET",
        "/agentcore-proof/target/owner",
        { authorization: "Bearer not-a-provider-token" },
        { requested_owner: "alice" },
      ),
    );
    expect(turnToken.statusCode).toBe(401);

    const override = await target(
      event(
        "GET",
        "/agentcore-proof/target/owner",
        {
          authorization: `Bearer ${await aliceAccessToken()}`,
          "x-proof-owner": "bob",
        },
        { requested_owner: "alice" },
      ),
    );
    expect(override.statusCode).toBe(400);
  });

  it("denies a caller that asks for another credential owner", async () => {
    const response = await target(
      event(
        "GET",
        "/agentcore-proof/target/owner",
        { authorization: `Bearer ${await aliceAccessToken()}` },
        { requested_owner: "bob" },
      ),
    );
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body!)).toEqual({ error: "owner_mismatch" });
  });

  it("returns a sanitized mixed projection for the first proof owner", async () => {
    const response = await target(
      event(
        "GET",
        "/agentcore-proof/target/mixed",
        { authorization: `Bearer ${await aliceAccessToken()}` },
        { requested_owner: "alice" },
      ),
    );
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body!);
    expect(body).toMatchObject({
      ownerAlias: "alice",
      taskField: "approved-summary-alice",
      disclosure: {
        status: "confirmation_required",
        reasonCode: "unrelated_sensitive_fields_withheld",
      },
    });
    expect(body.disclosure.decisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toMatch(/private|SECRET_SENTINEL/);
  });

  it("fails closed when deployed proof secrets are missing", async () => {
    vi.stubEnv("AGENTCORE_PROOF_OAUTH_ISSUER", "");
    vi.stubEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET", "");
    await expect(
      deployedTargetHandler(event("GET", "/agentcore-proof/target/owner")),
    ).rejects.toThrow("AGENTCORE_PROOF_OAUTH_ISSUER is required");
  });
});
