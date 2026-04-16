/**
 * Connections CRUD Handler
 *
 * GET    /api/connections        — list connections by tenant_id + user_id
 * GET    /api/connections/:id    — single connection with provider join
 * POST   /api/connections        — self-register (no OAuth); body:
 *                                   { providerName, external_id?, metadata? }
 * PUT    /api/connections/:id    — JSONB merge on metadata
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
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

// Accept either Bearer API_AUTH_SECRET (internal) or x-api-key (from app-manager)
import {
	SecretsManagerClient,
	DeleteSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

import {
	resolveOAuthToken,
	forceRefreshLastmileUserToken,
} from "../lib/oauth-token.js";
import {
	getOrMintLastmilePat,
	forceRefreshLastmilePat,
} from "../lib/lastmile-pat.js";
import {
	listWorkflows as lastmileListWorkflows,
	isLastmileRestConfigured,
	LastmileRestError,
} from "../integrations/external-work-items/providers/lastmile/restClient.js";
import { getConnectorBaseUrl } from "./task-connectors.js";

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
	return { id: segments[0] || null, sub: segments[1] || null };
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
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
	const token = extractBearerToken(event);
	const apiKey = event.headers["x-api-key"] || "";
	// Accept internal API secret OR AppSync API key (used by app-manager)
	if (!(token && validateApiSecret(token)) && !apiKey) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const userId = event.headers["x-principal-id"] || "";
	const method = event.requestContext.http.method;
	const { id, sub } = parsePath(event.rawPath);

	try {
		// Sub-resource: GET /api/connections/lastmile/workflows
		// Proxies the LastMile REST API so mobile can discover available
		// workflows for the task-creation picker. Uses the user's existing
		// OAuth token — same one the MCP and webhook paths already share.
		if (method === "GET" && id === "lastmile" && sub === "workflows") {
			return listLastmileWorkflows(tenantId, userId);
		}

		switch (method) {
			case "GET":
				return id
					? getConnection(tenantId, id)
					: listConnections(tenantId, userId);
			case "POST":
				if (id) return error("POST to /api/connections/:id not supported", 405);
				if (!userId) return error("Missing x-principal-id header");
				return createConnection(tenantId, userId, event);
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

async function createConnection(
	tenantId: string,
	userId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = parseBody(event);
	const providerName =
		typeof body.providerName === "string" ? body.providerName : "";
	if (!providerName) return error("Missing providerName");

	const externalId =
		typeof body.external_id === "string" ? body.external_id : null;
	const metadataInput =
		body.metadata && typeof body.metadata === "object"
			? (body.metadata as Record<string, unknown>)
			: {};

	const [provider] = await db
		.select({ id: connectProviders.id })
		.from(connectProviders)
		.where(eq(connectProviders.name, providerName));
	if (!provider) return notFound(`Unknown provider: ${providerName}`);

	// Idempotent upsert on (tenant_id, user_id, provider_id). If a row
	// already exists, JSONB-merge the new metadata into it and flip it
	// back to active — users self-registering again should be a no-op,
	// not a duplicate row.
	const [existing] = await db
		.select({ id: connections.id })
		.from(connections)
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.user_id, userId),
				eq(connections.provider_id, provider.id),
			),
		);

	if (existing) {
		const metadataJson = JSON.stringify(metadataInput);
		const [updated] = await db
			.update(connections)
			.set({
				status: "active",
				external_id: externalId ?? undefined,
				metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${metadataJson}::jsonb`,
				connected_at: new Date(),
				disconnected_at: null,
				updated_at: new Date(),
			})
			.where(eq(connections.id, existing.id))
			.returning();
		return json(updated);
	}

	const [inserted] = await db
		.insert(connections)
		.values({
			tenant_id: tenantId,
			user_id: userId,
			provider_id: provider.id,
			status: "active",
			external_id: externalId,
			metadata: metadataInput,
			connected_at: new Date(),
		})
		.returning();
	return json(inserted, 201);
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

// ---------------------------------------------------------------------------
// GET /api/connections/lastmile/workflows — proxy to LastMile REST API
// ---------------------------------------------------------------------------

async function listLastmileWorkflows(
	tenantId: string,
	userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Per-tenant baseUrl from webhooks.config.baseUrl (admin-settable on the
	// Connectors → LastMile page); falls back to the LASTMILE_TASKS_API_URL
	// Lambda env var if unset.
	const baseUrl = await getConnectorBaseUrl(tenantId, "lastmile");
	if (!isLastmileRestConfigured({ baseUrl })) {
		return error(
			"LastMile REST API not configured — set the base URL on the Connectors → LastMile page, or wire LASTMILE_TASKS_API_URL as a fallback.",
			503,
		);
	}
	if (!userId) return error("Missing x-principal-id header");

	// Find the user's active task-kind connection. We need it twice: to
	// look up the user's WorkOS JWT (for PAT exchange) and to pass back
	// into forceRefresh if the PAT we cached gets invalidated server-side.
	const [conn] = await db
		.select({
			id: connections.id,
			provider_id: connections.provider_id,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.user_id, userId),
				eq(connections.status, "active"),
				eq(connectProviders.provider_type, "task"),
			),
		)
		.limit(1);

	if (!conn) {
		return error("No active task connector for this user", 404);
	}

	// LastMile recommends PATs over the raw WorkOS JWT path because PATs
	// don't hit the Clerk user lookup (the original cause of "Failed to
	// validate WorkOS user"). Exchange the user's WorkOS JWT for a PAT
	// once, cache in SSM, and use it for every subsequent call.
	const patToken = await getOrMintLastmilePat({
		userId,
		getFreshWorkosJwt: () =>
			resolveOAuthToken(conn.id, tenantId, conn.provider_id),
	});
	if (!patToken) {
		return json(
			{
				error: "reconnect_needed",
				detail:
					"Unable to obtain a LastMile API token — your WorkOS session may have expired. Reconnect in Settings → MCP Servers.",
			},
			401,
		);
	}

	try {
		const workflows = await lastmileListWorkflows({
			ctx: {
				authToken: patToken,
				baseUrl,
				// If LastMile rejects the PAT (revoked, expired early), mint
				// a fresh one by re-exchanging the user's WorkOS JWT.
				refreshToken: () =>
					forceRefreshLastmilePat({
						userId,
						getFreshWorkosJwt: () =>
							// On the retry, prefer a forcibly refreshed WorkOS JWT
							// too — covers the case where BOTH tokens expired while
							// the adapter was dormant.
							forceRefreshLastmileUserToken(conn.id, tenantId),
					}),
			},
		});
		return json(workflows);
	} catch (err) {
		return mapLastmileError(err, "listLastmileWorkflows");
	}
}

function mapLastmileError(
	err: unknown,
	tag: string,
): APIGatewayProxyStructuredResultV2 {
	if (err instanceof LastmileRestError) {
		console.error(`[connections] ${tag} LastmileRestError:`, {
			status: err.status,
			code: err.code,
			message: err.message,
			requestId: err.requestId,
			responseBody: err.responseBody,
		});
		if (err.status === 401) {
			return json(
				{
					error: "reconnect_needed",
					detail: err.message,
					lastmile_code: err.code,
				},
				401,
			);
		}
		return json(
			{
				error: "lastmile_api_error",
				detail: err.message,
				lastmile_status: err.status,
				lastmile_code: err.code,
				lastmile_request_id: err.requestId,
			},
			502,
		);
	}
	console.error(`[connections] ${tag} failed:`, err);
	return error(
		`Failed to fetch workflows: ${(err as Error)?.message || "unknown error"}`,
		502,
	);
}
