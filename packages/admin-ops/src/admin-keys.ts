/**
 * Per-tenant admin-MCP key management.
 *
 * Deliberately NOT exposed as MCP tools — key creation via the MCP server
 * would be a trivial privilege escalation (any agent with a tenant key
 * could mint sibling keys). These functions are for the CLI and the
 * admin SPA only; both authenticate with the bootstrap API_AUTH_SECRET
 * or a human Cognito session.
 */

import type { AdminOpsClient } from "./client.js";

export interface AdminKeySummary {
	id: string;
	name: string;
	created_at: string | null;
	created_by_user_id: string | null;
	last_used_at: string | null;
	revoked_at: string | null;
}

export interface AdminKeyCreateResponse {
	id: string;
	name: string;
	/** Raw token. Shown ONCE. Never retrievable again. */
	token: string;
	created_at: string | null;
}

export interface AdminKeyCreateInput {
	name?: string;
	/** Optional attribution — caller's user UUID when a human is creating. */
	created_by_user_id?: string;
}

export async function createAdminKey(
	client: AdminOpsClient,
	tenantIdOrSlug: string,
	input: AdminKeyCreateInput = {},
): Promise<AdminKeyCreateResponse> {
	return client.fetch<AdminKeyCreateResponse>(
		`/api/tenants/${encodeURIComponent(tenantIdOrSlug)}/mcp-admin-keys`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export async function listAdminKeys(
	client: AdminOpsClient,
	tenantIdOrSlug: string,
): Promise<AdminKeySummary[]> {
	const res = await client.fetch<{ keys: AdminKeySummary[] }>(
		`/api/tenants/${encodeURIComponent(tenantIdOrSlug)}/mcp-admin-keys`,
	);
	return res.keys;
}

export async function revokeAdminKey(
	client: AdminOpsClient,
	tenantIdOrSlug: string,
	keyId: string,
): Promise<void> {
	await client.fetch<unknown>(
		`/api/tenants/${encodeURIComponent(tenantIdOrSlug)}/mcp-admin-keys/${encodeURIComponent(keyId)}`,
		{ method: "DELETE" },
	);
}
