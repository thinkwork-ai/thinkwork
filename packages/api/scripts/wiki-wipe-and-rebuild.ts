#!/usr/bin/env -S tsx
/**
 * wiki-wipe-and-rebuild.ts
 *
 * Purge the compiled wiki for a single (tenant, owner) scope, then
 * (optionally) rebuild from canonical memory by invoking the existing
 * journal-import path. Canonical memory in Hindsight is NEVER touched —
 * we only delete compiled rows.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-wipe-and-rebuild.ts \
 *     --tenant <uuid> --owner <uuid> [--dry-run] \
 *     [--rebuild --account <uuid> [--limit N]]
 *
 * Flags:
 *   --tenant    (required) tenant_id
 *   --owner     (required) owner/agent_id
 *   --dry-run   print row counts without deleting
 *   --rebuild   after wipe, run bootstrapJournalImport inline (requires --account)
 *   --account   accountId passed to bootstrapJournalImport
 *   --limit     optional ingest cap (matches the Lambda's limit field)
 *
 * Safety rails:
 *   - refuses to run without BOTH --tenant and --owner
 *   - counts before deleting so the operator sees blast radius
 *   - runs inside a transaction; any DELETE failure rolls back everything
 *   - --dry-run prints the same summary without mutating
 */

import { wipeWikiScope, countWikiScope } from "../src/lib/wiki/repository.js";
import { runJournalImport } from "../src/lib/wiki/journal-import.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	dryRun: boolean;
	rebuild: boolean;
	accountId: string | null;
	limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		tenantId: null,
		ownerId: null,
		dryRun: false,
		rebuild: false,
		accountId: null,
		limit: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--tenant":
				out.tenantId = argv[++i] ?? null;
				break;
			case "--owner":
				out.ownerId = argv[++i] ?? null;
				break;
			case "--dry-run":
				out.dryRun = true;
				break;
			case "--rebuild":
				out.rebuild = true;
				break;
			case "--account":
				out.accountId = argv[++i] ?? null;
				break;
			case "--limit": {
				const n = Number(argv[++i]);
				out.limit = Number.isFinite(n) ? n : null;
				break;
			}
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}
	return out;
}

function printHelp(): void {
	console.log(
		`Usage: wiki-wipe-and-rebuild --tenant <uuid> --owner <uuid> [--dry-run]
                             [--rebuild --account <uuid> [--limit N]]`,
	);
}

function formatCounts(label: string, c: Awaited<ReturnType<typeof countWikiScope>>): void {
	console.log(`\n=== ${label} ===`);
	console.log(`  pages                     ${c.pages}`);
	console.log(`  sections                  ${c.sections}`);
	console.log(`  links                     ${c.links}`);
	console.log(`  aliases                   ${c.aliases}`);
	console.log(`  unresolved_mentions       ${c.unresolved_mentions}`);
	console.log(`  compile_jobs              ${c.compile_jobs}`);
	console.log(`  cursor                    ${c.has_cursor ? "yes" : "no"}`);
	console.log(`  pages_with_parent         ${c.pages_with_parent}`);
	console.log(`  sections_promoted         ${c.sections_promoted}`);
	console.log(`  sections_candidate        ${c.sections_promotion_candidate}`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!args.tenantId || !args.ownerId) {
		console.error(
			"error: --tenant <uuid> and --owner <uuid> are both required",
		);
		printHelp();
		process.exit(2);
	}
	if (args.rebuild && !args.accountId) {
		console.error("error: --rebuild requires --account <uuid>");
		process.exit(2);
	}

	console.log(
		`[wiki-wipe-and-rebuild] scope tenant=${args.tenantId} owner=${args.ownerId} dryRun=${args.dryRun} rebuild=${args.rebuild}`,
	);

	if (args.dryRun) {
		const counts = await countWikiScope({
			tenantId: args.tenantId,
			ownerId: args.ownerId,
		});
		formatCounts("current state (dry-run)", counts);
		console.log("\n(dry run — no rows deleted)");
		return;
	}

	const { before, after } = await wipeWikiScope({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
	});
	formatCounts("before wipe", before);
	formatCounts("after wipe", after);

	if (args.rebuild) {
		console.log(
			`\n[wiki-wipe-and-rebuild] triggering bootstrap import account=${args.accountId} tenant=${args.tenantId} agent=${args.ownerId} limit=${args.limit ?? "none"}`,
		);
		const result = await runJournalImport({
			accountId: args.accountId!,
			tenantId: args.tenantId,
			agentId: args.ownerId,
			limit: args.limit ?? undefined,
		});
		console.log(
			`[wiki-wipe-and-rebuild] import done ingested=${result.recordsIngested} skipped=${result.recordsSkipped} errors=${result.errors} compileJobId=${result.compileJobId ?? "null"}`,
		);
	}
}

main().catch((err) => {
	console.error(`[wiki-wipe-and-rebuild] fatal: ${(err as Error).stack ?? err}`);
	process.exit(1);
});
