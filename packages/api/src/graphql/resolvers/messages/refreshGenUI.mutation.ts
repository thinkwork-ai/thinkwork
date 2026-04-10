/**
 * refreshGenUI — re-executes an MCP tool call to refresh a GenUI card.
 *
 * Since tool invocations in message metadata may be sub-agent calls (not direct
 * MCP calls), we use a genui_type → MCP tool mapping to determine what to call.
 * Params are reconstructed from the existing GenUI result data where possible.
 *
 * No LLM invocation — direct JSON-RPC call to the MCP server.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	messages,
	snakeToCamel,
} from "../../utils.js";

const MCP_BASE_URL = process.env.LASTMILE_MCP_BASE_URL || "https://mcp-dev.lastmile-tei.com";
const MCP_SERVICE_KEY = process.env.LASTMILE_MCP_SERVICE_KEY || "";

// Map genui_type to the MCP server + tool + default params to call for refresh
// Map genui_type → MCP server + tool + params builder
// CRM uses crm_graphql with entity shorthand; places uses places_search directly
const GENUI_REFRESH_MAP: Record<string, { server: string; tool: string; buildParams: (data: any) => Record<string, unknown> }> = {
	opportunity_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "opportunity", first: data.items?.length || 5 }),
	},
	opportunity: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "opportunity", id: data.id }),
	},
	lead_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "lead", first: data.items?.length || 5 }),
	},
	lead: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "lead", id: data.id }),
	},
	task_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "task", first: data.items?.length || 5 }),
	},
	task: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "task", id: data.id }),
	},
	account_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "account", first: data.items?.length || 5 }),
	},
	account: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "account", id: data.id }),
	},
	place_search_results: {
		server: "places",
		tool: "places_search",
		buildParams: (data) => ({
			query: data.query || "",
			...(data.location ? { location: data.location } : {}),
		}),
	},
	place: {
		server: "places",
		tool: "place_detail",
		buildParams: (data) => ({ place_id: data.place_id || data.id }),
	},
};

async function callMcpTool(toolName: string, args: Record<string, unknown>, server: string): Promise<unknown> {
	const mcpUrl = `${MCP_BASE_URL}/${server}`;
	const rpcResponse = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${MCP_SERVICE_KEY}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		}),
	});

	const rpc = await rpcResponse.json();
	if (rpc?.error) throw new Error(rpc.error.message || "MCP error");

	const content = rpc?.result?.content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item?.type === "text" && item?.text) {
				try { return JSON.parse(item.text); } catch { return item.text; }
			}
		}
	}
	return null;
}

export const refreshGenUI = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { messageId, toolIndex } = args;

	// 1. Fetch the message
	const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
	if (!msg) throw new Error("Message not found");

	// 2. Parse tool_results
	const toolResults = typeof msg.tool_results === "string"
		? JSON.parse(msg.tool_results)
		: (msg.tool_results || []);

	if (!Array.isArray(toolResults) || toolIndex >= toolResults.length) {
		throw new Error("Invalid toolIndex");
	}

	const currentResult = toolResults[toolIndex];
	const genuiType = currentResult?._type;
	if (!genuiType) throw new Error("GenUI type not found on tool result");

	// 3. Determine tool + params — prefer _source (embedded by AgentCore), fall back to GENUI_REFRESH_MAP
	let server: string;
	let tool: string;
	let params: Record<string, unknown>;

	const source = currentResult._source as { tool?: string; params?: Record<string, unknown> } | undefined;
	if (source?.tool) {
		// _source available — use it directly
		// tool name may be the raw MCP tool name (e.g., "crm_graphql")
		// server is inferred from tool name prefix or known mapping
		tool = source.tool;
		params = source.params || {};
		// Infer server from tool name (crm_* → crm, places_* → places)
		if (tool.startsWith("crm_")) server = "crm";
		else if (tool.startsWith("places_") || tool === "place_detail") server = "places";
		else server = "crm"; // default
	} else {
		// No _source — use static mapping
		const refreshConfig = GENUI_REFRESH_MAP[genuiType];
		if (!refreshConfig) {
			throw new Error(`No refresh mapping for GenUI type: ${genuiType}`);
		}
		server = refreshConfig.server;
		tool = refreshConfig.tool;
		params = refreshConfig.buildParams(currentResult);
	}

	// 4. Call MCP tool directly
	const freshResult = await callMcpTool(tool, params, server);

	// 6. Update tool_results with fresh data + timestamp
	const updatedResults = [...toolResults];
	if (freshResult && typeof freshResult === "object") {
		const resultObj = freshResult as Record<string, unknown>;
		updatedResults[toolIndex] = {
			...resultObj,
			_type: genuiType,
			_source: source || { tool, params }, // preserve or embed source for future refreshes
			_refreshedAt: new Date().toISOString(),
		};
	}

	// 7. Save back to message
	const [updated] = await db
		.update(messages)
		.set({ tool_results: updatedResults })
		.where(eq(messages.id, messageId))
		.returning();

	return updated ? snakeToCamel(updated) : null;
};
