/**
 * BYOB Registration — Paperclip-aligned REST endpoints
 *
 * Public + authenticated invite flow:
 *   POST   /api/tenants/:tenantId/invites            (Bearer)  Create invite
 *   GET    /api/invites/:token                        (Public)  Invite summary
 *   GET    /api/invites/:token/onboarding.txt         (Public)  Plain-text onboarding
 *   POST   /api/invites/:token/accept                 (Public)  Agent submits join request
 *   GET    /api/tenants/:tenantId/join-requests       (Bearer)  List join requests
 *   POST   /api/tenants/:tenantId/join-requests/:id/approve  (Bearer)
 *   POST   /api/tenants/:tenantId/join-requests/:id/reject   (Bearer)
 *   POST   /api/join-requests/:id/claim-api-key       (Public, claim secret)
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import {
	invites,
	joinRequests,
	agents,
	agentApiKeys,
	activityLog,
} from "@thinkwork/database-pg/schema";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, notFound, unauthorized, forbidden } from "../lib/response.js";

// ---------------------------------------------------------------------------
// Token helpers (Paperclip-aligned)
// ---------------------------------------------------------------------------

const INVITE_TOKEN_PREFIX = "mf_invite_";
const INVITE_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const INVITE_TOKEN_SUFFIX_LENGTH = 8;
const INVITE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function createInviteToken(): string {
	const bytes = randomBytes(INVITE_TOKEN_SUFFIX_LENGTH);
	let suffix = "";
	for (let i = 0; i < INVITE_TOKEN_SUFFIX_LENGTH; i++) {
		suffix += INVITE_TOKEN_ALPHABET[bytes[i]! % INVITE_TOKEN_ALPHABET.length];
	}
	return `${INVITE_TOKEN_PREFIX}${suffix}`;
}

function createClaimSecret(): string {
	return `mf_claim_${randomBytes(24).toString("hex")}`;
}

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// --- Public endpoints (no auth) ---

		// GET /api/invites/:token/onboarding.txt
		const onboardingMatch = path.match(
			/^\/api\/invites\/([^/]+)\/onboarding\.txt$/,
		);
		if (onboardingMatch && method === "GET") {
			return getOnboardingTxt(onboardingMatch[1], event);
		}

		// GET /api/invites/:token
		const inviteSummaryMatch = path.match(/^\/api\/invites\/([^/]+)$/);
		if (inviteSummaryMatch && method === "GET") {
			return getInviteSummary(inviteSummaryMatch[1]);
		}

		// POST /api/invites/:token/accept
		const acceptMatch = path.match(/^\/api\/invites\/([^/]+)\/accept$/);
		if (acceptMatch && method === "POST") {
			return acceptInvite(acceptMatch[1], event);
		}

		// POST /api/join-requests/:id/claim-api-key
		const claimMatch = path.match(
			/^\/api\/join-requests\/([^/]+)\/claim-api-key$/,
		);
		if (claimMatch && method === "POST") {
			return claimApiKey(claimMatch[1], event);
		}

		// --- Authenticated endpoints ---
		if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
		const auth = await authenticate(event.headers);
		if (!auth) return unauthorized();

		// POST /api/tenants/:tenantId/invites
		const createMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/invites$/,
		);
		if (createMatch && method === "POST") {
			return createInvite(createMatch[1], event);
		}

		// GET /api/tenants/:tenantId/join-requests
		const listJrMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/join-requests$/,
		);
		if (listJrMatch && method === "GET") {
			return listJoinRequests(listJrMatch[1], event);
		}

		// POST /api/tenants/:tenantId/join-requests/:id/approve
		const approveMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/join-requests\/([^/]+)\/approve$/,
		);
		if (approveMatch && method === "POST") {
			return approveJoinRequest(approveMatch[1], approveMatch[2], event);
		}

		// POST /api/tenants/:tenantId/join-requests/:id/reject
		const rejectMatch = path.match(
			/^\/api\/tenants\/([^/]+)\/join-requests\/([^/]+)\/reject$/,
		);
		if (rejectMatch && method === "POST") {
			return rejectJoinRequest(rejectMatch[1], rejectMatch[2], event);
		}

		// --- Legacy routes (invites list, revoke) ---

		// GET /api/invites?tenantId=...
		if (path === "/api/invites" && method === "GET") {
			const tenantId =
				event.headers["x-tenant-id"] ||
				event.queryStringParameters?.tenantId;
			if (!tenantId) return error("tenantId is required");
			return listInvites(tenantId);
		}

		// DELETE /api/invites/:id
		const deleteMatch = path.match(/^\/api\/invites\/([^/]+)$/);
		if (deleteMatch && method === "DELETE") {
			return revokeInvite(deleteMatch[1]);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Invites handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// POST /api/tenants/:tenantId/invites — Create invite (admin)
// ---------------------------------------------------------------------------

async function createInvite(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const agentName = body.agentName || body.agent_name || "External Agent";
	const userId = body.userId || body.user_id || event.headers["x-principal-id"];

	const plainToken = createInviteToken();
	const tokenHash = hashToken(plainToken);
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

	const [invite] = await db
		.insert(invites)
		.values({
			tenant_id: tenantId,
			invite_type: "agent",
			token_hash: tokenHash,
			defaults_payload: { agentName },
			max_uses: 1,
			invited_by_user_id: userId || undefined,
			expires_at: expiresAt,
		})
		.returning();

	const apiUrl = process.env.API_URL || `https://${event.headers.host}`;

	return json({
		id: invite.id,
		token: plainToken,
		inviteType: invite.invite_type,
		expiresAt: invite.expires_at.toISOString(),
		onboardingUrl: `${apiUrl}/api/invites/${plainToken}/onboarding.txt`,
		acceptUrl: `${apiUrl}/api/invites/${plainToken}/accept`,
	}, 201);
}

// ---------------------------------------------------------------------------
// GET /api/invites/:token — Public invite summary
// ---------------------------------------------------------------------------

async function getInviteSummary(
	token: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tokenHash = hashToken(token.trim());
	const [invite] = await db
		.select()
		.from(invites)
		.where(eq(invites.token_hash, tokenHash));

	if (!invite || invite.revoked_at || invite.expires_at < new Date()) {
		return notFound("Invite not found or expired");
	}

	const defaults = invite.defaults_payload as Record<string, unknown> | null;

	return json({
		id: invite.id,
		inviteType: invite.invite_type,
		agentName: defaults?.agentName ?? null,
		expiresAt: invite.expires_at.toISOString(),
		usedCount: invite.used_count,
		maxUses: invite.max_uses,
	});
}

// ---------------------------------------------------------------------------
// GET /api/invites/:token/onboarding.txt — Plain-text onboarding document
// ---------------------------------------------------------------------------

async function getOnboardingTxt(
	token: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tokenHash = hashToken(token.trim());
	const [invite] = await db
		.select()
		.from(invites)
		.where(eq(invites.token_hash, tokenHash));

	if (!invite || invite.revoked_at || invite.expires_at < new Date()) {
		return notFound("Invite not found or expired");
	}

	const apiUrl = process.env.API_URL || `https://${event.headers.host}`;
	const defaults = invite.defaults_payload as Record<string, unknown> | null;
	const agentName = (defaults?.agentName as string) ?? "Your Agent";

	const text = `# Thinkwork Agent Onboarding
#
# This document is readable by both humans and agents.

## Invite Details
- inviteType: ${invite.invite_type}
- expiresAt: ${invite.expires_at.toISOString()}
- maxUses: ${invite.max_uses}
- usedCount: ${invite.used_count}

## Step 1: Accept the invite (submit a join request)

POST ${apiUrl}/api/invites/${token}/accept
Content-Type: application/json

{
  "agentName": "${agentName}",
  "adapterType": "your_adapter_type",
  "capabilities": ["list", "of", "capabilities"]
}

Response (202):
{
  "joinRequestId": "<uuid>",
  "claimSecret": "mf_claim_<hex>",
  "status": "pending_approval"
}

IMPORTANT: Save the claimSecret — it is shown only once and expires in 7 days.

## Step 2: Wait for approval

An admin will review and approve your join request in the Thinkwork dashboard.
You can poll the invite summary to check status:

GET ${apiUrl}/api/invites/${token}

## Step 3: Claim your API key

Once approved, use the claimSecret to claim your API key:

POST ${apiUrl}/api/join-requests/<joinRequestId>/claim-api-key
Content-Type: application/json

{
  "claimSecret": "mf_claim_<your_claim_secret>"
}

Response (201):
{
  "apiKey": { "id": "<uuid>", "agentId": "<uuid>", "keyPrefix": "mf_key_..." },
  "plainTextKey": "mf_key_<hex>"
}

IMPORTANT: Store the plainTextKey securely — it cannot be retrieved again.
Use it as a Bearer token for authenticated API calls.

## API Base URL
${apiUrl}
`;

	return {
		statusCode: 200,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
		body: text,
	};
}

// ---------------------------------------------------------------------------
// POST /api/invites/:token/accept — Agent submits join request (public)
// ---------------------------------------------------------------------------

async function acceptInvite(
	token: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const tokenHash = hashToken(token.trim());

	const [invite] = await db
		.select()
		.from(invites)
		.where(eq(invites.token_hash, tokenHash));

	if (!invite || invite.revoked_at || invite.expires_at < new Date()) {
		return notFound("Invite not found or expired");
	}
	if (invite.used_count >= invite.max_uses) {
		return error("Invite usage limit reached", 409);
	}

	const agentName = body.agentName || body.agent_name;
	if (!agentName) return error("agentName is required");

	const adapterType = body.adapterType || body.adapter_type || "process";
	const capabilities = body.capabilities ?? [];
	const adapterConfig = body.adapterConfig || body.adapter_config || null;

	const plainClaimSecret = createClaimSecret();
	const claimSecretHash = hashToken(plainClaimSecret);
	const claimExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	const [jr] = await db
		.insert(joinRequests)
		.values({
			tenant_id: invite.tenant_id,
			invite_id: invite.id,
			request_type: "agent",
			agent_name: agentName,
			adapter_type: adapterType,
			capabilities: capabilities,
			adapter_config: adapterConfig,
			claim_secret_hash: claimSecretHash,
			claim_expires_at: claimExpiresAt,
			status: "pending_approval",
		})
		.returning();

	// Mark invite as accepted and bump used_count
	await db
		.update(invites)
		.set({
			accepted_at: invite.accepted_at ?? new Date(),
			used_count: sql`${invites.used_count} + 1`,
		})
		.where(eq(invites.id, invite.id));

	return json(
		{
			joinRequestId: jr.id,
			claimSecret: plainClaimSecret,
			status: "pending_approval",
		},
		202,
	);
}

// ---------------------------------------------------------------------------
// GET /api/tenants/:tenantId/join-requests — List join requests (admin)
// ---------------------------------------------------------------------------

async function listJoinRequests(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const statusFilter = event.queryStringParameters?.status;
	const conditions = [eq(joinRequests.tenant_id, tenantId)];
	if (statusFilter) conditions.push(eq(joinRequests.status, statusFilter));

	const rows = await db
		.select()
		.from(joinRequests)
		.where(and(...conditions))
		.orderBy(desc(joinRequests.created_at));

	return json(rows.map(sanitizeJoinRequest));
}

// ---------------------------------------------------------------------------
// POST /api/tenants/:tenantId/join-requests/:id/approve — Creates agent
// ---------------------------------------------------------------------------

async function approveJoinRequest(
	tenantId: string,
	requestId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const rawUserId = body.userId || body.user_id || event.headers["x-principal-id"];
	// approved_by_user_id is a UUID FK — only set if valid
	const userId = rawUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
		? rawUserId
		: undefined;

	const [jr] = await db
		.select()
		.from(joinRequests)
		.where(
			and(
				eq(joinRequests.id, requestId),
				eq(joinRequests.tenant_id, tenantId),
			),
		);

	if (!jr) return notFound("Join request not found");
	if (jr.status !== "pending_approval") {
		return error("Join request is not pending", 409);
	}

	// Find the CEO / root agent to set as reportsTo
	const existingAgents = await db
		.select({ id: agents.id, reports_to: agents.reports_to, status: agents.status, template_id: agents.template_id })
		.from(agents)
		.where(eq(agents.tenant_id, tenantId));

	// CEO = an active agent with no reportsTo, or first active agent
	const ceoAgent = existingAgents.find((a) => !a.reports_to) ?? existingAgents[0] ?? null;

	// Create the agent
	const [agent] = await db
		.insert(agents)
		.values({
			tenant_id: tenantId,
			name: jr.agent_name,
			slug: generateSlug(),
			template_id: (jr as any).template_id || ceoAgent?.template_id,
			type: "agent",
			status: "idle",
			adapter_type: jr.adapter_type,
			adapter_config: jr.adapter_config as any,
			reports_to: ceoAgent?.id ?? undefined,
		})
		.returning();

	// Update join request
	await db
		.update(joinRequests)
		.set({
			status: "approved",
			created_agent_id: agent.id,
			approved_by_user_id: userId,
			resolved_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(joinRequests.id, requestId));

	// Increment invite usedCount (if not already done at accept time for legacy)
	if (jr.invite_id) {
		// Already incremented at accept time, but keep activity log
	}

	// Log activity (actor_id is UUID NOT NULL — use nil UUID as fallback for system actions)
	await db.insert(activityLog).values({
		tenant_id: tenantId,
		actor_type: userId ? "user" : "system",
		actor_id: userId ?? "00000000-0000-0000-0000-000000000000",
		action: "agent_registered",
		entity_type: "agent",
		entity_id: agent.id,
		changes: { joinRequestId: jr.id, source: "byob" },
	});

	// Re-fetch updated join request
	const [updated] = await db
		.select()
		.from(joinRequests)
		.where(eq(joinRequests.id, requestId));

	return json(sanitizeJoinRequest(updated));
}

// ---------------------------------------------------------------------------
// POST /api/tenants/:tenantId/join-requests/:id/reject
// ---------------------------------------------------------------------------

async function rejectJoinRequest(
	tenantId: string,
	requestId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const rawUserId = body.userId || body.user_id || event.headers["x-principal-id"];
	const userId = rawUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
		? rawUserId
		: undefined;
	const reason = body.reason || null;

	const [jr] = await db
		.select()
		.from(joinRequests)
		.where(
			and(
				eq(joinRequests.id, requestId),
				eq(joinRequests.tenant_id, tenantId),
			),
		);

	if (!jr) return notFound("Join request not found");
	if (jr.status !== "pending_approval") {
		return error("Join request is not pending", 409);
	}

	const [updated] = await db
		.update(joinRequests)
		.set({
			status: "rejected",
			rejected_by_user_id: userId,
			rejection_reason: reason,
			resolved_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(joinRequests.id, requestId))
		.returning();

	return json(sanitizeJoinRequest(updated));
}

// ---------------------------------------------------------------------------
// POST /api/join-requests/:id/claim-api-key — Claim API key (public, needs claim secret)
// ---------------------------------------------------------------------------

async function claimApiKey(
	requestId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const claimSecret = body.claimSecret || body.claim_secret;
	if (!claimSecret) return error("claimSecret is required");

	const claimSecretHash = hashToken(claimSecret);

	const [jr] = await db
		.select()
		.from(joinRequests)
		.where(
			and(
				eq(joinRequests.id, requestId),
				eq(joinRequests.claim_secret_hash, claimSecretHash),
			),
		);

	if (!jr) return forbidden("Invalid claim");
	if (jr.status !== "approved") return error("Join request not yet approved", 409);
	if (!jr.created_agent_id) return error("No agent created for this request", 409);
	if (jr.claim_expires_at && jr.claim_expires_at < new Date()) {
		return error("Claim secret expired", 410);
	}
	if (jr.claim_consumed_at) return error("Claim already used", 409);

	// Generate API key
	const plainApiKey = `mf_key_${randomBytes(48).toString("hex")}`;
	const keyHash = hashToken(plainApiKey);

	const [apiKey] = await db
		.insert(agentApiKeys)
		.values({
			tenant_id: jr.tenant_id,
			agent_id: jr.created_agent_id,
			key_hash: keyHash,
			name: `Initial key for ${jr.agent_name}`,
		})
		.returning();

	// Mark claim as consumed
	await db
		.update(joinRequests)
		.set({
			status: "claimed",
			claim_consumed_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(joinRequests.id, requestId));

	return json(
		{
			apiKey: {
				id: apiKey.id,
				agentId: apiKey.agent_id,
				keyPrefix: plainApiKey.slice(0, 12) + "...",
				createdAt: apiKey.created_at.toISOString(),
			},
			plainTextKey: plainApiKey,
		},
		201,
	);
}

// ---------------------------------------------------------------------------
// Legacy: GET /api/invites — List invites (admin)
// ---------------------------------------------------------------------------

async function listInvites(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(invites)
		.where(eq(invites.tenant_id, tenantId))
		.orderBy(desc(invites.created_at));

	return json(
		rows.map((r) => ({
			id: r.id,
			tenantId: r.tenant_id,
			inviteType: r.invite_type,
			maxUses: r.max_uses,
			usedCount: r.used_count,
			expiresAt: r.expires_at.toISOString(),
			revokedAt: r.revoked_at?.toISOString() ?? null,
			createdAt: r.created_at.toISOString(),
			expired: r.expires_at < new Date(),
			agentName:
				(r.defaults_payload as Record<string, unknown> | null)?.agentName ??
				null,
		})),
	);
}

// ---------------------------------------------------------------------------
// Legacy: DELETE /api/invites/:id — Revoke invite (admin)
// ---------------------------------------------------------------------------

async function revokeInvite(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [revoked] = await db
		.update(invites)
		.set({ revoked_at: new Date() })
		.where(eq(invites.id, id))
		.returning();

	if (!revoked) return notFound("Invite not found");
	return json({ id: revoked.id, revokedAt: revoked.revoked_at?.toISOString() });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeJoinRequest(
	row: typeof joinRequests.$inferSelect,
): Record<string, unknown> {
	const { claim_secret_hash: _, ...safe } = row;
	return {
		id: safe.id,
		tenantId: safe.tenant_id,
		inviteId: safe.invite_id,
		requestType: safe.request_type,
		status: safe.status,
		agentName: safe.agent_name,
		adapterType: safe.adapter_type,
		capabilities: safe.capabilities,
		adapterConfig: safe.adapter_config,
		claimExpiresAt: safe.claim_expires_at?.toISOString() ?? null,
		claimConsumedAt: safe.claim_consumed_at?.toISOString() ?? null,
		createdAgentId: safe.created_agent_id,
		approvedByUserId: safe.approved_by_user_id,
		rejectedByUserId: safe.rejected_by_user_id,
		rejectionReason: safe.rejection_reason,
		resolvedAt: safe.resolved_at?.toISOString() ?? null,
		createdAt: safe.created_at.toISOString(),
		updatedAt: safe.updated_at.toISOString(),
	};
}
