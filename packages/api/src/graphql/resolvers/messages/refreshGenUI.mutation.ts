/**
 * refreshGenUI — re-executes an MCP tool call to refresh a GenUI card.
 *
 * The only live branch in prior versions routed `_type === "external_task"`
 * through the LastMile adapter. Phase C removed that adapter along with the
 * rest of the LastMile Task connector. The legacy CRM/places branch was
 * already disabled pending a tenant_mcp_servers wiring (never wired).
 *
 * This resolver currently has no live implementation. It throws on invoke
 * so callers get an explicit error rather than a silent failure. Delete the
 * resolver + its GraphQL declaration if the refresh button on GenUI cards
 * is also removed from clients.
 */

import type { GraphQLContext } from "../../context.js";

export const refreshGenUI = async (
	_parent: unknown,
	_args: { messageId: string; toolIndex: number },
	_ctx: GraphQLContext,
) => {
	throw new Error(
		"refreshGenUI is not implemented in this build. GenUI refresh was previously backed by the LastMile external-task adapter, which has been removed. Rewire against a generic MCP server lookup or remove the refresh affordance from clients.",
	);
};
