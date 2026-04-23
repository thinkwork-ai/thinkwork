/**
 * Lightweight caller-identity endpoint.
 *
 * GET /api/auth/me
 *
 * Cognito-authenticated. Returns just enough about the caller to gate
 * UI affordances (e.g. owner-only nav items) without forcing a GraphQL
 * round-trip through the admin urql client. Both admin Sidebar and
 * mobile Settings consume this.
 *
 *   200 → { email, tenantId, role, name }
 *   401 → unauthenticated
 *   403 → authenticated but no tenant resolved (pre-bootstrap state)
 *
 * Role comes from tenant_members.role for (tenantId, userId) — the
 * same shape requireTenantAdmin() checks server-side. Null when the
 * caller is authenticated but not yet a member (edge case during
 * provisioning; UI treats as non-owner).
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { users, tenantMembers } = schema;

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	if (event.requestContext.http.method !== "GET") {
		return error("Method not allowed", 405);
	}

	const auth = await authenticate(
		event.headers as Record<string, string | undefined>,
	);
	if (!auth || !auth.email) {
		return unauthorized("Authentication required");
	}

	const emailLower = auth.email.toLowerCase();

	// Resolve user row (canonical source for id + tenant_id + name).
	const [userRow] = await db
		.select()
		.from(users)
		.where(eq(users.email, emailLower))
		.limit(1);

	if (!userRow) {
		return json(
			{
				email: auth.email,
				tenantId: null,
				role: null,
				name: null,
				note: "user_not_bootstrapped",
			},
			200,
		);
	}

	const tenantId = userRow.tenant_id;
	if (!tenantId) {
		return json({
			email: userRow.email,
			tenantId: null,
			role: null,
			name: userRow.name ?? null,
		});
	}

	// Look up the caller's role in this tenant. Matched on
	// (tenant_id, principal_type='user', principal_id=userRow.id) —
	// the shape tenant_members uses.
	const [memberRow] = await db
		.select()
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_type, "user"),
				eq(tenantMembers.principal_id, userRow.id),
			),
		)
		.limit(1);

	return json({
		email: userRow.email,
		tenantId,
		role: memberRow?.role ?? null,
		name: userRow.name ?? null,
	});
}
