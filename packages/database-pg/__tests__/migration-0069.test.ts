import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0069 = readFileSync(
	join(HERE, "..", "drizzle", "0069_compliance_schema.sql"),
	"utf-8",
);
const schemaSource = readFileSync(
	join(HERE, "..", "src", "schema", "compliance.ts"),
	"utf-8",
);
const indexSource = readFileSync(
	join(HERE, "..", "src", "schema", "index.ts"),
	"utf-8",
);

/**
 * Phase 3 U1: every `-- creates:` / `-- creates-constraint:` /
 * `-- creates-function:` / `-- creates-trigger:` marker in the migration
 * header must correspond to an actual DDL statement, and the Drizzle TS
 * schema must mirror the SQL so resolvers (U3, U10) and the drainer
 * Lambda (U4) get typed access matching what's actually in the database.
 */
describe("migration 0069 — compliance schema foundation", () => {
	describe("structural shape", () => {
		it("creates the compliance schema (idempotent)", () => {
			expect(migration0069).toMatch(/CREATE SCHEMA IF NOT EXISTS compliance\b/);
		});

		it("guards against wrong-database application", () => {
			expect(migration0069).toMatch(
				/IF current_database\(\)\s*!=\s*'thinkwork'/,
			);
		});

		it("uses the canonical lock_timeout / statement_timeout pattern", () => {
			expect(migration0069).toMatch(/SET LOCAL lock_timeout = '5s'/);
			expect(migration0069).toMatch(/SET LOCAL statement_timeout = '60s'/);
		});

		it("wraps DDL in BEGIN / COMMIT", () => {
			const beginOffset = migration0069.indexOf("\nBEGIN;");
			const commitOffset = migration0069.lastIndexOf("\nCOMMIT;");
			expect(beginOffset).toBeGreaterThan(0);
			expect(commitOffset).toBeGreaterThan(beginOffset);
		});
	});

	describe("table creation", () => {
		const tables = [
			"audit_outbox",
			"audit_events",
			"actor_pseudonym",
			"export_jobs",
		] as const;

		it.each(tables)("creates compliance.%s", (table) => {
			expect(migration0069).toMatch(
				new RegExp(`CREATE TABLE IF NOT EXISTS compliance\\.${table}\\b`),
			);
			// Marker line is what the drift gate (scripts/db-migrate-manual.sh)
			// keys off — its absence ships a passing PR that the post-deploy
			// gate fails.
			expect(migration0069).toMatch(
				new RegExp(`--\\s*creates:\\s*compliance\\.${table}\\b`),
			);
		});
	});

	describe("audit_events immutability", () => {
		it("declares the raise_immutable trigger function", () => {
			expect(migration0069).toMatch(
				/CREATE OR REPLACE FUNCTION compliance\.raise_immutable\(\)/,
			);
			expect(migration0069).toMatch(
				/--\s*creates-function:\s*compliance\.raise_immutable\b/,
			);
		});

		it("blocks UPDATE on audit_events via BEFORE UPDATE trigger", () => {
			expect(migration0069).toMatch(
				/CREATE TRIGGER audit_events_block_update\s+BEFORE UPDATE ON compliance\.audit_events/,
			);
			expect(migration0069).toMatch(
				/--\s*creates-trigger:\s*compliance\.audit_events\.audit_events_block_update\b/,
			);
		});

		it("blocks DELETE on audit_events via BEFORE DELETE trigger", () => {
			expect(migration0069).toMatch(
				/CREATE TRIGGER audit_events_block_delete\s+BEFORE DELETE ON compliance\.audit_events/,
			);
			expect(migration0069).toMatch(
				/--\s*creates-trigger:\s*compliance\.audit_events\.audit_events_block_delete\b/,
			);
		});

		it("blocks TRUNCATE on audit_events via BEFORE TRUNCATE STATEMENT trigger", () => {
			// TRUNCATE bypasses BEFORE DELETE triggers in Postgres — without
			// this trigger an actor with TRUNCATE privilege could wipe the
			// entire audit log without surfacing the immutability error.
			expect(migration0069).toMatch(
				/CREATE TRIGGER audit_events_block_truncate\s+BEFORE TRUNCATE ON compliance\.audit_events\s+FOR EACH STATEMENT/,
			);
			expect(migration0069).toMatch(
				/--\s*creates-trigger:\s*compliance\.audit_events\.audit_events_block_truncate\b/,
			);
		});

		it("trigger function switches on TG_OP so a single function serves ROW + STATEMENT firings", () => {
			expect(migration0069).toMatch(/IF TG_OP = 'TRUNCATE' THEN/);
		});

		it("uses idempotent DROP TRIGGER IF EXISTS before each CREATE TRIGGER", () => {
			// Portable across Postgres versions — CREATE OR REPLACE TRIGGER is
			// 14+ but DROP IF EXISTS works on every supported version.
			expect(migration0069).toMatch(
				/DROP TRIGGER IF EXISTS audit_events_block_update ON compliance\.audit_events/,
			);
			expect(migration0069).toMatch(
				/DROP TRIGGER IF EXISTS audit_events_block_delete ON compliance\.audit_events/,
			);
			expect(migration0069).toMatch(
				/DROP TRIGGER IF EXISTS audit_events_block_truncate ON compliance\.audit_events/,
			);
		});
	});

	describe("event-type prefix CHECK matches the slate", () => {
		const eventTypePrefixRegex =
			/event_type\s*~\s*'\^\(auth\|user\|agent\|mcp\|workspace\|data\|policy\|approval\)\\\.'/;

		it("audit_events constrains event_type to known prefixes", () => {
			expect(migration0069).toMatch(eventTypePrefixRegex);
			expect(migration0069).toMatch(
				/CONSTRAINT audit_events_event_type_prefix CHECK/,
			);
		});

		it("audit_outbox constrains event_type to the same prefix set", () => {
			expect(migration0069).toMatch(
				/CONSTRAINT audit_outbox_event_type_prefix CHECK/,
			);
			// Two CHECK occurrences for the same prefix regex confirm the outbox + events tables stay in lockstep.
			const matches = migration0069.match(
				/event_type\s*~\s*'\^\(auth\|user\|agent\|mcp\|workspace\|data\|policy\|approval\)\\\.'/g,
			);
			expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
		});
	});

	describe("indexes match the Events list filter set (R8) and drainer poll", () => {
		const requiredIndexes = [
			// Drainer's `FOR UPDATE SKIP LOCKED WHERE drained_at IS NULL` poll.
			["uq_audit_outbox_event_id", "compliance.audit_outbox"],
			["idx_audit_outbox_pending", "compliance.audit_outbox"],
			["idx_audit_outbox_tenant_enqueued", "compliance.audit_outbox"],
			// Drainer-replay idempotency keyed on outbox_id UNIQUE.
			["uq_audit_events_event_id", "compliance.audit_events"],
			["uq_audit_events_outbox_id", "compliance.audit_events"],
			// Admin Events list filters (R8).
			["idx_audit_events_tenant_occurred", "compliance.audit_events"],
			["idx_audit_events_tenant_event_type", "compliance.audit_events"],
			["idx_audit_events_actor", "compliance.audit_events"],
			["idx_audit_events_control_ids", "compliance.audit_events"],
			// Pseudonym lookup paths (typeahead by email_hash, by user_id).
			["idx_actor_pseudonym_user", "compliance.actor_pseudonym"],
			["idx_actor_pseudonym_email_hash", "compliance.actor_pseudonym"],
			// Export-job listing + rate-limit lookup.
			["idx_export_jobs_tenant_requested", "compliance.export_jobs"],
			["idx_export_jobs_actor_requested", "compliance.export_jobs"],
		] as const;

		it.each(requiredIndexes)("declares %s on %s", (indexName, table) => {
			// The drift-gate marker.
			expect(migration0069).toMatch(
				new RegExp(`--\\s*creates:\\s*compliance\\.${indexName}\\b`),
			);
			// The DDL itself — accept either CREATE INDEX or CREATE UNIQUE INDEX.
			expect(migration0069).toMatch(
				new RegExp(
					`CREATE (UNIQUE )?INDEX IF NOT EXISTS ${indexName}[\\s\\S]*?ON ${table.replace(".", "\\.")}`,
				),
			);
		});

		it("control_ids index uses GIN access method for array containment lookups", () => {
			expect(migration0069).toMatch(
				/CREATE INDEX IF NOT EXISTS idx_audit_events_control_ids[\s\S]*?USING GIN \(control_ids\)/,
			);
		});

		it("audit_outbox pending index is partial WHERE drained_at IS NULL", () => {
			// Without WHERE clause the index is a strict superset of the
			// drainer's FOR UPDATE SKIP LOCKED poll target — partial keeps
			// the index small as drained rows accumulate.
			expect(migration0069).toMatch(
				/CREATE INDEX IF NOT EXISTS idx_audit_outbox_pending[\s\S]*?WHERE drained_at IS NULL/,
			);
		});
	});

	describe("Drizzle TS schema mirrors the SQL", () => {
		it("uses pgSchema('compliance') for cross-schema typed access", () => {
			expect(schemaSource).toMatch(
				/export const compliance = pgSchema\("compliance"\)/,
			);
		});

		it("declares all four tables via compliance.table(...)", () => {
			expect(schemaSource).toMatch(
				/auditOutbox = compliance\.table\(\s*"audit_outbox"/,
			);
			expect(schemaSource).toMatch(
				/auditEvents = compliance\.table\(\s*"audit_events"/,
			);
			expect(schemaSource).toMatch(
				/actorPseudonym = compliance\.table\(\s*"actor_pseudonym"/,
			);
			expect(schemaSource).toMatch(
				/exportJobs = compliance\.table\(\s*"export_jobs"/,
			);
		});

		it("re-exports compliance from the schema barrel", () => {
			expect(indexSource).toContain('export * from "./compliance"');
		});
	});

	describe("event-type slate matches origin R10 + R14 reservation", () => {
		const phase3Slate = [
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
		];

		const phase6Reservations = [
			"policy.evaluated",
			"policy.allowed",
			"policy.blocked",
			"policy.bypassed",
			"approval.recorded",
		];

		it.each(phase3Slate)("declares Phase 3 starter slate type %s", (type) => {
			expect(schemaSource).toContain(`"${type}"`);
		});

		it.each(phase6Reservations)(
			"reserves Phase 6 governance type %s without writers",
			(type) => {
				// R14 — declared but not emitted in v1; presence in the slate
				// constant prevents the prefix CHECK from rejecting future
				// inserts, while no writer code references it yet.
				expect(schemaSource).toContain(`"${type}"`);
			},
		);
	});
});
