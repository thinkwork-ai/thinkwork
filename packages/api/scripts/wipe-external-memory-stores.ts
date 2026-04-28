#!/usr/bin/env -S tsx
/**
 * One-shot wipe of legacy fragmented Hindsight memory units.
 *
 * Plan: docs/plans/2026-04-27-002-feat-hindsight-ingest-and-runtime-cleanup-plan.md (U11)
 *
 * Targets memory_units rows whose `bank_id` matches `user_%` AND
 * (metadata->>'document_id' IS NULL OR context = 'thread_turn'). These are
 * the per-message-fragmented documents created by the pre-U3 retain path
 * (one row per turn pair, no document_id, context="thread_turn"). The new
 * shape post-U3 is one document per thread keyed by document_id=threadId
 * with context='thinkwork_thread'. The filter targets only the legacy
 * shape, so a run after U3 ships is safe to re-run any time.
 *
 * Storage layer: raw SQL on hindsight.memory_units (Q4 resolution
 * 2026-04-28). Mirrors the existing pattern at
 * packages/api/src/lib/memory/adapters/hindsight-adapter.ts:332-336.
 *
 * Pre-flight consumer survey (required before live runs in any new stage):
 * - recall callsites: HindsightAdapter.recall + inspect — read by metadata
 *   fields; tolerant of legacy rows
 * - eval harness: reads via the adapter; same shape contract
 * - mobile/admin renderers: inspect/export through the adapter; no direct
 *   memory_units coupling
 * - wiki-compile: reads from `hindsight.memory_units` for cursor advance
 *   but does not filter by context literal
 * None filter by `context = 'thread_turn'` literal; the wipe is safe.
 *
 * Usage:
 *   # Dry-run (default): print COUNT, no DELETE
 *   DATABASE_URL=... tsx packages/api/scripts/wipe-external-memory-stores.ts --stage dev
 *
 *   # Live run requires --surveyed-on within 7 days
 *   DATABASE_URL=... tsx packages/api/scripts/wipe-external-memory-stores.ts \
 *     --stage dev --dry-run=false --surveyed-on 2026-04-26
 *
 *   # Scope to one user
 *   DATABASE_URL=... tsx packages/api/scripts/wipe-external-memory-stores.ts \
 *     --stage dev --user <userId>
 *
 *   # Scope to one tenant (joins agents to filter user banks)
 *   DATABASE_URL=... tsx packages/api/scripts/wipe-external-memory-stores.ts \
 *     --stage dev --tenant <tenantId>
 *
 *   # Override the implausibly-large safeguard
 *   DATABASE_URL=... tsx packages/api/scripts/wipe-external-memory-stores.ts \
 *     --stage dev --max-deletes 5000000
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

export interface CliArgs {
	stage: string;
	dryRun: boolean;
	userId?: string;
	tenantId?: string;
	surveyedOn?: string;
	maxDeletes: number;
	batchSize: number;
}

export const DEFAULT_MAX_DELETES = 1_000_000;
export const DEFAULT_BATCH_SIZE = 1_000;
export const SURVEY_FRESHNESS_DAYS = 7;

export function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		stage: "",
		dryRun: true,
		maxDeletes: DEFAULT_MAX_DELETES,
		batchSize: DEFAULT_BATCH_SIZE,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--stage":
				args.stage = argv[++i] ?? "";
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--dry-run=false":
				args.dryRun = false;
				break;
			case "--dry-run=true":
				args.dryRun = true;
				break;
			case "--user":
				args.userId = argv[++i];
				break;
			case "--tenant":
				args.tenantId = argv[++i];
				break;
			case "--surveyed-on":
				args.surveyedOn = argv[++i];
				break;
			case "--max-deletes":
				args.maxDeletes = parseInt(argv[++i] ?? "0", 10);
				break;
			case "--batch-size":
				args.batchSize = parseInt(argv[++i] ?? "0", 10);
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

function printHelp(): void {
	console.log(`Usage: wipe-external-memory-stores --stage <dev|prod> [options]

  --stage <name>           Required. Used in summary log only.
  --dry-run[=true|=false]  Default true. Live run requires --dry-run=false.
  --user <uuid>            Scope to one user bank.
  --tenant <uuid>          Scope to all users belonging to this tenant.
  --surveyed-on YYYY-MM-DD Required for --dry-run=false. Must be within
                           ${SURVEY_FRESHNESS_DAYS} days. Codifies the pre-flight
                           consumer survey.
  --max-deletes N          Implausibly-large safeguard (default ${DEFAULT_MAX_DELETES}).
                           Aborts dry-run if count exceeds this.
  --batch-size N           Per-transaction DELETE batch size (default ${DEFAULT_BATCH_SIZE}).`);
}

export interface SurveyValidation {
	ok: boolean;
	error?: string;
}

export function validateSurvey(args: CliArgs, today: Date = new Date()): SurveyValidation {
	if (args.dryRun) return { ok: true };
	if (!args.surveyedOn) {
		return {
			ok: false,
			error:
				"--dry-run=false requires --surveyed-on YYYY-MM-DD. The pre-flight " +
				"consumer survey (recall callsites, eval harness, renderers, " +
				"wiki-compile) must be re-run for each stage before a live wipe.",
		};
	}
	const surveyDate = new Date(args.surveyedOn + "T00:00:00.000Z");
	if (Number.isNaN(surveyDate.getTime())) {
		return { ok: false, error: `--surveyed-on must be YYYY-MM-DD; got ${args.surveyedOn}` };
	}
	const todayUTC = new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z");
	const daysOld = Math.floor(
		(todayUTC.getTime() - surveyDate.getTime()) / (1000 * 60 * 60 * 24),
	);
	if (daysOld > SURVEY_FRESHNESS_DAYS) {
		return {
			ok: false,
			error:
				`--surveyed-on ${args.surveyedOn} is ${daysOld} days old; max ${SURVEY_FRESHNESS_DAYS}. ` +
				`Re-run the consumer survey and supply a fresh date.`,
		};
	}
	if (daysOld < 0) {
		return { ok: false, error: `--surveyed-on ${args.surveyedOn} is in the future` };
	}
	return { ok: true };
}

interface CountRow {
	count: string | number | bigint;
}

interface BankRow {
	bank_id: string;
	row_count: string | number | bigint;
}

/**
 * Build the WHERE-clause SQL fragment that scopes the legacy filter to the
 * supplied --user / --tenant flags. The base predicate
 * `(metadata->>'document_id' IS NULL OR context = 'thread_turn')` is shared
 * across count and per-bank delete, so it lives in this helper.
 */
function legacyPredicate(args: CliArgs) {
	if (args.userId) {
		return sql`bank_id = ${"user_" + args.userId} AND (metadata->>'document_id' IS NULL OR context = 'thread_turn')`;
	}
	if (args.tenantId) {
		// Tenant scope joins agents → memory_units via human_pair_id (the
		// user_id used in bank construction). The agents table is in the
		// public schema; hindsight.memory_units is in hindsight.
		return sql`bank_id LIKE 'user_%' AND bank_id IN (
			SELECT 'user_' || a.human_pair_id::text
			FROM public.agents a
			WHERE a.tenant_id = ${args.tenantId}::uuid
			  AND a.human_pair_id IS NOT NULL
		) AND (metadata->>'document_id' IS NULL OR context = 'thread_turn')`;
	}
	return sql`bank_id LIKE 'user_%' AND (metadata->>'document_id' IS NULL OR context = 'thread_turn')`;
}

export interface WipeReport {
	totalLegacy: number;
	bankCount: number;
	dryRun: boolean;
	deletedByBank: Array<{ bankId: string; deleted: number }>;
}

export async function runWipe(args: CliArgs, db = getDb()): Promise<WipeReport> {
	if (!args.stage) {
		throw new Error("--stage is required");
	}
	const survey = validateSurvey(args);
	if (!survey.ok) {
		throw new Error(survey.error);
	}

	// Count phase — always runs first, even on live run.
	const countResult: any = await db.execute(
		sql`SELECT COUNT(*)::text AS count FROM hindsight.memory_units WHERE ${legacyPredicate(args)}`,
	);
	const rows: CountRow[] = countResult?.rows ?? countResult ?? [];
	const totalLegacy = Number((rows[0]?.count ?? 0));

	// Implausibly-large safeguard.
	if (totalLegacy > args.maxDeletes) {
		throw new Error(
			`Refusing to proceed: legacy count ${totalLegacy} exceeds --max-deletes ${args.maxDeletes}. ` +
				`Either narrow scope with --user/--tenant or override with --max-deletes.`,
		);
	}

	// Per-bank breakdown so the operator can see distribution.
	const banksResult: any = await db.execute(
		sql`SELECT bank_id, COUNT(*)::text AS row_count FROM hindsight.memory_units WHERE ${legacyPredicate(args)} GROUP BY bank_id ORDER BY COUNT(*) DESC`,
	);
	const bankRows: BankRow[] = banksResult?.rows ?? banksResult ?? [];

	const summaryHeader = `[wipe-external-memory-stores] stage=${args.stage} dry_run=${args.dryRun} ` +
		`scope=${args.userId ? `user:${args.userId.slice(0, 8)}` : args.tenantId ? `tenant:${args.tenantId.slice(0, 8)}` : "all-users"} ` +
		`legacy_total=${totalLegacy} bank_count=${bankRows.length}`;
	console.log(summaryHeader);

	if (args.dryRun || totalLegacy === 0) {
		for (const row of bankRows.slice(0, 20)) {
			console.log(`  bank=${row.bank_id} would_delete=${row.row_count}`);
		}
		if (bankRows.length > 20) {
			console.log(`  ... ${bankRows.length - 20} more banks`);
		}
		return {
			totalLegacy,
			bankCount: bankRows.length,
			dryRun: true,
			deletedByBank: [],
		};
	}

	// Live run: per-bank batched DELETE in transactions.
	const deletedByBank: Array<{ bankId: string; deleted: number }> = [];
	for (const row of bankRows) {
		const bankId = row.bank_id;
		let deletedForBank = 0;
		// Loop until no more rows match the predicate for this bank.
		// Each iteration is its own transaction (db.execute runs each
		// statement atomically); a partial run leaves a clean state.
		for (;;) {
			const deleteResult: any = await db.execute(
				sql`DELETE FROM hindsight.memory_units
					WHERE id IN (
						SELECT id FROM hindsight.memory_units
						WHERE bank_id = ${bankId}
						  AND (metadata->>'document_id' IS NULL OR context = 'thread_turn')
						LIMIT ${args.batchSize}
					)
					RETURNING id`,
			);
			const deletedRows: any[] = deleteResult?.rows ?? deleteResult ?? [];
			if (deletedRows.length === 0) break;
			deletedForBank += deletedRows.length;
		}
		deletedByBank.push({ bankId, deleted: deletedForBank });
		console.log(`  bank=${bankId} deleted=${deletedForBank}`);
	}

	const total = deletedByBank.reduce((acc, x) => acc + x.deleted, 0);
	console.log(`[wipe-external-memory-stores] complete deleted_total=${total}`);
	return {
		totalLegacy,
		bankCount: bankRows.length,
		dryRun: false,
		deletedByBank,
	};
}

// Entry point — only runs when invoked as a script, not when imported in tests.
if (import.meta.url === `file://${process.argv[1]}`) {
	(async () => {
		try {
			const args = parseArgs(process.argv.slice(2));
			await runWipe(args);
			process.exit(0);
		} catch (err) {
			const msg = (err as Error)?.message || String(err);
			console.error(`[wipe-external-memory-stores] ${msg}`);
			process.exit(1);
		}
	})();
}
