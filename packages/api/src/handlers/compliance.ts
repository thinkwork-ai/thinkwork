/**
 * Compliance audit event emit endpoint — POST /api/compliance/events
 *
 * Cross-runtime emit path (U6). The Python Strands runtime authenticates
 * via API_AUTH_SECRET (no user session) and POSTs audit events to this
 * endpoint, which validates the cross-tenant boundary, emits through the
 * U3 helper inside a transaction, and returns idempotent-replay metadata.
 *
 * Auth: Bearer API_AUTH_SECRET only (no Cognito). Strands has no user
 * session; the platform-credential is the trust boundary.
 *
 * Idempotency: client supplies `event_id` (UUIDv7) in the body and
 * mirrors it in the optional `Idempotency-Key` header. Pre-check via
 * SELECT against `audit_outbox.event_id`; on hit, return 200 with
 * `{idempotent: true}` and the previously-stored outbox_id. On miss,
 * INSERT through the U3 helper. The pg unique constraint on
 * `audit_outbox.event_id` (U1's `uq_audit_outbox_event_id`) is a
 * defense-in-depth fallback for the SELECT/INSERT race; on 23505 we
 * re-run the SELECT and return idempotent: true.
 *
 * Tier semantics: handler is internally atomic (db.transaction rolls
 * back on any error). The Strands caller treats this as telemetry —
 * if the entire round-trip fails, agent action proceeds anyway.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { auditOutbox, users } from "@thinkwork/database-pg/schema";
import {
	emitAuditEvent,
	type EmitAuditEventInput,
} from "../lib/compliance/emit.js";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error } from "../lib/response.js";

const UUIDV7_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_ACTOR_TYPES = new Set(["user", "system", "agent"] as const);

interface ComplianceEventBody {
	event_id?: unknown;
	tenantId?: unknown;
	actorUserId?: unknown;
	actorType?: unknown;
	eventType?: unknown;
	source?: unknown;
	payload?: unknown;
	occurredAt?: unknown;
	resourceType?: unknown;
	resourceId?: unknown;
	action?: unknown;
	outcome?: unknown;
	requestId?: unknown;
	threadId?: unknown;
	agentId?: unknown;
	controlIds?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		Object.getPrototypeOf(v) === Object.prototype
	);
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const cors = handleCors(event);
	if (cors) return cors;

	if (event.requestContext?.http?.method !== "POST") {
		return error("Method not allowed", 405);
	}
	if (event.rawPath !== "/api/compliance/events") {
		return error("Not found", 404);
	}

	// ── Auth: API_AUTH_SECRET only (no Cognito). Strands has no user session.
	const bearer = extractBearerToken(event);
	if (!bearer || !validateApiSecret(bearer)) {
		return error("Unauthorized", 401);
	}

	// ── Body parse + validate.
	let body: ComplianceEventBody;
	try {
		body = JSON.parse(event.body || "{}");
	} catch {
		return error("Invalid JSON body", 400);
	}

	if (typeof body.event_id !== "string" || !UUIDV7_RE.test(body.event_id)) {
		return error(
			"event_id must be a UUIDv7 string (cross-runtime idempotency depends on UUIDv7 shape)",
			400,
		);
	}
	if (typeof body.tenantId !== "string" || !body.tenantId) {
		return error("tenantId is required", 400);
	}
	if (typeof body.actorUserId !== "string" || !body.actorUserId) {
		return error("actorUserId is required", 400);
	}
	const actorType = body.actorType ?? "user";
	if (
		typeof actorType !== "string" ||
		!ALLOWED_ACTOR_TYPES.has(actorType as never)
	) {
		return error(
			"actorType must be one of: user, system, agent",
			400,
		);
	}
	if (typeof body.eventType !== "string" || !body.eventType) {
		return error("eventType is required", 400);
	}
	if (!isPlainObject(body.payload)) {
		return error("payload must be a plain object", 400);
	}

	// Idempotency-Key header is a courtesy mirror of body.event_id —
	// validate they agree when both are present so a buggy client
	// fails loudly instead of silently picking one over the other.
	const idempotencyKey =
		event.headers["idempotency-key"] || event.headers["Idempotency-Key"];
	if (idempotencyKey && idempotencyKey !== body.event_id) {
		return error(
			"Idempotency-Key header does not match body event_id",
			400,
		);
	}

	const eventId = body.event_id;
	const tenantId = body.tenantId;
	const actorUserId = body.actorUserId;
	const eventType = body.eventType;
	const payload = body.payload;
	const source =
		typeof body.source === "string" && body.source
			? body.source
			: "strands";

	// Optional envelope fields with light validation.
	const occurredAt =
		typeof body.occurredAt === "string"
			? new Date(body.occurredAt)
			: undefined;
	if (occurredAt && Number.isNaN(occurredAt.getTime())) {
		return error("occurredAt must be a valid ISO 8601 timestamp", 400);
	}

	const optionalString = (v: unknown): string | undefined =>
		typeof v === "string" ? v : undefined;
	const controlIds = isStringArray(body.controlIds)
		? body.controlIds
		: undefined;

	// ── Cross-tenant guard. The body's tenantId is caller-supplied; we
	// only trust it after confirming the supplied actorUserId actually
	// belongs to that tenant. Don't reveal whether the user exists in
	// another tenant — return 403 uniformly on mismatch or missing.
	//
	// The SELECT against the `users` table only applies for
	// `actorType === "user"`. `system` and `agent` actorIds are not
	// `users.id` PKs (system actors are platform constants like
	// "platform-credential", agent actorIds are `agents.id` rows in
	// a different table), so SELECTing `users` would always 403 them.
	// For non-user actorTypes the API_AUTH_SECRET bearer is the trust
	// boundary; the body's tenantId is accepted as authoritative.
	if (actorType === "user") {
		const [actorRow] = await db
			.select({ tenant_id: users.tenant_id })
			.from(users)
			.where(eq(users.id, actorUserId))
			.limit(1);

		if (!actorRow || actorRow.tenant_id !== tenantId) {
			return error("Forbidden", 403);
		}
	}

	// ── Idempotency pre-check. Cheap SELECT before opening a tx. Replay
	// returns 200 with idempotent: true and the previously-stored
	// outbox_id; the chain hash for this event_id has already been
	// computed by the U4 drainer (or will be on the next sweep).
	const [existing] = await db
		.select({
			event_id: auditOutbox.event_id,
			outbox_id: auditOutbox.outbox_id,
		})
		.from(auditOutbox)
		.where(eq(auditOutbox.event_id, eventId))
		.limit(1);

	if (existing) {
		return json({
			dispatched: true,
			idempotent: true,
			eventId: existing.event_id,
			outboxId: existing.outbox_id,
			redactedFields: [],
		});
	}

	// ── Emit via U3 helper inside a transaction. The wrapping tx is
	// belt-and-suspenders: U3's INSERT is the only DB write, so a
	// rollback simply undoes the INSERT. Wrapping anyway preserves the
	// pattern other callers use and leaves room for future
	// pre-emit reads.
	const emitInput: EmitAuditEventInput = {
		eventId,
		tenantId,
		actorId: actorUserId,
		actorType: actorType as never,
		eventType: eventType as never,
		source: source as never,
		payload: payload as Record<string, unknown>,
		occurredAt,
		resourceType: optionalString(body.resourceType),
		resourceId: optionalString(body.resourceId),
		action: optionalString(body.action),
		outcome: optionalString(body.outcome),
		requestId: optionalString(body.requestId),
		threadId: optionalString(body.threadId),
		agentId: optionalString(body.agentId),
		controlIds,
	};

	try {
		const result = await db.transaction(async (tx) => {
			return await emitAuditEvent(tx, emitInput);
		});
		return json({
			dispatched: true,
			idempotent: false,
			eventId: result.eventId,
			outboxId: result.outboxId,
			redactedFields: result.redactedFields,
		});
	} catch (err: unknown) {
		// pg unique-violation race: a concurrent request with the same
		// event_id landed between our SELECT and INSERT. Re-run the
		// SELECT and surface the pre-existing row as an idempotent hit.
		// drizzle-orm wraps the underlying pg error, so check both the
		// outer `.code` AND the wrapped `.cause.code` (this matches the
		// existing 23505 patterns at
		// `packages/api/src/lib/computers/tasks.ts:383` and
		// `packages/api/src/lib/connectors/runtime.ts:862`).
		const errAny = err as { code?: string; cause?: { code?: string } };
		const pgCode = errAny?.code ?? errAny?.cause?.code;
		if (pgCode === "23505") {
			const [raced] = await db
				.select({
					event_id: auditOutbox.event_id,
					outbox_id: auditOutbox.outbox_id,
				})
				.from(auditOutbox)
				.where(eq(auditOutbox.event_id, eventId))
				.limit(1);
			if (raced) {
				return json({
					dispatched: true,
					idempotent: true,
					eventId: raced.event_id,
					outboxId: raced.outbox_id,
					redactedFields: [],
				});
			}
		}
		// Validation errors from the U3 helper (unknown eventType /
		// actorType / source / malformed eventId) and the
		// redaction registry (`redactPayload: ` prefix on unknown
		// eventTypes) bubble up here. Mapping these to 400 keeps the
		// contract honest — they're caller bugs, not server faults —
		// and prevents the Python client from treating them as
		// retryable 5xx and exhausting backoff on a permanent error.
		const message = err instanceof Error ? err.message : String(err);
		if (
			message.startsWith("emitAuditEvent: ") ||
			message.startsWith("redactPayload: ")
		) {
			return error(
				message.replace(/^(emitAuditEvent|redactPayload): /, ""),
				400,
			);
		}
		console.error(`[compliance.events] emit failed: ${message}`);
		return error("Internal server error", 500);
	}
}
