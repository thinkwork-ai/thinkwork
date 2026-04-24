/**
 * agents-runtime-config — service-auth REST endpoint the Strands
 * container calls during `kind=run_skill` dispatch to fetch the agent's
 * runtime config (template, skills, MCP, KBs, guardrail, etc.).
 *
 * GET /api/agents/runtime-config?tenantId=<uuid>&agentId=<uuid>
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   → 200 { AgentRuntimeConfig } — see packages/api/src/lib/resolve-agent-runtime-config.ts
 *   → 400 { error } — missing/invalid query params
 *   → 401 { error: "Unauthorized" }
 *   → 404 { error } — agent or template not found for the tenant
 *
 * Uses the service-endpoint auth pattern (API_AUTH_SECRET) rather than
 * widening resolveCaller (per
 * docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md).
 *
 * Plan: docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U1.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, notFound, unauthorized } from "../lib/response.js";
import {
	AgentNotFoundError,
	AgentTemplateNotFoundError,
	resolveAgentRuntimeConfig,
} from "../lib/resolve-agent-runtime-config.js";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") {
		return {
			statusCode: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET,OPTIONS",
				"Access-Control-Allow-Headers": "*",
			},
			body: "",
		};
	}
	if (event.requestContext.http.method !== "GET") {
		return error("Method not allowed", 405);
	}
	if (event.rawPath !== "/api/agents/runtime-config") {
		return error("Not found", 404);
	}

	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const qs = event.queryStringParameters ?? {};
	const tenantId = qs.tenantId;
	const agentId = qs.agentId;

	if (!tenantId || !UUID_RE.test(tenantId)) {
		return error("tenantId: valid UUID required", 400);
	}
	if (!agentId || !UUID_RE.test(agentId)) {
		return error("agentId: valid UUID required", 400);
	}

	// Optional per-invoker overrides. Container dispatcher can hint these
	// when the envelope carried a specific human invoker; otherwise the
	// helper leaves CURRENT_USER_EMAIL empty (R15 "no invoker" refusal).
	const currentUserId =
		typeof qs.currentUserId === "string" && qs.currentUserId
			? qs.currentUserId
			: undefined;
	const currentUserEmail =
		typeof qs.currentUserEmail === "string" && qs.currentUserEmail
			? qs.currentUserEmail
			: undefined;
	if (currentUserId && !UUID_RE.test(currentUserId)) {
		return error("currentUserId: must be a UUID if provided", 400);
	}

	try {
		const cfg = await resolveAgentRuntimeConfig({
			tenantId,
			agentId,
			currentUserId,
			currentUserEmail,
			logPrefix: "[agents-runtime-config]",
		});
		return json(cfg, 200);
	} catch (err) {
		if (err instanceof AgentNotFoundError) {
			// 404 keeps the endpoint from leaking cross-tenant existence —
			// an agent that belongs to tenant B when queried with tenant A
			// looks indistinguishable from a non-existent agent.
			return notFound(err.message);
		}
		if (err instanceof AgentTemplateNotFoundError) {
			return notFound(err.message);
		}
		console.error("[agents-runtime-config] resolve failed:", err);
		return error("Internal server error", 500);
	}
}
