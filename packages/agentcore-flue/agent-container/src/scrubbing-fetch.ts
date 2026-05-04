/**
 * Plan §005 U16 — scrubbing fetch interceptor for MCP egress.
 *
 * Wraps a base `fetch` with two trusted-handler responsibilities:
 *
 *   1. Egress auth swap: U7's `buildMcpTools` mints a `Handle <uuid>`
 *      Authorization header per server. The handle is opaque — the MCP
 *      server expects `Bearer <token>` (RFC 6750) on the wire. This
 *      interceptor reads the request's `Authorization`, resolves the
 *      handle against the trusted-side `HandleStore`, and swaps in the
 *      real bearer for the actual HTTP call.
 *   2. Egress response scrub: the response body is run through
 *      `scrubBearerStrings` with the active bearer in scope, so any
 *      reflected-bearer (401 echo, debug log surface, etc.) is redacted
 *      before the SDK / agent loop touches it.
 *
 * The interceptor is the single FR-3a/FR-4a egress point for MCP.
 * Tests verify that bearers do not appear in the returned Response
 * body or in any structured log capture.
 */

import { scrubBearerStrings } from "./bearer-scrub.js";
import { McpHandleAuthScheme, type HandleStore } from "./mcp.js";

export interface ScrubbingFetchOptions {
	/** Trusted-handler HandleStore. Per-invocation; never module-level. */
	handleStore: HandleStore;
	/**
	 * The fetch to delegate to. Defaults to `globalThis.fetch`. Tests
	 * inject a mock to capture the swapped Authorization and to control
	 * the response body.
	 */
	baseFetch?: typeof fetch;
}

/**
 * Build a `fetch`-shaped function that the SDK transport calls.
 *
 * Behavior:
 *   - If the request carries `Authorization: Handle <uuid>`, resolve to
 *     the live bearer and replace with `Authorization: Bearer <bearer>`
 *     for the egress fetch.
 *   - If the request carries any other Authorization (or none), pass
 *     through unchanged. (`buildMcpTools` strips caller-supplied
 *     Authorization; this branch exists for non-MCP callers and as a
 *     defensive fall-through.)
 *   - Read the response body, scrub bearer-shaped strings (and the
 *     active bearer literally), return a new Response with the scrubbed
 *     body. The original headers, status, and statusText are preserved.
 *
 * The function is per-invocation: each Flue invocation gets a fresh
 * `HandleStore` and therefore a fresh interceptor closure.
 */
export function createScrubbingFetch(
	options: ScrubbingFetchOptions,
): typeof fetch {
	const { handleStore, baseFetch } = options;
	const delegate = baseFetch ?? globalThis.fetch.bind(globalThis);
	const handlePrefix = `${McpHandleAuthScheme} `;

	return async function scrubbingFetch(
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> {
		const swap = swapAuthorizationHeader(init?.headers, handleStore, handlePrefix);

		const effectiveInit: RequestInit | undefined = swap
			? { ...(init ?? {}), headers: swap.headers }
			: init;

		const response = await delegate(input, effectiveInit);

		// Stream the body once, scrub, and return a new Response. We can't
		// modify the original body in place (Response.body is a ReadableStream
		// the SDK reads to completion). Cloning before .text() would also
		// work but requires double-buffering; reading and rebuilding is the
		// conservative path for unit-test predictability.
		const rawBody = await response.text();
		const scrubbed = scrubBearerStrings(rawBody, swap?.activeBearer);

		return new Response(scrubbed, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

interface SwapResult {
	headers: Record<string, string>;
	activeBearer: string;
}

/**
 * Inspect headers, find an `Authorization: Handle <uuid>` value, resolve
 * the handle to a bearer, and return a new headers record with the
 * Bearer-form Authorization. Returns `null` when no swap is needed
 * (no Authorization, or Authorization not in handle form).
 *
 * Header lookup is case-insensitive (`Authorization` vs
 * `authorization`) per RFC 7230. The output `headers` record carries
 * the canonical capitalization the SDK transport expects.
 */
function swapAuthorizationHeader(
	headers: HeadersInit | undefined,
	handleStore: HandleStore,
	handlePrefix: string,
): SwapResult | null {
	if (!headers) return null;

	const flat = flattenHeaders(headers);
	const authKey = findHeaderKey(flat, "authorization");
	if (!authKey) return null;

	const value = flat[authKey];
	if (typeof value !== "string" || !value.startsWith(handlePrefix)) {
		return null;
	}

	const handle = value.slice(handlePrefix.length).trim();
	if (!handle) return null;

	const bearer = handleStore.resolve(handle);

	const out: Record<string, string> = { ...flat };
	delete out[authKey];
	out["Authorization"] = `Bearer ${bearer}`;

	return { headers: out, activeBearer: bearer };
}

function flattenHeaders(headers: HeadersInit): Record<string, string> {
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	if (Array.isArray(headers)) {
		const out: Record<string, string> = {};
		for (const [key, value] of headers) {
			out[key] = value;
		}
		return out;
	}
	return { ...(headers as Record<string, string>) };
}

function findHeaderKey(
	headers: Record<string, string>,
	target: string,
): string | undefined {
	const lower = target.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) return key;
	}
	return undefined;
}
