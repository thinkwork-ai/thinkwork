import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import {
	threads,
	messages,
	messageArtifacts,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import {
	json,
	error,
	notFound,
	unauthorized,
	paginated,
} from "../lib/response.js";

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
		// POST /api/messages/relay (must match before /:id)
		if (path === "/api/messages/relay" && method === "POST") {
			return relayMessage(event);
		}

		// /api/messages/:id/artifacts
		const artifactsMatch = path.match(
			/^\/api\/messages\/([^/]+)\/artifacts$/,
		);
		if (artifactsMatch) {
			const messageId = artifactsMatch[1];
			if (method === "GET") return listArtifacts(messageId);
			if (method === "POST") return createArtifact(messageId, event);
			return error("Method not allowed", 405);
		}

		// /api/messages/:id
		const idMatch = path.match(/^\/api\/messages\/([^/]+)$/);
		if (idMatch) {
			if (method === "GET") return getMessage(idMatch[1]);
			return error("Method not allowed", 405);
		}

		// /api/messages
		if (path === "/api/messages") {
			if (method === "GET") return listMessages(event);
			if (method === "POST") return createMessage(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Messages handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

async function listMessages(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const threadId = params.threadId;
	if (!threadId) return error("threadId query parameter is required");

	const limit = Math.min(Number(params.limit) || 50, 200);
	const cursor = params.cursor; // ISO timestamp

	const conditions = [eq(messages.thread_id, threadId)];
	if (cursor) {
		conditions.push(lt(messages.created_at, new Date(cursor)));
	}

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.created_at))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor =
		hasMore && items.length > 0
			? items[items.length - 1].created_at.toISOString()
			: null;

	return paginated(items, nextCursor, hasMore);
}

async function getMessage(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [message] = await db
		.select()
		.from(messages)
		.where(eq(messages.id, id));
	if (!message) return notFound("Message not found");
	return json(message);
}

async function createMessage(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.thread_id || !body.role) {
		return error("thread_id and role are required");
	}

	// Look up the thread to get tenant_id
	const [thread] = await db
		.select({ tenant_id: threads.tenant_id })
		.from(threads)
		.where(eq(threads.id, body.thread_id));
	if (!thread) return notFound("Thread not found");

	const [message] = await db
		.insert(messages)
		.values({
			thread_id: body.thread_id,
			tenant_id: thread.tenant_id,
			role: body.role,
			content: body.content,
			sender_type: body.sender_type,
			sender_id: body.sender_id,
			metadata: body.metadata,
		})
		.returning();

	return json(message, 201);
}

async function relayMessage(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.threadId || !body.role) {
		return error("threadId and role are required");
	}

	// Look up the thread to get tenant_id
	const [thread] = await db
		.select({ tenant_id: threads.tenant_id })
		.from(threads)
		.where(eq(threads.id, body.threadId));
	if (!thread) return notFound("Thread not found");

	const [message] = await db
		.insert(messages)
		.values({
			thread_id: body.threadId,
			tenant_id: thread.tenant_id,
			role: body.role,
			content: body.content,
			sender_type: body.sender_type || "agent",
			sender_id: body.sender_id,
			metadata: body.metadata,
			tool_calls: body.tool_calls,
			tool_results: body.tool_results,
			token_count: body.token_count,
		})
		.returning();

	return json(message, 201);
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

async function listArtifacts(
	messageId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(messageArtifacts)
		.where(eq(messageArtifacts.message_id, messageId))
		.orderBy(desc(messageArtifacts.created_at));

	return json(rows);
}

async function createArtifact(
	messageId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.artifact_type) return error("artifact_type is required");

	// Look up the message to get thread_id and tenant_id
	const [msg] = await db
		.select({
			thread_id: messages.thread_id,
			tenant_id: messages.tenant_id,
		})
		.from(messages)
		.where(eq(messages.id, messageId));
	if (!msg) return notFound("Message not found");

	const [artifact] = await db
		.insert(messageArtifacts)
		.values({
			message_id: messageId,
			thread_id: msg.thread_id,
			tenant_id: msg.tenant_id,
			artifact_type: body.artifact_type,
			name: body.name,
			content: body.content,
			s3_key: body.s3_key,
			mime_type: body.mime_type,
			size_bytes: body.size_bytes,
			metadata: body.metadata,
		})
		.returning();

	return json(artifact, 201);
}
