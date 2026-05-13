import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, asc } from "drizzle-orm";
import {
	CognitoIdentityProviderClient,
	AdminCreateUserCommand,
	AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";
import { resolveTenantId } from "../lib/tenants.js";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import { provisionComputerForMember } from "../lib/computers/provision.js";

const { tenants, tenantMembers, tenantSettings, users } = schema;

const cognito = new CognitoIdentityProviderClient({});
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	// Helper: gate a sub-route by tenant membership. GETs let any active
	// member read; mutations require owner/admin. Returns verdict.tenantId
	// (helper-resolved, authoritative — supports slug + UUID).
	const gate = (tenantIdOrSlug: string) =>
		requireTenantMembership(event, tenantIdOrSlug, {
			requiredRoles:
				method === "GET"
					? ["owner", "admin", "member"]
					: ["owner", "admin"],
		});

	try {
		// GET /api/tenants — list-all (filtered to caller memberships;
		// apikey callers see everything for the CLI tenant picker).
		// TODO(PR-B): there is no POST /api/tenants (create-tenant) route
		// in this handler today. If one is added, gate it behind apikey
		// or an explicit operator role — a plain Cognito JWT shouldn't be
		// enough to create tenants. Tracked under plan 2026-04-24-006.
		if (path === "/api/tenants" && method === "GET") {
			const auth = await authenticate(event.headers);
			if (!auth) return unauthorized();
			return listTenants(auth);
		}

		// GET /api/tenants/by-slug/:slug (must match before /:id)
		const slugMatch = path.match(/^\/api\/tenants\/by-slug\/([^/]+)$/);
		if (slugMatch && method === "GET") {
			const verdict = await gate(slugMatch[1]);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			return getTenant(verdict.tenantId);
		}

		// POST /api/tenants/:slug/invites — invite a human teammate.
		// Distinct path from /members (which is a low-level principal insert)
		// because this does the full Cognito AdminCreateUser + DB upsert flow.
		const inviteMatch = path.match(/^\/api\/tenants\/([^/]+)\/invites$/);
		if (inviteMatch && method === "POST") {
			const verdict = await gate(inviteMatch[1]);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			return inviteMember(verdict.tenantId, event, verdict.userId ?? null);
		}

		// Routes with /api/tenants/:id/members/:memberId
		const memberDetailMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/members\/([^/]+)$/,
		);
		if (memberDetailMatch) {
			const [, tenantIdOrSlug, memberId] = memberDetailMatch;
			const verdict = await gate(tenantIdOrSlug);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			if (method === "DELETE") return removeMember(verdict.tenantId, memberId);
			if (method === "PUT")
				return updateMemberRole(verdict.tenantId, memberId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id/members
		const membersMatch = path.match(/^\/api\/tenants\/([^/]+)\/members$/);
		if (membersMatch) {
			const verdict = await gate(membersMatch[1]);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			if (method === "GET") return listMembers(verdict.tenantId);
			if (method === "POST")
				return addMember(verdict.tenantId, event, verdict.userId ?? null);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id/settings
		const settingsMatch = path.match(/^\/api\/tenants\/([^/]+)\/settings$/);
		if (settingsMatch) {
			const verdict = await gate(settingsMatch[1]);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			if (method === "GET") return getSettings(verdict.tenantId);
			if (method === "PUT") return updateSettings(verdict.tenantId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/tenants/:id
		const idMatch = path.match(/^\/api\/tenants\/([^/]+)$/);
		if (idMatch) {
			const verdict = await gate(idMatch[1]);
			if (!verdict.ok) return error(verdict.reason, verdict.status);
			if (method === "GET") return getTenant(verdict.tenantId);
			if (method === "PUT") return updateTenant(verdict.tenantId, event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Tenants handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Tenant listing — powers the CLI tenant picker + admin SPA tenant switcher
//
// Apikey callers (CLI/CI with the shared service secret) see every tenant so
// the tenant-picker keeps working for ops. Cognito callers are filtered to
// tenants where they have an active tenant_members row — preventing a
// signed-in user from enumerating every tenant in the deployment.
// ---------------------------------------------------------------------------

async function listTenants(
	auth: import("../lib/cognito-auth.js").AuthResult,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (auth.authType === "apikey") {
		const rows = await db
			.select({
				id: tenants.id,
				name: tenants.name,
				slug: tenants.slug,
				plan: tenants.plan,
				createdAt: tenants.created_at,
			})
			.from(tenants)
			.orderBy(asc(tenants.name));
		return json(rows);
	}

	const { userId } = await resolveCallerFromAuth(auth);
	if (!userId) return json([]);

	const rows = await db
		.select({
			id: tenants.id,
			name: tenants.name,
			slug: tenants.slug,
			plan: tenants.plan,
			createdAt: tenants.created_at,
		})
		.from(tenants)
		.innerJoin(tenantMembers, eq(tenantMembers.tenant_id, tenants.id))
		.where(
			and(
				eq(tenantMembers.principal_type, "user"),
				eq(tenantMembers.principal_id, userId),
				eq(tenantMembers.status, "active"),
			),
		)
		.orderBy(asc(tenants.name));
	return json(rows);
}

// ---------------------------------------------------------------------------
// POST /api/tenants/:slug/invites — human-member invite via Cognito
// (CLI-facing; ports the GraphQL inviteMember mutation logic)
// ---------------------------------------------------------------------------

async function inviteMember(
	tenantId: string,
	event: APIGatewayProxyEventV2,
	adminUserId: string | null,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (!COGNITO_USER_POOL_ID) {
		return error("COGNITO_USER_POOL_ID not configured on this Lambda", 500);
	}

	const body = JSON.parse(event.body || "{}");
	const email: string = (body.email || "").trim().toLowerCase();
	const name: string | null = body.name?.trim() || null;
	const role: string = body.role || "member";

	if (!email || !email.includes("@")) {
		return error("email is required and must look like an email address");
	}

	// 1. Cognito user — create new or fetch existing sub.
	let cognitoSub: string;
	try {
		const result = await cognito.send(
			new AdminCreateUserCommand({
				UserPoolId: COGNITO_USER_POOL_ID,
				Username: email,
				UserAttributes: [
					{ Name: "email", Value: email },
					{ Name: "email_verified", Value: "true" },
					...(name ? [{ Name: "name", Value: name }] : []),
					{ Name: "custom:tenant_id", Value: tenantId },
				],
				DesiredDeliveryMediums: ["EMAIL"],
			}),
		);
		cognitoSub =
			result.User?.Attributes?.find((a) => a.Name === "sub")?.Value || "";
		if (!cognitoSub) {
			return error("Cognito did not return a sub for the created user", 502);
		}
	} catch (err: any) {
		if (err.name === "UsernameExistsException") {
			const existing = await cognito.send(
				new AdminGetUserCommand({
					UserPoolId: COGNITO_USER_POOL_ID,
					Username: email,
				}),
			);
			cognitoSub =
				existing.UserAttributes?.find((a) => a.Name === "sub")?.Value || "";
			if (!cognitoSub) {
				return error("Could not resolve existing Cognito user sub", 502);
			}
		} else {
			console.error("inviteMember: Cognito admin-create-user failed", err);
			return error(err.message || "Cognito admin-create-user failed", 502);
		}
	}

	// 2. Upsert users row.
	const existingUser = await db
		.select()
		.from(users)
		.where(eq(users.id, cognitoSub));
	if (existingUser.length === 0) {
		await db.insert(users).values({
			id: cognitoSub,
			tenant_id: tenantId,
			email,
			name,
		});
	}

	// 3. Idempotent membership check.
	const existingMember = await db
		.select()
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_id, cognitoSub),
			),
		);
	if (existingMember.length > 0) {
		const m = existingMember[0];
		return json(
			{
				alreadyMember: true,
				id: m.id,
				tenantId: m.tenant_id,
				principalType: m.principal_type,
				principalId: m.principal_id,
				role: m.role,
				status: m.status,
				email,
			},
			200,
		);
	}

	// 4. Insert tenant membership.
	const [row] = await db
		.insert(tenantMembers)
		.values({
			tenant_id: tenantId,
			principal_type: "USER",
			principal_id: cognitoSub,
			role,
			status: "active",
		})
		.returning();

	// Computer provisioning is opt-in via `body.provision_computer`
	// (truthy). Default behavior is mobile-only / no-Computer — admins
	// can provision later via the Person-page CTA on /people/$humanId
	// or by re-invoking this endpoint after server config is updated.
	// Failure must NOT block the invite response; the helper itself
	// never throws.
	if (body.provision_computer === true) {
		try {
			await provisionComputerForMember({
				tenantId,
				userId: cognitoSub,
				principalType: "USER",
				callSite: "restInvite",
				adminUserId,
			});
		} catch (err) {
			console.error(
				"[tenants.ts:inviteMember] unexpected provisioning throw (suppressed):",
				err,
			);
		}
	}

	return json(
		{
			alreadyMember: false,
			id: row.id,
			tenantId: row.tenant_id,
			principalType: row.principal_type,
			principalId: row.principal_id,
			role: row.role,
			status: row.status,
			email,
		},
		201,
	);
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
	adminUserId: string | null,
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

	// Computer provisioning is opt-in via `body.provision_computer`
	// (truthy) AND only fires when the new member is active. Default
	// behavior is mobile-only / no-Computer — admins can provision later
	// via the Person-page CTA on /people/$humanId.
	if (body.provision_computer === true && member.status === "active") {
		try {
			await provisionComputerForMember({
				tenantId,
				userId: body.principal_id,
				principalType: body.principal_type,
				callSite: "restAddMember",
				adminUserId,
			});
		} catch (err) {
			console.error(
				"[tenants.ts:addMember] unexpected provisioning throw (suppressed):",
				err,
			);
		}
	}

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
