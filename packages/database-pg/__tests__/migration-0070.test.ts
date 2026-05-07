import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0070 = readFileSync(
	join(HERE, "..", "drizzle", "0070_compliance_aurora_roles.sql"),
	"utf-8",
);

/**
 * Phase 3 U2: every `-- creates-role:` marker must correspond to an
 * idempotent DO $$ block + a CREATE ROLE / ALTER ROLE pair, and the
 * GRANT matrix must scope each role to its declared per-tier privileges
 * (Decision #4 in the master plan — writer INSERT only on audit_outbox
 * + export_jobs; drainer SELECT/UPDATE on audit_outbox + SELECT on
 * actor_pseudonym + INSERT on audit_events; reader SELECT-only on all
 * four compliance.* tables).
 */
describe("migration 0070 — compliance Aurora roles + grants", () => {
	describe("structural shape", () => {
		it("guards against wrong-database application", () => {
			expect(migration0070).toMatch(
				/IF current_database\(\)\s*!=\s*'thinkwork'/,
			);
		});

		it("guards against missing compliance schema (out-of-order apply vs U1)", () => {
			// CREATE ROLE is not transactional in Postgres — without this
			// pre-flight the 0070 apply against a DB without 0069 would
			// leave roles with passwords but zero grants, and the drift
			// gate would report APPLIED, masking the partial state.
			expect(migration0070).toMatch(
				/IF NOT EXISTS \(SELECT FROM information_schema\.schemata WHERE schema_name = 'compliance'\)/,
			);
			expect(migration0070).toMatch(
				/RAISE EXCEPTION 'compliance schema missing[^']*0069/,
			);
		});

		it("uses the canonical lock_timeout / statement_timeout pattern", () => {
			expect(migration0070).toMatch(/SET LOCAL lock_timeout = '5s'/);
			expect(migration0070).toMatch(/SET LOCAL statement_timeout = '60s'/);
		});

		it("wraps DDL in BEGIN / COMMIT", () => {
			const beginOffset = migration0070.indexOf("\nBEGIN;");
			const commitOffset = migration0070.lastIndexOf("\nCOMMIT;");
			expect(beginOffset).toBeGreaterThan(0);
			expect(commitOffset).toBeGreaterThan(beginOffset);
		});
	});

	describe("creates-role markers (drift-gate consumed)", () => {
		const roles = [
			"compliance_writer",
			"compliance_drainer",
			"compliance_reader",
		] as const;

		it.each(roles)("declares creates-role marker for %s", (role) => {
			expect(migration0070).toMatch(
				new RegExp(`--\\s*creates-role:\\s*${role}\\b`),
			);
		});
	});

	describe("idempotent role creation", () => {
		const roles = [
			"compliance_writer",
			"compliance_drainer",
			"compliance_reader",
		] as const;

		it.each(roles)(
			"%s creation block checks pg_roles existence before CREATE ROLE",
			(role) => {
				// DO $$ block must check pg_roles before CREATE ROLE so re-runs
				// don't error on duplicate-role. Without this guard the bootstrap
				// script's idempotency story breaks the moment passwords rotate.
				const blockPattern = new RegExp(
					`IF NOT EXISTS \\(SELECT FROM pg_roles WHERE rolname = '${role}'\\)[\\s\\S]*?CREATE ROLE ${role}[\\s\\S]*?ELSE[\\s\\S]*?ALTER ROLE ${role}`,
				);
				expect(migration0070).toMatch(blockPattern);
			},
		);

		it.each(roles)("%s creation uses psql variable substitution", (role) => {
			const passVar = role.replace("compliance_", "") + "_pass";
			// Passwords are passed via -v writer_pass=... at psql invocation
			// time; format(%L) does the SQL-quoting so passwords with single
			// quotes or backslashes round-trip correctly.
			expect(migration0070).toMatch(
				new RegExp(
					`format\\('(?:CREATE|ALTER) ROLE ${role}[^']*PASSWORD %L'\\s*,\\s*:'${passVar}'\\)`,
				),
			);
		});
	});

	describe("GRANT matrix matches Decision #4", () => {
		it("all three roles get USAGE on schema compliance", () => {
			expect(migration0070).toMatch(
				/GRANT USAGE ON SCHEMA compliance TO compliance_writer, compliance_drainer, compliance_reader/,
			);
		});

		describe("compliance_writer (INSERT only on audit_outbox + export_jobs)", () => {
			it("grants INSERT on audit_outbox", () => {
				expect(migration0070).toMatch(
					/GRANT INSERT ON compliance\.audit_outbox TO compliance_writer/,
				);
			});

			it("grants INSERT on export_jobs", () => {
				expect(migration0070).toMatch(
					/GRANT INSERT ON compliance\.export_jobs TO compliance_writer/,
				);
			});

			it("does NOT grant any access to audit_events", () => {
				// Writer has no path to audit_events — only the drainer writes
				// there, and only via the U4 outbox flow.
				expect(migration0070).not.toMatch(
					/GRANT [\w, ]+ ON compliance\.audit_events TO compliance_writer/,
				);
			});

			it("does NOT grant SELECT/UPDATE/DELETE on writer's tables", () => {
				// INSERT-only writer — anything else (including SELECT on
				// audit_outbox to verify what was just written) widens blast
				// radius unnecessarily.
				expect(migration0070).not.toMatch(
					/GRANT (?:SELECT|UPDATE|DELETE)[^;]*TO compliance_writer/,
				);
			});
		});

		describe("compliance_drainer (poll outbox, write audit_events)", () => {
			it("grants SELECT, UPDATE on audit_outbox", () => {
				expect(migration0070).toMatch(
					/GRANT SELECT, UPDATE ON compliance\.audit_outbox TO compliance_drainer/,
				);
			});

			it("grants SELECT on actor_pseudonym", () => {
				expect(migration0070).toMatch(
					/GRANT SELECT ON compliance\.actor_pseudonym TO compliance_drainer/,
				);
			});

			it("grants INSERT on audit_events", () => {
				expect(migration0070).toMatch(
					/GRANT INSERT ON compliance\.audit_events TO compliance_drainer/,
				);
			});

			it("does NOT grant DELETE/TRUNCATE on any table", () => {
				// The U1 immutability triggers RAISE EXCEPTION on UPDATE/DELETE/
				// TRUNCATE of audit_events regardless of role grants — but role
				// scoping is the first line of defense and shouldn't include
				// the destructive verbs in the first place.
				expect(migration0070).not.toMatch(
					/GRANT [\w, ]*(?:DELETE|TRUNCATE)[\w, ]*ON compliance\.[a-z_]+ TO compliance_drainer/,
				);
			});
		});

		describe("compliance_reader (SELECT-only on all four tables)", () => {
			const tables = [
				"audit_outbox",
				"audit_events",
				"actor_pseudonym",
				"export_jobs",
			] as const;

			it.each(tables)("grants SELECT on %s", (table) => {
				expect(migration0070).toMatch(
					new RegExp(
						`GRANT SELECT ON compliance\\.${table} TO compliance_reader`,
					),
				);
			});

			it("does NOT grant INSERT/UPDATE/DELETE on any table", () => {
				expect(migration0070).not.toMatch(
					/GRANT (?:INSERT|UPDATE|DELETE)[^;]*TO compliance_reader/,
				);
			});
		});
	});

	describe("SQL injection safety in password substitution", () => {
		it("uses format(%L) for password interpolation, not plain :'pass' in CREATE ROLE", () => {
			// format(%L) emits a properly-escaped SQL literal even when the
			// password contains single quotes, backslashes, or null bytes. A
			// raw `CREATE ROLE foo WITH LOGIN PASSWORD :'pass'` would also
			// quote correctly under psql's default settings, but format(%L)
			// is defensive and matches the EXECUTE pattern that lets us put
			// the create/alter inside DO blocks.
			const formatMatches = migration0070.match(
				/format\('[A-Z][^']+%L'\s*,\s*:'(?:writer|drainer|reader)_pass'\)/g,
			);
			expect(formatMatches?.length ?? 0).toBeGreaterThanOrEqual(6);
			// 6 = 3 roles × 2 branches (CREATE + ALTER)
		});

		it.each([
			["compliance_writer", "writer_pass"],
			["compliance_drainer", "drainer_pass"],
			["compliance_reader", "reader_pass"],
		])(
			"%s has both CREATE and ALTER format(%%L) branches with the matching variable",
			(role, passVar) => {
				// Per-role assertion catches a missing branch that the
				// >=6-count assertion above would silently pass — e.g. if a
				// future edit drops the ALTER branch on one role.
				const createPattern = new RegExp(
					`format\\('CREATE ROLE ${role}[^']+%L'\\s*,\\s*:'${passVar}'\\)`,
				);
				const alterPattern = new RegExp(
					`format\\('ALTER ROLE ${role}[^']+%L'\\s*,\\s*:'${passVar}'\\)`,
				);
				expect(migration0070).toMatch(createPattern);
				expect(migration0070).toMatch(alterPattern);
			},
		);
	});
});
