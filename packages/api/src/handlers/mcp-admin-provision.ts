/**
 * mcp-admin-provision — idempotent one-shot provisioning of the admin-ops
 * MCP for a tenant.
 *
 * Wraps three steps that every tenant needs before its agents can use the
 * admin-ops MCP server:
 *
 *   1. Mint a fresh tenant-scoped Bearer token (tkm_…) in
 *      tenant_mcp_admin_keys — same helper PR #482 added.
 *   2. Store the raw token in Secrets Manager at
 *      `thinkwork/<stage>/mcp/<tenantId>/admin-ops`.
 *   3. Upsert a row in tenant_mcp_servers with slug="admin-ops",
 *      auth_type="tenant_api_key", auth_config={secretRef, token}.
 *      The `token` field is duplicated in auth_config for backward
 *      compat with mcp-configs.ts, which today reads the plaintext.
 *
 * After this handler succeeds, agents are still NOT subscribed — the
 * admin still needs to assign the server to each agent via
 * agent_mcp_servers (either through the admin SPA, GraphQL, or a
 * future agent-assignment endpoint). This is intentional: provisioning
 * the tenant surface and enabling it per-agent are separate decisions.
 *
 * Routes:
 *   POST /api/tenants/:tenantId/mcp-admin-provision
 *     Authorization: Bearer <API_AUTH_SECRET> (bootstrap auth path)
 *     body: { url?: string, name?: string, createdByUserId?: string }
 *       url — override MCP endpoint URL. Defaults to the stage's own
 *             API Gateway URL + /mcp/admin.
 *       name — human label for the tenant_mcp_admin_keys row.
 *       createdByUserId — delegate MCP calls through this user's
 *         principal. Resolvers gated on tenant-admin look up
 *         ctx.auth.principalId against tenant_members; without a
 *         real user here, admin-scoped tools refuse. Defaults to the
 *         tenant's earliest-joined active owner.
 *     → 201 { tenantMcpServerId, keyId, secretArn, url, provisioned,
 *             createdByUserId }
 *       provisioned: "created" | "rotated" — "rotated" when an earlier
 *       admin-ops slug already existed; the old key is revoked.
 *       createdByUserId: the user the MCP key was minted against
 *       (echoed so the caller can confirm the delegation).
 *
 * Bootstrap via validateApiSecret matches mcp-admin-keys + sandbox-quota.
 * A Cognito-aware auth path will land with the admin SPA's provisioning UI.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
	SecretsManagerClient,
	CreateSecretCommand,
	UpdateSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { getDb } from "@thinkwork/database-pg";
import {
	tenantMcpAdminKeys,
	tenantMcpServers,
	tenantMembers,
	tenants,
} from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, notFound, unauthorized } from "../lib/response.js";
import { generateToken } from "./mcp-admin-keys.js";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_OPS_SLUG = "admin-ops";
const DEFAULT_MCP_NAME = "Thinkwork Admin Ops";

const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Resolve the default MCP URL for this stage. Preference order:
 *   1. MCP_CUSTOM_DOMAIN env (mcp.thinkwork.ai — not live until PR #3's DNS dance)
 *   2. THINKWORK_API_URL env + /mcp/admin (execute-api fallback that always works)
 */
function defaultMcpUrl(): string {
	const custom = process.env.MCP_CUSTOM_DOMAIN;
	if (custom) return `https://${custom.replace(/^https?:\/\//, "")}/mcp/admin`;
	const apiUrl = process.env.THINKWORK_API_URL;
	if (!apiUrl) throw new Error("Neither MCP_CUSTOM_DOMAIN nor THINKWORK_API_URL is set");
	return `${apiUrl.replace(/\/+$/, "")}/mcp/admin`;
}

function secretNameFor(tenantId: string): string {
	return `thinkwork/${STAGE}/mcp/${tenantId}/admin-ops`;
}

// ---------------------------------------------------------------------------
// Tenant resolution (accepts UUID or slug)
// ---------------------------------------------------------------------------

async function resolveTenantUuid(db: ReturnType<typeof getDb>, idOrSlug: string) {
	if (UUID_RE.test(idOrSlug)) {
		const [row] = await db
			.select({ id: tenants.id })
			.from(tenants)
			.where(eq(tenants.id, idOrSlug))
			.limit(1);
		return row?.id ?? null;
	}
	const [row] = await db
		.select({ id: tenants.id })
		.from(tenants)
		.where(eq(tenants.slug, idOrSlug))
		.limit(1);
	return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Secrets Manager upsert
// ---------------------------------------------------------------------------

async function putSecret(
	name: string,
	value: string,
): Promise<string> {
	const payload = JSON.stringify({ type: "mcpApiKey", token: value });
	try {
		const res = await sm.send(
			new UpdateSecretCommand({ SecretId: name, SecretString: payload }),
		);
		return res.ARN ?? name;
	} catch (err: unknown) {
		if (err instanceof ResourceNotFoundException) {
			const res = await sm.send(
				new CreateSecretCommand({ Name: name, SecretString: payload }),
			);
			return res.ARN ?? name;
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") {
		return {
			statusCode: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST,OPTIONS",
				"Access-Control-Allow-Headers": "*",
			},
			body: "",
		};
	}

	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	if (event.requestContext.http.method !== "POST") {
		return error("Method not allowed", 405);
	}

	const match = event.rawPath.match(
		/^\/api\/tenants\/([^/]+)\/mcp-admin-provision\/?$/,
	);
	if (!match) return notFound("Route not found");

	const tenantIdOrSlug = match[1]!;

	let body: { url?: string; name?: string; createdByUserId?: string };
	try {
		body = JSON.parse(event.body || "{}");
	} catch {
		return error("Invalid JSON body", 400);
	}

	const url = (body.url?.trim() || defaultMcpUrl()).trim();
	if (!/^https?:\/\//i.test(url)) {
		return error("url must be an http(s) URL", 400);
	}
	const keyName = (body.name?.trim() || "default").slice(0, 100);

	if (body.createdByUserId && !UUID_RE.test(body.createdByUserId)) {
		return error("createdByUserId must be a valid UUID", 400);
	}

	try {
		const db = getDb();
		const tenantId = await resolveTenantUuid(db, tenantIdOrSlug);
		if (!tenantId) return notFound("Tenant not found");

		// Resolve the user the key will be minted against. Priority:
		//   1. body.createdByUserId — explicit caller override (CLI flag or UI).
		//   2. Earliest-joined active owner of the tenant — the natural admin
		//      to delegate MCP calls through; guarantees a valid principalId
		//      on every tool invocation.
		//   3. null — no tenant has an owner (shouldn't happen post-signup);
		//      resolvers gated on admin role will refuse, which is the
		//      fail-safe outcome.
		let createdByUserId: string | null = body.createdByUserId ?? null;
		if (!createdByUserId) {
			const [owner] = await db
				.select({ principalId: tenantMembers.principal_id })
				.from(tenantMembers)
				.where(and(
					eq(tenantMembers.tenant_id, tenantId),
					eq(tenantMembers.role, "owner"),
					eq(tenantMembers.principal_type, "user"),
					eq(tenantMembers.status, "active"),
				))
				.orderBy(asc(tenantMembers.created_at))
				.limit(1);
			createdByUserId = owner?.principalId ?? null;
		}

		// 1. Revoke any existing active key with the same (tenant, name).
		// The partial unique index `uq_tenant_mcp_admin_keys_active_name`
		// (tenant_id, name) WHERE revoked_at IS NULL would otherwise
		// collide the INSERT below. Running revoke-before-insert makes
		// `thinkwork mcp provision --all` idempotent — a re-run rotates
		// the "default" key without operator intervention.
		await db
			.update(tenantMcpAdminKeys)
			.set({ revoked_at: new Date() })
			.where(and(
				eq(tenantMcpAdminKeys.tenant_id, tenantId),
				eq(tenantMcpAdminKeys.name, keyName),
				isNull(tenantMcpAdminKeys.revoked_at),
			));

		// 2. Generate + insert the new tenant-scoped admin key.
		const { raw, hash } = generateToken();
		const [keyRow] = await db
			.insert(tenantMcpAdminKeys)
			.values({
				tenant_id: tenantId,
				key_hash: hash,
				name: keyName,
				created_by_user_id: createdByUserId,
			})
			.returning({ id: tenantMcpAdminKeys.id });

		if (!keyRow) {
			return error("Failed to create admin key", 500);
		}

		// 2. Store raw token in Secrets Manager.
		const secretName = secretNameFor(tenantId);
		const secretArn = await putSecret(secretName, raw);

		// 3. Upsert tenant_mcp_servers row for admin-ops.
		const [existingServer] = await db
			.select({
				id: tenantMcpServers.id,
				auth_config: tenantMcpServers.auth_config,
			})
			.from(tenantMcpServers)
			.where(and(
				eq(tenantMcpServers.tenant_id, tenantId),
				eq(tenantMcpServers.slug, ADMIN_OPS_SLUG),
			))
			.limit(1);

		let tenantMcpServerId: string;
		let provisioned: "created" | "rotated";
		const authConfig = { secretRef: secretName, token: raw };

		if (existingServer) {
			await db
				.update(tenantMcpServers)
				.set({
					name: DEFAULT_MCP_NAME,
					url,
					transport: "streamable-http",
					auth_type: "tenant_api_key",
					auth_config: authConfig,
					enabled: true,
					updated_at: new Date(),
				})
				.where(eq(tenantMcpServers.id, existingServer.id));
			tenantMcpServerId = existingServer.id;
			provisioned = "rotated";
			// The same-name key was already revoked in step 1, so the old
			// default token is dead. Other named keys (e.g. "ci") are
			// intentionally left alone — each name is a separate credential
			// for a separate consumer.
		} else {
			const [inserted] = await db
				.insert(tenantMcpServers)
				.values({
					tenant_id: tenantId,
					name: DEFAULT_MCP_NAME,
					slug: ADMIN_OPS_SLUG,
					url,
					transport: "streamable-http",
					auth_type: "tenant_api_key",
					auth_config: authConfig,
					enabled: true,
				})
				.returning({ id: tenantMcpServers.id });
			if (!inserted) return error("Failed to create tenant_mcp_servers row", 500);
			tenantMcpServerId = inserted.id;
			provisioned = "created";
		}

		return json(
			{
				tenantMcpServerId,
				keyId: keyRow.id,
				secretArn,
				url,
				provisioned,
				createdByUserId,
			},
			201,
		);
	} catch (err: unknown) {
		console.error("mcp-admin-provision handler error:", err);
		const message = err instanceof Error ? err.message : String(err);
		return error(`Internal server error: ${message}`, 500);
	}
}
