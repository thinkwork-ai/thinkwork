import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

const { users, userProfiles } = schema;

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
		// GET /api/users/me — current user from auth context
		if (path === "/api/users/me" && method === "GET") {
			return getCurrentUser(event);
		}

		// Routes with /api/users/:id/profile
		const profileMatch = path.match(/^\/api\/users\/([^/]+)\/profile$/);
		if (profileMatch) {
			const userId = profileMatch[1];
			if (method === "GET") return getUserProfile(userId);
			if (method === "PUT") return updateUserProfile(userId, event);
			return error("Method not allowed", 405);
		}

		// Routes with /api/users/:id
		const idMatch = path.match(/^\/api\/users\/([^/]+)$/);
		if (idMatch) {
			const userId = idMatch[1];
			if (method === "GET") return getUser(userId);
			if (method === "PUT") return updateUser(userId, event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Users handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

async function getCurrentUser(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	// The principal ID is passed via a custom header set by the authorizer.
	// Fall back to a query parameter for flexibility.
	const userId =
		event.headers["x-principal-id"] ||
		event.queryStringParameters?.["userId"];

	if (!userId) {
		return error("Cannot determine current user: missing x-principal-id header");
	}

	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) return notFound("User not found");
	return json(user);
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

async function getUser(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [user] = await db.select().from(users).where(eq(users.id, id));
	if (!user) return notFound("User not found");
	return json(user);
}

async function updateUser(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.image !== undefined) updates.image = body.image;
	if (body.phone !== undefined) updates.phone = body.phone;

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(users)
		.set({ ...updates, updated_at: new Date() })
		.where(eq(users.id, id))
		.returning();

	if (!updated) return notFound("User not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function getUserProfile(
	userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [profile] = await db
		.select()
		.from(userProfiles)
		.where(eq(userProfiles.user_id, userId));
	if (!profile) return notFound("User profile not found");
	return json(profile);
}

async function updateUserProfile(
	userId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};
	if (body.display_name !== undefined)
		updates.display_name = body.display_name;
	if (body.theme !== undefined) updates.theme = body.theme;
	if (body.notification_preferences !== undefined)
		updates.notification_preferences = body.notification_preferences;

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(userProfiles)
		.set({ ...updates, updated_at: new Date() })
		.where(eq(userProfiles.user_id, userId))
		.returning();

	if (!updated) return notFound("User profile not found");
	return json(updated);
}
