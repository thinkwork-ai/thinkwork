import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

const { tenants, tenantMembers, tenantSettings } = schema;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// GET /api/tenants/by-slug/:slug (must match before /:id)
		const slugMatch = path.match(/^\/api\/tenants\/by-slug\/([^/]+)$/);
		if (slugMatch && method === "GET") {
			return getTenantBySlug(slugMatch[1]);
		}

		// Routes with /api/tenants/:id/members/:memberId
		const memberDetailMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/members\/([^/]+)$/,
		);
		if (memberDetailMatch) {
			const [, tenantId, memberId] = memberDetailMatch;
			if (method === "DELETE") return removeMember(tenantId, memberId);
			if (method === "PUT") return updateMemberRole(tenantId, memberId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id/members
		const membersMatch = path.match(/^\/api\/tenants\/([^/]+)\/members$/);
		if (membersMatch) {
			const tenantId = membersMatch[1];
			if (method === "GET") return listMembers(tenantId);
			if (method === "POST") return addMember(tenantId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id/settings
		const settingsMatch = path.match(/^\/api\/tenants\/([^/]+)\/settings$/);
		if (settingsMatch) {
			const tenantId = settingsMatch[1];
			if (method === "GET") return getSettings(tenantId);
			if (method === "PUT") return updateSettings(tenantId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id
		const idMatch = path.match(/^\/api\/tenants\/([^/]+)$/);
		if (idMatch) {
			const tenantId = idMatch[1];
			if (method === "GET") return getTenant(tenantId);
			if (method === "PUT") return updateTenant(tenantId, event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Tenants handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Tenant CRUD
// ---------------------------------------------------------------------------

async function getTenant(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
	if (!tenant) return notFound("Tenant not found");
	return json(tenant);
}

async function getTenantBySlug(
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [tenant] = await db
		.select()
		.from(tenants)
		.where(eq(tenants.slug, slug));
	if (!tenant) return notFound("Tenant not found");
	return json(tenant);
}

async function updateTenant(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.plan !== undefined) updates.plan = body.plan;
	if (body.issue_prefix !== undefined) updates.issue_prefix = body.issue_prefix;

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(tenants)
		.set({ ...updates, updated_at: new Date() })
		.where(eq(tenants.id, id))
		.returning();

	if (!updated) return notFound("Tenant not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function listMembers(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const members = await db
		.select()
		.from(tenantMembers)
		.where(eq(tenantMembers.tenant_id, tenantId));
	return json(members);
}

async function addMember(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.principal_type || !body.principal_id) {
		return error("principal_type and principal_id are required");
	}

	const [member] = await db
		.insert(tenantMembers)
		.values({
			tenant_id: tenantId,
			principal_type: body.principal_type,
			principal_id: body.principal_id,
			role: body.role || "member",
			status: body.status || "active",
		})
		.returning();

	return json(member, 201);
}

async function removeMember(
	tenantId: string,
	memberId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [deleted] = await db
		.delete(tenantMembers)
		.where(
			and(
				eq(tenantMembers.id, memberId),
				eq(tenantMembers.tenant_id, tenantId),
			),
		)
		.returning();

	if (!deleted) return notFound("Member not found");
	return json(deleted);
}

async function updateMemberRole(
	tenantId: string,
	memberId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.role) return error("role is required");

	const [updated] = await db
		.update(tenantMembers)
		.set({ role: body.role, updated_at: new Date() })
		.where(
			and(
				eq(tenantMembers.id, memberId),
				eq(tenantMembers.tenant_id, tenantId),
			),
		)
		.returning();

	if (!updated) return notFound("Member not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [settings] = await db
		.select()
		.from(tenantSettings)
		.where(eq(tenantSettings.tenant_id, tenantId));
	if (!settings) return notFound("Tenant settings not found");
	return json(settings);
}

async function updateSettings(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};
	if (body.default_model !== undefined)
		updates.default_model = body.default_model;
	if (body.budget_monthly_cents !== undefined)
		updates.budget_monthly_cents = body.budget_monthly_cents;
	if (body.auto_close_thread_minutes !== undefined)
		updates.auto_close_thread_minutes = body.auto_close_thread_minutes;
	if (body.max_agents !== undefined)
		updates.max_agents = body.max_agents;
	if (body.features !== undefined) updates.features = body.features;

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(tenantSettings)
		.set({ ...updates, updated_at: new Date() })
		.where(eq(tenantSettings.tenant_id, tenantId))
		.returning();

	if (!updated) return notFound("Tenant settings not found");
	return json(updated);
}
