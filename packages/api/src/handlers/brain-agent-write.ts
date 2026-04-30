import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json } from "../lib/response.js";
import {
	assertInvokerBelongsToTenant,
	brainWritesEnabledForTenant,
	BrainWriteNotFoundError,
	writeBrainFact,
	type BrainWriteRequest,
} from "../lib/brain/write-service.js";

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;
	if (event.requestContext.http.method !== "POST") {
		return json({ error: "method_not_allowed" }, 405);
	}

	const payload = parsePayload(event);
	if (!payload) return json({ error: "invalid_json" }, 400);
	payload.idempotencyKey =
		payload.idempotencyKey ||
		event.headers["idempotency-key"] ||
		event.headers["Idempotency-Key"] ||
		"";

	if (!(await brainWritesEnabledForTenant(payload.tenantId))) {
		return json({ error: "brain_writes_disabled_for_tenant" }, 503);
	}

	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) {
		return json({ error: "unauthorized" }, 401);
	}

	if (!(await assertInvokerBelongsToTenant(payload))) {
		return json({ error: "forbidden" }, 403);
	}

	try {
		const result = await writeBrainFact(payload);
		return json({ ok: true, ...result });
	} catch (err) {
		if (err instanceof BrainWriteNotFoundError) {
			return json({ error: "not_found" }, 404);
		}
		return json(
			{ error: err instanceof Error ? err.message : String(err) },
			422,
		);
	}
}

function parsePayload(event: APIGatewayProxyEventV2): BrainWriteRequest | null {
	if (!event.body) return null;
	try {
		return JSON.parse(event.body) as BrainWriteRequest;
	} catch {
		return null;
	}
}
