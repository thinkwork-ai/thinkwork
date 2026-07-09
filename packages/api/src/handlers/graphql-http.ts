/**
 * GraphQL HTTP Handler for API Gateway
 *
 * Uses graphql-yoga for schema-driven execution with validation,
 * introspection, and proper error handling.
 *
 * AppSync is retained solely for WebSocket subscriptions.
 *
 * Per-request logging: emits one JSON line per GraphQL invocation with
 * `{operationName, duration, status, errorCode, ok}`. Without this, silent
 * ~5s pool-timeout failures (issue #470) are indistinguishable from
 * successful handler runs in CloudWatch — every line reads just
 * `START/END/REPORT` with no operation context. With this line in place, a
 * Logs Insights query on `errorCode != ""` or `duration > 2000` pinpoints
 * the failing operation on the first pass.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { yoga } from "../graphql/server.js";

type ParsedOp = { operationName: string | null; operationType: string | null };

function parseOperation(body: string | undefined): ParsedOp {
  if (!body) return { operationName: null, operationType: null };
  try {
    const parsed = JSON.parse(body) as {
      operationName?: string;
      query?: string;
    };
    const operationName = parsed.operationName ?? null;
    // Cheap operation-type detection without a GraphQL parser pass.
    const query = parsed.query ?? "";
    const match = query.match(/^\s*(query|mutation|subscription)\b/i);
    const operationType = match ? match[1].toLowerCase() : null;
    return { operationName, operationType };
  } catch {
    return { operationName: null, operationType: null };
  }
}

// Lambda rejects synchronous response payloads over 6,291,556 bytes with
// RequestEntityTooLarge — the invocation fails after the handler "succeeds"
// and clients see an empty response ("[Network] No Content"). Guard below
// this ceiling so an oversized GraphQL result degrades into a readable
// GraphQL error instead of a dead invocation. The limit applies to the
// JSON-serialized {statusCode, headers, body} return value, where every
// quote/backslash in the body gains an escape byte — so the guard must
// measure the JSON-escaped body, not raw body bytes (a quote-dense 5.7MB
// GraphQL body can serialize past the limit). The remaining headroom
// covers statusCode + headers.
export const MAX_RESPONSE_BYTES = 5_800_000;

export function escapedBodyBytes(body: string): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

export function oversizedResponseBody(
  operationName: string | null,
  byteLength: number,
): string {
  return JSON.stringify({
    errors: [
      {
        message: `Response for ${operationName ?? "operation"} is too large to return (${Math.round(byteLength / 1024)} KB). Try requesting fewer items.`,
        extensions: { code: "RESPONSE_TOO_LARGE", byteLength },
      },
    ],
  });
}

function extractFirstErrorCode(responseBody: string): string | null {
  try {
    const parsed = JSON.parse(responseBody) as {
      errors?: { extensions?: { code?: string } }[];
    };
    return parsed.errors?.[0]?.extensions?.code ?? null;
  } catch {
    return null;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { method } = event.requestContext.http;
  const url = `https://localhost/graphql`;
  const started = Date.now();
  const op = parseOperation(method === "POST" ? event.body : undefined);

  const request = new Request(url, {
    method,
    headers: event.headers as Record<string, string>,
    body: method === "POST" ? event.body : undefined,
  });

  const response = await yoga.fetch(request);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  let body = await response.text();
  let status = response.status;
  const byteLength = escapedBodyBytes(body);
  if (byteLength > MAX_RESPONSE_BYTES) {
    console.log(
      JSON.stringify({
        msg: "graphql.response_too_large",
        operationName: op.operationName,
        byteLength,
      }),
    );
    body = oversizedResponseBody(op.operationName, byteLength);
    status = 200;
    responseHeaders["content-type"] = "application/json; charset=utf-8";
    delete responseHeaders["content-length"];
    delete responseHeaders["content-encoding"];
  }
  const errorCode = status === 200 ? extractFirstErrorCode(body) : null;
  // Single structured log line. Non-200 responses and any coded
  // GraphQL error are flagged so an operator can grep for ok=false.
  const ok = status === 200 && errorCode === null;
  console.log(
    JSON.stringify({
      msg: "graphql.request",
      operationName: op.operationName,
      operationType: op.operationType,
      status,
      duration: Date.now() - started,
      errorCode,
      ok,
    }),
  );

  return {
    statusCode: status,
    headers: responseHeaders,
    body,
  };
}
