import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { verifyMcpAccessToken } from "./mcp-oauth.js";
import { handleCors, json } from "../lib/response.js";
import { getMemoryServices } from "../lib/memory/index.js";
import type { RecallResult, ThinkWorkMemoryRecord } from "../lib/memory/types.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";

const MAX_LIMIT = 50;

const TOOLS = [
	{
		name: "memory_recall",
		description: "Search the authenticated user's Thinkwork memory.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural-language memory search query.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: MAX_LIMIT,
					description: "Maximum number of memories to return.",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "memory_list",
		description: "List recent memories for the authenticated Thinkwork user.",
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "integer",
					minimum: 1,
					maximum: MAX_LIMIT,
					description: "Maximum number of memories to return.",
				},
			},
			additionalProperties: false,
		},
	},
] as const;

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	const resource = resourceUrl(event);
	const metadataUrl = `${issuerUrl(event)}/.well-known/oauth-protected-resource/mcp/user-memory`;
	const bearer = bearerToken(event);
	if (!bearer) return unauthorized(metadataUrl);

	let claims: Record<string, unknown>;
	try {
		claims = verifyMcpAccessToken(bearer, resource);
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
					tools: TOOLS,
				},
			});
		case "tools/call":
			return await handleToolCall(request, claims);
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

async function handleToolCall(
	request: JsonRpcRequest,
	claims: Record<string, unknown>,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = request.params as ToolCallParams | undefined;
	const toolName = typeof params?.name === "string" ? params.name : "";
	const args = isRecord(params?.arguments) ? params.arguments : {};

	if (!toolName) return jsonRpcError(request.id, -32602, "Tool name is required");
	if (!hasScope(claims, "memory:read")) return jsonRpcError(request.id, -32001, "memory:read scope is required");

	const owner = await resolveUserMemoryOwner(claims);
	if (!owner) {
		return jsonRpcError(request.id, -32002, "Could not resolve authenticated Thinkwork user");
	}

	switch (toolName) {
		case "memory_recall": {
			const query = stringArg(args.query);
			if (!query) return jsonRpcError(request.id, -32602, "query is required");
			const limit = limitArg(args.limit);
			const results = await getMemoryServices().recall.recall({
				...owner,
				query,
				...(limit ? { limit } : {}),
			});
			return jsonRpcResult(request.id, {
				content: [{ type: "text", text: formatRecallResults(results) }],
				structuredContent: {
					memories: results.map(formatRecallResult),
				},
			});
		}
		case "memory_list": {
			const limit = limitArg(args.limit);
			const records = await getMemoryServices().inspect.inspect({
				...owner,
				...(limit ? { limit } : {}),
			});
			return jsonRpcResult(request.id, {
				content: [{ type: "text", text: formatMemoryRecords(records) }],
				structuredContent: {
					memories: records.map(formatMemoryRecord),
				},
			});
		}
		default:
			return jsonRpcError(request.id, -32601, `Unknown tool: ${toolName}`);
	}
}

async function resolveUserMemoryOwner(
	claims: Record<string, unknown>,
): Promise<{ tenantId: string; ownerType: "user"; ownerId: string } | null> {
	const claimedUserId = stringClaim(claims.user_id) ?? stringClaim(claims["custom:user_id"]);
	const claimedTenantId = stringClaim(claims.tenant_id) ?? stringClaim(claims["custom:tenant_id"]);
	if (claimedUserId && claimedTenantId) {
		return { tenantId: claimedTenantId, ownerType: "user", ownerId: claimedUserId };
	}

	const sub = stringClaim(claims.sub);
	if (!sub) return null;
	const resolved = await resolveCallerFromAuth({
		authType: "cognito",
		principalId: sub,
		email: stringClaim(claims.email) ?? null,
		tenantId: claimedTenantId ?? null,
		agentId: null,
	});
	const userId = claimedUserId ?? resolved.userId;
	const tenantId = claimedTenantId ?? resolved.tenantId;
	if (!userId || !tenantId) return null;
	return { tenantId, ownerType: "user", ownerId: userId };
}

function formatRecallResults(results: RecallResult[]): string {
	if (results.length === 0) return "No matching memories found.";
	return JSON.stringify(results.map(formatRecallResult), null, 2);
}

function formatMemoryRecords(records: ThinkWorkMemoryRecord[]): string {
	if (records.length === 0) return "No memories found.";
	return JSON.stringify(records.map(formatMemoryRecord), null, 2);
}

function formatRecallResult(result: RecallResult): Record<string, unknown> {
	return {
		...formatMemoryRecord(result.record),
		score: result.score,
		whyRecalled: result.whyRecalled,
		backend: result.backend,
	};
}

function formatMemoryRecord(record: ThinkWorkMemoryRecord): Record<string, unknown> {
	return {
		id: record.id,
		tenantId: record.tenantId,
		ownerType: record.ownerType,
		ownerId: record.ownerId,
		kind: record.kind,
		sourceType: record.sourceType,
		strategy: record.strategy,
		status: record.status,
		text: record.content.text,
		summary: record.content.summary,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		metadata: record.metadata,
	};
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: Record<string, unknown>) {
	return json({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
	return json({ jsonrpc: "2.0", id, error: { code, message } });
}

type JsonRpcRequest = {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
};

type ToolCallParams = {
	name?: unknown;
	arguments?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringClaim(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function hasScope(claims: Record<string, unknown>, scope: string): boolean {
	return stringClaim(claims.scope)?.split(/\s+/).includes(scope) ?? false;
}

function stringArg(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function limitArg(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(numeric) || numeric < 1) return undefined;
	return Math.min(numeric, MAX_LIMIT);
}

function resourceUrl(event: APIGatewayProxyEventV2): string {
	return `${issuerUrl(event)}/mcp/user-memory`;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
	const proto = event.headers["x-forwarded-proto"] || "https";
	const host = event.headers.host || event.requestContext.domainName;
	return `${proto}://${host}`;
}
