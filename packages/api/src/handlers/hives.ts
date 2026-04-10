import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { teams } from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

const db = getDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePath(rawPath: string) {
	// /api/hives
	// /api/hives/:id
	const segments = rawPath
		.replace(/^\/api\/hives\/?/, "")
		.split("/")
		.filter(Boolean);
	return {
		id: segments[0] || null,
	};
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
	if (!event.body) return {};
	try {
		return JSON.parse(event.body);
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const { id } = parsePath(event.rawPath);

	try {
		switch (method) {
			case "GET":
				return id ? getHive(tenantId, id) : listHives(tenantId);
			case "POST":
				return createHive(tenantId, event);
			case "PUT":
				if (!id) return error("Missing hive ID");
				return updateHive(tenantId, id, event);
			case "DELETE":
				if (!id) return error("Missing hive ID");
				return archiveHive(tenantId, id);
			default:
				return error("Method not allowed", 405);
		}
	} catch (err: any) {
		console.error("hives handler error", err);
		return error(err.message ?? "Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Hives CRUD
// ---------------------------------------------------------------------------

async function listHives(tenantId: string) {
	const rows = await db
		.select()
		.from(teams)
		.where(eq(teams.tenant_id, tenantId));
	return json(rows);
}

async function getHive(tenantId: string, id: string) {
	const [row] = await db
		.select()
		.from(teams)
		.where(and(eq(teams.id, id), eq(teams.tenant_id, tenantId)));
	if (!row) return notFound("Team not found");
	return json(row);
}

async function createHive(
	tenantId: string,
	event: APIGatewayProxyEventV2,
) {
	const body = parseBody(event);
	if (!body.name) return error("name is required");

	const [row] = await db
		.insert(teams)
		.values({
			tenant_id: tenantId,
			name: body.name as string,
			description: body.description as string | undefined,
			type: (body.type as string) ?? "team",
			budget_monthly_cents: body.budget_monthly_cents as number | undefined,
			metadata: body.metadata ?? undefined,
		})
		.returning();
	return json(row, 201);
}

async function updateHive(
	tenantId: string,
	id: string,
	event: APIGatewayProxyEventV2,
) {
	const body = parseBody(event);

	const updates: Record<string, unknown> = { updated_at: new Date() };
	const allowedFields = [
		"name",
		"description",
		"type",
		"status",
		"budget_monthly_cents",
		"metadata",
	];
	for (const f of allowedFields) {
		if (f in body) updates[f] = body[f];
	}

	if (Object.keys(updates).length === 1) {
		return error("No valid fields to update");
	}

	const [row] = await db
		.update(teams)
		.set(updates)
		.where(and(eq(teams.id, id), eq(teams.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Team not found");
	return json(row);
}

async function archiveHive(tenantId: string, id: string) {
	const [row] = await db
		.update(teams)
		.set({ status: "archived", updated_at: new Date() })
		.where(and(eq(teams.id, id), eq(teams.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Team not found");
	return json(row);
}
