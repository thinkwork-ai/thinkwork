/**
 * Build MCP server configs for an agent invocation.
 *
 * Queries two registries and merges:
 *   - tenant: `agent_mcp_servers` ⋈ `tenant_mcp_servers` (third-party connectors)
 *   - admin:  `agent_admin_mcp_servers` ⋈ `admin_mcp_servers` (admin-ops)
 *
 * Auth (`tenant_api_key`, `oauth`, `per_user_oauth` with refresh-on-expiry)
 * resolves identically for both registries via `resolveMcpAuth`. Servers
 * whose auth can't be resolved are logged and skipped.
 *
 * During the migration window between this unit (U2) and U9 (legacy
 * cleanup), an `admin-ops`-slugged row can exist in BOTH registries.
 * If that happens for a single agent, the admin row wins and a
 * deprecation warning fires naming the tenant row.
 *
 * Plan: docs/plans/2026-05-05-001-refactor-admin-ops-mcp-separation-plan.md
 *
 * Called from both the wakeup processor (scheduled/triggered
 * invocations) and chat-agent-invoke (direct chat turns).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	tenantMcpServers,
	agentMcpServers,
	adminMcpServers,
	agentAdminMcpServers,
	userMcpTokens,
} from "@thinkwork/database-pg/schema";
import {
	SecretsManagerClient,
	GetSecretValueCommand,
	UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { mcpHashMatches } from "./mcp-server-hash.js";

export interface McpServerConfig {
	name: string;
	url: string;
	transport: "streamable-http" | "sse";
	auth?: { type: string; token: string };
	tools?: string[];
	/**
	 * True when this entry came from the admin-MCP registry
	 * (`admin_mcp_servers`). False (or omitted) for the tenant registry.
	 * Surfaces in CloudWatch so operators can audit which agents had
	 * admin tools at turn N.
	 */
	is_admin?: boolean;
}

const db = getDb();

/**
 * Shape produced by both registry queries. The same struct flows through
 * the hash-pin check + auth resolver regardless of source.
 */
interface McpRow {
	mcp_server_id: string;
	name: string;
	slug: string;
	url: string;
	transport: string;
	auth_type: string;
	auth_config: unknown;
	server_enabled: boolean;
	server_status: string;
	server_url_hash: string | null;
	assignment_enabled: boolean;
	assignment_config: unknown;
}

/**
 * Resolve the bearer token for a single MCP row, applying the auth
 * model (`none` / `tenant_api_key` / `oauth` / `per_user_oauth`).
 *
 * For per-user OAuth, this looks up `user_mcp_tokens`, hydrates the
 * secret from Secrets Manager, refreshes if expiring within 5 minutes,
 * and persists the rotated secret + new expiry. WorkOS public-client
 * refresh requires `client_id` from `auth_config`.
 *
 * Returns `undefined` when no token applies (auth_type='none') or
 * when the resolution path failed in a recoverable way (already logged).
 * Caller decides whether the row is then skipped (tenant_api_key /
 * oauth without a token) or kept (none).
 */
async function resolveMcpAuth(
	mcp: McpRow,
	humanPairId: string | null | undefined,
	logPrefix: string,
): Promise<string | undefined> {
	if (mcp.auth_type === "tenant_api_key") {
		const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
		return authCfg.token as string | undefined;
	}

	if (mcp.auth_type !== "oauth" && mcp.auth_type !== "per_user_oauth") {
		return undefined;
	}

	if (!humanPairId) return undefined;

	try {
		const [userToken] = await db
			.select({
				id: userMcpTokens.id,
				secret_ref: userMcpTokens.secret_ref,
				status: userMcpTokens.status,
				expires_at: userMcpTokens.expires_at,
			})
			.from(userMcpTokens)
			.where(
				and(
					eq(userMcpTokens.user_id, humanPairId),
					eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
					eq(userMcpTokens.status, "active"),
				),
			)
			.limit(1);

		if (!userToken?.secret_ref) {
			console.warn(
				`${logPrefix} No active MCP token for user ${humanPairId} (MCP: ${mcp.slug})`,
			);
			return undefined;
		}

		const sm = new SecretsManagerClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
		const secret = await sm.send(
			new GetSecretValueCommand({ SecretId: userToken.secret_ref }),
		);
		if (!secret.SecretString) return undefined;

		const parsed = JSON.parse(secret.SecretString);
		const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
		const isExpired =
			userToken.expires_at &&
			new Date(userToken.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;

		if (!isExpired || !parsed.refresh_token) {
			return parsed.access_token;
		}

		// WorkOS public-client refresh REQUIRES client_id in the body.
		// It's stored in {tenant,admin}_mcp_servers.auth_config at DCR time.
		const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
		const clientId =
			typeof authCfg.client_id === "string" ? authCfg.client_id : "";
		if (!clientId) {
			console.warn(
				`${logPrefix} MCP token for ${mcp.slug} needs refresh but auth_config.client_id is missing; user must reconnect from mobile to re-run DCR`,
			);
			return parsed.access_token;
		}

		console.log(
			`${logPrefix} MCP token expired for ${mcp.slug}, refreshing...`,
		);
		// Equivalence with the original (origin/main) buildMcpConfigs:
		// every failure path inside the refresh attempt left `token`
		// undefined so the caller's `if (!token) continue` SKIPPED the
		// server. Returning the stale `parsed.access_token` instead would
		// hand the runtime an already-expired credential (worse: when
		// refreshRes is 4xx we have just marked the row status='expired',
		// so the access_token is provably dead). Preserve the original
		// skip-the-server behavior by returning undefined on every
		// refresh-step failure.
		try {
			const mcpBaseUrl = mcp.url.replace(/\/+$/, "");
			const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
			const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;
			const resMeta = await fetch(wellKnownUrl, {
				signal: AbortSignal.timeout(5000),
			});
			if (!resMeta.ok) return undefined;

			const meta = (await resMeta.json()) as {
				authorization_servers?: string[];
			};
			const authServer = meta.authorization_servers?.[0];
			if (!authServer) return undefined;

			const authMetaRes = await fetch(
				`${authServer}/.well-known/oauth-authorization-server`,
				{ signal: AbortSignal.timeout(5000) },
			).catch(() => null);
			const oidcRes = authMetaRes?.ok
				? authMetaRes
				: await fetch(`${authServer}/.well-known/openid-configuration`, {
						signal: AbortSignal.timeout(5000),
					});
			if (!oidcRes.ok) return undefined;

			const authMeta = (await oidcRes.json()) as { token_endpoint: string };
			const refreshRes = await fetch(authMeta.token_endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: parsed.refresh_token,
					client_id: clientId,
				}).toString(),
				signal: AbortSignal.timeout(10000),
			});

			if (!refreshRes.ok) {
				const errBody = await refreshRes.text().catch(() => "");
				console.warn(
					`${logPrefix} MCP token refresh failed for ${mcp.slug}: ${refreshRes.status} ${errBody}`,
				);
				await db
					.update(userMcpTokens)
					.set({ status: "expired", updated_at: new Date() })
					.where(eq(userMcpTokens.id, userToken.id));
				return undefined;
			}

			const refreshData = (await refreshRes.json()) as {
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
			};
			const updatedSecret = {
				access_token: refreshData.access_token,
				refresh_token: refreshData.refresh_token || parsed.refresh_token,
				token_type: parsed.token_type || "Bearer",
				obtained_at: new Date().toISOString(),
			};
			await sm.send(
				new UpdateSecretCommand({
					SecretId: userToken.secret_ref,
					SecretString: JSON.stringify(updatedSecret),
				}),
			);
			const newExpiry = refreshData.expires_in
				? new Date(Date.now() + refreshData.expires_in * 1000)
				: null;
			await db
				.update(userMcpTokens)
				.set({ expires_at: newExpiry, updated_at: new Date() })
				.where(eq(userMcpTokens.id, userToken.id));
			console.log(`${logPrefix} MCP token refreshed for ${mcp.slug}`);
			return refreshData.access_token;
		} catch (refreshErr) {
			console.warn(
				`${logPrefix} MCP token refresh error for ${mcp.slug}:`,
				refreshErr,
			);
			// Equivalence: original code's catch left token undefined so
			// the caller skipped the server. Same here.
			return undefined;
		}
	} catch (err) {
		console.warn(`${logPrefix} MCP token lookup failed for ${mcp.slug}:`, err);
		return undefined;
	}
}

/**
 * Apply the hash-pin check + auth resolution to a batch of MCP rows
 * and produce the runtime config entries.
 *
 * Tags every produced entry with the registry origin via `isAdmin`.
 */
async function processRows(
	rows: McpRow[],
	humanPairId: string | null | undefined,
	isAdmin: boolean,
	logPrefix: string,
): Promise<McpServerConfig[]> {
	const out: McpServerConfig[] = [];
	for (const mcp of rows) {
		if (!mcp.server_enabled) continue;

		// Defensive invariant (SI-5): the SQL WHERE already filters by
		// status='approved', but drift between `url_hash` and the current
		// (url, auth_config) means the approval no longer applies. Skip
		// without blocking the rest of the agent's MCP fleet.
		//
		// `url_hash IS NULL` means the row was pre-existing at the U3
		// migration that grandfathered live servers in as approved
		// without computing a hash — allow it. New approvals always
		// write url_hash, so future mutations are hash-guarded.
		if (
			mcp.server_url_hash &&
			!mcpHashMatches(
				mcp.server_url_hash,
				mcp.url,
				mcp.auth_config as Record<string, unknown> | null,
			)
		) {
			console.warn(
				`${logPrefix} skipping ${mcp.slug}: url_hash mismatch with (url, auth_config); re-approval required`,
			);
			continue;
		}

		const token = await resolveMcpAuth(mcp, humanPairId, logPrefix);

		if (mcp.auth_type === "tenant_api_key" && !token) {
			console.warn(
				`${logPrefix} Skipping MCP ${mcp.slug}: tenant API key not configured`,
			);
			continue;
		}
		if (
			(mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") &&
			!token
		) {
			console.warn(
				`${logPrefix} Skipping MCP ${mcp.slug}: user has not completed OAuth`,
			);
			continue;
		}

		const assignCfg = (mcp.assignment_config as Record<string, unknown>) || {};
		out.push({
			name: mcp.slug,
			url: mcp.url,
			transport:
				(mcp.transport as "streamable-http" | "sse") || "streamable-http",
			auth: token ? { type: "bearer", token } : undefined,
			tools: Array.isArray(assignCfg.toolAllowlist)
				? (assignCfg.toolAllowlist as string[])
				: undefined,
			...(isAdmin ? { is_admin: true } : {}),
		});
	}
	return out;
}

export async function buildMcpConfigs(
	agentId: string,
	humanPairId: string | null | undefined,
	logPrefix = "[mcp-configs]",
): Promise<McpServerConfig[]> {
	// U11 gate (tenant): only approved + enabled servers reach the runtime.
	const tenantRows = (await db
		.select({
			mcp_server_id: tenantMcpServers.id,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			transport: tenantMcpServers.transport,
			auth_type: tenantMcpServers.auth_type,
			auth_config: tenantMcpServers.auth_config,
			server_enabled: tenantMcpServers.enabled,
			server_status: tenantMcpServers.status,
			server_url_hash: tenantMcpServers.url_hash,
			assignment_enabled: agentMcpServers.enabled,
			assignment_config: agentMcpServers.config,
		})
		.from(agentMcpServers)
		.innerJoin(
			tenantMcpServers,
			eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
		)
		.where(
			and(
				eq(agentMcpServers.agent_id, agentId),
				eq(agentMcpServers.enabled, true),
				eq(tenantMcpServers.status, "approved"),
				eq(tenantMcpServers.enabled, true),
			),
		)) as McpRow[];

	// Admin registry — same gate, separate table. A failure here must not
	// take down tenant configs (matches the per-server skip behavior in
	// processRows). Caught + logged; tenant configs still flow.
	let adminRows: McpRow[] = [];
	try {
		adminRows = (await db
			.select({
				mcp_server_id: adminMcpServers.id,
				name: adminMcpServers.name,
				slug: adminMcpServers.slug,
				url: adminMcpServers.url,
				transport: adminMcpServers.transport,
				auth_type: adminMcpServers.auth_type,
				auth_config: adminMcpServers.auth_config,
				server_enabled: adminMcpServers.enabled,
				server_status: adminMcpServers.status,
				server_url_hash: adminMcpServers.url_hash,
				assignment_enabled: agentAdminMcpServers.enabled,
				assignment_config: agentAdminMcpServers.config,
			})
			.from(agentAdminMcpServers)
			.innerJoin(
				adminMcpServers,
				eq(agentAdminMcpServers.mcp_server_id, adminMcpServers.id),
			)
			.where(
				and(
					eq(agentAdminMcpServers.agent_id, agentId),
					eq(agentAdminMcpServers.enabled, true),
					eq(adminMcpServers.status, "approved"),
					eq(adminMcpServers.enabled, true),
				),
			)) as McpRow[];
	} catch (err) {
		console.warn(`${logPrefix} admin MCP query failed:`, err);
	}

	const tenantConfigs = await processRows(
		tenantRows,
		humanPairId,
		false,
		logPrefix,
	);
	const adminConfigs = await processRows(
		adminRows,
		humanPairId,
		true,
		logPrefix,
	);

	// Migration-window dedup: during U2..U9 the legacy `admin-ops` row in
	// `tenant_mcp_servers` may still resolve for an agent alongside the
	// new admin row. The admin row wins; warn (with the legacy row's
	// mcp_server_id so operators have a directly-actionable id) so the
	// resurrected legacy row gets chased down.
	//
	// IMPORTANT: dedup is scoped to slug='admin-ops' only. The admin
	// registry should only ever carry admin-class slugs (admin-ops today).
	// A collision on any OTHER slug between the two registries is a
	// configuration corruption — treat as an unexpected error rather
	// than letting admin silently shadow user-facing connectors.
	// Build the slug set from RAW admin rows (not adminConfigs) so that
	// an admin row dropped by hash-pin / auth-skip still shadows its
	// colliding tenant row — the dedup is about the structural intent,
	// not the per-turn resolution outcome.
	const ADMIN_OPS_SLUG = "admin-ops";
	const adminRowsBySlug = new Map(adminRows.map((r) => [r.slug, r]));
	const tenantRowsBySlug = new Map(tenantRows.map((r) => [r.slug, r]));
	const merged: McpServerConfig[] = [...adminConfigs];
	for (const tenantCfg of tenantConfigs) {
		if (!adminRowsBySlug.has(tenantCfg.name)) {
			merged.push(tenantCfg);
			continue;
		}
		if (tenantCfg.name === ADMIN_OPS_SLUG) {
			const tenantRow = tenantRowsBySlug.get(tenantCfg.name);
			console.warn(
				`${logPrefix} legacy tenant_mcp_servers row for slug=admin-ops (mcp_server_id=${tenantRow?.mcp_server_id ?? "unknown"}) shadowed by admin_mcp_servers; admin entry wins (deprecation: U9 will drop the tenant row)`,
			);
			continue;
		}
		// Non-admin-ops collision: cross-registry slug clash that should
		// not happen post-U6. Log as error so it surfaces in CloudWatch
		// alarms; keep the tenant entry (the user-facing connector) and
		// drop the admin one to avoid a silent name-takeover.
		const adminRow = adminRowsBySlug.get(tenantCfg.name);
		console.error(
			`${logPrefix} unexpected cross-registry slug collision: slug=${tenantCfg.name} appears in tenant_mcp_servers (mcp_server_id=${tenantRowsBySlug.get(tenantCfg.name)?.mcp_server_id}) AND admin_mcp_servers (mcp_server_id=${adminRow?.mcp_server_id}). Keeping the tenant entry; dropping the admin one.`,
		);
		const adminIdx = merged.findIndex(
			(c) => c.name === tenantCfg.name && c.is_admin,
		);
		if (adminIdx >= 0) merged.splice(adminIdx, 1);
		merged.push(tenantCfg);
	}

	// Always log resolved counts — even when zero. A wakeup turn that
	// resolved zero MCPs (e.g., admin query failed AND agent only had
	// admin-MCP attached) used to leave no breadcrumb at all; operators
	// could not distinguish "agent designed this way" from "config
	// silently broke."
	console.log(
		`${logPrefix} MCP configs built: agent=${agentId} tenant=${tenantConfigs.length} admin=${adminConfigs.length} merged=${merged.length}${
			merged.length > 0
				? ` (${merged
						.map((c) => `${c.name}${c.is_admin ? " [admin]" : ""}`)
						.join(", ")})`
				: ""
		}`,
	);

	return merged;
}
