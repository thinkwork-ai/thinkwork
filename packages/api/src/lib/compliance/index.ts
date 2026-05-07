/**
 * Public API for the compliance audit-event helper.
 *
 * Resolvers and Lambda handlers import via:
 *
 *   import { emitAuditEvent } from "../lib/compliance";
 *
 * Wire inside the caller's existing `db.transaction(async (tx) => { ... })`
 * so the audit write is atomic with the primary mutation. The helper
 * throws on validation failure or insert failure — control-evidence-tier
 * callers let the throw propagate to their tx (rollback); telemetry-tier
 * callers wrap in try/catch + void log.
 *
 * See `docs/plans/2026-05-07-003-feat-compliance-u3-write-helper-plan.md`.
 */

export {
	emitAuditEvent,
	COMPLIANCE_SOURCES,
	type ComplianceSource,
	type EmitAuditEventInput,
	type EmitAuditEventResult,
} from "./emit";

export { redactPayload, sanitizeStringField } from "./redaction";
export type { RedactResult } from "./redaction";

export { EVENT_PAYLOAD_SHAPES } from "./event-schemas";
export type { RedactionSchema } from "./event-schemas";

// Re-exports from the schema package so consumers don't need a separate
// import for the type union.
export {
	COMPLIANCE_EVENT_TYPES,
	COMPLIANCE_ACTOR_TYPES,
	type ComplianceEventType,
	type ComplianceActorType,
} from "@thinkwork/database-pg/schema";
