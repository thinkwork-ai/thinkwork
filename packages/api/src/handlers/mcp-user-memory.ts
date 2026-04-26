import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { verifyMcpAccessToken } from "./mcp-oauth.js";
import { handleCors, json } from "../lib/response.js";

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	const resource = resourceUrl(event);
	const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/user-memory`;
	const bearer = bearerToken(event);
	if (!bearer) return unauthorized(metadataUrl);

	try {
		verifyMcpAccessToken(bearer, resource);
	} catch (err) {
		const reason = err instanceof Error ? err.message : "unknown";
		console.warn("[mcp-user-memory] bearer verification failed", { reason });
		return unauthorized(metadataUrl);
	}

	if (event.requestContext.http.method !== "POST") {
		return json({ error: "method_not_allowed" }, 405);
	}

	const request = parseJsonRpc(event);
	if (!request) {
		return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
	}

	if (!("id" in request)) {
		return { statusCode: 202, headers: { "Content-Type": "application/json" }, body: "" };
	}

	switch (request.method) {
		case "initialize":
			return json({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "thinkwork-user-memory", version: "0.1.0" },
				},
			});
		case "tools/list":
			return json({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					tools: [],
				},
			});
		default:
			return json({
				jsonrpc: "2.0",
				id: request.id,
				error: {
					code: -32601,
					message: `Method not found: ${request.method}`,
				},
			});
	}
}

type JsonRpcRequest = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
};

function parseJsonRpc(event: APIGatewayProxyEventV2): JsonRpcRequest | null {
	if (!event.body) return null;
	try {
		const body = event.isBase64Encoded
			? Buffer.from(event.body, "base64").toString("utf8")
			: event.body;
		const parsed = JSON.parse(body) as JsonRpcRequest;
		if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") return null;
		return parsed;
	} catch {
		return null;
	}
}

function unauthorized(resourceMetadataUrl: string): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode: 401,
		headers: {
			"Content-Type": "application/json",
			"WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
		},
		body: JSON.stringify({ error: "unauthorized" }),
	};
}

function bearerToken(event: APIGatewayProxyEventV2): string | null {
	const header = event.headers.authorization || event.headers.Authorization;
	const match = header?.match(/^Bearer\s+(.+)$/i);
	return match?.[1] ?? null;
}

function resourceUrl(event: APIGatewayProxyEventV2): string {
	return `${issuerUrl(event)}/mcp/user-memory`;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
	const proto = event.headers["x-forwarded-proto"] || "https";
	const host = event.headers.host || event.requestContext.domainName;
	return `${proto}://${host}`;
}
