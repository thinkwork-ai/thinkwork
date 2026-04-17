/**
 * Shared JSON-RPC caller for MCP servers.
 *
 * Extracted from refreshGenUI.mutation.ts so the refresh path and the
 * external-task executeAction path can share one implementation. Accepts an
 * optional per-user auth token; falls back to the service key when absent.
 *
 * Self-healing auth: callers can pass a `refreshToken` callback. When the
 * remote returns 401 (or a body clearly indicating WorkOS JWT rejection),
 * we invoke the callback once, swap the bearer, and retry. Mirrors the same
 * pattern the REST client uses in `lastmile/restClient.ts`. Without this,
 * a stale WorkOS access_token (revoked, rotated, clock skew) forces the
 * user to manually reconnect from mobile every ~15 min even though our
 * refresh_token is still good.
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
	// LastMile's MCP returns plain 401 bodies that AREN'T JSON-RPC shape,
	// e.g. `{"error":"Failed to validate WorkOS user."}` with HTTP 401.
	// Belt-and-suspenders: also sniff the body text for the signature phrase
	// in case status code gets massaged by some proxy.
	const haystack = args.rawBody.toLowerCase();
	return (
		haystack.includes("failed to validate workos") ||
		haystack.includes("invalid workos token")
	);
}

async function singleAttempt(opts: {
	mcpUrl: string;
	tool: string;
	bearer: string;
	bearerKind: string;
	requestBody: string;
}): Promise<SingleAttemptOutcome> {
	const { mcpUrl, tool, bearer, bearerKind, requestBody } = opts;
	const bearerPreview = bearer ? `${bearer.slice(0, 12)}…len=${bearer.length}` : "NONE";
	console.log(
		`[mcp ${tool}] POST ${mcpUrl} bearer=${bearerKind}(${bearerPreview}) args=${requestBody.slice(0, 200)}`,
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
		// Non-JSON body. If this was a 401 (auth), let the caller refresh + retry.
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

	// Auth-level failure (HTTP 401/403, or body signature match). Surface as
	// auth_error so the caller can force-refresh and retry.
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
	server,
	tool,
	args,
	authToken,
	baseUrl,
	refreshToken,
}: McpCallArgs): Promise<unknown> {
	const mcpUrl = `${baseUrl || MCP_BASE_URL}/${server}`;
	const bearerKind = authToken ? "user" : "service";
	const requestBody = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: tool, arguments: args },
	});

	let currentBearer = authToken || MCP_SERVICE_KEY;

	const first = await singleAttempt({
		mcpUrl,
		tool,
		bearer: currentBearer,
		bearerKind,
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
		mcpUrl,
		tool,
		bearer: currentBearer,
		bearerKind,
		requestBody,
	});
	if (second.kind === "ok") return second.value;
	throw second.errorToThrow;
}
