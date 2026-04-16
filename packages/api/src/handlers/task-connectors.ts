/**
 * Task Connectors Admin REST Handler
 *
 * Bearer-auth protected CRUD for managing task connector registrations.
 * A "task connector" is a `webhooks` row with target_type='task' and a
 * connect_provider_id — i.e. the admin-side configuration for receiving
 * external task events from providers like LastMile.
 *
 * Lifecycle:
 *   POST   :slug                — enable (inserts the row, or re-enables an
 *                                 existing disabled row while preserving its
 *                                 token + signing secret)
 *   DELETE :slug                — soft disable (UPDATE enabled=false). Row +
 *                                 config preserved; webhook URL stops
 *                                 accepting events. Reversible via POST :slug.
 *   DELETE :slug?hard=true      — hard delete. Nulls thread_turns.webhook_id
 *                                 (cascade is SET NULL on webhook_deliveries)
 *                                 and removes the webhooks row. Delivery
 *                                 history survives but loses its webhook_id
 *                                 reference. Use with care.
 *
 * Routes:
 *   GET    /api/task-connectors                         — list catalog with per-tenant enablement
 *   POST   /api/task-connectors/:slug                   — enable / re-enable
 *   DELETE /api/task-connectors/:slug[?hard=true]       — soft disable (or hard delete)
 *   GET    /api/task-connectors/:slug/deliveries        — paginated delivery history
 *   POST   /api/task-connectors/:slug/test              — fire a synthetic event
 *   POST   /api/task-connectors/:slug/generate-secret   — issue HMAC signing secret (returned once)
 *   POST   /api/task-connectors/:slug/regenerate-secret — rotate HMAC signing secret
 *   DELETE /api/task-connectors/:slug/secret            — remove HMAC signing (token-only auth)
 *   PATCH  /api/task-connectors/:slug/config            — update per-tenant connector settings
 *                                                         (currently: baseUrl for the provider's REST API)
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
	webhooks,
	webhookDeliveries,
	connectProviders,
	connections,
	threadTurns,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

// Static map of providers whose signing secret env var is wired into the
// deployed Lambda. Used to compute secret_status when no per-tenant secret
// is set. Update when a new provider lands with env-var-based fallback.
const LEGACY_ENV_SECRETS: Record<string, string> = {
	lastmile: "LASTMILE_WEBHOOK_SECRET",
};

function webhookUrlForToken(token: string): string {
	// Read at call time so tests can stub THINKWORK_API_URL via vi.stubEnv.
	const base = process.env.THINKWORK_API_URL || "";
	return `${base}/webhooks/${token}`;
}

/**
 * Resolve the per-tenant REST base URL for a task connector by reading
 * `webhooks.config.baseUrl` on the tenant's task webhook row for the
 * named provider. Returns null when no webhook row exists or the config
 * field is empty — callers should fall back to the provider-specific
 * Lambda env var (e.g. `LASTMILE_TASKS_API_URL`).
 *
 * Exported so the REST-facing handlers (`connections.ts`,
 * `syncExternalTaskOnCreate`) can read per-tenant config without
 * duplicating the join. Reads on every call — fine because the task
 * handlers already fetch the connection row; one extra single-row
 * lookup is cheap compared to the outbound HTTP call.
 */
export async function getConnectorBaseUrl(
	tenantId: string,
	providerName: string,
): Promise<string | null> {
	const [row] = await db
		.select({ config: webhooks.config })
		.from(webhooks)
		.innerJoin(
			connectProviders,
			eq(webhooks.connect_provider_id, connectProviders.id),
		)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(connectProviders.name, providerName),
			),
		)
		.limit(1);
	if (!row) return null;
	const cfg = (row.config ?? null) as Record<string, unknown> | null;
	const url = cfg?.baseUrl;
	return typeof url === "string" && url.length > 0 ? url : null;
}

function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

function parsePath(rawPath: string): { slug: string | null; sub: string | null } {
	const match = rawPath.match(/^\/api\/task-connectors(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/);
	if (!match) return { slug: null, sub: null };
	return { slug: match[1] || null, sub: match[2] || null };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") {
		return {
			statusCode: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "*",
				"Access-Control-Allow-Headers": "*",
			},
			body: "",
		};
	}

	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const method = event.requestContext.http.method;
	const { slug, sub } = parsePath(event.rawPath);

	try {
		// Collection: /api/task-connectors
		if (!slug) {
			if (method === "GET") return listConnectors(tenantId);
			return error("Method not allowed", 405);
		}

		// Sub-resources: /api/task-connectors/:slug/:sub
		if (sub === "deliveries") {
			if (method === "GET") return listDeliveries(tenantId, slug, event);
			return error("Method not allowed", 405);
		}
		if (sub === "test") {
			if (method === "POST") return testConnector(tenantId, slug);
			return error("Method not allowed", 405);
		}
		if (sub === "generate-secret" || sub === "regenerate-secret") {
			if (method === "POST") return generateSecret(tenantId, slug);
			return error("Method not allowed", 405);
		}
		if (sub === "secret") {
			if (method === "DELETE") return removeSecret(tenantId, slug);
			return error("Method not allowed", 405);
		}
		if (sub === "config") {
			if (method === "PATCH") return updateConfig(tenantId, slug, event);
			return error("Method not allowed", 405);
		}

		// Item: /api/task-connectors/:slug
		if (method === "POST") return enableConnector(tenantId, slug);
		if (method === "DELETE") return disableConnector(tenantId, slug, event);
		return error("Method not allowed", 405);
	} catch (err) {
		console.error("[task-connectors] handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// GET /api/task-connectors — list catalog with per-tenant state + stats
// ---------------------------------------------------------------------------

type ConnectorRow = {
	slug: string;
	display_name: string;
	provider_id: string;
	provider_type: string;
	is_available: boolean;
	/** Whether a webhook row has been created (enabled OR disabled). */
	configured: boolean;
	/** Whether the webhook row is currently accepting events. */
	enabled: boolean;
	webhook_id: string | null;
	webhook_url: string | null;
	has_secret: boolean;
	secret_status: "configured" | "missing";
	/** Per-tenant provider REST API base URL (e.g. LastMile's dev API host).
	 *  Null when not configured — caller falls back to the provider's Lambda
	 *  env var (`LASTMILE_TASKS_API_URL` etc.). Stored in webhooks.config.baseUrl. */
	base_url: string | null;
	connection_count: number;
	last_delivery_at: string | null;
	delivery_count_24h: number;
	recent_failures: number;
};

async function listConnectors(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// 1. Fetch the catalog — all task-type providers.
	const catalog = await db
		.select({
			id: connectProviders.id,
			name: connectProviders.name,
			display_name: connectProviders.display_name,
			provider_type: connectProviders.provider_type,
			is_available: connectProviders.is_available,
		})
		.from(connectProviders)
		.where(eq(connectProviders.provider_type, "task"));

	// 2. Fetch this tenant's existing task webhook rows in one query. Include
	//    disabled rows — the UI needs to show them so the user can re-enable
	//    or hard-delete.
	const existingWebhooks = await db
		.select({
			id: webhooks.id,
			connect_provider_id: webhooks.connect_provider_id,
			token: webhooks.token,
			config: webhooks.config,
			enabled: webhooks.enabled,
			last_invoked_at: webhooks.last_invoked_at,
			invocation_count: webhooks.invocation_count,
		})
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
			),
		);

	const webhookByProvider = new Map<string, (typeof existingWebhooks)[number]>();
	for (const row of existingWebhooks) {
		if (row.connect_provider_id) {
			webhookByProvider.set(row.connect_provider_id, row);
		}
	}

	// 3. Denormalized stats: connection count + delivery count (24h)
	//    + recent failures per provider. One query per provider to keep the
	//    code simple; catalog is tiny (≤ 10 rows).
	const now = Date.now();
	const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

	const rows: ConnectorRow[] = [];
	for (const provider of catalog) {
		const webhook = webhookByProvider.get(provider.id);
		const exists = !!webhook;
		const enabled = webhook?.enabled ?? false;

		const [connectionCountRow] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(connections)
			.where(
				and(
					eq(connections.tenant_id, tenantId),
					eq(connections.provider_id, provider.id),
					eq(connections.status, "active"),
				),
			);
		const connection_count = Number(connectionCountRow?.count ?? 0);

		let delivery_count_24h = 0;
		let recent_failures = 0;
		if (webhook) {
			const stats = await db
				.select({
					total: sql<number>`count(*)::int`,
					failures: sql<number>`count(*) filter (where resolution_status not in ('ok', 'rate_limited'))::int`,
				})
				.from(webhookDeliveries)
				.where(
					and(
						eq(webhookDeliveries.webhook_id, webhook.id),
						gte(webhookDeliveries.received_at, dayAgo),
					),
				);
			delivery_count_24h = Number(stats[0]?.total ?? 0);
			recent_failures = Number(stats[0]?.failures ?? 0);
		}

		// has_secret = per-tenant secret configured on the webhook row.
		// secret_status = "configured" iff has_secret OR legacy env var set.
		const cfg = (webhook?.config ?? null) as Record<string, unknown> | null;
		const tenantSecret = typeof cfg?.secret === "string" && cfg.secret.length > 0;
		const envSecretKey = LEGACY_ENV_SECRETS[provider.name];
		const envSecretPresent =
			typeof envSecretKey === "string" && !!process.env[envSecretKey];
		const base_url =
			typeof cfg?.baseUrl === "string" && cfg.baseUrl.length > 0
				? cfg.baseUrl
				: null;

		rows.push({
			slug: provider.name,
			display_name: provider.display_name,
			provider_id: provider.id,
			provider_type: provider.provider_type,
			is_available: provider.is_available,
			configured: exists,
			enabled,
			webhook_id: webhook?.id ?? null,
			webhook_url: webhook ? webhookUrlForToken(webhook.token) : null,
			has_secret: tenantSecret,
			secret_status: tenantSecret || envSecretPresent ? "configured" : "missing",
			base_url,
			connection_count,
			last_delivery_at:
				webhook?.last_invoked_at?.toISOString?.() ??
				(webhook?.last_invoked_at as unknown as string | null) ??
				null,
			delivery_count_24h,
			recent_failures,
		});
	}

	return json(rows);
}

// ---------------------------------------------------------------------------
// POST /api/task-connectors/:slug — enable (or re-enable a disabled row)
// ---------------------------------------------------------------------------

async function enableConnector(
	tenantId: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select()
		.from(connectProviders)
		.where(
			and(
				eq(connectProviders.name, slug),
				eq(connectProviders.provider_type, "task"),
			),
		);
	if (!provider) return notFound(`Connector '${slug}' not found`);

	// If a row already exists, re-enable it in place — preserving the token
	// and signing secret — so the provider-side webhook config stays valid.
	const [existing] = await db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (existing) {
		if (!existing.enabled) {
			await db
				.update(webhooks)
				.set({ enabled: true, updated_at: new Date() })
				.where(eq(webhooks.id, existing.id));
		}
		return json({
			ok: true,
			id: existing.id,
			slug,
			webhook_url: webhookUrlForToken(existing.token),
			already_enabled: existing.enabled,
			re_enabled: !existing.enabled,
		});
	}

	const token = generateToken();
	const [inserted] = await db
		.insert(webhooks)
		.values({
			tenant_id: tenantId,
			name: `${provider.display_name} Tasks`,
			description: `Inbound task events from ${provider.display_name}`,
			token,
			target_type: "task",
			connect_provider_id: provider.id,
			enabled: true,
			rate_limit: 600,
			created_by_type: "user",
		})
		.returning();

	return json(
		{
			ok: true,
			id: inserted.id,
			slug,
			webhook_url: webhookUrlForToken(inserted.token),
			already_enabled: false,
			re_enabled: false,
		},
		201,
	);
}

// ---------------------------------------------------------------------------
// DELETE /api/task-connectors/:slug — soft disable (default) or hard delete
// when `?hard=true`. Soft preserves the row, config, and delivery history;
// hard removes the row after nulling dependent FKs.
// ---------------------------------------------------------------------------

async function disableConnector(
	tenantId: string,
	slug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const hard = (event.queryStringParameters?.hard ?? "").toLowerCase() === "true";

	const [existing] = await db
		.select({ id: webhooks.id, enabled: webhooks.enabled })
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!existing) {
		return json({ ok: true, slug, mode: hard ? "hard" : "soft", changed: false });
	}

	if (hard) {
		// Null the thread_turns FK first; webhook_deliveries FK is ON DELETE
		// SET NULL so it handles itself. webhook_idempotency cascades on
		// delete via its own FK definition.
		await db
			.update(threadTurns)
			.set({ webhook_id: null })
			.where(eq(threadTurns.webhook_id, existing.id));
		await db.delete(webhooks).where(eq(webhooks.id, existing.id));
		return json({ ok: true, slug, mode: "hard", changed: true });
	}

	// Soft disable — UPDATE enabled=false. Idempotent: if already disabled,
	// no write, still 200.
	if (existing.enabled) {
		await db
			.update(webhooks)
			.set({ enabled: false, updated_at: new Date() })
			.where(eq(webhooks.id, existing.id));
	}
	return json({
		ok: true,
		slug,
		mode: "soft",
		changed: existing.enabled,
	});
}

// ---------------------------------------------------------------------------
// GET /api/task-connectors/:slug/deliveries — recent history
// ---------------------------------------------------------------------------

async function listDeliveries(
	tenantId: string,
	slug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const [webhook] = await db
		.select({ id: webhooks.id })
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!webhook) return json([]);

	const params = event.queryStringParameters || {};
	const limit = Math.min(Number(params.limit) || 50, 200);
	const cursor = params.cursor ? new Date(params.cursor) : null;

	const conditions = [eq(webhookDeliveries.webhook_id, webhook.id)];
	if (cursor) conditions.push(lt(webhookDeliveries.received_at, cursor));

	const rows = await db
		.select({
			id: webhookDeliveries.id,
			received_at: webhookDeliveries.received_at,
			resolution_status: webhookDeliveries.resolution_status,
			signature_status: webhookDeliveries.signature_status,
			normalized_kind: webhookDeliveries.normalized_kind,
			external_task_id: webhookDeliveries.external_task_id,
			provider_user_id: webhookDeliveries.provider_user_id,
			thread_id: webhookDeliveries.thread_id,
			thread_created: webhookDeliveries.thread_created,
			status_code: webhookDeliveries.status_code,
			error_message: webhookDeliveries.error_message,
			duration_ms: webhookDeliveries.duration_ms,
			body_preview: webhookDeliveries.body_preview,
			body_size_bytes: webhookDeliveries.body_size_bytes,
			is_replay: webhookDeliveries.is_replay,
		})
		.from(webhookDeliveries)
		.where(and(...conditions))
		.orderBy(desc(webhookDeliveries.received_at))
		.limit(limit);

	return json(rows);
}

// ---------------------------------------------------------------------------
// POST /api/task-connectors/:slug/test — fire synthetic event
// ---------------------------------------------------------------------------

async function testConnector(
	tenantId: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select()
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const [webhook] = await db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!webhook) {
		return error(
			"Connector is not enabled for this tenant. Enable it first.",
			400,
		);
	}

	// Pick a real connected user so the ingest pipeline can resolve a target.
	const [conn] = await db
		.select({ metadata: connections.metadata })
		.from(connections)
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.provider_id, provider.id),
				eq(connections.status, "active"),
			),
		)
		.limit(1);

	if (!conn) {
		return error(
			"Connect at least one user via Settings → Integrations before testing.",
			400,
		);
	}

	const meta = (conn.metadata as Record<string, unknown> | null) ?? {};
	const providerMeta = (meta[slug] as Record<string, unknown> | undefined) ?? {};
	const providerUserId = providerMeta.userId as string | undefined;
	if (!providerUserId) {
		return error(
			`Connected user has no ${slug}.userId in connection metadata. Reconnect via OAuth.`,
			400,
		);
	}

	// Build a synthetic LastMile-shaped payload that matches the real
	// outbox event format (batched array). When a new provider lands,
	// branch on slug here to build its native shape.
	const syntheticTaskId = `test_task_${randomBytes(4).toString("hex")}`;
	const nowIso = new Date().toISOString();
	const testPayload = [
		{
			eventId: `test_${randomBytes(8).toString("hex")}`,
			occurredAt: nowIso,
			resource: "task",
			action: "updated",
			entityId: syntheticTaskId,
			task: {
				id: syntheticTaskId,
				title: "Test event from Connectors page",
				status: "todo",
				assignee_id: providerUserId,
				description:
					"Synthetic test event fired from the admin Connectors page.",
				created_at: nowIso,
				updated_at: nowIso,
			},
		},
	];

	const url = webhookUrlForToken(webhook.token);
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-request-id": `test-${Date.now()}`,
		},
		body: JSON.stringify(testPayload),
	});

	const body = await res.json().catch(() => ({}));
	return json(
		{
			ok: res.ok,
			status: res.status,
			webhook_url: url,
			response: body,
		},
		res.ok ? 200 : 502,
	);
}

// ---------------------------------------------------------------------------
// Secret lifecycle
// ---------------------------------------------------------------------------

async function generateSecret(
	tenantId: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const [existing] = await db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!existing) {
		return error(
			"Connector is not enabled. Enable it before generating a secret.",
			400,
		);
	}

	const newSecret = generateToken();
	const currentCfg = (existing.config ?? {}) as Record<string, unknown>;
	await db
		.update(webhooks)
		.set({
			config: { ...currentCfg, secret: newSecret },
			updated_at: new Date(),
		})
		.where(eq(webhooks.id, existing.id));

	return json({ ok: true, secret: newSecret });
}

// ---------------------------------------------------------------------------
// PATCH /api/task-connectors/:slug/config — per-tenant connector settings
// ---------------------------------------------------------------------------

/** Fields admins can write via the connector config endpoint. JSONB schema
 *  is open-ended in the DB, but this allow-list keeps unknown keys out. */
type AllowedConfigKey = "baseUrl";

async function updateConfig(
	tenantId: string,
	slug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const [existing] = await db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!existing) {
		return error(
			"Connector is not enabled. Enable it before editing config.",
			400,
		);
	}

	// Parse + validate body. Reject unknown keys so a typo in the UI doesn't
	// silently persist dead config.
	let body: unknown;
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return error("Invalid JSON body", 400);
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return error("Body must be a JSON object", 400);
	}

	const ALLOWED: ReadonlySet<AllowedConfigKey> = new Set(["baseUrl"]);
	const updates: Partial<Record<AllowedConfigKey, string | null>> = {};
	for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
		if (!ALLOWED.has(key as AllowedConfigKey)) {
			return error(`Unknown config key: ${key}`, 400);
		}
		// Only string values or null (to clear the field) are accepted.
		if (value !== null && typeof value !== "string") {
			return error(`Config value for ${key} must be string or null`, 400);
		}
		if (key === "baseUrl" && typeof value === "string") {
			try {
				const parsed = new URL(value);
				if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
					return error("baseUrl must be http(s)", 400);
				}
			} catch {
				return error("baseUrl is not a valid URL", 400);
			}
		}
		updates[key as AllowedConfigKey] = value;
	}

	const currentCfg = (existing.config ?? {}) as Record<string, unknown>;
	const nextCfg: Record<string, unknown> = { ...currentCfg };
	for (const [k, v] of Object.entries(updates)) {
		if (v === null || v === "") delete nextCfg[k];
		else nextCfg[k] = v;
	}

	await db
		.update(webhooks)
		.set({ config: nextCfg, updated_at: new Date() })
		.where(eq(webhooks.id, existing.id));

	return json({
		ok: true,
		config: {
			baseUrl:
				typeof nextCfg.baseUrl === "string" && nextCfg.baseUrl.length > 0
					? nextCfg.baseUrl
					: null,
		},
	});
}

async function removeSecret(
	tenantId: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, slug));
	if (!provider) return notFound(`Connector '${slug}' not found`);

	const [existing] = await db
		.select()
		.from(webhooks)
		.where(
			and(
				eq(webhooks.tenant_id, tenantId),
				eq(webhooks.target_type, "task"),
				eq(webhooks.connect_provider_id, provider.id),
			),
		);
	if (!existing) return notFound("Connector not enabled");

	const currentCfg = (existing.config ?? {}) as Record<string, unknown>;
	const { secret: _removed, ...rest } = currentCfg;
	await db
		.update(webhooks)
		.set({ config: rest, updated_at: new Date() })
		.where(eq(webhooks.id, existing.id));

	return json({ ok: true });
}
