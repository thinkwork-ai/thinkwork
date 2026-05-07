/**
 * `emitAuditEvent` — in-process write helper for the compliance
 * audit-event log.
 *
 * Callers (Yoga resolvers, Lambda handlers) invoke this inside their
 * existing `db.transaction(async (tx) => { ... })` block so the audit
 * write is atomic with the primary mutation. The helper:
 *
 *   1. Validates eventType / source / actorType against the typed enums.
 *   2. Generates UUIDv7 event_id + outbox_id.
 *   3. Redacts the payload via the per-event-type allow-list.
 *   4. Inserts into `compliance.audit_outbox`.
 *   5. Returns identifiers for caller smoke pinning.
 *
 * The U4 drainer Lambda (separate process, reserved-concurrency=1)
 * polls the outbox, computes the per-tenant hash chain, and copies to
 * `compliance.audit_events`. The helper has no awareness of the chain.
 *
 * **Tier semantics** (master plan R6):
 *   - Control-evidence: caller lets the helper's throw propagate to
 *     their tx, which rolls back. The originating action fails.
 *   - Telemetry: caller wraps in try/catch + void log. The originating
 *     action proceeds; the audit gap fires an operator alert.
 *
 * The helper itself doesn't pick the tier — that's a call-site decision.
 */

import type { Database } from "@thinkwork/database-pg";
import {
	auditOutbox,
	COMPLIANCE_ACTOR_TYPES,
	COMPLIANCE_EVENT_TYPES,
	type ComplianceActorType,
	type ComplianceEventType,
} from "@thinkwork/database-pg/schema";
import { uuidv7 } from "uuidv7";
import { redactPayload } from "./redaction";

/**
 * Drizzle handle accepted by the helper: either the top-level `db` or a
 * `tx` from inside `db.transaction(async (tx) => ...)`. Indexing off the
 * Database type extracts whatever PgTransaction shape Drizzle uses,
 * future-proof against drizzle-orm version bumps.
 *
 * Exported so callers + tests can name the parameter type directly
 * instead of reaching through `Parameters<typeof emitAuditEvent>[0]`.
 */
export type AuditTx =
	| Database
	| Parameters<Parameters<Database["transaction"]>[0]>[0];

export const COMPLIANCE_SOURCES = [
	"graphql",
	"lambda",
	"strands",
	"scheduler",
	"system",
] as const;
export type ComplianceSource = (typeof COMPLIANCE_SOURCES)[number];

const COMPLIANCE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
	COMPLIANCE_EVENT_TYPES,
);
const COMPLIANCE_ACTOR_TYPE_SET: ReadonlySet<string> = new Set(
	COMPLIANCE_ACTOR_TYPES,
);
const COMPLIANCE_SOURCE_SET: ReadonlySet<string> = new Set(COMPLIANCE_SOURCES);

export interface EmitAuditEventInput {
	/** Required envelope fields (R5). */
	tenantId: string;
	actorId: string;
	actorType: ComplianceActorType;
	eventType: ComplianceEventType;
	source: ComplianceSource;
	/** Raw payload — helper redacts before insert. */
	payload: Record<string, unknown>;

	/** Optional envelope fields. */
	occurredAt?: Date;
	resourceType?: string;
	resourceId?: string;
	action?: string;
	outcome?: string;
	requestId?: string;
	threadId?: string;
	agentId?: string;
	controlIds?: string[];
	payloadSchemaVersion?: number;
	/** Pre-uploaded S3 key for oversize payloads (caller uploads; helper passes through). */
	payloadOversizeS3Key?: string;

	/**
	 * Optional caller-supplied event_id (U6). When present, the helper
	 * uses this value as-is instead of generating a fresh UUIDv7. The
	 * caller is responsible for passing a UUIDv7-shaped value — the
	 * helper validates the shape and throws on mismatch. This exists so
	 * cross-runtime callers (Strands Python client) can supply the same
	 * event_id across retries; the `audit_outbox.uq_audit_outbox_event_id`
	 * unique constraint then makes replays idempotent at the DB layer.
	 *
	 * Existing in-process U5 callers (createAgent, createInvite, MCP
	 * CRUD, workspace-files) should NOT pass this — generating
	 * server-side keeps the chain ordering invariant simple.
	 */
	eventId?: string;
}

/**
 * UUIDv7 regex from RFC 9562 — version nibble is `7`, variant nibble is
 * `8`/`9`/`a`/`b`. The helper validates caller-supplied event_ids
 * against this shape so a malformed ID never reaches the DB unique
 * constraint where it would silently disable idempotent replay.
 */
const UUIDV7_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EmitAuditEventResult {
	eventId: string;
	outboxId: string;
	/** Field names that were dropped, truncated, or scrubbed during redaction. */
	redactedFields: string[];
}

/**
 * Insert a redacted audit event into `compliance.audit_outbox`.
 *
 * Callers should pass `tx` (from `db.transaction(async (tx) => ...)`)
 * for control-evidence semantics; passing `db` directly bypasses
 * transactional atomicity with the primary write.
 *
 * **Tenant-boundary contract:** `tenantId` and `actorId` are caller-
 * supplied. The helper does NOT validate that the caller is authorized
 * to write for that tenant — that is the caller's responsibility,
 * resolved via `resolveCallerFromAuth(ctx.auth)` /
 * `resolveCallerTenantId(ctx)` in resolvers, or via the authenticated
 * session context in Lambda handlers. A resolver passing a user-
 * supplied `tenantId` would corrupt that tenant's hash chain (U4); all
 * call sites must derive tenant ID from the authenticated session, not
 * from request arguments.
 *
 * Throws on:
 *   - Unknown eventType / source / actorType
 *   - Missing required fields (tenantId, actorId)
 *   - Unknown event type in the redaction registry
 *   - Drizzle insert failure (propagates the underlying error)
 *
 * Returns identifiers + redaction provenance for caller smoke pinning.
 */
export async function emitAuditEvent(
	tx: AuditTx,
	input: EmitAuditEventInput,
): Promise<EmitAuditEventResult> {
	// ── Validation ───────────────────────────────────────────────
	if (!input.tenantId) {
		throw new Error("emitAuditEvent: tenantId is required");
	}
	if (!input.actorId) {
		throw new Error("emitAuditEvent: actorId is required");
	}
	if (!COMPLIANCE_EVENT_TYPE_SET.has(input.eventType)) {
		throw new Error(
			`emitAuditEvent: unknown eventType "${input.eventType}". ` +
				`Allowed: ${COMPLIANCE_EVENT_TYPES.join(", ")}`,
		);
	}
	if (!COMPLIANCE_ACTOR_TYPE_SET.has(input.actorType)) {
		throw new Error(
			`emitAuditEvent: unknown actorType "${input.actorType}". ` +
				`Allowed: ${COMPLIANCE_ACTOR_TYPES.join(", ")}`,
		);
	}
	if (!COMPLIANCE_SOURCE_SET.has(input.source)) {
		throw new Error(
			`emitAuditEvent: unknown source "${input.source}". ` +
				`Allowed: ${COMPLIANCE_SOURCES.join(", ")}`,
		);
	}
	if (input.eventId !== undefined && !UUIDV7_RE.test(input.eventId)) {
		throw new Error(
			`emitAuditEvent: eventId "${input.eventId}" is not a valid UUIDv7. ` +
				`Cross-runtime idempotency depends on UUIDv7 shape; pass undefined ` +
				`to let the helper generate one server-side.`,
		);
	}

	// ── ID + redaction ───────────────────────────────────────────
	const eventId = input.eventId ?? uuidv7();
	const outboxId = uuidv7();
	const occurredAt = input.occurredAt ?? new Date();

	const { redacted, redactedFields } = redactPayload(
		input.eventType,
		input.payload,
	);

	// ── Envelope build ───────────────────────────────────────────
	// Match the auditOutbox Drizzle schema column names. Drizzle's typed
	// insert validates the shape at compile time via the table's
	// inferred type.
	const row = {
		outbox_id: outboxId,
		event_id: eventId,
		tenant_id: input.tenantId,
		occurred_at: occurredAt,
		actor: input.actorId,
		actor_type: input.actorType,
		source: input.source,
		event_type: input.eventType,
		resource_type: input.resourceType ?? null,
		resource_id: input.resourceId ?? null,
		action: input.action ?? null,
		outcome: input.outcome ?? null,
		request_id: input.requestId ?? null,
		thread_id: input.threadId ?? null,
		agent_id: input.agentId ?? null,
		payload: redacted,
		payload_schema_version: input.payloadSchemaVersion ?? 1,
		control_ids: input.controlIds ?? [],
		payload_redacted_fields: redactedFields,
		payload_oversize_s3_key: input.payloadOversizeS3Key ?? null,
	};

	// ── Insert ───────────────────────────────────────────────────
	// Failure propagates to the caller's tx → control-evidence semantic.
	await tx.insert(auditOutbox).values(row);

	return { eventId, outboxId, redactedFields };
}
