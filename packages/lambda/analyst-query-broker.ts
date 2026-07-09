/**
 * Analyst Query Broker — first-party MCP server (THINK-228 U3).
 *
 * Exposes one tool, `query`, over the same stateless
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
import { createHash, timingSafeEqual } from "node:crypto";
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
import {
  ANALYST_CALLER_CONTEXT_HEADER,
  verifyAnalystCallerContextHeader,
  type AnalystCallerContextPayload,
} from "./analyst-caller-context.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "thinkwork-analyst-query-broker";
const SERVER_VERSION = "0.1.0";

export const ANALYST_QUERY_TOOL = {
  name: "query",
  description:
    "Execute ONE read-only SQL statement (PostgreSQL SELECT / WITH) against the " +
    "registered data source. Consult the connection's SCHEMA.md before writing " +
    "SQL — only tables and columns listed there are granted. The result is an " +
    `envelope with the column schema, up to ${INLINE_ROW_CAP} preview rows, the ` +
    "total row count, per-column stats, and — for larger results — a result_file " +
    "reference that is landed into your sandbox for analysis with execute_code. " +
    "Prefer aggregated queries (GROUP BY) sized to fit charts and tables. " +
    "Multi-statement input, writes, and DDL are rejected. " +
    "Query budgets apply: a per-run cap and a per-tenant-day cap (every " +
    "attempt counts, including rejected ones). The result envelope reports " +
    "budget.remaining when a day cap is in force — pace your queries to it. " +
    "A budget-exhausted error is TERMINAL: stop querying and report findings " +
    "from the data you already have.",
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
  // Document-only key once THINK-230 added it to the runtime-config
  // document (config_env): read via getConfig ONLY (its env-wins merge still
  // honors the broker's per-handler env override). A direct process.env read
  // here would fail the runtime-config fixture gate.
  const secretArn = getConfig("ANALYST_BROKER_SECRET_ARN");
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

/**
 * Verified caller identity for this invocation (THINK-229 U2). Signed
 * caller contexts carry per-caller identity; the legacy tenant-wide
 * bearer maps to `legacy_bearer` and emits a structured marker so bearer
 * retirement is gated on observed-zero bearer traffic, not assumption.
 */
export interface BrokerCallerIdentity {
  tenantId: string;
  actorKind: "agent" | "delegation" | "system_refresh" | "legacy_bearer";
  agentId?: string;
  threadId?: string;
  refreshId?: string;
  policyClaims: Record<string, unknown>;
}

function logAuth(fields: Record<string, unknown>): void {
  // Structured auth audit (R6): identity evidence only — never header or
  // token material.
  console.log(JSON.stringify({ msg: "analyst-broker.auth", ...fields }));
}

function callerIdentityFromContext(
  payload: AnalystCallerContextPayload,
): BrokerCallerIdentity {
  return {
    tenantId: payload.tenantId,
    actorKind: payload.actor,
    ...(payload.agentId ? { agentId: payload.agentId } : {}),
    ...(payload.threadId ? { threadId: payload.threadId } : {}),
    ...(payload.refreshId ? { refreshId: payload.refreshId } : {}),
    policyClaims: payload.policyClaims,
  };
}

function readCapabilityPublicKey(): string | null {
  // Document-only key: read via getConfig ONLY (its env-wins merge still
  // honors a hand-set env var as an incident/test override — a direct
  // process.env read here would fail the runtime-config fixture gate).
  let value = "";
  try {
    value = getConfig("CAPABILITY_SIGNING_PUBLIC_KEY") || "";
  } catch {
    value = "";
  }
  if (!value.trim()) return null;
  // Terraform/SSM often carries PEMs with literal \n escapes.
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

interface QueryTrace {
  /** Verbatim SQL — ONLY under the signed retain_sql claim (U6/R16). */
  sql?: string;
  /** Default redacted shape (U6): hash + coarse shape + length. */
  sql_sha256?: string;
  sql_shape?: string;
  sql_length?: number;
  payload_schema_version: number;
  data_source: string;
  rows_returned: number;
  approx_bytes: number;
  duration_ms: number;
  truncated: boolean;
  result_file: string | null;
  outcome: "ok" | "rejected";
  error?: string;
  /** Verified caller identity (THINK-229 U2). */
  actor_kind: BrokerCallerIdentity["actorKind"];
  agent_id?: string;
  thread_id?: string;
  refresh_id?: string;
}

// ---------------------------------------------------------------------------
// Tenant-day budget (THINK-229 U4 / KTD6)
//
// The count is host/ledger-owned: the synchronous trace write to the
// compliance endpoint returns `tenantDayCount` (post-increment — includes
// the row just written), cached here per warm container. The broker
// blocks the NEXT query once the cap is reached. Residual overshoot is
// bounded by reserved concurrency (4): concurrent invocations can each
// pass the pre-check before any of their counts land — acceptable for a
// soft product budget, not a security boundary.
// ---------------------------------------------------------------------------

interface TenantBudgetState {
  dayKey: string;
  count: number;
  blockedEmitted: boolean;
}

const _budgetState = new Map<string, TenantBudgetState>();

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function budgetStateFor(tenantId: string): TenantBudgetState {
  const day = utcDayKey();
  const existing = _budgetState.get(tenantId);
  if (existing && existing.dayKey === day) return existing;
  const fresh: TenantBudgetState = {
    dayKey: day,
    count: 0,
    blockedEmitted: false,
  };
  _budgetState.set(tenantId, fresh);
  return fresh;
}

/** Test-only. */
export function _resetBudgetState(): void {
  _budgetState.clear();
}

/** Test-only: seed the ledger-derived count for one tenant. */
export function _seedBudgetState(tenantId: string, count: number): void {
  const state = budgetStateFor(tenantId);
  state.count = count;
}

function dayCapFromClaims(caller: BrokerCallerIdentity): number | null {
  const budgets = (caller.policyClaims as { budgets?: unknown }).budgets;
  if (!budgets || typeof budgets !== "object") return null;
  const cap = (budgets as { maxQueriesPerTenantDay?: unknown })
    .maxQueriesPerTenantDay;
  return typeof cap === "number" && Number.isFinite(cap) && cap > 0
    ? cap
    : null;
}

function retainSqlFromClaims(caller: BrokerCallerIdentity): boolean {
  return (caller.policyClaims as { retain_sql?: unknown }).retain_sql === true;
}

/**
 * Coarse SQL shape for the redacted audit payload (THINK-229 U6): leading
 * verb + the relation names already parsed by the EXPLAIN gate — no new
 * SQL parsing.
 */
export function sqlShapeFromExplain(sql: string, explainPlan: unknown): string {
  const verb = (sql.trim().split(/\s+/)[0] ?? "").toUpperCase() || "UNKNOWN";
  const relations = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record["Relation Name"] === "string") {
      relations.add(record["Relation Name"] as string);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(explainPlan);
  const list = [...relations].sort().join(",");
  return list ? `${verb} ${list}` : verb;
}

/**
 * The terminal (non-retryable) error shape (R14): distinct from the
 * verbatim retryable SQL rejection so the model stops instead of burning
 * budget on unfixable retries. The text is the anti-fabrication phrasing
 * that already works in AnalystQueryCapError.
 */
function terminalBudgetRejection(cap: number, observed: number) {
  return {
    stage: "policy",
    terminal: true,
    message:
      `Tenant-day query budget reached (${observed}/${cap} queries today). ` +
      "This is a policy limit, not a SQL error — retrying will not succeed. " +
      "Stop querying and report findings from the data you already have; " +
      "state clearly which questions could not be answered.",
  } as const;
}

async function emitComplianceEvent(input: {
  tenantId: string;
  eventType: string;
  action: string;
  outcome: string;
  resourceId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const apiUrl = getConfig("THINKWORK_API_URL");
  const authSecret = getApiAuthSecret();
  if (!apiUrl || !authSecret) {
    throw new Error(
      "analyst-query-broker: THINKWORK_API_URL / API auth secret unavailable — " +
        "cannot write the audit event.",
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
      tenantId: input.tenantId,
      actorUserId: "analyst-query-broker",
      actorType: "system",
      eventType: input.eventType,
      source: "lambda",
      action: input.action,
      outcome: input.outcome,
      resourceType: "data_source",
      resourceId: input.resourceId,
      payload: input.payload,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `analyst-query-broker: audit event write failed (HTTP ${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

async function emitQueryTrace(
  tenantId: string,
  trace: QueryTrace,
): Promise<void> {
  const result = await emitComplianceEvent({
    tenantId,
    eventType: "data.query_executed",
    action: "query",
    outcome: trace.outcome,
    resourceId: trace.data_source,
    payload: trace as unknown as Record<string, unknown>,
  });
  // KTD6: the endpoint counts the tenant-day ledger in the same
  // transaction as the insert (post-increment — includes this trace);
  // cache it so the NEXT query's pre-check sees it.
  const count = result?.tenantDayCount;
  if (typeof count === "number" && Number.isFinite(count)) {
    const state = budgetStateFor(tenantId);
    state.count = Math.max(state.count, count);
  }
}

// ---------------------------------------------------------------------------
// query
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
    /** THINK-229 U4 (R14): terminal errors must not be retried. */
    terminal?: boolean;
  };
}

async function runQuery(
  sql: string,
  caller: BrokerCallerIdentity,
): Promise<RunQueryOutcome> {
  const tenantId = caller.tenantId;
  const actorFields = {
    actor_kind: caller.actorKind,
    ...(caller.agentId ? { agent_id: caller.agentId } : {}),
    ...(caller.threadId ? { thread_id: caller.threadId } : {}),
    ...(caller.refreshId ? { refresh_id: caller.refreshId } : {}),
  };
  const retainSql = retainSqlFromClaims(caller);
  const sqlFields = (shape: string | null) =>
    retainSql
      ? { sql, payload_schema_version: 2 }
      : {
          sql_sha256: createHash("sha256").update(sql, "utf8").digest("hex"),
          ...(shape ? { sql_shape: shape } : {}),
          sql_length: sql.length,
          payload_schema_version: 2,
        };

  // THINK-229 U4 (R14/KTD6): tenant-day budget pre-check. The count is
  // ledger-derived (returned by the synchronous trace write); the cap
  // arrives ONLY via the signed policyClaims — no claims, no day cap
  // (phase-in: the claims flow once ANALYST_POLICY_SOURCE flips).
  // This applies to EVERY caller including system_refresh (R15 —
  // headless refresh shares the tenant cap).
  const dayCap = dayCapFromClaims(caller);
  if (dayCap !== null) {
    const state = budgetStateFor(tenantId);
    if (state.count >= dayCap) {
      if (!state.blockedEmitted) {
        state.blockedEmitted = true;
        await emitComplianceEvent({
          tenantId,
          eventType: "policy.blocked",
          action: "budget_check",
          outcome: "blocked",
          resourceId: DATA_SOURCE_SLUG,
          payload: {
            cap_kind: "max_queries_per_tenant_day",
            limit: dayCap,
            observed: state.count,
            data_source: DATA_SOURCE_SLUG,
            ...actorFields,
          },
        }).catch((err) => {
          // The block itself must not depend on the event landing — but
          // let the next blocked call retry the emission.
          state.blockedEmitted = false;
          console.error(
            "analyst-query-broker: policy.blocked emission failed",
            err,
          );
        });
      }
      return { rejection: terminalBudgetRejection(dayCap, state.count) };
    }
  }

  const client = await getAnalystReaderClient();
  let result;
  try {
    result = await gateAndExecute(client, sql, {
      // THINK-234: scope every query to the VERIFIED caller tenant via the
      // gate's row-level GUC. tenantId was validated non-empty at auth (both
      // the signed-context and legacy-bearer paths carry one).
      tenantId,
      maxRows: envInt("ANALYST_MAX_FETCH_ROWS", DEFAULT_MAX_FETCH_ROWS),
      maxBytes: envInt("ANALYST_MAX_FETCH_BYTES", DEFAULT_MAX_FETCH_BYTES),
    });
  } catch (err) {
    if (err instanceof AnalystQueryRejection) {
      // Rejections are traced too — the R8 stream records attempts, and
      // the in-loop cap (U6) counts them against the delegation.
      await emitQueryTrace(tenantId, {
        ...sqlFields(null),
        data_source: DATA_SOURCE_SLUG,
        rows_returned: 0,
        approx_bytes: 0,
        duration_ms: 0,
        truncated: false,
        result_file: null,
        outcome: "rejected",
        error: err.message,
        ...actorFields,
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

  const preEnvelope = buildEnvelope({
    columns: result.columns,
    rows: result.rows,
    fetchExhausted: result.fetchExhausted,
    resultFile,
  });

  await emitQueryTrace(tenantId, {
    ...sqlFields(sqlShapeFromExplain(sql, result.explainPlan)),
    data_source: DATA_SOURCE_SLUG,
    rows_returned: preEnvelope.row_count,
    approx_bytes: preEnvelope.approx_bytes,
    duration_ms: result.durationMs,
    truncated: preEnvelope.truncated,
    result_file: preEnvelope.result_file,
    outcome: "ok",
    ...actorFields,
  });

  // Budget view AFTER the trace write so `remaining` reflects the
  // post-increment count that included this query (R13).
  if (dayCap !== null) {
    const state = budgetStateFor(tenantId);
    preEnvelope.budget = {
      remaining: Math.max(0, dayCap - state.count),
      limit: dayCap,
    };
  }

  return { envelope: preEnvelope };
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  req: JsonRpcRequest,
  caller: BrokerCallerIdentity,
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
                name: ANALYST_QUERY_TOOL.name,
                description: ANALYST_QUERY_TOOL.description,
                inputSchema: ANALYST_QUERY_TOOL.inputSchema,
              },
            ],
          },
        };

      case "tools/call": {
        const params = req.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        if (params?.name !== ANALYST_QUERY_TOOL.name) {
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
              message: "query requires a non-empty string argument: sql",
            },
          };
        }
        try {
          const outcome = await runQuery(sql, caller);
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

  // THINK-229 U2 auth order: signed caller context if present -> verify
  // or 401 (never fall through to the bearer on a broken context); else
  // legacy bearer (phase-in, marker-logged); else 401.
  const headers = event.headers ?? {};
  // API Gateway v2 lowercases header names.
  const contextHeader = headers[ANALYST_CALLER_CONTEXT_HEADER];
  let caller: BrokerCallerIdentity;
  if (contextHeader) {
    const publicKeyPem = readCapabilityPublicKey();
    if (!publicKeyPem) {
      console.error(
        "analyst-query-broker: CAPABILITY_SIGNING_PUBLIC_KEY unavailable — cannot verify caller contexts",
      );
      return httpJson(500, { error: "Caller-context verifier unavailable" });
    }
    const verified = verifyAnalystCallerContextHeader({
      headerValue: contextHeader,
      requestBody: event.body ?? "",
      publicKeyPem,
      nowMs: Date.now(),
    });
    if (!verified.ok) {
      logAuth({
        mode: "caller_context",
        outcome: "rejected",
        reason: verified.reason,
      });
      return httpJson(401, { error: "Unauthorized" });
    }
    caller = callerIdentityFromContext(verified.payload);
    logAuth({
      mode: "caller_context",
      outcome: "ok",
      actor: caller.actorKind,
      tenant: caller.tenantId,
    });
  } else {
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
    caller = {
      tenantId: credential.tenantId,
      actorKind: "legacy_bearer",
      policyClaims: {},
    };
    // Bearer-retirement gate (R5): observed-zero traffic on this marker,
    // not assumption.
    logAuth({ mode: "legacy_bearer", outcome: "ok", tenant: caller.tenantId });
  }

  // THINK-234: both auth paths must carry a tenant to row-scope the query.
  // Fail closed here — never dispatch a query that could run unscoped (the
  // gate re-validates the UUID shape, but reject a missing tenant at the
  // auth boundary rather than as a per-query tool error).
  if (!caller.tenantId) {
    logAuth({ mode: "tenant_scope", outcome: "rejected", reason: "no_tenant" });
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
        (parsed as JsonRpcRequest[]).map((r) => dispatch(r, caller)),
      )
    ).filter((r): r is JsonRpcResponse => r !== null);
    return httpJson(200, responses);
  }

  const response = await dispatch(parsed as JsonRpcRequest, caller);
  if (response === null) {
    return { statusCode: 202, body: "" };
  }
  return httpJson(200, response);
}
