/**
 * Connections CRUD Handler
 *
 * GET  /api/connections          — list connections by tenant_id + user_id
 * GET  /api/connections/:id      — single connection with provider join
 * PUT  /api/connections/:id      — JSONB merge on metadata
 * DELETE /api/connections/:id    — set status inactive, delete SM secret + credentials
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

// Accept either Bearer API_AUTH_SECRET (internal) or x-api-key (from app-manager)
import {
	SecretsManagerClient,
	DeleteSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const { connections, connectProviders, credentials } = schema;

const STAGE = process.env.STAGE || "dev";
const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

function parsePath(rawPath: string) {
	const segments = rawPath
		.replace(/^\/api\/connections\/?/, "")
		.split("/")
		.filter(Boolean);
	return { id: segments[0] || null };
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
	if (!event.body) return {};
	try {
		return JSON.parse(event.body);
	} catch {
		return {};
	}
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	const apiKey = event.headers["x-api-key"] || "";
	// Accept internal API secret OR AppSync API key (used by app-manager)
	if (!(token && validateApiSecret(token)) && !apiKey) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const userId = event.headers["x-principal-id"] || "";
	const method = event.requestContext.http.method;
	const { id } = parsePath(event.rawPath);

	try {
		switch (method) {
			case "GET":
				return id
					? getConnection(tenantId, id)
					: listConnections(tenantId, userId);
			case "PUT":
				if (!id) return error("Missing connection ID");
				return updateConnection(tenantId, id, event);
			case "DELETE":
				if (!id) return error("Missing connection ID");
				return deleteConnection(tenantId, id);
			default:
				return error(`Unsupported method: ${method}`, 405);
		}
	} catch (err) {
		console.error("[connections] Error:", err);
		return error("Internal server error", 500);
	}
}

async function listConnections(
	tenantId: string,
	userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: connections.id,
			tenant_id: connections.tenant_id,
			user_id: connections.user_id,
			provider_id: connections.provider_id,
			status: connections.status,
			external_id: connections.external_id,
			metadata: connections.metadata,
			connected_at: connections.connected_at,
			created_at: connections.created_at,
			updated_at: connections.updated_at,
			provider_name: connectProviders.name,
			provider_display_name: connectProviders.display_name,
			provider_type: connectProviders.provider_type,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			userId
				? and(
						eq(connections.tenant_id, tenantId),
						eq(connections.user_id, userId),
					)
				: eq(connections.tenant_id, tenantId),
		);

	return json(rows);
}

async function getConnection(
	tenantId: string,
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [row] = await db
		.select({
			id: connections.id,
			tenant_id: connections.tenant_id,
			user_id: connections.user_id,
			provider_id: connections.provider_id,
			status: connections.status,
			external_id: connections.external_id,
			metadata: connections.metadata,
			connected_at: connections.connected_at,
			created_at: connections.created_at,
			updated_at: connections.updated_at,
			provider_name: connectProviders.name,
			provider_display_name: connectProviders.display_name,
			provider_type: connectProviders.provider_type,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(eq(connections.id, id), eq(connections.tenant_id, tenantId)),
		);

	if (!row) return notFound("Connection not found");
	return json(row);
}

async function updateConnection(
	tenantId: string,
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = parseBody(event);

	// Build update fields
	const updates: Record<string, unknown> = {
		updated_at: new Date(),
	};

	if (body.status && typeof body.status === "string") {
		updates.status = body.status;
	}
	if (body.external_id && typeof body.external_id === "string") {
		updates.external_id = body.external_id;
	}

	// JSONB merge on metadata — critical for cursor updates
	if (body.metadata && typeof body.metadata === "object") {
		const metadataJson = JSON.stringify(body.metadata);
		const [updated] = await db
			.update(connections)
			.set({
				...updates,
				metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${metadataJson}::jsonb`,
			})
			.where(
				and(eq(connections.id, id), eq(connections.tenant_id, tenantId)),
			)
			.returning();

		if (!updated) return notFound("Connection not found");
		return json(updated);
	}

	const [updated] = await db
		.update(connections)
		.set(updates)
		.where(
			and(eq(connections.id, id), eq(connections.tenant_id, tenantId)),
		)
		.returning();

	if (!updated) return notFound("Connection not found");
	return json(updated);
}

async function deleteConnection(
	tenantId: string,
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Soft-delete: set status to inactive
	const [updated] = await db
		.update(connections)
		.set({
			status: "inactive",
			disconnected_at: new Date(),
			updated_at: new Date(),
		})
		.where(
			and(eq(connections.id, id), eq(connections.tenant_id, tenantId)),
		)
		.returning();

	if (!updated) return notFound("Connection not found");

	// Delete Secrets Manager secret
	const secretId = `thinkwork/${STAGE}/oauth/${id}`;
	try {
		await sm.send(
			new DeleteSecretCommand({
				SecretId: secretId,
				ForceDeleteWithoutRecovery: true,
			}),
		);
	} catch (err) {
		if (!(err instanceof ResourceNotFoundException)) {
			console.error(`[connections] Failed to delete secret ${secretId}:`, err);
		}
	}

	// Delete credentials rows
	await db
		.delete(credentials)
		.where(
			and(
				eq(credentials.connection_id, id),
				eq(credentials.tenant_id, tenantId),
			),
		);

	return json({ ok: true, id });
}
