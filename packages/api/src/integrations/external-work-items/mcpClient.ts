/**
 * Shared JSON-RPC caller for MCP servers.
 *
 * The `url` is the full MCP endpoint (e.g. `https://dev-mcp.lastmile-tei.com/tasks`).
 * Callers must resolve it from the `tenant_mcp_servers` record — this module
 * does not read any env vars or apply defaults. That way a hostname rename
 * on the provider side takes effect the moment the record is updated in
 * admin, with no code deploy.
 *
 * Self-healing auth: callers can pass a `refreshToken` callback. When the
 * remote returns 401 (or a body clearly indicating bearer rejection), we
 * invoke the callback once, swap the bearer, and retry. Mirrors the REST
 * client pattern in `lastmile/restClient.ts`.
 */

export type McpCallArgs = {
	/** Full MCP endpoint URL, resolved from `tenant_mcp_servers.url`. */
	url: string;
	tool: string;
	args: Record<string, unknown>;
	/** Per-user OAuth access token. Required — no service-key fallback. */
	authToken: string;
	/** Called when the remote returns 401. Should return a freshly-refreshed
	 *  access_token (bypassing any cache). Return null to signal unrecoverable
	 *  auth — the original error will propagate. Invoked at most once per
	 *  call (no infinite refresh loops). */
	refreshToken?: () => Promise<string | null>;
};

type SingleAttemptOutcome =
	| { kind: "ok"; value: unknown }
	| { kind: "auth_error"; errorToThrow: Error }
	| { kind: "non_auth_error"; errorToThrow: Error };

function looksLikeAuthFailure(args: {
	status: number;
	rawBody: string;
	parsed: unknown;
}): boolean {
	if (args.status === 401 || args.status === 403) return true;
	// Some proxies strip status codes; sniff the body too.
	const haystack = args.rawBody.toLowerCase();
	return (
		haystack.includes("failed to validate workos") ||
		haystack.includes("invalid workos token") ||
		haystack.includes("invalid token")
	);
}

async function singleAttempt(opts: {
	mcpUrl: string;
	tool: string;
	bearer: string;
	requestBody: string;
}): Promise<SingleAttemptOutcome> {
	const { mcpUrl, tool, bearer, requestBody } = opts;
	const bearerPreview = bearer ? `${bearer.slice(0, 12)}…len=${bearer.length}` : "NONE";
	console.log(
		`[mcp ${tool}] POST ${mcpUrl} bearer=${bearerPreview} args=${requestBody.slice(0, 200)}`,
	);

	const rpcResponse = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${bearer}`,
		},
		body: requestBody,
	});

	let rawBody = "";
	try {
		rawBody = await rpcResponse.text();
	} catch (err) {
		console.error(
			`[mcp ${tool}] ERROR reading response body from ${mcpUrl}:`,
			(err as Error)?.message,
		);
		return { kind: "non_auth_error", errorToThrow: err as Error };
	}
	console.log(
		`[mcp ${tool}] response status=${rpcResponse.status} bodyLen=${rawBody.length} preview=${rawBody.slice(0, 500)}`,
	);

	let parsed: unknown = undefined;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		if (looksLikeAuthFailure({ status: rpcResponse.status, rawBody, parsed })) {
			return {
				kind: "auth_error",
				errorToThrow: new Error(
					`MCP ${tool} auth rejected (status=${rpcResponse.status}): ${rawBody.slice(0, 200)}`,
				),
			};
		}
		console.error(
			`[mcp ${tool}] response body is not JSON (status=${rpcResponse.status}): ${rawBody.slice(0, 500)}`,
		);
		return {
			kind: "non_auth_error",
			errorToThrow: new Error(
				`MCP ${tool} returned non-JSON (status=${rpcResponse.status})`,
			),
		};
	}

	if (looksLikeAuthFailure({ status: rpcResponse.status, rawBody, parsed })) {
		const p = parsed as { error?: unknown };
		const errText =
			typeof p?.error === "string"
				? p.error
				: typeof (p?.error as { message?: string })?.message === "string"
					? (p.error as { message?: string }).message
					: rawBody.slice(0, 200);
		return {
			kind: "auth_error",
			errorToThrow: new Error(
				`MCP ${tool} auth rejected (status=${rpcResponse.status}): ${errText}`,
			),
		};
	}

	const rpc = parsed as {
		error?: { code?: number; message?: string; data?: unknown };
		result?: {
			content?: Array<{ type?: string; text?: string }>;
			isError?: boolean;
		};
	};

	if (rpc?.error) {
		const fullMsg = `[mcp ${tool}] JSON-RPC error code=${rpc.error.code ?? "?"} message=${rpc.error.message ?? "(empty)"} data=${JSON.stringify(rpc.error.data ?? null)}`;
		console.error(fullMsg);
		return {
			kind: "non_auth_error",
			errorToThrow: new Error(
				rpc.error.message || `MCP error (code=${rpc.error.code ?? "?"})`,
			),
		};
	}

	const result = rpc?.result;
	if (result?.isError === true) {
		const errText = Array.isArray(result.content)
			? (result.content.find((c) => c?.type === "text" && c?.text)?.text ?? "tool error")
			: "tool error";
		return {
			kind: "non_auth_error",
			errorToThrow: new Error(`[mcp ${tool}] ${errText}`),
		};
	}

	const content = result?.content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item?.type === "text" && item?.text) {
				try {
					return { kind: "ok", value: JSON.parse(item.text) };
				} catch {
					return { kind: "ok", value: item.text };
				}
			}
		}
	}
	return { kind: "ok", value: null };
}

export async function callMcpTool({
	url,
	tool,
	args,
	authToken,
	refreshToken,
}: McpCallArgs): Promise<unknown> {
	if (!url) {
		throw new Error(
			`[mcp ${tool}] url is required — resolve from tenant_mcp_servers.url; no default is applied`,
		);
	}
	if (!authToken) {
		throw new Error(
			`[mcp ${tool}] authToken is required — no service-key fallback`,
		);
	}

	const requestBody = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: tool, arguments: args },
	});

	let currentBearer = authToken;

	const first = await singleAttempt({
		mcpUrl: url,
		tool,
		bearer: currentBearer,
		requestBody,
	});
	if (first.kind === "ok") return first.value;
	if (first.kind === "non_auth_error") throw first.errorToThrow;

	if (!refreshToken) {
		throw first.errorToThrow;
	}

	let refreshed: string | null = null;
	try {
		refreshed = await refreshToken();
	} catch (err) {
		console.error(`[mcp ${tool}] refresh callback threw:`, err);
		throw first.errorToThrow;
	}
	if (!refreshed || refreshed === currentBearer) {
		console.warn(
			`[mcp ${tool}] refresh-retry abandoned (no new token from callback)`,
		);
		throw first.errorToThrow;
	}

	console.log(`[mcp ${tool}] refresh-retry firing with rotated bearer`);
	currentBearer = refreshed;

	const second = await singleAttempt({
		mcpUrl: url,
		tool,
		bearer: currentBearer,
		requestBody,
	});
	if (second.kind === "ok") return second.value;
	throw second.errorToThrow;
}
