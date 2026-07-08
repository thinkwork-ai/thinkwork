/**
 * Analyst Query Broker — first-party MCP server (THINK-228 U3).
 *
 * Exposes one tool, `run_query`, over the same stateless
 * Streamable-HTTP-style transport as admin-ops-mcp.ts (hand-rolled
 * JSON-RPC: initialize / tools/list / tools/call / ping — one POST, one
 * response, no session state). Mounted at POST /mcp/analyst; registered
 * per-tenant as an approved `tenant_mcp_servers` row by
 * scripts/provision-analyst-connector.mts (U4).
 *
 * Security posture (plan KTD7/KTD8 + assumptions):
 *   - SQL executes ONLY as the hardened `analyst_reader` role
 *     (SELECT-only grants, read-only default transaction mode, role-level
 *     statement timeout). The platform writer credential in the shared
 *     handler env is deliberately never used here.
 *   - Single-statement enforcement is wire-level: EXPLAIN gate and
 *     execution both run via pg-cursor's extended-protocol Parse
 *     (see analyst-query-gate.ts).
 *   - Caller auth is the tenant-wide broker service credential
 *     (ANALYST_BROKER_SECRET_ARN, JSON {token, tenantId}) presented as
 *     Bearer. Accepted dev-only risk: this is defense-in-depth behind
 *     network/IAM reachability, not per-caller identity — see the plan's
 *     static-secret assumption before reusing this pattern for external
 *     Postgres.
 *   - R8: every executed query emits a `data.query_executed` compliance
 *     audit event via POST /api/compliance/events (RequestResponse,
 *     surfaced — a query whose audit trace cannot be written returns an
 *     error, because the trace is the compensating control for the
 *     static-secret risk).
 *
 * The per-delegation query cap is NOT here — it lives in the delegation
 * loop (KTD3, U6). The broker owns per-query bounds only.
 */

import { getConfig, getApiAuthSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { timingSafeEqual } from "node:crypto";
import { uuidv7 } from "uuidv7";

import {
  buildEnvelope,
  toCsv,
  INLINE_ROW_CAP,
  type AnalystEnvelope,
} from "./analyst-envelope.js";
import {
  gateAndExecute,
  AnalystQueryRejection,
  DEFAULT_MAX_FETCH_BYTES,
  DEFAULT_MAX_FETCH_ROWS,
} from "./analyst-query-gate.js";
import { getAnalystReaderClient } from "./analyst-reader-db.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "thinkwork-analyst-query-broker";
const SERVER_VERSION = "0.1.0";

export const RUN_QUERY_TOOL = {
  name: "run_query",
  description:
    "Execute ONE read-only SQL statement (PostgreSQL SELECT / WITH) against the " +
    "registered data source. Consult the connection's SCHEMA.md before writing " +
    "SQL — only tables and columns listed there are granted. The result is an " +
    `envelope with the column schema, up to ${INLINE_ROW_CAP} preview rows, the ` +
    "total row count, per-column stats, and — for larger results — a result_file " +
    "reference that is landed into your sandbox for analysis with execute_code. " +
    "Prefer aggregated queries (GROUP BY) sized to fit charts and tables. " +
    "Multi-statement input, writes, and DDL are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single read-only SQL statement.",
      },
    },
    required: ["sql"],
    additionalProperties: false,
  },
} as const;

// ---------------------------------------------------------------------------
// JSON-RPC types (minimal — mirrors admin-ops-mcp.ts)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// ---------------------------------------------------------------------------
// Broker credential (Bearer auth + trace tenant scope)
// ---------------------------------------------------------------------------

interface BrokerCredential {
  token: string;
  tenantId: string;
}

let _credential: { value: BrokerCredential; fetchedAt: number } | undefined;
const CREDENTIAL_TTL_MS = 5 * 60 * 1000;

async function getBrokerCredential(): Promise<BrokerCredential> {
  if (_credential && Date.now() - _credential.fetchedAt < CREDENTIAL_TTL_MS) {
    return _credential.value;
  }
  // Test escape hatch — mirrors ANALYST_READER_DATABASE_URL in the DB module.
  const testToken = process.env.ANALYST_BROKER_TEST_TOKEN;
  if (testToken) {
    const value = {
      token: testToken,
      tenantId: process.env.ANALYST_BROKER_TEST_TENANT_ID ?? "",
    };
    _credential = { value, fetchedAt: Date.now() };
    return value;
  }
  const secretArn = process.env.ANALYST_BROKER_SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      "analyst-query-broker: ANALYST_BROKER_SECRET_ARN is unset — the broker " +
        "cannot authenticate callers. Wire it via Terraform and populate the " +
        "secret with scripts/provision-analyst-connector.mts.",
    );
  }
  const { SecretsManagerClient, GetSecretValueCommand } =
    await import("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const result = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const parsed = JSON.parse(
    result.SecretString || "{}",
  ) as Partial<BrokerCredential>;
  if (!parsed.token || !parsed.tenantId) {
    throw new Error(
      "analyst-query-broker: broker credential secret must be JSON {token, tenantId}",
    );
  }
  const value = { token: parsed.token, tenantId: parsed.tenantId };
  _credential = { value, fetchedAt: Date.now() };
  return value;
}

/** Test-only: drop the cached credential. */
export function _resetBrokerCredential(): void {
  _credential = undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const h = event.headers ?? {};
  const raw = h["authorization"] ?? h["Authorization"];
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// S3 staging (KTD2 file facet)
// ---------------------------------------------------------------------------

async function stageResultCsv(tenantId: string, csv: string): Promise<string> {
  const bucket = process.env.ANALYST_STAGING_BUCKET;
  if (!bucket) {
    throw new Error(
      "analyst-query-broker: ANALYST_STAGING_BUCKET is unset — cannot stage " +
        "results larger than the inline cap.",
    );
  }
  const prefix = process.env.ANALYST_STAGING_PREFIX || "analyst-staging";
  const key = `${prefix}/${tenantId}/${uuidv7()}.csv`;
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: csv,
      ContentType: "text/csv",
      ServerSideEncryption: "AES256",
    }),
  );
  return `s3://${bucket}/${key}`;
}

// ---------------------------------------------------------------------------
// R8 audit trace — POST /api/compliance/events (surfaced, never swallowed)
// ---------------------------------------------------------------------------

interface QueryTrace {
  sql: string;
  data_source: string;
  rows_returned: number;
  approx_bytes: number;
  duration_ms: number;
  truncated: boolean;
  result_file: string | null;
  outcome: "ok" | "rejected";
  error?: string;
}

async function emitQueryTrace(
  tenantId: string,
  trace: QueryTrace,
): Promise<void> {
  const apiUrl = getConfig("THINKWORK_API_URL");
  const authSecret = getApiAuthSecret();
  if (!apiUrl || !authSecret) {
    throw new Error(
      "analyst-query-broker: THINKWORK_API_URL / API auth secret unavailable — " +
        "cannot write the query audit trace (R8).",
    );
  }
  const eventId = uuidv7();
  const response = await fetch(`${apiUrl}/api/compliance/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
      "Idempotency-Key": eventId,
    },
    body: JSON.stringify({
      event_id: eventId,
      tenantId,
      actorUserId: "analyst-query-broker",
      actorType: "system",
      eventType: "data.query_executed",
      source: "lambda",
      action: "run_query",
      outcome: trace.outcome,
      resourceType: "data_source",
      resourceId: trace.data_source,
      payload: trace as unknown as Record<string, unknown>,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `analyst-query-broker: audit trace write failed (HTTP ${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// run_query
// ---------------------------------------------------------------------------

const DATA_SOURCE_SLUG = process.env.ANALYST_DATA_SOURCE_SLUG || "postgres-dev";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RunQueryOutcome {
  envelope?: AnalystEnvelope;
  /** Verbatim rejection for model self-repair (R6). */
  rejection?: {
    stage: string;
    message: string;
    code?: string;
    position?: string;
  };
}

async function runQuery(
  sql: string,
  tenantId: string,
): Promise<RunQueryOutcome> {
  const client = await getAnalystReaderClient();
  let result;
  try {
    result = await gateAndExecute(client, sql, {
      maxRows: envInt("ANALYST_MAX_FETCH_ROWS", DEFAULT_MAX_FETCH_ROWS),
      maxBytes: envInt("ANALYST_MAX_FETCH_BYTES", DEFAULT_MAX_FETCH_BYTES),
    });
  } catch (err) {
    if (err instanceof AnalystQueryRejection) {
      // Rejections are traced too — the R8 stream records attempts, and
      // the in-loop cap (U6) counts them against the delegation.
      await emitQueryTrace(tenantId, {
        sql,
        data_source: DATA_SOURCE_SLUG,
        rows_returned: 0,
        approx_bytes: 0,
        duration_ms: 0,
        truncated: false,
        result_file: null,
        outcome: "rejected",
        error: err.message,
      });
      return {
        rejection: {
          stage: err.stage,
          message: err.message,
          ...(err.code ? { code: err.code } : {}),
          ...(err.position ? { position: err.position } : {}),
        },
      };
    }
    throw err;
  }

  let resultFile: string | null = null;
  if (result.rows.length > INLINE_ROW_CAP) {
    resultFile = await stageResultCsv(
      tenantId,
      toCsv(result.columns, result.rows),
    );
  }

  const envelope = buildEnvelope({
    columns: result.columns,
    rows: result.rows,
    fetchExhausted: result.fetchExhausted,
    resultFile,
  });

  await emitQueryTrace(tenantId, {
    sql,
    data_source: DATA_SOURCE_SLUG,
    rows_returned: envelope.row_count,
    approx_bytes: JSON.stringify(envelope.rows).length,
    duration_ms: result.durationMs,
    truncated: envelope.truncated,
    result_file: envelope.result_file,
    outcome: "ok",
  });

  return { envelope };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  req: JsonRpcRequest,
  tenantId: string,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        };

      case "notifications/initialized":
        return null;

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: RUN_QUERY_TOOL.name,
                description: RUN_QUERY_TOOL.description,
                inputSchema: RUN_QUERY_TOOL.inputSchema,
              },
            ],
          },
        };

      case "tools/call": {
        const params = req.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        if (params?.name !== RUN_QUERY_TOOL.name) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JsonRpcErrorCode.MethodNotFound,
              message: `Unknown tool: ${params?.name ?? "<missing>"}`,
            },
          };
        }
        const sql = params.arguments?.sql;
        if (typeof sql !== "string" || !sql.trim()) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JsonRpcErrorCode.InvalidParams,
              message: "run_query requires a non-empty string argument: sql",
            },
          };
        }
        try {
          const outcome = await runQuery(sql, tenantId);
          if (outcome.rejection) {
            return {
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  { type: "text", text: JSON.stringify(outcome.rejection) },
                ],
                isError: true,
              },
            };
          }
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: JSON.stringify(outcome.envelope) },
              ],
              isError: false,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          };
        }
      }

      default:
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: JsonRpcErrorCode.MethodNotFound,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  } catch (err: unknown) {
    if (isNotification) return null;
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: JsonRpcErrorCode.InternalError, message },
    };
  }
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

function httpJson(
  status: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method !== "POST") {
    return httpJson(405, { error: "Method not allowed — POST only" });
  }

  const token = extractBearer(event);
  if (!token) {
    return httpJson(401, { error: "Unauthorized" });
  }
  let credential: BrokerCredential;
  try {
    credential = await getBrokerCredential();
  } catch (err) {
    console.error("analyst-query-broker: credential resolution failed", err);
    return httpJson(500, { error: "Broker credential unavailable" });
  }
  if (!constantTimeEquals(token, credential.token)) {
    return httpJson(401, { error: "Unauthorized" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body ?? "");
  } catch {
    return httpJson(200, {
      jsonrpc: "2.0",
      id: null,
      error: { code: JsonRpcErrorCode.ParseError, message: "Invalid JSON" },
    });
  }

  if (Array.isArray(parsed)) {
    const responses = (
      await Promise.all(
        (parsed as JsonRpcRequest[]).map((r) =>
          dispatch(r, credential.tenantId),
        ),
      )
    ).filter((r): r is JsonRpcResponse => r !== null);
    return httpJson(200, responses);
  }

  const response = await dispatch(
    parsed as JsonRpcRequest,
    credential.tenantId,
  );
  if (response === null) {
    return { statusCode: 202, body: "" };
  }
  return httpJson(200, response);
}
