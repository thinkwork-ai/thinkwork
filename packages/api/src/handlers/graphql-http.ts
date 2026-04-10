/**
 * GraphQL HTTP Handler for API Gateway
 *
 * Uses graphql-yoga for schema-driven execution with validation,
 * introspection, and proper error handling.
 *
 * AppSync is retained solely for WebSocket subscriptions.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { yoga } from "../graphql/server.js";

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const { method } = event.requestContext.http;
	const url = `https://localhost/graphql`;

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

	return {
		statusCode: response.status,
		headers: responseHeaders,
		body: await response.text(),
	};
}
