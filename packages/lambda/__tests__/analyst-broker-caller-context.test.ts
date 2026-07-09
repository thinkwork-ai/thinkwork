/**
 * Broker auth-layer tests for the signed caller context (THINK-229 U2).
 *
 * No database needed: tools/list and the 401 matrix exercise the auth
 * seam only. Auth order under test: context if present → verify or 401
 * (a broken context NEVER falls through to the bearer); else legacy
 * bearer (phase-in + structured marker); else 401.
 */

import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ANALYST_CALLER_CONTEXT_HEADER,
  ANALYST_CALLER_CONTEXT_KIND,
  canonicalizeCallerContextPayload,
  encodeAnalystCallerContextHeader,
  hashAnalystRequestBody,
  type AnalystCallerContextPayload,
} from "../analyst-caller-context.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: wrongKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;

const TEST_TOKEN = "analyst-broker-test-token";
const TEST_TENANT = "11111111-1111-7111-8111-111111111111";

function signedHeader(
  payload: AnalystCallerContextPayload,
  key = privateKey,
): string {
  const canonical = canonicalizeCallerContextPayload(payload);
  return encodeAnalystCallerContextHeader({
    payload,
    signature: {
      version: 1,
      algorithm: "Ed25519",
      payloadHash: createHash("sha256").update(canonical).digest("hex"),
      signature: edSign(null, Buffer.from(canonical, "utf8"), key).toString(
        "hex",
      ),
      signed_by: "api-dispatch",
      signed_at: new Date().toISOString(),
    },
  });
}

function contextPayload(
  overrides: Partial<AnalystCallerContextPayload> = {},
): AnalystCallerContextPayload {
  const now = Date.now();
  return {
    kind: ANALYST_CALLER_CONTEXT_KIND,
    tenantId: TEST_TENANT,
    actor: "agent",
    agentId: "agent-1",
    policyClaims: {},
    iat: now,
    exp: now + 60_000,
    ...overrides,
  };
}

function makeEvent(input: {
  body: unknown;
  bearer?: string;
  contextHeader?: string;
}): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = {};
  if (input.bearer) headers.authorization = `Bearer ${input.bearer}`;
  if (input.contextHeader) {
    headers[ANALYST_CALLER_CONTEXT_HEADER] = input.contextHeader;
  }
  return {
    version: "2.0",
    routeKey: "POST /mcp/analyst",
    rawPath: "/mcp/analyst",
    rawQueryString: "",
    headers,
    requestContext: {
      http: { method: "POST", path: "/mcp/analyst" },
    } as APIGatewayProxyEventV2["requestContext"],
    body:
      typeof input.body === "string" ? input.body : JSON.stringify(input.body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

const LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };

describe("analyst-query-broker caller-context auth (THINK-229 U2)", () => {
  let handler: typeof import("../analyst-query-broker.js").handler;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.ANALYST_BROKER_TEST_TOKEN = TEST_TOKEN;
    process.env.ANALYST_BROKER_TEST_TENANT_ID = TEST_TENANT;
    process.env.CAPABILITY_SIGNING_PUBLIC_KEY = PUBLIC_PEM;
    handler = (await import("../analyst-query-broker.js")).handler;
  });

  afterAll(() => {
    delete process.env.ANALYST_BROKER_TEST_TOKEN;
    delete process.env.ANALYST_BROKER_TEST_TENANT_ID;
    delete process.env.CAPABILITY_SIGNING_PUBLIC_KEY;
  });

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  function authLogs(): Array<Record<string, unknown>> {
    return logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && entry.msg === "analyst-broker.auth",
      );
  }

  it("valid session context → 200; identity logged", async () => {
    const response = await handler(
      makeEvent({
        body: LIST_BODY,
        contextHeader: signedHeader(contextPayload()),
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(authLogs()).toEqual([
      expect.objectContaining({
        mode: "caller_context",
        outcome: "ok",
        actor: "agent",
        tenant: TEST_TENANT,
      }),
    ]);
  });

  it("valid request-bound refresh context → 200 against the exact body", async () => {
    const body = JSON.stringify(LIST_BODY);
    const response = await handler(
      makeEvent({
        body,
        contextHeader: signedHeader(
          contextPayload({
            actor: "system_refresh",
            refreshId: "artifact-1",
            bodyHash: hashAnalystRequestBody(body),
          }),
        ),
      }),
    );
    expect(response.statusCode).toBe(200);
  });

  it("tampered / wrong-key / expired / wrong-body contexts → 401 with uniform text", async () => {
    const cases = [
      signedHeader(contextPayload(), wrongKey),
      signedHeader(contextPayload({ exp: Date.now() - 1000 })),
      signedHeader(
        contextPayload({
          actor: "system_refresh",
          bodyHash: hashAnalystRequestBody("some other body"),
        }),
      ),
      "garbage-header",
    ];
    for (const contextHeader of cases) {
      const response = await handler(
        makeEvent({ body: LIST_BODY, contextHeader }),
      );
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe(JSON.stringify({ error: "Unauthorized" }));
    }
  });

  it("a broken context NEVER falls through to a valid bearer", async () => {
    const response = await handler(
      makeEvent({
        body: LIST_BODY,
        bearer: TEST_TOKEN,
        contextHeader: signedHeader(contextPayload(), wrongKey),
      }),
    );
    expect(response.statusCode).toBe(401);
  });

  it("legacy bearer only → still accepted (phase-in) with the retirement marker logged", async () => {
    const response = await handler(
      makeEvent({ body: LIST_BODY, bearer: TEST_TOKEN }),
    );
    expect(response.statusCode).toBe(200);
    expect(authLogs()).toEqual([
      expect.objectContaining({ mode: "legacy_bearer", outcome: "ok" }),
    ]);
  });

  it("neither context nor bearer → 401", async () => {
    const response = await handler(makeEvent({ body: LIST_BODY }));
    expect(response.statusCode).toBe(401);
  });

  it("context present but verifier key unavailable → 500, never an auth bypass", async () => {
    const saved = process.env.CAPABILITY_SIGNING_PUBLIC_KEY;
    delete process.env.CAPABILITY_SIGNING_PUBLIC_KEY;
    try {
      const response = await handler(
        makeEvent({
          body: LIST_BODY,
          contextHeader: signedHeader(contextPayload()),
        }),
      );
      expect(response.statusCode).toBe(500);
    } finally {
      process.env.CAPABILITY_SIGNING_PUBLIC_KEY = saved;
    }
  });
});
