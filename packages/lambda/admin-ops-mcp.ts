/**
 * Admin-Ops MCP Server — Lambda handler.
 *
 * Exposes Thinkwork admin operations as MCP tools over a stateless
 * Streamable-HTTP-style transport. Each POST is one JSON-RPC request;
 * the Lambda returns a single JSON-RPC response body. No session state.
 *
 * Wire protocol: https://spec.modelcontextprotocol.io/specification/basic/
 *
 * Supported methods (tool-server subset):
 *   - initialize              → server info + capabilities
 *   - notifications/initialized (no reply)
 *   - tools/list              → list of tools with JSON Schema
 *   - tools/call              → invoke one tool, return content block
 *   - ping                    → liveness check
 *
 * Auth: Bearer <API_AUTH_SECRET> in the Authorization header. The same
 * secret is reused to call the Thinkwork REST API downstream.
 *
 * This is the agent-facing surface of the @thinkwork/admin-ops package.
 * Keep tool definitions mechanical wrappers over imported functions.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpAdminKeys } from "@thinkwork/database-pg/schema";
import {
	AdminOpsError,
	createClient,
	tenants as tenantOps,
} from "@thinkwork/admin-ops";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "thinkwork-admin-ops";
const SERVER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// JSON-RPC types (minimal)
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
// Tool registry
// ---------------------------------------------------------------------------

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function buildTools(auth: AuthResult): ToolDefinition[] {
	const apiUrl = process.env.THINKWORK_API_URL ?? "";
	const authSecret = process.env.API_AUTH_SECRET ?? "";

	// Tenant pinning: a tenant-scoped key forces tenantId on every downstream
	// call regardless of what the caller passed. A superuser (API_AUTH_SECRET)
	// falls back to the caller-supplied tenantId — reserved for bootstrap.
	const clientFor = (args: Record<string, unknown>) => {
		const pinnedTenantId = auth.tenantId;
		const argTenantId =
			typeof args.tenantId === "string" ? args.tenantId : undefined;
		const tenantId = pinnedTenantId ?? argTenantId;
		return createClient({
			apiUrl,
			authSecret,
			principalId: typeof args.principalId === "string" ? args.principalId : undefined,
			principalEmail:
				typeof args.principalEmail === "string" ? args.principalEmail : undefined,
			tenantId,
			agentId: typeof args.agentId === "string" ? args.agentId : undefined,
		});
	};

	return [
		{
			name: "tenants_list",
			description:
				"List tenants (workspaces) visible to the caller. Returns id, name, slug, plan, createdAt for each.",
			inputSchema: {
				type: "object",
				properties: {
					principalId: {
						type: "string",
						description: "Invoking user's UUID (optional; used for audit attribution).",
					},
				},
				additionalProperties: false,
			},
			async handler(args) {
				return tenantOps.listTenants(clientFor(args));
			},
		},
		{
			name: "tenants_get",
			description:
				"Fetch a single tenant by id (UUID) or slug. Returns the full tenant record.",
			inputSchema: {
				type: "object",
				properties: {
					idOrSlug: {
						type: "string",
						description: "Tenant UUID or slug.",
					},
					principalId: { type: "string", description: "Invoking user's UUID (optional)." },
				},
				required: ["idOrSlug"],
				additionalProperties: false,
			},
			async handler(args) {
				const { idOrSlug } = args as { idOrSlug: string };
				const isUuid =
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
				const client = clientFor(args);
				return isUuid
					? tenantOps.getTenant(client, idOrSlug)
					: tenantOps.getTenantBySlug(client, idOrSlug);
			},
		},
		{
			name: "tenants_update",
			description:
				"Update a tenant's name, plan, or issue_prefix. Returns the updated tenant record. At least one of name/plan/issue_prefix must be provided.",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "Tenant UUID." },
					name: { type: "string" },
					plan: { type: "string", description: "Plan tier (free, team, enterprise, …)." },
					issue_prefix: { type: "string" },
					principalId: { type: "string", description: "Invoking user's UUID (optional)." },
				},
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				const { id, name, plan, issue_prefix } = args as {
					id: string;
					name?: string;
					plan?: string;
					issue_prefix?: string;
				};
				const input: Record<string, string> = {};
				if (name !== undefined) input.name = name;
				if (plan !== undefined) input.plan = plan;
				if (issue_prefix !== undefined) input.issue_prefix = issue_prefix;
				if (Object.keys(input).length === 0) {
					throw new Error("At least one of name, plan, or issue_prefix is required");
				}
				return tenantOps.updateTenant(clientFor(args), id, input);
			},
		},
	];
}

// ---------------------------------------------------------------------------
// JSON-RPC method dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: JsonRpcRequest, tools: ToolDefinition[]): Promise<JsonRpcResponse | null> {
	const id = req.id ?? null;

	// Notifications carry no id and expect no reply.
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
						tools: tools.map((t) => ({
							name: t.name,
							description: t.description,
							inputSchema: t.inputSchema,
						})),
					},
				};

			case "tools/call": {
				const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
				const toolName = params?.name;
				const toolArgs = params?.arguments ?? {};
				if (!toolName) {
					return {
						jsonrpc: "2.0",
						id,
						error: { code: JsonRpcErrorCode.InvalidParams, message: "tools/call requires params.name" },
					};
				}
				const tool = tools.find((t) => t.name === toolName);
				if (!tool) {
					return {
						jsonrpc: "2.0",
						id,
						error: { code: JsonRpcErrorCode.MethodNotFound, message: `Unknown tool: ${toolName}` },
					};
				}
				try {
					const result = await tool.handler(toolArgs);
					// MCP content block — tool result as JSON text so the model can parse.
					return {
						jsonrpc: "2.0",
						id,
						result: {
							content: [{ type: "text", text: JSON.stringify(result) }],
							isError: false,
						},
					};
				} catch (err) {
					// Tool-level errors come back as isError=true content per MCP spec —
					// the client/LLM sees the failure but the RPC itself succeeds.
					const message =
						err instanceof AdminOpsError
							? `${err.message} (HTTP ${err.status})`
							: err instanceof Error
								? err.message
								: String(err);
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
					error: { code: JsonRpcErrorCode.MethodNotFound, message: `Method not found: ${req.method}` },
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
// Auth
// ---------------------------------------------------------------------------

function extractBearer(event: APIGatewayProxyEventV2): string | null {
	const h = event.headers ?? {};
	const raw = h["authorization"] ?? h["Authorization"];
	if (!raw) return null;
	const match = raw.match(/^Bearer\s+(.+)$/i);
	return match ? match[1]! : null;
}

export interface AuthResult {
	ok: true;
	/** Present for tenant-scoped keys; absent for break-glass admin-secret callers. */
	tenantId?: string;
	/** Key row id, when authenticated via tenant_mcp_admin_keys. */
	keyId?: string;
	/** True when the caller used the shared API_AUTH_SECRET (cross-tenant access). */
	superuser: boolean;
}

/**
 * Authenticate the caller.
 *
 * Order:
 *   1. Bearer matches a live (non-revoked) row in tenant_mcp_admin_keys
 *      → tenant-scoped auth. `tenantId` is populated.
 *   2. Bearer matches process.env.API_AUTH_SECRET → break-glass superuser.
 *      No tenant pinning; reserved for bootstrap + ops debugging.
 *   3. Anything else → null (401).
 */
async function authenticate(event: APIGatewayProxyEventV2): Promise<AuthResult | null> {
	const token = extractBearer(event);
	if (!token) return null;

	const hash = createHash("sha256").update(token).digest("hex");
	try {
		const db = getDb();
		const [row] = await db
			.select({
				id: tenantMcpAdminKeys.id,
				tenant_id: tenantMcpAdminKeys.tenant_id,
			})
			.from(tenantMcpAdminKeys)
			.where(
				and(
					eq(tenantMcpAdminKeys.key_hash, hash),
					isNull(tenantMcpAdminKeys.revoked_at),
				),
			)
			.limit(1);
		if (row) {
			// Best-effort last_used_at bump — failure to update MUST NOT block auth.
			db.update(tenantMcpAdminKeys)
				.set({ last_used_at: new Date() })
				.where(eq(tenantMcpAdminKeys.id, row.id))
				.catch((err: unknown) => {
					console.warn("admin-ops-mcp: last_used_at bump failed", err);
				});
			return { ok: true, tenantId: row.tenant_id, keyId: row.id, superuser: false };
		}
	} catch (err: unknown) {
		// DB unavailable — fall through to superuser check so break-glass still
		// works during partial outages. Log so operators know the index path
		// is degraded.
		console.error("admin-ops-mcp: key lookup failed (falling back to superuser check)", err);
	}

	const superSecret = process.env.API_AUTH_SECRET;
	if (superSecret && token === superSecret) {
		return { ok: true, superuser: true };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

function httpJson(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode: status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "*",
			"Access-Control-Allow-Headers": "*",
		},
		body: JSON.stringify(body),
	};
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const method = event.requestContext.http.method;

	if (method === "OPTIONS") {
		return {
			statusCode: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: "",
		};
	}

	if (method !== "POST") {
		return httpJson(405, { error: "Method not allowed — POST only" });
	}

	const auth = await authenticate(event);
	if (!auth) {
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

	const tools = buildTools(auth);

	// Single request or batch
	if (Array.isArray(parsed)) {
		const responses = (
			await Promise.all(
				(parsed as JsonRpcRequest[]).map((r) => dispatch(r, tools)),
			)
		).filter((r): r is JsonRpcResponse => r !== null);
		return httpJson(200, responses);
	}

	const response = await dispatch(parsed as JsonRpcRequest, tools);
	if (response === null) {
		// Notification — HTTP 202 per JSON-RPC over HTTP convention, empty body.
		return { statusCode: 202, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
	}
	return httpJson(200, response);
}
