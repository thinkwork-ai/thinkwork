/**
 * Broker budget + redaction integration tests (THINK-229 U4/U6).
 *
 * Real-Postgres suite (same gating as analyst-query-broker.test.ts):
 *   docker run --rm -e POSTGRES_PASSWORD=analyst -e POSTGRES_DB=analyst_test \
 *     -p 5439:5432 postgres:14
 *   ANALYST_BROKER_TEST_DATABASE_URL=postgres://postgres:analyst@127.0.0.1:5439/analyst_test
 *
 * Covers: envelope budget view, tenant-day pre-check → terminal error +
 * single policy.blocked emission, hash-by-default SQL redaction with the
 * secret-literal leak assertion, and the signed retain_sql opt-in.
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
  type AnalystCallerContextPayload,
} from "../analyst-caller-context.js";

const TEST_DB_URL = process.env.ANALYST_BROKER_TEST_DATABASE_URL;
const TEST_TENANT = "22222222-2222-7222-8222-222222222222";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;

function signedContext(claims: Record<string, unknown>): string {
  const now = Date.now();
  const payload: AnalystCallerContextPayload = {
    kind: ANALYST_CALLER_CONTEXT_KIND,
    tenantId: TEST_TENANT,
    actor: "agent",
    agentId: "agent-budget-test",
    policyClaims: claims,
    iat: now,
    exp: now + 60_000,
  };
  const canonical = canonicalizeCallerContextPayload(payload);
  return encodeAnalystCallerContextHeader({
    payload,
    signature: {
      version: 1,
      algorithm: "Ed25519",
      payloadHash: createHash("sha256").update(canonical).digest("hex"),
      signature: edSign(
        null,
        Buffer.from(canonical, "utf8"),
        privateKey,
      ).toString("hex"),
      signed_by: "api-dispatch",
      signed_at: new Date().toISOString(),
    },
  });
}

function makeEvent(
  body: unknown,
  contextHeader: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /mcp/analyst",
    rawPath: "/mcp/analyst",
    rawQueryString: "",
    headers: { [ANALYST_CALLER_CONTEXT_HEADER]: contextHeader },
    requestContext: {
      http: { method: "POST", path: "/mcp/analyst" },
    } as APIGatewayProxyEventV2["requestContext"],
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function callQuery(
  handler: (
    e: APIGatewayProxyEventV2,
  ) => Promise<{ statusCode?: number; body?: string }>,
  sql: string,
  claims: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const response = await handler(
    makeEvent(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "query", arguments: { sql } },
      },
      signedContext(claims),
    ),
  );
  const rpc = JSON.parse(response.body ?? "{}");
  return {
    isError: rpc.result?.isError === true,
    text: rpc.result?.content?.[0]?.text ?? "",
  };
}

describe.skipIf(!TEST_DB_URL)(
  "broker budgets + SQL redaction (THINK-229 U4/U6)",
  () => {
    let handler: typeof import("../analyst-query-broker.js").handler;
    let resetBudget: typeof import("../analyst-query-broker.js")._resetBudgetState;
    let seedBudget: typeof import("../analyst-query-broker.js")._seedBudgetState;
    let resetClient: typeof import("../analyst-reader-db.js")._resetAnalystReaderClient;

    /** Every compliance-endpoint POST body, in order. */
    const complianceCalls: Array<Record<string, unknown>> = [];
    let dayCount = 0;

    beforeAll(async () => {
      process.env.ANALYST_READER_DATABASE_URL = TEST_DB_URL;
      process.env.CAPABILITY_SIGNING_PUBLIC_KEY = PUBLIC_PEM;
      process.env.ANALYST_STAGING_BUCKET = "test-staging-bucket";
      process.env.THINKWORK_API_URL = "https://api.test.invalid";
      process.env.API_AUTH_SECRET = "test-api-auth-secret";

      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          complianceCalls.push(body);
          if (body.eventType === "data.query_executed") dayCount += 1;
          return new Response(
            JSON.stringify({ dispatched: true, tenantDayCount: dayCount }),
            { status: 200 },
          );
        }),
      );

      const broker = await import("../analyst-query-broker.js");
      handler = broker.handler;
      resetBudget = broker._resetBudgetState;
      seedBudget = broker._seedBudgetState;
      resetClient = (await import("../analyst-reader-db.js"))
        ._resetAnalystReaderClient;
    });

    afterAll(async () => {
      await resetClient();
      vi.unstubAllGlobals();
      delete process.env.ANALYST_READER_DATABASE_URL;
      delete process.env.CAPABILITY_SIGNING_PUBLIC_KEY;
    });

    beforeEach(() => {
      complianceCalls.length = 0;
      dayCount = 0;
      resetBudget();
    });

    it("under cap: envelope carries budget {remaining, limit}; trace is hash-shaped with NO verbatim SQL", async () => {
      const claims = { budgets: { maxQueriesPerTenantDay: 5 } };
      const result = await callQuery(
        handler,
        "SELECT 'super-secret-literal-xK9' AS c",
        claims,
      );
      expect(result.isError).toBe(false);
      const envelope = JSON.parse(result.text);
      expect(envelope.budget).toEqual({ remaining: 4, limit: 5 });

      const trace = complianceCalls.find(
        (call) => call.eventType === "data.query_executed",
      )!;
      const payload = trace.payload as Record<string, unknown>;
      expect(payload.sql).toBeUndefined();
      expect(payload.sql_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.sql_shape).toMatch(/^SELECT/);
      expect(payload.sql_length).toBeGreaterThan(0);
      expect(payload.payload_schema_version).toBe(2);
      // Leak test (R16): the secret-shaped literal never serializes into
      // ANY emitted event field.
      expect(JSON.stringify(complianceCalls)).not.toContain(
        "super-secret-literal-xK9",
      );
      // Identity fields land (U2 gap closed by the schema extension).
      expect(payload.actor_kind).toBe("agent");
      expect(payload.agent_id).toBe("agent-budget-test");
    });

    it("retain_sql claim → verbatim SQL retained", async () => {
      const claims = { retain_sql: true };
      await callQuery(handler, "SELECT 42 AS answer", claims);
      const trace = complianceCalls.find(
        (call) => call.eventType === "data.query_executed",
      )!;
      const payload = trace.payload as Record<string, unknown>;
      expect(payload.sql).toBe("SELECT 42 AS answer");
      expect(payload.sql_sha256).toBeUndefined();
    });

    it("rejected attempts trace redacted and still count toward the budget", async () => {
      const claims = { budgets: { maxQueriesPerTenantDay: 5 } };
      const result = await callQuery(
        handler,
        "SELECT nope FROM does_not_exist_xyz",
        claims,
      );
      expect(result.isError).toBe(true);
      // Retryable shape — verbatim server error, NOT terminal.
      const rejection = JSON.parse(result.text);
      expect(rejection.terminal).toBeUndefined();
      const trace = complianceCalls.find(
        (call) => call.eventType === "data.query_executed",
      )!;
      const payload = trace.payload as Record<string, unknown>;
      expect(payload.outcome).toBe("rejected");
      expect(payload.sql).toBeUndefined();
      expect(payload.sql_sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("over the day cap: terminal error, policy.blocked emitted exactly once, no DB touch", async () => {
      seedBudget(TEST_TENANT, 3);
      const claims = { budgets: { maxQueriesPerTenantDay: 3 } };

      const first = await callQuery(handler, "SELECT 1", claims);
      expect(first.isError).toBe(true);
      const rejection = JSON.parse(first.text);
      expect(rejection).toMatchObject({ stage: "policy", terminal: true });
      expect(rejection.message).toContain("Stop querying");

      const second = await callQuery(handler, "SELECT 2", claims);
      expect(JSON.parse(second.text).terminal).toBe(true);

      const blocked = complianceCalls.filter(
        (call) => call.eventType === "policy.blocked",
      );
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.payload).toMatchObject({
        cap_kind: "max_queries_per_tenant_day",
        limit: 3,
        observed: 3,
        actor_kind: "agent",
      });
      // Blocked calls never reach the ledger as query traces.
      expect(
        complianceCalls.filter(
          (call) => call.eventType === "data.query_executed",
        ),
      ).toHaveLength(0);
    });

    it("no claims (legacy/pre-flip) → no day cap, no budget in envelope", async () => {
      const result = await callQuery(handler, "SELECT 7 AS n", {});
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.text).budget).toBeUndefined();
    });
  },
);
