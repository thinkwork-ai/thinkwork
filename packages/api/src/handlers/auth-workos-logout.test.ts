import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const { mockAuthenticate, mockSecretsSend } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSecretsSend: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  GetSecretValueCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  SecretsManagerClient: vi.fn(() => ({ send: mockSecretsSend })),
}));

import {
  __resetWorkosLogoutCacheForTest,
  findWorkosUserId,
  handler,
} from "./auth-workos-logout";

function event(token = makeJwt({})): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: "POST" } },
    headers: { authorization: `Bearer ${token}` },
  } as unknown as APIGatewayProxyEventV2;
}

function makeJwt(payload: object): string {
  return ["header", base64Url(payload), "signature"].join(".");
}

function base64Url(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetWorkosLogoutCacheForTest();
  mockAuthenticate.mockReset();
  mockSecretsSend.mockReset();
  mockAuthenticate.mockResolvedValue({
    principalId: "cognito-sub",
    tenantId: "tenant-1",
    email: "eric@example.com",
    emailVerified: true,
    authType: "cognito",
    agentId: null,
  });
});

describe("findWorkosUserId", () => {
  it("prefers a named WorkOS identity from Cognito claims", () => {
    expect(
      findWorkosUserId({
        identities: [
          { providerName: "Google", providerType: "Google", userId: "123" },
          {
            providerName: "WorkOSAuth",
            providerType: "OIDC",
            userId: "user_01KVDYR6GCPSJ1MP6YAG1G5YE0",
          },
        ],
      }),
    ).toBe("user_01KVDYR6GCPSJ1MP6YAG1G5YE0");
  });

  it("supports Cognito's stringified identities claim", () => {
    expect(
      findWorkosUserId({
        identities: JSON.stringify([
          {
            providerName: "WorkOSAuthU1",
            providerType: "OIDC",
            userId: "user_abc",
          },
        ]),
      }),
    ).toBe("user_abc");
  });
});

describe("auth-workos-logout handler", () => {
  it("revokes each active WorkOS session for the signed-in Cognito identity", async () => {
    vi.stubEnv("WORKOS_API_KEY", "sk_test_workos");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "sess_1" }, { id: "sess_2" }],
          list_metadata: {},
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [
            {
              providerName: "WorkOSAuth",
              providerType: "OIDC",
              userId: "user_01KVDYR6GCPSJ1MP6YAG1G5YE0",
            },
          ],
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      revoked: {
        revokedAuthorizedApplications: 0,
        revokedSessions: 2,
      },
      workosUserId: "user_01KVDYR6GCPSJ1MP6YAG1G5YE0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.workos.com/user_management/users/user_01KVDYR6GCPSJ1MP6YAG1G5YE0/sessions?order=desc&limit=100",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.workos.com/user_management/sessions/revoke",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ session_id: "sess_1" }),
    });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer sk_test_workos",
    );
  });

  it("returns success without calling WorkOS when the JWT is not a WorkOS login", async () => {
    vi.stubEnv("WORKOS_API_KEY", "sk_test_workos");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [{ providerName: "Google", userId: "google-user" }],
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      revoked: 0,
      reason: "no_workos_identity",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when no WorkOS API key is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [
            {
              providerName: "WorkOSAuth",
              providerType: "OIDC",
              userId: "user_abc",
            },
          ],
        }),
      ),
    );

    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can load the WorkOS API key from a JSON Secrets Manager value", async () => {
    vi.stubEnv("WORKOS_API_KEY_SECRET_ARN", "thinkwork/dev/workos/api-key");
    mockSecretsSend.mockResolvedValue({
      SecretString: JSON.stringify({ api_key: "sk_secret_value" }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], list_metadata: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [
            {
              providerName: "WorkOSAuth",
              providerType: "OIDC",
              userId: "user_abc",
            },
          ],
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer sk_secret_value",
    );
  });

  it("deletes the configured WorkOS Connect application authorization", async () => {
    vi.stubEnv("WORKOS_API_KEY", "sk_test_workos");
    vi.stubEnv(
      "WORKOS_CONNECT_APPLICATION_ID",
      "connect_app_01KVENEBCBASBQ5PGV6W5BPFVB",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], list_metadata: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [
            {
              providerName: "WorkOSAuth",
              providerType: "OIDC",
              userId: "user_abc",
            },
          ],
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      revoked: {
        revokedAuthorizedApplications: 1,
        revokedSessions: 0,
      },
      workosUserId: "user_abc",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.workos.com/user_management/users/user_abc/authorized_applications/connect_app_01KVENEBCBASBQ5PGV6W5BPFVB",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("treats a missing WorkOS Connect application authorization as already logged out", async () => {
    vi.stubEnv("WORKOS_API_KEY", "sk_test_workos");
    vi.stubEnv(
      "WORKOS_CONNECT_APPLICATION_ID",
      "connect_app_01KVENEBCBASBQ5PGV6W5BPFVB",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], list_metadata: {} }))
      .mockResolvedValueOnce(jsonResponse({ code: "entity_not_found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      event(
        makeJwt({
          identities: [
            {
              providerName: "WorkOSAuth",
              providerType: "OIDC",
              userId: "user_abc",
            },
          ],
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string).revoked).toEqual({
      revokedAuthorizedApplications: 0,
      revokedSessions: 0,
    });
  });

  it("requires Cognito authentication", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(event());
    expect(res.statusCode).toBe(401);
  });
});
