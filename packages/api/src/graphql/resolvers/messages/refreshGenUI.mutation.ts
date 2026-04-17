/**
 * refreshGenUI — re-executes an MCP tool call to refresh a GenUI card.
 *
 * Routing:
 *   - `_type === "external_task"` → `getAdapter(_source.provider).refresh(...)`
 *   - `_source.tool` present → call that tool directly (legacy CRM/places)
 *   - else → look up static `GENUI_REFRESH_MAP`
 *
 * No LLM invocation — direct JSON-RPC call to the MCP server.
 */

import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	messages,
	snakeToCamel,
} from "../../utils.js";
import { callMcpTool } from "../../../integrations/external-work-items/mcpClient.js";
import { getAdapter, hasAdapter } from "../../../integrations/external-work-items/index.js";
import type { TaskProvider } from "../../../integrations/external-work-items/types.js";
import {
	resolveOAuthToken,
	resolveLastmileTasksMcpServer,
} from "../../../lib/oauth-token.js";
import { GENUI_REFRESH_MAP, inferServerFromTool } from "./genui-refresh-legacy.js";

type ExternalSource = {
	provider?: TaskProvider;
	tool?: string;
	params?: Record<string, unknown>;
};

export const refreshGenUI = async (_parent: unknown, args: { messageId: string; toolIndex: number }, _ctx: GraphQLContext) => {
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

	const source = currentResult._source as ExternalSource | undefined;

	// 3a. external_task branch → adapter registry
	if (genuiType === "external_task") {
		const provider = source?.provider;
		if (!provider || !hasAdapter(provider)) {
			throw new Error(`external_task refresh missing/unknown provider on _source: ${provider ?? "(none)"}`);
		}
		const externalTaskId =
			(source?.params?.id as string | undefined) ??
			(currentResult?.item?.core?.id as string | undefined);
		if (!externalTaskId) {
			throw new Error("external_task refresh missing task id in _source.params or item.core.id");
		}

		const connectionId = (currentResult?._connectionId as string | undefined) ?? undefined;
		const tenantId = msg.tenant_id;
		const providerId = (currentResult?._providerId as string | undefined) ?? undefined;
		let authToken: string | undefined;
		if (connectionId && tenantId && providerId) {
			authToken = (await resolveOAuthToken(connectionId, tenantId, providerId)) ?? undefined;
		}
		const tasksMcp =
			provider === "lastmile"
				? await resolveLastmileTasksMcpServer(tenantId)
				: null;
		if (provider === "lastmile" && !tasksMcp) {
			throw new Error(
				`No LastMile Tasks MCP server configured for tenant ${tenantId} — reconnect LastMile`,
			);
		}

		const envelope = await getAdapter(provider).refresh({
			externalTaskId,
			ctx: {
				tenantId,
				connectionId,
				authToken,
				mcpServerUrl: tasksMcp?.url,
			},
		});

		const updatedResults = [...toolResults];
		updatedResults[toolIndex] = {
			...envelope,
			_connectionId: connectionId,
			_providerId: providerId,
		};
		const [updated] = await db
			.update(messages)
			.set({ tool_results: updatedResults })
			.where(eq(messages.id, messageId))
			.returning();
		return updated ? snakeToCamel(updated) : null;
	}

	// 3b. legacy CRM/places path — not yet wired to tenant_mcp_servers.
	// TODO(mcp-url-record): resolve URL + auth from tenant_mcp_servers by
	// (tenantId, server-path-suffix) and re-enable. Failing loudly here
	// beats silently pointing at a hardcoded host. External-task refresh
	// (the common path) works via 3a above.
	const legacyTool = source?.tool ?? GENUI_REFRESH_MAP[genuiType]?.tool;
	void inferServerFromTool; // retain import until follow-up wires it back
	void callMcpTool; // retain import until follow-up wires it back
	throw new Error(
		`[refreshGenUI] legacy refresh path disabled pending tenant_mcp_servers wiring (tool=${legacyTool ?? "?"}, genuiType=${genuiType}).`,
	);
};
