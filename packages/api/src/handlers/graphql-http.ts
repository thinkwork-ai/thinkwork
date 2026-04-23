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

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { yoga } from "../graphql/server.js";

type ParsedOp = { operationName: string | null; operationType: string | null };

function parseOperation(body: string | undefined): ParsedOp {
	if (!body) return { operationName: null, operationType: null };
	try {
		const parsed = JSON.parse(body) as { operationName?: string; query?: string };
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
	const body = await response.text();
	const errorCode = response.status === 200 ? extractFirstErrorCode(body) : null;
	// Single structured log line. Non-200 responses and any coded
	// GraphQL error are flagged so an operator can grep for ok=false.
	const ok = response.status === 200 && errorCode === null;
	console.log(
		JSON.stringify({
			msg: "graphql.request",
			operationName: op.operationName,
			operationType: op.operationType,
			status: response.status,
			duration: Date.now() - started,
			errorCode,
			ok,
		}),
	);

	return {
		statusCode: response.status,
		headers: responseHeaders,
		body,
	};
}
