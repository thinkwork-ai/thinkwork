/**
 * Admin-side REST fetch helper. Every admin REST call should go through
 * this helper so the Cognito id-token bearer is attached consistently,
 * and so auth-hydration-window behavior is centralized.
 *
 * Supersedes the `VITE_API_AUTH_SECRET`-bearer pattern that used to ship
 * a shared service secret in the public JS bundle. The id token comes
 * from the user's Cognito session — no secrets in the bundle.
 *
 * Two error classes are exported so callers can distinguish:
 *   - `NotReadyError` — auth session not yet hydrated. High-traffic
 *     callers (Sidebar, route loaders) should catch this and retry on
 *     the next render rather than surface it to the router / an
 *     ErrorBoundary.
 *   - `ApiError` — fetch returned non-2xx, or the response body was not
 *     valid JSON. Carries `status` and the best-effort parsed body so
 *     call sites can render a useful message.
 *
 * The `extraHeaders` passthrough is used to forward `x-tenant-id` until
 * PR B enforces membership server-side. That passthrough should be
 * removed once PR B lands.
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

export class NotReadyError extends Error {
	readonly kind = "NotReadyError" as const;
	constructor(message = "Auth not ready") {
		super(message);
		this.name = "NotReadyError";
	}
}

export class ApiError extends Error {
	readonly kind = "ApiError" as const;
	readonly status: number;
	readonly body: unknown;
	constructor(status: number, body: unknown, message?: string) {
		super(message ?? `API ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

export interface ApiFetchOptions extends RequestInit {
	extraHeaders?: Record<string, string>;
}

/**
 * Authenticated REST fetch. Attaches `Authorization: Bearer <id-token>`
 * and `Content-Type: application/json`; forwards `extraHeaders` (used
 * for `x-tenant-id` in the interim before PR B).
 *
 * Throws `NotReadyError` when the Cognito session hasn't hydrated yet.
 * Throws `ApiError` on non-2xx responses.
 */
export async function apiFetch<T = unknown>(
	path: string,
	options: ApiFetchOptions = {},
): Promise<T> {
	const { extraHeaders, headers: callerHeaders, ...rest } = options;
	const token = await getIdToken();
	if (!token) throw new NotReadyError();

	const res = await fetch(`${API_URL}${path}`, {
		...rest,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			// TODO(PR B): drop x-tenant-id passthrough once handlers
			// derive tenantId from membership instead of the header.
			...(extraHeaders ?? {}),
			...(callerHeaders ?? {}),
		},
	});

	// Best-effort body parse: try JSON, fall back to text. Attach raw
	// text to `ApiError.body` so a non-JSON 5xx still surfaces something
	// useful to the caller instead of a parse failure.
	let body: unknown = null;
	const text = await res.text();
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}

	if (!res.ok) {
		const message =
			typeof body === "object" && body !== null && "error" in body
				? String((body as { error: unknown }).error)
				: `API ${res.status} ${res.statusText}`;
		throw new ApiError(res.status, body, message);
	}

	return body as T;
}
