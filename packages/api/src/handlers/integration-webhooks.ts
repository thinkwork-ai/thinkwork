/**
 * Integration webhooks handler.
 *
 * Public, no bearer auth — each request is authenticated via the provider's
 * signature header (`X-LastMile-Signature`, etc). Distinct from `webhooks.ts`,
 * which is token-as-auth and user-configured.
 *
 * Routes:
 *   POST /integrations/:provider/webhook
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handleCors, json, error, notFound } from "../lib/response.js";
import type { APIGatewayProxyEventHeaders } from "aws-lambda";
import { ingestExternalTaskEvent } from "../integrations/external-work-items/ingestEvent.js";

// In-memory rate limiter — one entry per (provider, signature-prefix) or per
// request source IP. Resets on cold start. Protects against runaway retries
// during a provider outage; real DoS protection lives at the edge.
const rateLimitWindow = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MINUTE = 600;

function checkRateLimit(key: string): boolean {
	const now = Date.now();
	const entry = rateLimitWindow.get(key);
	if (!entry || now >= entry.resetAt) {
		rateLimitWindow.set(key, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	if (entry.count >= RATE_LIMIT_PER_MINUTE) return false;
	entry.count++;
	return true;
}

function lowerHeaders(raw: Record<string, string | undefined>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "string") out[k.toLowerCase()] = v;
	}
	return out;
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const method = event.requestContext.http.method;
	const path = event.rawPath;

	if (method === "OPTIONS") {
		const corsResponse = handleCors(event);
		if (corsResponse) return corsResponse;
	}
	if (method !== "POST") return error("Method not allowed", 405);

	const match = path.match(/^\/integrations\/([^/]+)\/webhook$/);
	if (!match) return notFound("Route not found");

	const provider = match[1];
	const sourceIp = event.requestContext.http.sourceIp || "unknown";
	if (!checkRateLimit(`${provider}:${sourceIp}`)) {
		return {
			statusCode: 429,
			headers: { "Content-Type": "application/json", "Retry-After": "60" },
			body: JSON.stringify({ error: "Rate limit exceeded" }),
		};
	}

	const rawBody = event.body ?? "";
	const headers = lowerHeaders(event.headers ?? {});

	try {
		const result = await ingestExternalTaskEvent({ provider, rawBody, headers });

		switch (result.status) {
			case "unverified":
				return error("Invalid signature", 401);
			case "ignored":
				return json({ ok: false, reason: result.reason }, 202);
			case "unresolved_connection":
				console.warn(
					`[integration-webhooks] Unresolved connection for provider=${provider} providerUserId=${result.providerUserId ?? "(none)"}`,
				);
				return json({ ok: false, reason: "unresolved_connection" }, 202);
			case "ok":
				return json(
					{
						ok: true,
						threadId: result.threadId,
						created: result.created,
						eventKind: result.event.kind,
					},
					201,
				);
		}
	} catch (err) {
		console.error("[integration-webhooks] handler error:", err);
		return error("Internal server error", 500);
	}
}
