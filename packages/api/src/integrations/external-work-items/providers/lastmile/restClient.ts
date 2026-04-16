/**
 * LastMile — REST API client.
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
 * **Authentication (per published spec at dev-playground.lastmile-tei.com):**
 *
 * Every call sends `Authorization: Bearer <token>`. The preferred token is
 * a WorkOS **M2M** access_token obtained via `client_credentials` — see
 * `lib/lastmile-m2m.ts`. M2M tokens carry an `org_id` claim that LastMile
 * maps to a companyId via the organization's `metadata.lmi_company_id`,
 * bypassing the per-user Clerk-lookup that was the source of the
 * "Failed to validate WorkOS user" error on the per-user path.
 *
 * The legacy per-user WorkOS JWT path still works and is kept as a
 * fallback for tenants that haven't provisioned an M2M client yet.
 *
 * **Wire format (per spec):** camelCase everywhere (path params, query
 * params, request bodies, response bodies). Pagination uses
 * `?page=1&pageSize=50` with an envelope `{data, page, pageSize, totalCount, totalPages}`.
 */

const BASE_URL = process.env.LASTMILE_TASKS_API_URL || "";
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 2;

export function isLastmileRestConfigured(args?: { baseUrl?: string | null }): boolean {
	// Per-tenant baseUrl wins over the Lambda env var fallback. The env var
	// acts as a bootstrap default for single-tenant / local-dev and gets
	// removed once every tenant is configured via the admin UI.
	if (args?.baseUrl) return true;
	return BASE_URL.length > 0;
}

// ── Types (aligned with LastMile OpenAPI v1.0.0 — camelCase throughout) ──

/** Canonical shape of a LastMile task as returned by the REST endpoints. */
export interface LastmileTask {
	id: string;
	taskNumber?: string;
	title: string;
	description: string | null;
	status: string;
	priority: string | null;
	assigneeId: string | null;
	terminalId?: string | null;
	dueDate: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface LastmileMe {
	id: string;
	email: string;
	firstName?: string | null;
	lastName?: string | null;
	companyId?: string | null;
}

/** Shape per LastMile OpenAPI `TaskCreate`. `terminalId` is required on
 *  their side; `workflowId` is kept on the ThinkWork side as thread
 *  metadata but is NOT part of the LastMile POST body.
 *
 *  If a caller wants "LastMile picks the status/team from a workflow",
 *  use `POST /workflows/{id}/tasks` instead — to be added as a helper
 *  when we need it. For now `/tasks` is the generic path. */
export interface CreateTaskRequest {
	title: string;
	terminalId: string;
	description?: string | null;
	status?: string;
	priority?: "urgent" | "high" | "medium" | "low" | string;
	assigneeId?: string;
	dueDate?: string;
}

export interface LastmileWorkflow {
	id: string;
	companyId?: string;
	name: string;
	description?: string | null;
	teamId: string;
	taskTypeId?: string | null;
	workflowData?: Record<string, unknown>;
	automationRules?: Record<string, unknown> | null;
	isActive?: boolean;
	createdBy?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface UpdateTaskRequest {
	title?: string;
	description?: string | null;
	status?: string;
	priority?: "urgent" | "high" | "medium" | "low" | string;
	dueDate?: string | null;
	assigneeId?: string | null;
}

/** Query params for `GET /tasks` — camelCase, page/pageSize pagination. */
export interface ListTasksQuery {
	page?: number;
	pageSize?: number;
	status?: string;
	assigneeId?: string;
	terminalId?: string;
}

/** Standard pagination envelope used by most list endpoints. */
export interface PaginatedResponse<T> {
	data: T[];
	page: number;
	pageSize: number;
	totalCount: number;
	totalPages: number;
}

export type ListTasksResponse = PaginatedResponse<LastmileTask>;

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
	/** Per-call base URL override — wins over the LASTMILE_TASKS_API_URL
	 *  env var. Supplied by callers that looked up the tenant's per-
	 *  connector config (webhooks.config.baseUrl) via `getConnectorBaseUrl`. */
	baseUrl?: string;
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
	const effectiveBase = args.baseUrl || BASE_URL;
	if (!effectiveBase) {
		throw new LastmileRestError({
			status: 0,
			code: "not_configured",
			message:
				"LastMile REST client is not configured — set the per-tenant baseUrl via the connector admin UI (or LASTMILE_TASKS_API_URL as a fallback).",
		});
	}
	if (!args.authToken) {
		throw new LastmileRestError({
			status: 0,
			code: "missing_token",
			message: "LastMile REST calls require a per-user OAuth bearer token.",
		});
	}

	const url = new URL(`${effectiveBase.replace(/\/$/, "")}${args.path}`);
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
				// Token shape — prefix + suffix + length so we can compare
				// to what's in SSM without leaking the full plaintext.
				const tokenPreview =
					currentToken.length > 14
						? `${currentToken.slice(0, 12)}…${currentToken.slice(-4)}`
						: `(len=${currentToken.length})`;
				const outboundHeaders = buildHeaders();
				console.error(
					`[lastmile-rest] 401 from ${args.method} ${args.path}`,
					{
						status: 401,
						code: errObj?.code,
						message: errObj?.message || errText,
						requestId: res.headers.get("x-request-id") ?? undefined,
						responseBody: parsed ?? errText,
						url: url.toString(),
						outboundHeaders: {
							...outboundHeaders,
							// Don't log the full bearer — prefix/suffix only.
							Authorization: `Bearer ${tokenPreview}`,
						},
						tokenPreview,
						tokenLen: currentToken.length,
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
	/** Per-tenant REST API base URL (e.g. "https://api-dev.lastmile-tei.com").
	 *  Read from `webhooks.config.baseUrl` via `getConnectorBaseUrl`. When
	 *  omitted, falls back to the LASTMILE_TASKS_API_URL env var. */
	baseUrl?: string | null;
	/** Optional: called on 401 to force-refresh the token and retry once.
	 *  Callers should wire this to `forceRefreshLastmileUserToken` so
	 *  server-invalidated tokens self-heal without requiring mobile
	 *  reconnect. Return null to signal unrecoverable auth — `doRequest`
	 *  then surfaces a 401 the handler can translate to reconnect UX. */
	refreshToken?: () => Promise<string | null>;
}

/** Compact helper to avoid repeating the ctx → args plumbing on every method. */
function ctxToBaseUrl(ctx: LastmileRestCtx): string | undefined {
	return ctx.baseUrl ?? undefined;
}

/** POST /tasks — create a task. Gated by `isLastmileRestConfigured()`. */
export async function createTask(
	args: { input: CreateTaskRequest; idempotencyKey?: string; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask, CreateTaskRequest>({
		method: "POST",
		path: "/tasks",
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		body: args.input,
		idempotencyKey: args.idempotencyKey,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /tasks/{taskId} — returns the full task in one round-trip. */
export async function getTask(
	args: { taskId: string; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask>({
		method: "GET",
		path: `/tasks/${encodeURIComponent(args.taskId)}`,
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /tasks — paginated list (`?page=&pageSize=`). */
export async function listTasks(
	args: { query?: ListTasksQuery; ctx: LastmileRestCtx },
): Promise<ListTasksResponse> {
	return doRequest<ListTasksResponse>({
		method: "GET",
		path: "/tasks",
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		query: args.query as Record<string, string | number | undefined> | undefined,
		refreshToken: args.ctx.refreshToken,
	});
}

/** PATCH /tasks/{taskId} — partial update. Returns the full task post-update. */
export async function updateTask(
	args: { taskId: string; input: UpdateTaskRequest; ctx: LastmileRestCtx },
): Promise<LastmileTask> {
	return doRequest<LastmileTask, UpdateTaskRequest>({
		method: "PATCH",
		path: `/tasks/${encodeURIComponent(args.taskId)}`,
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		body: args.input,
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /users/me — current principal (works for both user and M2M tokens;
 *  M2M returns the service-principal identity). */
export async function getMe(
	args: { ctx: LastmileRestCtx },
): Promise<LastmileMe> {
	return doRequest<LastmileMe>({
		method: "GET",
		path: "/users/me",
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		refreshToken: args.ctx.refreshToken,
	});
}

/** GET /workflows — returns the company's workflows for the mobile
 *  task-picker. Paginated per spec; we fetch the first page (pageSize=100)
 *  and return `data`. If a tenant ever has >100 workflows we'll add
 *  follow-up paging; today that's not on the horizon. */
export async function listWorkflows(
	args: { ctx: LastmileRestCtx; query?: { teamId?: string; isActive?: boolean; pageSize?: number } },
): Promise<LastmileWorkflow[]> {
	const query: Record<string, string | number | undefined> = {
		pageSize: args.query?.pageSize ?? 100,
	};
	if (args.query?.teamId) query.teamId = args.query.teamId;
	if (typeof args.query?.isActive === "boolean") query.isActive = String(args.query.isActive);

	const envelope = await doRequest<PaginatedResponse<LastmileWorkflow>>({
		method: "GET",
		path: "/workflows",
		authToken: args.ctx.authToken,
		baseUrl: ctxToBaseUrl(args.ctx),
		query,
		refreshToken: args.ctx.refreshToken,
	});
	// Spec guarantees `data: Workflow[]`. Defensively unwrap a bare array
	// in case an older handler is still deployed on some stage.
	if (Array.isArray(envelope)) return envelope as LastmileWorkflow[];
	return envelope?.data ?? [];
}
