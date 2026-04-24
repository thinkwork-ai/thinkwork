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
	teams as teamOps,
	agents as agentOps,
	templates as templateOps,
	users as userOps,
	artifacts as artifactOps,
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
	//
	// Principal fallback: GraphQL resolvers gated on tenant-admin look up
	// ctx.auth.principalId against tenant_members. Resolve priority:
	//   1. args.principalId — MCP tool caller (Strands runtime) asserts the
	//      real invoking human. Matches the Python skill's CURRENT_USER_ID.
	//   2. auth.createdByUserId — the user the tenant's admin key was minted
	//      against (defaulted to the tenant's first owner on provision).
	//      Ensures every MCP call has some admin principal even when the
	//      caller doesn't thread one through.
	//   3. undefined — the apikey branch in authenticate() will set
	//      ctx.auth.principalId to null, and resolvers that require admin
	//      role will refuse. Expected behavior for unprovisioned keys.
	const clientFor = (args: Record<string, unknown>) => {
		const pinnedTenantId = auth.tenantId;
		const argTenantId =
			typeof args.tenantId === "string" ? args.tenantId : undefined;
		const tenantId = pinnedTenantId ?? argTenantId;

		const argPrincipalId =
			typeof args.principalId === "string" ? args.principalId : undefined;
		const principalId = argPrincipalId ?? auth.createdByUserId;

		return createClient({
			apiUrl,
			authSecret,
			principalId,
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

		// -------------------------------------------------------------------
		// Self / user reads
		// -------------------------------------------------------------------
		{
			name: "me",
			description: "Return the caller's own User record.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
			async handler(args) {
				return userOps.me(clientFor(args));
			},
		},
		{
			name: "users_get",
			description: "Fetch a user by id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string", description: "User UUID." } },
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				return userOps.getUser(clientFor(args), (args as { id: string }).id);
			},
		},
		{
			name: "tenant_members_list",
			description: "List all members (role + status per principal) of a tenant.",
			inputSchema: {
				type: "object",
				properties: { tenantId: { type: "string", description: "Tenant UUID." } },
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return userOps.listTenantMembers(clientFor(args), (args as { tenantId: string }).tenantId);
			},
		},

		// -------------------------------------------------------------------
		// Agent reads
		// -------------------------------------------------------------------
		{
			name: "agents_list",
			description: "List agents in a tenant, optionally filtered by status/type/includeSystem.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					status: { type: "string", description: "AgentStatus enum filter." },
					type: { type: "string", description: "AgentType enum filter." },
					includeSystem: { type: "boolean" },
				},
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return agentOps.listAgents(clientFor(args), args as unknown as agentOps.ListAgentsInput);
			},
		},
		{
			name: "agents_get",
			description: "Fetch a single agent by id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				return agentOps.getAgent(clientFor(args), (args as { id: string }).id);
			},
		},
		{
			name: "agents_list_all",
			description:
				"Unfiltered agent inventory for a tenant — subs + system optional. Use for reconcilers that need every agent.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					includeSystem: { type: "boolean" },
					includeSubAgents: { type: "boolean" },
				},
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return agentOps.listAllTenantAgents(
					clientFor(args),
					args as unknown as agentOps.ListAllTenantAgentsInput,
				);
			},
		},

		// -------------------------------------------------------------------
		// Agent mutations
		// -------------------------------------------------------------------
		{
			name: "agents_create",
			description:
				"Create a new agent in a tenant, optionally linked to a template. Use templates to stamp out new agents at scale.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					templateId: { type: "string" },
					name: { type: "string" },
					role: { type: "string" },
					type: { type: "string" },
					systemPrompt: { type: "string" },
					reportsTo: { type: "string" },
					humanPairId: { type: "string" },
					parentAgentId: { type: "string" },
					adapterType: { type: "string" },
					avatarUrl: { type: "string" },
					budgetMonthlyCents: { type: "integer" },
					idempotencyKey: { type: "string" },
				},
				required: ["tenantId", "templateId", "name"],
				additionalProperties: false,
			},
			async handler(args) {
				return agentOps.createAgent(clientFor(args), args as unknown as agentOps.CreateAgentInput);
			},
		},
		{
			name: "agents_set_skills",
			description:
				"Replace the full agent_skills set for an agent. Empty list is rejected server-side to guard against stale-UI wipes.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string" },
					skills: {
						type: "array",
						items: { type: "object", additionalProperties: true },
						description:
							"Each: { skillId, config?, permissions?, rateLimitRpm?, modelOverride?, enabled? }",
					},
					idempotencyKey: { type: "string" },
				},
				required: ["agentId", "skills"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { agentId: string; skills: agentOps.AgentSkillInput[]; idempotencyKey?: string };
				return agentOps.setAgentSkills(clientFor(args), a.agentId, a.skills, a.idempotencyKey);
			},
		},
		{
			name: "agents_set_capabilities",
			description: "Replace the agent_capabilities set for an agent.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string" },
					capabilities: {
						type: "array",
						items: { type: "object", additionalProperties: true },
						description: "Each: { capability, config?, enabled? }",
					},
					idempotencyKey: { type: "string" },
				},
				required: ["agentId", "capabilities"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as {
					agentId: string;
					capabilities: agentOps.AgentCapabilityInput[];
					idempotencyKey?: string;
				};
				return agentOps.setAgentCapabilities(clientFor(args), a.agentId, a.capabilities, a.idempotencyKey);
			},
		},

		// -------------------------------------------------------------------
		// Team reads + mutations
		// -------------------------------------------------------------------
		{
			name: "teams_list",
			description: "List all teams in a tenant.",
			inputSchema: {
				type: "object",
				properties: { tenantId: { type: "string" } },
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return teamOps.listTeams(clientFor(args), (args as { tenantId: string }).tenantId);
			},
		},
		{
			name: "teams_get",
			description: "Fetch a single team by id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				return teamOps.getTeam(clientFor(args), (args as { id: string }).id);
			},
		},
		{
			name: "teams_create",
			description: "Create a team in a tenant.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					name: { type: "string" },
					description: { type: "string" },
					type: { type: "string" },
					budgetMonthlyCents: { type: "integer" },
					idempotencyKey: { type: "string" },
				},
				required: ["tenantId", "name"],
				additionalProperties: false,
			},
			async handler(args) {
				return teamOps.createTeam(clientFor(args), args as unknown as teamOps.CreateTeamInput);
			},
		},
		{
			name: "teams_add_agent",
			description: "Add an agent to a team.",
			inputSchema: {
				type: "object",
				properties: {
					teamId: { type: "string" },
					agentId: { type: "string" },
					role: { type: "string", description: 'Default "member".' },
					idempotencyKey: { type: "string" },
				},
				required: ["teamId", "agentId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as unknown as { teamId: string } & teamOps.AddTeamAgentInput;
				return teamOps.addTeamAgent(clientFor(args), a.teamId, a);
			},
		},
		{
			name: "teams_add_user",
			description: "Add a user to a team.",
			inputSchema: {
				type: "object",
				properties: {
					teamId: { type: "string" },
					userId: { type: "string" },
					role: { type: "string", description: 'Default "member".' },
					idempotencyKey: { type: "string" },
				},
				required: ["teamId", "userId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as unknown as { teamId: string } & teamOps.AddTeamUserInput;
				return teamOps.addTeamUser(clientFor(args), a.teamId, a);
			},
		},
		{
			name: "teams_remove_agent",
			description: "Remove an agent from a team.",
			inputSchema: {
				type: "object",
				properties: { teamId: { type: "string" }, agentId: { type: "string" } },
				required: ["teamId", "agentId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { teamId: string; agentId: string };
				return teamOps.removeTeamAgent(clientFor(args), a.teamId, a.agentId);
			},
		},
		{
			name: "teams_remove_user",
			description: "Remove a user from a team.",
			inputSchema: {
				type: "object",
				properties: { teamId: { type: "string" }, userId: { type: "string" } },
				required: ["teamId", "userId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { teamId: string; userId: string };
				return teamOps.removeTeamUser(clientFor(args), a.teamId, a.userId);
			},
		},

		// -------------------------------------------------------------------
		// Agent-template reads + mutations
		// -------------------------------------------------------------------
		{
			name: "templates_list",
			description: "List agent templates for a tenant.",
			inputSchema: {
				type: "object",
				properties: { tenantId: { type: "string" } },
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return templateOps.listTemplates(clientFor(args), (args as { tenantId: string }).tenantId);
			},
		},
		{
			name: "templates_get",
			description: "Fetch a template by id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				return templateOps.getTemplate(clientFor(args), (args as { id: string }).id);
			},
		},
		{
			name: "templates_linked_agents",
			description: "List all agents currently linked to a given template.",
			inputSchema: {
				type: "object",
				properties: { templateId: { type: "string" } },
				required: ["templateId"],
				additionalProperties: false,
			},
			async handler(args) {
				return templateOps.listLinkedAgentsForTemplate(
					clientFor(args),
					(args as { templateId: string }).templateId,
				);
			},
		},
		{
			name: "templates_create",
			description: "Create an agent template in a tenant.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					name: { type: "string" },
					slug: { type: "string" },
					description: { type: "string" },
					category: { type: "string" },
					model: { type: "string" },
					isPublished: { type: "boolean" },
					idempotencyKey: { type: "string" },
				},
				required: ["tenantId", "name", "slug"],
				additionalProperties: false,
			},
			async handler(args) {
				return templateOps.createAgentTemplate(
					clientFor(args),
					args as unknown as templateOps.CreateAgentTemplateInput,
				);
			},
		},
		{
			name: "templates_create_agent",
			description:
				"Stamp a new agent from a template (the core stamp-out-an-enterprise recipe).",
			inputSchema: {
				type: "object",
				properties: {
					templateId: { type: "string" },
					tenantId: { type: "string" },
					name: { type: "string" },
					role: { type: "string" },
					humanPairId: { type: "string" },
					parentAgentId: { type: "string" },
					budgetMonthlyCents: { type: "integer" },
					idempotencyKey: { type: "string" },
				},
				required: ["templateId", "tenantId", "name"],
				additionalProperties: false,
			},
			async handler(args) {
				return templateOps.createAgentFromTemplate(
					clientFor(args),
					args as unknown as templateOps.CreateAgentFromTemplateInput,
				);
			},
		},
		{
			name: "templates_sync_to_agent",
			description: "Sync one specific agent to its template's current configuration.",
			inputSchema: {
				type: "object",
				properties: {
					templateId: { type: "string" },
					agentId: { type: "string" },
					idempotencyKey: { type: "string" },
				},
				required: ["templateId", "agentId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { templateId: string; agentId: string; idempotencyKey?: string };
				return templateOps.syncTemplateToAgent(clientFor(args), a.templateId, a.agentId, a.idempotencyKey);
			},
		},
		{
			name: "templates_sync_to_all_agents",
			description:
				"OPT-IN: Sync every linked agent to the template. Tenant-wide blast radius — server-side authz enforces admin role.",
			inputSchema: {
				type: "object",
				properties: {
					templateId: { type: "string" },
					idempotencyKey: { type: "string" },
				},
				required: ["templateId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { templateId: string; idempotencyKey?: string };
				return templateOps.syncTemplateToAllAgents(clientFor(args), a.templateId, a.idempotencyKey);
			},
		},
		{
			name: "templates_accept_update",
			description:
				"Acknowledge and accept a pending template update on a specific agent (the companion to sync_to_all when you want per-agent control).",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string" },
					idempotencyKey: { type: "string" },
				},
				required: ["agentId"],
				additionalProperties: false,
			},
			async handler(args) {
				const a = args as { agentId: string; idempotencyKey?: string };
				return templateOps.acceptTemplateUpdate(clientFor(args), a.agentId, a.idempotencyKey);
			},
		},

		// -------------------------------------------------------------------
		// Artifact reads
		// -------------------------------------------------------------------
		{
			name: "artifacts_list",
			description: "List artifacts in a tenant, filterable by thread/agent/type/status.",
			inputSchema: {
				type: "object",
				properties: {
					tenantId: { type: "string" },
					threadId: { type: "string" },
					agentId: { type: "string" },
					type: { type: "string", description: "ArtifactType enum filter." },
					status: { type: "string", description: "ArtifactStatus enum filter." },
					limit: { type: "integer" },
				},
				required: ["tenantId"],
				additionalProperties: false,
			},
			async handler(args) {
				return artifactOps.listArtifacts(
					clientFor(args),
					args as unknown as artifactOps.ListArtifactsInput,
				);
			},
		},
		{
			name: "artifacts_get",
			description: "Fetch an artifact by id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
				additionalProperties: false,
			},
			async handler(args) {
				return artifactOps.getArtifact(clientFor(args), (args as { id: string }).id);
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
	/**
	 * User the key was minted against — typically the tenant owner that ran
	 * `thinkwork mcp provision`. Forwarded to downstream REST/GraphQL calls
	 * as `x-principal-id` when the MCP tool caller doesn't supply their
	 * own. Without it, resolvers gated on tenant-admin (tenant_members
	 * lookup against ctx.auth.principalId) would refuse every call.
	 */
	createdByUserId?: string;
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
				created_by_user_id: tenantMcpAdminKeys.created_by_user_id,
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
			return {
				ok: true,
				tenantId: row.tenant_id,
				keyId: row.id,
				createdByUserId: row.created_by_user_id ?? undefined,
				superuser: false,
			};
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
