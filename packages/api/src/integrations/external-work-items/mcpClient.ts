/**
 * Shared JSON-RPC caller for MCP servers.
 *
 * Extracted from refreshGenUI.mutation.ts so the refresh path and the
 * external-task executeAction path can share one implementation. Accepts an
 * optional per-user auth token; falls back to the service key when absent.
 */

const MCP_BASE_URL =
	process.env.LASTMILE_MCP_BASE_URL || "https://mcp-dev.lastmile-tei.com";
const MCP_SERVICE_KEY = process.env.LASTMILE_MCP_SERVICE_KEY || "";

export type McpCallArgs = {
	server: string;
	tool: string;
	args: Record<string, unknown>;
	/** Per-user OAuth access token. Overrides the service key when present. */
	authToken?: string;
	/** Override the base URL (defaults to LASTMILE_MCP_BASE_URL). */
	baseUrl?: string;
};

export async function callMcpTool({
	server,
	tool,
	args,
	authToken,
	baseUrl,
}: McpCallArgs): Promise<unknown> {
	const mcpUrl = `${baseUrl || MCP_BASE_URL}/${server}`;
	const bearer = authToken || MCP_SERVICE_KEY;

	const rpcResponse = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${bearer}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: tool, arguments: args },
		}),
	});

	const rpc = (await rpcResponse.json()) as {
		error?: { message?: string };
		result?: { content?: Array<{ type?: string; text?: string }> };
	};
	if (rpc?.error) throw new Error(rpc.error.message || "MCP error");

	const content = rpc?.result?.content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item?.type === "text" && item?.text) {
				try {
					return JSON.parse(item.text);
				} catch {
					return item.text;
				}
			}
		}
	}
	return null;
}
