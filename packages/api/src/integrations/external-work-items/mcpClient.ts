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
	const bearerKind = authToken ? "user" : "service";
	const bearerPreview = bearer ? `${bearer.slice(0, 12)}…len=${bearer.length}` : "NONE";
	console.log(
		`[mcp ${tool}] POST ${mcpUrl} bearer=${bearerKind}(${bearerPreview}) args=${JSON.stringify(args).slice(0, 200)}`,
	);

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

	let rawBody = "";
	try {
		rawBody = await rpcResponse.text();
	} catch (err) {
		console.error(
			`[mcp ${tool}] ERROR reading response body from ${mcpUrl}:`,
			(err as Error)?.message,
		);
		throw err;
	}
	console.log(
		`[mcp ${tool}] response status=${rpcResponse.status} bodyLen=${rawBody.length} preview=${rawBody.slice(0, 500)}`,
	);

	let rpc: {
		error?: { code?: number; message?: string; data?: unknown };
		result?: {
			content?: Array<{ type?: string; text?: string }>;
			isError?: boolean;
		};
	};
	try {
		rpc = JSON.parse(rawBody);
	} catch (err) {
		console.error(
			`[mcp ${tool}] response body is not JSON (status=${rpcResponse.status}): ${rawBody.slice(0, 500)}`,
		);
		throw new Error(`MCP ${tool} returned non-JSON (status=${rpcResponse.status})`);
	}

	// Transport-level JSON-RPC error (server rejected the request shape).
	if (rpc?.error) {
		const fullMsg = `[mcp ${tool}] JSON-RPC error code=${rpc.error.code ?? "?"} message=${rpc.error.message ?? "(empty)"} data=${JSON.stringify(rpc.error.data ?? null)}`;
		console.error(fullMsg);
		throw new Error(rpc.error.message || `MCP error (code=${rpc.error.code ?? "?"})`);
	}

	// Tool-level error — LastMile (and the MCP spec) signals "the tool
	// ran and failed" by returning `result.isError: true` with the failure
	// message inside `result.content[0].text`, NOT via the top-level
	// `error` field. Without this branch the error string silently falls
	// through as a "payload" and downstream callers throw a confusing
	// "non-object payload" from their own shape checks. Probed on
	// LastMile's mcp-dev server for `tasks_get` with a stale id:
	//   { result: { content: [{type:"text",text:"Error: Task not found."}], isError: true } }
	const result = rpc?.result;
	if (result?.isError === true) {
		const errText = Array.isArray(result.content)
			? (result.content.find((c) => c?.type === "text" && c?.text)?.text ?? "tool error")
			: "tool error";
		throw new Error(`[mcp ${tool}] ${errText}`);
	}

	const content = result?.content;
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
