/**
 * Analyst query broker tests (THINK-228 U3).
 *
 * Two layers:
 *   - Always-on unit tests: envelope construction, CSV escaping, the KTD2
 *     value-invariant descriptor, transport auth.
 *   - Real-Postgres integration tests, gated on
 *     ANALYST_BROKER_TEST_DATABASE_URL (the AE4 protocol scenarios are
 *     explicitly required to run against a real server, not a mock).
 *     Locally: docker run --rm -e POSTGRES_PASSWORD=analyst \
 *       -e POSTGRES_DB=analyst_test -p 5439:5432 postgres:14
 *     then ANALYST_BROKER_TEST_DATABASE_URL=postgres://postgres:analyst@127.0.0.1:5439/analyst_test
 */

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
  buildEnvelope,
  columnsDescriptor,
  computeStats,
  pgTypeName,
  serializeCell,
  toCsv,
  INLINE_ROW_CAP,
  type AnalystEnvelope,
} from "../analyst-envelope.js";

const TEST_DB_URL = process.env.ANALYST_BROKER_TEST_DATABASE_URL;

// ---------------------------------------------------------------------------
// S3 mock — staging must not hit AWS in tests. Captures PutObject inputs.
// ---------------------------------------------------------------------------

const putObjectInputs: Array<Record<string, unknown>> = [];
vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    async send(command: PutObjectCommand) {
      putObjectInputs.push(command.input);
      return {};
    }
  }
  return { S3Client, PutObjectCommand };
});

// ---------------------------------------------------------------------------
// Unit tests (no DB)
// ---------------------------------------------------------------------------

describe("analyst envelope", () => {
  it("serializes cells deterministically and JSON-safe", () => {
    expect(serializeCell(null)).toBeNull();
    expect(serializeCell(undefined)).toBeNull();
    expect(serializeCell(42)).toBe(42);
    expect(serializeCell(true)).toBe(true);
    expect(serializeCell("x")).toBe("x");
    expect(serializeCell(new Date("2026-07-08T00:00:00Z"))).toBe(
      "2026-07-08T00:00:00.000Z",
    );
    expect(serializeCell(BigInt(7))).toBe(7);
    expect(serializeCell(BigInt("99999999999999999999"))).toBe(
      "99999999999999999999",
    );
    expect(serializeCell({ a: 1 })).toBe('{"a":1}');
  });

  it("escapes CSV per RFC 4180", () => {
    const csv = toCsv(
      [
        { name: "a", pg_type: "text" },
        { name: "b", pg_type: "text" },
      ],
      [
        ['he said "hi"', "one,two"],
        [null, "line\nbreak"],
      ],
    );
    expect(csv).toContain('"he said ""hi""","one,two"');
    expect(csv).toContain(',"line\nbreak"');
  });

  it("KTD2: descriptor is value-invariant — volume/null/staging churn does not change it", () => {
    const columns = [
      { name: "tenant", pg_type: "text" },
      { name: "n", pg_type: "int8" },
    ];
    const small = buildEnvelope({
      columns,
      rows: [["a", 1]],
      fetchExhausted: false,
      resultFile: null,
    });
    const bigWithNulls = buildEnvelope({
      columns,
      rows: Array.from({ length: INLINE_ROW_CAP + 50 }, (_, i) => [
        i % 3 === 0 ? null : `t${i}`,
        i,
      ]),
      fetchExhausted: false,
      resultFile: "s3://bucket/analyst-staging/tenant/x.csv",
    });
    expect(columnsDescriptor(small)).toEqual(columnsDescriptor(bigWithNulls));
    expect(JSON.stringify(columnsDescriptor(small))).toEqual(
      JSON.stringify(columnsDescriptor(bigWithNulls)),
    );
    // …while the raw envelopes differ in exactly the ways that must not
    // affect the bound shape.
    expect(small.result_file).toBeNull();
    expect(bigWithNulls.result_file).toBeTypeOf("string");
    expect(small.truncated).toBe(false);
    expect(bigWithNulls.truncated).toBe(true);
  });

  it("all envelope keys are always present, including null stats", () => {
    const envelope = buildEnvelope({
      columns: [{ name: "x", pg_type: "text" }],
      rows: [],
      fetchExhausted: false,
      resultFile: null,
    });
    expect(Object.keys(envelope).sort()).toEqual(
      [
        "approx_bytes",
        "columns",
        "result_file",
        "row_count",
        "rows",
        "stats",
        "truncated",
      ].sort(),
    );
    expect(envelope.stats.x).toEqual({ nulls: 0, min: null, max: null });
  });

  it("THINK-232: approx_bytes measures the inline preview and matches the trace value", () => {
    const columns = [{ name: "n", pg_type: "int8" }];
    const rows = Array.from({ length: INLINE_ROW_CAP + 25 }, (_, i) => [i]);
    const envelope = buildEnvelope({
      columns,
      rows,
      fetchExhausted: false,
      resultFile: null,
    });
    // Only the inline (capped) rows are measured — same as the broker trace's
    // JSON.stringify(preEnvelope.rows).length.
    expect(envelope.approx_bytes).toBe(JSON.stringify(envelope.rows).length);
    expect(envelope.rows.length).toBe(INLINE_ROW_CAP);
    // Empty result → the JSON of an empty array, "[]".
    const empty = buildEnvelope({
      columns,
      rows: [],
      fetchExhausted: false,
      resultFile: null,
    });
    expect(empty.approx_bytes).toBe(2);
  });

  it("computes per-column stats over all rows", () => {
    const stats = computeStats(
      [
        { name: "n", pg_type: "int4" },
        { name: "s", pg_type: "text" },
      ],
      [
        [5, "b"],
        [null, "a"],
        [2, null],
      ],
    );
    expect(stats.n).toEqual({ nulls: 1, min: 2, max: 5 });
    expect(stats.s).toEqual({ nulls: 1, min: "a", max: "b" });
  });

  it("maps common pg type OIDs and falls back deterministically", () => {
    expect(pgTypeName(20)).toBe("int8");
    expect(pgTypeName(2950)).toBe("uuid");
    expect(pgTypeName(999999)).toBe("oid:999999");
  });
});

// ---------------------------------------------------------------------------
// Transport + integration (real Postgres, env-gated)
// ---------------------------------------------------------------------------

function makeEvent(body: unknown, token?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /mcp/analyst",
    rawPath: "/mcp/analyst",
    rawQueryString: "",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    requestContext: {
      http: { method: "POST", path: "/mcp/analyst" },
    } as APIGatewayProxyEventV2["requestContext"],
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

interface RpcResult {
  statusCode: number;
  rpc: {
    result?: {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
      tools?: Array<{ name: string }>;
    };
    error?: { code: number; message: string };
  };
}

const TEST_TOKEN = "analyst-broker-test-token";
const TEST_TENANT = "11111111-1111-7111-8111-111111111111";

async function callBroker(
  handler: (
    e: APIGatewayProxyEventV2,
  ) => Promise<{ statusCode?: number; body?: string }>,
  method: string,
  params?: Record<string, unknown>,
  token: string | null = TEST_TOKEN, // null = send no Authorization header
): Promise<RpcResult> {
  const response = await handler(
    makeEvent({ jsonrpc: "2.0", id: 1, method, params }, token ?? undefined),
  );
  return {
    statusCode: response.statusCode ?? 0,
    rpc: response.body ? JSON.parse(response.body) : {},
  };
}

function envelopeFrom(result: RpcResult): AnalystEnvelope {
  const text = result.rpc.result?.content?.[0]?.text;
  if (!text) throw new Error("no content in RPC result");
  return JSON.parse(text) as AnalystEnvelope;
}

describe.skipIf(!TEST_DB_URL)("broker integration (real Postgres)", () => {
  // Env is set before the dynamic import so module-scope reads are safe.
  let handler: typeof import("../analyst-query-broker.js").handler;
  let resetCredential: typeof import("../analyst-query-broker.js")._resetBrokerCredential;
  let resetClient: typeof import("../analyst-reader-db.js")._resetAnalystReaderClient;
  let getClient: typeof import("../analyst-reader-db.js").getAnalystReaderClient;

  const traceCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let traceResponder: () => Response = () =>
    new Response(JSON.stringify({ dispatched: true }), { status: 200 });

  beforeAll(async () => {
    process.env.ANALYST_READER_DATABASE_URL = TEST_DB_URL;
    process.env.ANALYST_BROKER_TEST_TOKEN = TEST_TOKEN;
    process.env.ANALYST_BROKER_TEST_TENANT_ID = TEST_TENANT;
    process.env.ANALYST_STAGING_BUCKET = "test-staging-bucket";
    process.env.THINKWORK_API_URL = "https://api.test.invalid";
    process.env.API_AUTH_SECRET = "test-api-auth-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        traceCalls.push({
          url: String(url),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >,
        });
        return traceResponder();
      }),
    );

    const brokerModule = await import("../analyst-query-broker.js");
    handler = brokerModule.handler;
    resetCredential = brokerModule._resetBrokerCredential;
    const dbModule = await import("../analyst-reader-db.js");
    resetClient = dbModule._resetAnalystReaderClient;
    getClient = dbModule.getAnalystReaderClient;

    const client = await getClient();
    await client.query(`
      DROP TABLE IF EXISTS analyst_fixture;
      CREATE TABLE analyst_fixture (
        id serial PRIMARY KEY,
        tenant text NOT NULL,
        amount int,
        note text
      );
      INSERT INTO analyst_fixture (tenant, amount, note)
      SELECT 'tenant-' || (i % 3), i, CASE WHEN i % 5 = 0 THEN NULL ELSE 'n' || i END
      FROM generate_series(1, 500) AS i;
    `);
  });

  afterAll(async () => {
    await resetClient();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    traceCalls.length = 0;
    putObjectInputs.length = 0;
    traceResponder = () =>
      new Response(JSON.stringify({ dispatched: true }), { status: 200 });
  });

  it("rejects missing/wrong bearer with 401", async () => {
    const noAuth = await callBroker(handler, "tools/list", undefined, null);
    expect(noAuth.statusCode).toBe(401);
    const wrongAuth = await callBroker(
      handler,
      "tools/list",
      undefined,
      "nope",
    );
    expect(wrongAuth.statusCode).toBe(401);
  });

  it("initialize + tools/list expose exactly query", async () => {
    const init = await callBroker(handler, "initialize");
    expect(init.rpc.result).toMatchObject({
      serverInfo: { name: "thinkwork-analyst-query-broker" },
    });
    const list = await callBroker(handler, "tools/list");
    expect(list.rpc.result?.tools?.map((t) => t.name)).toEqual(["query"]);
  });

  it("AE1: unknown column fails at the EXPLAIN gate with the verbatim planner error", async () => {
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: "SELECT no_such_column FROM analyst_fixture" },
    });
    expect(result.rpc.result?.isError).toBe(true);
    const rejection = JSON.parse(result.rpc.result!.content![0]!.text);
    expect(rejection.stage).toBe("explain");
    expect(rejection.message).toContain(
      'column "no_such_column" does not exist',
    );
    // Rejected attempts are traced (they count against the delegation cap).
    expect(traceCalls).toHaveLength(1);
    expect(traceCalls[0]!.body.outcome).toBe("rejected");
  });

  it("AE4: a semicolon inside a string literal is NOT falsely rejected", async () => {
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: {
        sql: "SELECT count(*) AS n FROM analyst_fixture WHERE note = 'a;b'",
      },
    });
    expect(result.rpc.result?.isError).toBe(false);
    expect(envelopeFrom(result).row_count).toBe(1);
  });

  it("AE4: parameterless two-statement text is rejected server-side", async () => {
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: {
        sql: "SELECT count(*) FROM analyst_fixture; DELETE FROM analyst_fixture",
      },
    });
    expect(result.rpc.result?.isError).toBe(true);
    const rejection = JSON.parse(result.rpc.result!.content![0]!.text);
    expect(rejection.message).toContain(
      "cannot insert multiple commands into a prepared statement",
    );
    // No rows were deleted — the second statement never executed.
    const client = await getClient();
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM analyst_fixture",
    );
    expect(rows[0].n).toBe(500);
  });

  it("AE4: a dollar-quote/comment-hidden second statement is rejected", async () => {
    const hidden =
      "SELECT count(*) FROM analyst_fixture -- comment\n; DROP TABLE analyst_fixture";
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: hidden },
    });
    expect(result.rpc.result?.isError).toBe(true);
    const rejection = JSON.parse(result.rpc.result!.content![0]!.text);
    expect(rejection.message).toContain(
      "cannot insert multiple commands into a prepared statement",
    );
  });

  it("rejects utility statements (SET) at the gate", async () => {
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: "SET statement_timeout = '0'" },
    });
    expect(result.rpc.result?.isError).toBe(true);
    const rejection = JSON.parse(result.rpc.result!.content![0]!.text);
    expect(rejection.stage).toBe("explain");
  });

  it("happy path: aggregate query returns the full envelope with stats", async () => {
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: {
        sql: "SELECT tenant, count(*)::int AS n, sum(amount)::int AS total FROM analyst_fixture GROUP BY tenant ORDER BY tenant",
      },
    });
    expect(result.rpc.result?.isError).toBe(false);
    const envelope = envelopeFrom(result);
    expect(envelope.columns).toEqual([
      { name: "tenant", pg_type: "text" },
      { name: "n", pg_type: "int4" },
      { name: "total", pg_type: "int4" },
    ]);
    expect(envelope.row_count).toBe(3);
    expect(envelope.truncated).toBe(false);
    expect(envelope.result_file).toBeNull();
    expect(envelope.stats.n.nulls).toBe(0);
    expect(traceCalls).toHaveLength(1);
    expect(traceCalls[0]!.url).toBe(
      "https://api.test.invalid/api/compliance/events",
    );
    expect(traceCalls[0]!.body).toMatchObject({
      tenantId: TEST_TENANT,
      actorType: "system",
      eventType: "data.query_executed",
      outcome: "ok",
    });
  });

  it("KTD2: envelopes at different data volumes produce an identical bound descriptor", async () => {
    const sql =
      "SELECT tenant, note FROM analyst_fixture WHERE id <= $CAP ORDER BY id";
    const small = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: sql.replace("$CAP", "5") }, // no nulls in 1..5, no staging
    });
    const large = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: sql.replace("$CAP", "400") }, // nulls + S3 staging
    });
    const smallEnv = envelopeFrom(small);
    const largeEnv = envelopeFrom(large);
    expect(smallEnv.result_file).toBeNull();
    expect(largeEnv.result_file).toContain("s3://test-staging-bucket/");
    expect(JSON.stringify(columnsDescriptor(smallEnv))).toEqual(
      JSON.stringify(columnsDescriptor(largeEnv)),
    );
  });

  it("edge: exactly the inline cap → not truncated, no staging; one over → staged with SSE", async () => {
    const atCap = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: {
        sql: `SELECT id FROM analyst_fixture WHERE id <= ${INLINE_ROW_CAP} ORDER BY id`,
      },
    });
    const atCapEnv = envelopeFrom(atCap);
    expect(atCapEnv.row_count).toBe(INLINE_ROW_CAP);
    expect(atCapEnv.truncated).toBe(false);
    expect(atCapEnv.result_file).toBeNull();
    expect(putObjectInputs).toHaveLength(0);

    const overCap = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: {
        sql: `SELECT id FROM analyst_fixture WHERE id <= ${INLINE_ROW_CAP + 1} ORDER BY id`,
      },
    });
    const overCapEnv = envelopeFrom(overCap);
    expect(overCapEnv.row_count).toBe(INLINE_ROW_CAP + 1);
    expect(overCapEnv.rows).toHaveLength(INLINE_ROW_CAP);
    expect(overCapEnv.truncated).toBe(true);
    expect(overCapEnv.result_file).toContain("s3://test-staging-bucket/");
    expect(overCapEnv.result_file).toContain(TEST_TENANT);
    expect(putObjectInputs).toHaveLength(1);
    expect(putObjectInputs[0]).toMatchObject({
      Bucket: "test-staging-bucket",
      ServerSideEncryption: "AES256",
      ContentType: "text/csv",
    });
  });

  it("session isolation: a GUC set on the reused connection does not survive DISCARD ALL", async () => {
    const client = await getClient();
    await client.query("SET statement_timeout = '123s'");
    const before = await client.query("SHOW statement_timeout");
    expect(before.rows[0].statement_timeout).toBe("123s");

    await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: "SELECT 1 AS one" },
    });

    const after = await client.query("SHOW statement_timeout");
    expect(after.rows[0].statement_timeout).not.toBe("123s");
  });

  it("R8: an audit-trace write failure surfaces as a tool error (not swallowed)", async () => {
    traceResponder = () => new Response("boom", { status: 500 });
    const result = await callBroker(handler, "tools/call", {
      name: "query",
      arguments: { sql: "SELECT 1 AS one" },
    });
    expect(result.rpc.result?.isError).toBe(true);
    expect(result.rpc.result?.content?.[0]?.text).toContain(
      "audit event write failed",
    );
  });

  it("error path: DB unreachable returns a structured error, no crash", async () => {
    await resetClient();
    process.env.ANALYST_READER_DATABASE_URL =
      "postgres://nobody:nothing@127.0.0.1:59999/nope";
    try {
      const result = await callBroker(handler, "tools/call", {
        name: "query",
        arguments: { sql: "SELECT 1" },
      });
      expect(result.statusCode).toBe(200);
      expect(result.rpc.result?.isError).toBe(true);
    } finally {
      process.env.ANALYST_READER_DATABASE_URL = TEST_DB_URL;
      await resetClient();
    }
  });

  it("integration: mcpCallTool (packages/api wire client) round-trips tools/list and tools/call", async () => {
    // Bridge mcpCallTool's fetch to the Lambda handler — a REAL client
    // round-trip over the exact wire shapes, no network. mcpCallTool sends
    // initialize → notifications/initialized → the request, and tolerates
    // an absent session header (KTD1a's stateless-transport contract).
    interface McpTarget {
      url: string;
      token?: string;
    }
    interface McpClientModule {
      mcpListTools: (
        target: McpTarget,
        options?: { fetchImpl?: typeof fetch },
      ) => Promise<Array<{ name: string }>>;
      mcpCallTool: (
        target: McpTarget,
        name: string,
        args: Record<string, unknown>,
        options?: { fetchImpl?: typeof fetch },
      ) => Promise<{ isError: boolean; raw: unknown }>;
    }
    // Vitest-only alias (see vitest.config.ts); kept invisible to tsc so
    // packages/api's module graph stays out of this package's rootDir.
    // prettier-ignore
    // @ts-expect-error — unresolvable module specifier by design.
    const clientModule = (await import("virtual:api-mcp-client")) as McpClientModule;
    const { mcpListTools, mcpCallTool } = clientModule;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await handler(
        makeEvent(String(init?.body ?? ""), TEST_TOKEN),
      );
      return new Response(response.body ?? "", {
        status: response.statusCode ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const target = {
      url: "https://broker.test.invalid/mcp/analyst",
      token: TEST_TOKEN,
    };
    const tools = await mcpListTools(target, { fetchImpl });
    expect(tools.map((t) => t.name)).toEqual(["query"]);

    const call = await mcpCallTool(
      target,
      "query",
      { sql: "SELECT count(*)::int AS n FROM analyst_fixture" },
      { fetchImpl },
    );
    expect(call.isError).toBe(false);
    const raw = call.raw as { content: Array<{ text: string }> };
    const envelope = JSON.parse(raw.content[0]!.text) as AnalystEnvelope;
    expect(envelope.rows[0]![0]).toBe(500);
  });
});
