/**
 * LastMile Tasks — REST API client.
 *
 * ThinkWork talks to LastMile over two transports:
 *
 * 1. **MCP** (`mcpClient.ts`) — deterministic agent tool calls. Used when an
 *    agent is reasoning in chat and needs to invoke a tool. Stays as MCP
 *    because the LLM's ability to read MCP's structured tool descriptors
 *    is the whole point of the transport.
 *
 * 2. **REST** (this file) — system-layer sync and CRUD. Used by webhook
 *    ingest, mobile-initiated task creation, and user-clicked actions on
 *    the mobile/web task card. Direct, typed, one round-trip per op, no
 *    LLM in the loop. This is the deterministic path — when the mobile UI
 *    says "create a task," we don't want an agent synthesizing arguments.
 *
 * Every call takes a per-user OAuth bearer token — same token LastMile
 * issues via the existing `/oauth/token` flow. A missing `LASTMILE_TASKS_API_URL`
 * env var feature-flags the whole client off: callers should check
 * `isLastmileRestConfigured()` first and fall back gracefully when the
 * endpoint isn't wired yet. This lets us ship the surrounding plumbing
 * (sync_status columns, retry mutation, mobile badges) before the
 * LastMile API is available.
 */

const BASE_URL = process.env.LASTMILE_TASKS_API_URL || "";
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 2;

export function isLastmileRestConfigured(): boolean {
	return BASE_URL.length > 0;
}

// ── Types (mirroring the spec handed to LastMile) ──────────────────────────

/** Canonical shape of a LastMile task as returned by the REST endpoints.
 *  All five methods (create/get/list/update/via the /v1/me cousin) should
 *  return this same shape so we normalize once. */
export interface LastmileTask {
	id: string;
	task_number?: number;
	title: string;
	description: string | null;
	status: string;
	status_id?: string | null;
	priority: string | null;
	due_date: string | null;
	assignee_id: string | null;
	creator_id: string | null;
	team_id: string | null;
	created_at: string;
	updated_at: string;
	assigned_at?: string | null;
	completed_at?: string | null;
	is_archived?: boolean;
	source?: {
		system?: string;
		external_ref?: string;
	} | null;
}

export interface LastmileMe {
	id: string;
	name: string;
	email: string;
	primary_team_id?: string | null;
	team_ids?: string[];
}

export interface CreateTaskRequest {
	/** The only truly required field. */
	title: string;
	/** Required for auto-resolution of team_id, status_id, task_type_id.
	 *  Without it the caller must supply status_id explicitly. */
	workflow_id?: string;
	description?: string | null;
	assignee_id?: string;
	priority?: "urgent" | "high" | "medium" | "low";
	due_date?: string;
	team_id?: string;
	task_type_id?: string;
	status_id?: string;
}

export interface LastmileWorkflow {
	id: string;
	name: string;
	description?: string | null;
	team_id: string;
	task_type_id?: string | null;
	is_active?: boolean;
}

export interface UpdateTaskRequest {
	title?: string;
	description?: string | null;
	status_id?: string;
	priority?: "urgent" | "high" | "medium" | "low";
	due_date?: string | null;
	assignee_id?: string;
}

export interface ListTasksQuery {
	assignee_id?: string;
	status?: string;
	team_id?: string;
	updated_since?: string;
	limit?: number;
	cursor?: string;
}

export interface ListTasksResponse {
	items: LastmileTask[];
	next_cursor: string | null;
}

// ── Errors ────────────────────────────────────────────────────────────────

/** Structured error surfaced by every method. Callers inspecting `.code`
 *  can branch on known failure modes (e.g., token expired → trigger
 *  re-auth flow) without parsing error messages. */
export class LastmileRestError extends Error {
	public readonly status: number;
	public readonly code: string;
	public readonly requestId: string | undefined;
	public readonly responseBody: unknown;

	constructor(args: {
		status: number;
		code: string;
		message: string;
		requestId?: string;
		responseBody?: unknown;
	}) {
		super(args.message);
		this.name = "LastmileRestError";
		this.status = args.status;
		this.code = args.code;
		this.requestId = args.requestId;
		this.responseBody = args.responseBody;
	}
}

// ── JWT peek (diagnostic only — NO signature validation) ──────────────────

/** Base64url-decode a JWT payload and return the claims. Used purely for
 *  diagnostic logging on 401 so we can see what audience/issuer/expiry
 *  LastMile rejected. Never use for authorization decisions. */
function peekJwtClaims(token: string):
	| {
			aud?: unknown;
			iss?: unknown;
			exp?: number;
			scope?: unknown;
			sub?: unknown;
	  }
	| null {
	try {
		const parts = token.split(".");
		if (parts.length < 2) return null;
		const payload = parts[1];
		if (!payload) return null;
		const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		const json = Buffer.from(padded, "base64").toString("utf8");
		return JSON.parse(json) as {
			aud?: unknown;
			iss?: unknown;
			exp?: number;
			scope?: unknown;
			sub?: unknown;
		};
	} catch {
		return null;
	}
}

// ── Shared fetch helper ────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestArgs<B> {
	method: Method;
	path: string;
	authToken: string;
	body?: B;
	query?: Record<string, string | number | undefined>;
	idempotencyKey?: string;
	/** Called when LastMile returns 401. Should return a freshly-refreshed
	 *  access_token (bypassing any cache). Return null to signal
	 *  unrecoverable auth — `doRequest` will then throw a 401 error.
	 *  Only invoked once per call (no infinite refresh loops). */
	refreshToken?: () => Promise<string | null>;
}

async function doRequest<TResponse, TBody = unknown>(
	args: RequestArgs<TBody>,
): Promise<TResponse> {
	if (!BASE_URL) {
		throw new LastmileRestError({
			status: 0,
			code: "not_configured",
			message:
				"LastMile REST client is not configured — set LASTMILE_TASKS_API_URL to enable system-layer sync.",
		});
	}
	if (!args.authToken) {
		throw new LastmileRestError({
			status: 0,
			code: "missing_token",
			message: "LastMile REST calls require a per-user OAuth bearer token.",
		});
	}

	const url = new URL(`${BASE_URL.replace(/\/$/, "")}${args.path}`);
	if (args.query) {
		for (const [k, v] of Object.entries(args.query)) {
			if (v !== undefined && v !== null && v !== "") {
				url.searchParams.set(k, String(v));
			}
		}
	}

	// Mutable token so the 401-refresh path can swap it for the retry.
	let currentToken = args.authToken;
	let refreshConsumed = false;

	const buildHeaders = (): Record<string, string> => {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${currentToken}`,
			Accept: "application/json",
		};
		if (args.body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		if (args.idempotencyKey) {
			headers["Idempotency-Key"] = args.idempotencyKey;
		}
		return headers;
	};

	// Retry on 5xx only. 4xx errors are client-side — retrying won't help.
	// Network errors (TypeError from fetch) also retry, since they're often
	// transient DNS/connection blips on cold starts.
	// 401s get ONE refresh-and-retry attempt when a refreshToken callback
	// is provided, separately from the 5xx retry loop.
	let lastErr: unknown = undefined;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const res = await fetch(url.toString(), {
				method: args.method,
				headers: buildHeaders(),
				body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (res.ok) {
				if (res.status === 204) return undefined as TResponse;
				return (await res.json()) as TResponse;
			}

			// Parse the error body once. LastMile spec says errors are
			// `{ error: { code, message } }` — we tolerate plain-text
			// responses too.
			let parsed: unknown = undefined;
			let errText = "";
			try {
				const raw = await res.text();
				errText = raw;
				if (raw) parsed = JSON.parse(raw);
			} catch {
				// Non-JSON body, fall back to text.
			}

			const errObj =
				parsed && typeof parsed === "object"
					? (parsed as { error?: { code?: string; message?: string } }).error
					: undefined;

			// 401: diagnose + attempt a single force-refresh retry.
			if (res.status === 401) {
				const claims = peekJwtClaims(currentToken);
				const nowSec = Math.floor(Date.now() / 1000);
				console.error(
					`[lastmile-rest] 401 from ${args.method} ${args.path}`,
					{
						status: 401,
						code: errObj?.code,
						message: errObj?.message || errText,
						requestId: res.headers.get("x-request-id") ?? undefined,
						responseBody: parsed ?? errText,
						tokenAudience: claims?.aud,
						tokenIssuer: claims?.iss,
						tokenScope: claims?.scope,
						tokenSub: claims?.sub,
						tokenExp: claims?.exp,
						nowSec,
						tokenExpiresInSec:
							typeof claims?.exp === "number" ? claims.exp - nowSec : undefined,
						refreshRetryAttempted: refreshConsumed,
					},
				);

				if (args.refreshToken && !refreshConsumed) {
					refreshConsumed = true;
					let refreshed: string | null = null;
					try {
						refreshed = await args.refreshToken();
					} catch (refreshErr) {
						console.error(
							`[lastmile-rest] refresh callback threw:`,
							refreshErr,
						);
					}
					if (refreshed && refreshed !== currentToken) {
						console.log(
							`[lastmile-rest] refresh-retry firing for ${args.method} ${args.path}`,
						);
						currentToken = refreshed;
						// Reset the attempt counter — the 5xx retries are a separate
						// concern and the first try after refresh deserves a full
						// budget of 5xx retries of its own.
						attempt = -1;
						continue;
					}
					console.warn(
						`[lastmile-rest] refresh-retry abandoned (no new token) for ${args.method} ${args.path}`,
					);
				}

				throw new LastmileRestError({
					status: 401,
					code: refreshConsumed
						? "unauthorized_after_refresh"
						: errObj?.code || "unauthorized",
					message:
						errObj?.message ||
						errText ||
						`LastMile ${args.method} ${args.path} failed (401)`,
					requestId: res.headers.get("x-request-id") ?? undefined,
					responseBody: parsed ?? errText,
				});
			}

			// Retry on 5xx — reset and fall through to the next loop iter.
			if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
				const backoffMs = 150 * 2 ** attempt;
				await new Promise((r) => setTimeout(r, backoffMs));
				continue;
			}

			throw new LastmileRestError({
				status: res.status,
				code: errObj?.code || `http_${res.status}`,
				message: errObj?.message || errText || `LastMile ${args.method} ${args.path} failed`,
				requestId: res.headers.get("x-request-id") ?? undefined,
				responseBody: parsed ?? errText,
			});
		} catch (err) {
			clearTimeout(timeout);
			// AbortError (timeout) and TypeError (network failure) retry.
			const isAbort = (err as Error)?.name === "AbortError";
			const isNetwork = err instanceof TypeError;
			if ((isAbort || isNetwork) && attempt < MAX_RETRIES) {
				lastErr = err;
				const backoffMs = 150 * 2 ** attempt;
				await new Promise((r) => setTimeout(r, backoffMs));
				continue;
			}
			// LastmileRestError already has good shape — rethrow as-is.
			if (err instanceof LastmileRestError) throw err;
			throw new LastmileRestError({
				status: 0,
				code: isAbort ? "timeout" : "network_error",
				message: (err as Error)?.message || "LastMile request failed",
			});
		}
	}

	// Exhausted retries — bubble the last error up in normalized form.
	throw lastErr instanceof LastmileRestError
		? lastErr
		: new LastmileRestError({
				status: 0,
				code: "exhausted_retries",
				message: `LastMile ${args.method} ${args.path} failed after ${MAX_RETRIES + 1} attempts`,
			});
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface LastmileRestCtx {
	/** Per-user OAuth bearer token, resolved via `resolveOAuthToken`. */
	authToken: string;
	/** Optional: called on 401 to force-refresh the token and retry once.
	 *  Callers should wire this to `forceRefreshLastmileUserToken` so
	 *  server-invalidated tokens self-heal without requiring mobile
	 *  reconnect. Return null to signal unrecoverable auth — `doRequest`
	 *  then surfaces a 401 the handler can translate to reconnect UX. */
	refreshToken?: () => Promise<string | null>;
}

/** POST /v1/tasks — create a task. Blocked by LastMile Tasks API until the
 *  endpoint ships; caller should gate this on `isLastmileRestConfigured()`
 *  and fall back to a `sync_status='local'` branch when unavailable. */
export async function createTask(
	args: { input: CreateTaskRequest; idempotencyKey?: string; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask, CreateTaskRequest>({
		method: "POST",
		path: "/tasks",
		authToken: args.ctx.authToken,
		body: args.input,
		idempotencyKey: args.idempotencyKey,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /v1/tasks/{id} — replaces the `tasks_get` MCP call used by
 *  `refresh.ts`. Returns the full task in one round-trip. */
export async function getTask(
	args: { taskId: string; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask>({
		method: "GET",
		path: `/v1/tasks/${encodeURIComponent(args.taskId)}`,
		authToken: args.ctx.authToken,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /v1/tasks — replaces `tasks_list` MCP. Cursor-paginated. */
export async function listTasks(
	args: { query?: ListTasksQuery; ctx: LastmileRestCtx },
): Promise<ListTasksResponse> {
	return doRequest<ListTasksResponse>({
		method: "GET",
		path: "/tasks",
		authToken: args.ctx.authToken,
		query: args.query as Record<string, string | number | undefined> | undefined,
		refreshToken: args.ctx.refreshToken,
	});
}

/** PATCH /v1/tasks/{id} — replaces `task_update_status`, `task_update_assignee`,
 *  and `task_update`. All field updates go through here. Returns the full
 *  task post-update so callers don't need a follow-up GET. */
export async function updateTask(
	args: { taskId: string; input: UpdateTaskRequest; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask, UpdateTaskRequest>({
		method: "PATCH",
		path: `/v1/tasks/${encodeURIComponent(args.taskId)}`,
		authToken: args.ctx.authToken,
		body: args.input,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /me — replaces the `user_whoami` MCP call used immediately
 *  after OAuth to resolve the user's LastMile id. */
export async function getMe(
	args: { ctx: LastmileRestCtx },
): Promise<LastmileMe> {
	return doRequest<LastmileMe>({
		method: "GET",
		path: "/me",
		authToken: args.ctx.authToken,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /workflows — returns the company's active workflows. Used by the
 *  mobile Tasks footer `+` button to let the user pick what kind of task
 *  to create (each workflow = a task type with its own team, statuses,
 *  and automation rules). */
export async function listWorkflows(
	args: { ctx: LastmileRestCtx },
): Promise<LastmileWorkflow[]> {
	// The handler returns `{ data: [...] }` (paginated) or bare array.
	// Normalize to always return an array.
	const raw = await doRequest<LastmileWorkflow[] | { data: LastmileWorkflow[] }>({
		method: "GET",
		path: "/workflows",
		authToken: args.ctx.authToken,
		refreshToken: args.ctx.refreshToken,
	});
	return Array.isArray(raw) ? raw : (raw?.data ?? []);
}
