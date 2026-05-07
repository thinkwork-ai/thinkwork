/**
 * compliance.* — append-only audit-event log + tamper evidence.
 *
 * Phase 3 U1 of the System Workflows revert + Compliance reframe. SOC2
 * Type 1 evidence-foundation. The DDL is hand-rolled in
 * drizzle/0069_compliance_schema.sql (cross-schema work isn't standard
 * for the repo and the GRANT/trigger hardening is fiddly to express via
 * the Drizzle DSL); this TS file is the typed read-side view that
 * resolvers + the U4 drainer Lambda consume.
 *
 * Plan: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
 *
 * Write path:
 *   resolver/handler tx → emitAuditEvent (U3) → INSERT compliance.audit_outbox
 *                              → drainer (U4) chains hash → INSERT compliance.audit_events
 *
 * Role separation (U2 ships GRANTs):
 *   - compliance_writer: USAGE on schema + INSERT on audit_outbox + INSERT on export_jobs
 *   - compliance_drainer: SELECT/UPDATE on audit_outbox + INSERT on audit_events
 *   - compliance_reader: USAGE + SELECT on all four tables
 *
 * Defense-in-depth: BEFORE UPDATE/DELETE triggers on audit_events
 * RAISE EXCEPTION regardless of role.
 */

import {
	pgSchema,
	uuid,
	text,
	timestamp,
	integer,
	jsonb,
	char,
	index,
	uniqueIndex,
	check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const compliance = pgSchema("compliance");

/**
 * audit_outbox — same-transaction durability tier for control-evidence
 * writes. Resolvers + handlers insert here in their primary transaction;
 * if the originating action commits, the outbox row is visible. The U4
 * drainer Lambda single-writer (reserved-concurrency=1) polls
 * `FOR UPDATE SKIP LOCKED LIMIT 1`, computes per-tenant hash chain, and
 * writes to audit_events keyed on outbox_id (UNIQUE; idempotent on
 * replay).
 */
export const auditOutbox = compliance.table(
	"audit_outbox",
	{
		outbox_id: uuid("outbox_id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		event_id: uuid("event_id").notNull(),
		tenant_id: uuid("tenant_id").notNull(),
		occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
		enqueued_at: timestamp("enqueued_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		drained_at: timestamp("drained_at", { withTimezone: true }),
		drainer_error: text("drainer_error"),
		actor: text("actor").notNull(),
		actor_type: text("actor_type").notNull(),
		source: text("source").notNull(),
		event_type: text("event_type").notNull(),
		resource_type: text("resource_type"),
		resource_id: text("resource_id"),
		action: text("action"),
		outcome: text("outcome"),
		request_id: text("request_id"),
		thread_id: uuid("thread_id"),
		agent_id: uuid("agent_id"),
		payload: jsonb("payload")
			.notNull()
			.default(sql`'{}'::jsonb`),
		payload_schema_version: integer("payload_schema_version")
			.notNull()
			.default(1),
		control_ids: text("control_ids")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		payload_redacted_fields: text("payload_redacted_fields")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		payload_oversize_s3_key: text("payload_oversize_s3_key"),
	},
	(table) => [
		uniqueIndex("uq_audit_outbox_event_id").on(table.event_id),
		index("idx_audit_outbox_pending")
			.on(table.enqueued_at)
			.where(sql`${table.drained_at} IS NULL`),
		index("idx_audit_outbox_tenant_enqueued").on(
			table.tenant_id,
			table.enqueued_at,
		),
		check(
			"audit_outbox_event_type_prefix",
			sql`${table.event_type} ~ '^(auth|user|agent|mcp|workspace|data|policy|approval)\\.'`,
		),
	],
);

/**
 * audit_events — append-only audit-event log (R5). Per-tenant hash chain
 * via prev_hash + event_hash, both computed app-side by the U4 drainer
 * Lambda. INSERT is the only legal mutation; UPDATE and DELETE are
 * rejected by the compliance.raise_immutable() trigger.
 *
 * The 22-field origin envelope (R5) plus payload_oversize_s3_key
 * (oversized payloads spill to S3) and outbox_id (link to originating
 * outbox row, drainer-replay idempotency key).
 */
export const auditEvents = compliance.table(
	"audit_events",
	{
		event_id: uuid("event_id").primaryKey().notNull(),
		outbox_id: uuid("outbox_id").notNull(),
		tenant_id: uuid("tenant_id").notNull(),
		occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
		recorded_at: timestamp("recorded_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		actor: text("actor").notNull(),
		actor_type: text("actor_type").notNull(),
		source: text("source").notNull(),
		event_type: text("event_type").notNull(),
		resource_type: text("resource_type"),
		resource_id: text("resource_id"),
		action: text("action"),
		outcome: text("outcome"),
		request_id: text("request_id"),
		thread_id: uuid("thread_id"),
		agent_id: uuid("agent_id"),
		payload: jsonb("payload")
			.notNull()
			.default(sql`'{}'::jsonb`),
		payload_schema_version: integer("payload_schema_version")
			.notNull()
			.default(1),
		control_ids: text("control_ids")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		payload_redacted_fields: text("payload_redacted_fields")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		payload_oversize_s3_key: text("payload_oversize_s3_key"),
		prev_hash: char("prev_hash", { length: 64 }),
		event_hash: char("event_hash", { length: 64 }).notNull(),
	},
	(table) => [
		uniqueIndex("uq_audit_events_event_id").on(table.event_id),
		uniqueIndex("uq_audit_events_outbox_id").on(table.outbox_id),
		index("idx_audit_events_tenant_occurred").on(
			table.tenant_id,
			table.occurred_at,
		),
		index("idx_audit_events_tenant_event_type").on(
			table.tenant_id,
			table.event_type,
			table.occurred_at,
		),
		index("idx_audit_events_actor").on(table.actor),
		// GIN index in DDL — Drizzle index() defaults to BTREE; the SQL
		// migration is the source of truth for the access method.
		index("idx_audit_events_control_ids").using("gin", table.control_ids),
		check(
			"audit_events_actor_type_allowed",
			sql`${table.actor_type} IN ('user','system','agent')`,
		),
		check(
			"audit_events_event_type_prefix",
			sql`${table.event_type} ~ '^(auth|user|agent|mcp|workspace|data|policy|approval)\\.'`,
		),
	],
);

/**
 * actor_pseudonym — opaque actor_id ↔ user_id + email_hash mapping.
 * GDPR right-to-be-forgotten enabler (Decision #5). Audit chain hashes
 * the opaque actor id, never PII. RTBF erasure deletes the pseudonym
 * row; chain remains valid (no audit_events row mutates) but
 * actor→person resolution is lost.
 */
export const actorPseudonym = compliance.table(
	"actor_pseudonym",
	{
		actor_id: uuid("actor_id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		user_id: uuid("user_id"),
		email_hash: char("email_hash", { length: 64 }),
		actor_type: text("actor_type").notNull(),
		display_name: text("display_name"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_actor_pseudonym_user")
			.on(table.user_id)
			.where(sql`${table.user_id} IS NOT NULL`),
		index("idx_actor_pseudonym_email_hash")
			.on(table.email_hash)
			.where(sql`${table.email_hash} IS NOT NULL`),
		check(
			"actor_pseudonym_actor_type_allowed",
			sql`${table.actor_type} IN ('user','system','agent')`,
		),
	],
);

/**
 * export_jobs — admin async-export tracking (R9, U11). createAuditExport
 * mutation enforces 90-day max date range + 10/hour/admin rate limit at
 * the resolver layer before insert. export-runner Lambda streams the
 * filtered events to S3 multipart and publishes a 15-minute presigned
 * URL.
 */
export const exportJobs = compliance.table(
	"export_jobs",
	{
		job_id: uuid("job_id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id").notNull(),
		requested_by_actor_id: uuid("requested_by_actor_id").notNull(),
		filter: jsonb("filter").notNull(),
		format: text("format").notNull(),
		status: text("status").notNull().default("queued"),
		s3_key: text("s3_key"),
		presigned_url: text("presigned_url"),
		presigned_url_expires_at: timestamp("presigned_url_expires_at", {
			withTimezone: true,
		}),
		job_error: text("job_error"),
		requested_at: timestamp("requested_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		started_at: timestamp("started_at", { withTimezone: true }),
		completed_at: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		index("idx_export_jobs_tenant_requested").on(
			table.tenant_id,
			table.requested_at,
		),
		index("idx_export_jobs_actor_requested").on(
			table.tenant_id,
			table.requested_by_actor_id,
			table.requested_at,
		),
		check(
			"export_jobs_format_allowed",
			sql`${table.format} IN ('csv','json')`,
		),
		check(
			"export_jobs_status_allowed",
			sql`${table.status} IN ('queued','running','complete','failed')`,
		),
	],
);

/**
 * Canonical event-type slate (R10) — the 10 starter events for SOC2
 * Type 1 evidence + 5 reserved Phase 6 governance types (R14, declared
 * but not emitted in v1).
 */
export const COMPLIANCE_EVENT_TYPES = [
	// Phase 3 starter slate (R10)
	"auth.signin.success",
	"auth.signin.failure",
	"auth.signout",
	"user.invited",
	"user.created",
	"user.disabled",
	"user.deleted",
	"agent.created",
	"agent.deleted",
	"agent.skills_changed",
	"mcp.added",
	"mcp.removed",
	"workspace.governance_file_edited",
	"data.export_initiated",
	// Phase 6 reservations (R14)
	"policy.evaluated",
	"policy.allowed",
	"policy.blocked",
	"policy.bypassed",
	"approval.recorded",
] as const;

export type ComplianceEventType = (typeof COMPLIANCE_EVENT_TYPES)[number];

export const COMPLIANCE_ACTOR_TYPES = ["user", "system", "agent"] as const;
export type ComplianceActorType = (typeof COMPLIANCE_ACTOR_TYPES)[number];
