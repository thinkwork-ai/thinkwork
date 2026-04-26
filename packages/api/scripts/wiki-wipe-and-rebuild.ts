#!/usr/bin/env -S tsx
/**
 * wiki-wipe-and-rebuild.ts
 *
 * Purge the compiled wiki for a single (tenant, user/owner) scope, then
 * optionally enqueue and drain the existing compile pipeline from canonical
 * memory. Canonical memory in Hindsight is NEVER touched — we only delete
 * compiled wiki rows/cursors/jobs.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-wipe-and-rebuild.ts \
 *     --tenant <uuid> --owner <uuid> [--dry-run] [--rebuild] [--drain]
 *
 * Flags:
 *   --tenant    (required) tenant_id
 *   --owner     (required) owner/user_id
 *   --dry-run   print row counts without deleting
 *   --rebuild   wipe, then enqueue a bootstrap wiki compile for this user
 *   --drain     with --rebuild: drain the rebuilt scope; without --rebuild:
 *               drain existing pending jobs without wiping
 *   --max-jobs  max jobs to run while draining (default 50)
 *
 * Safety rails:
 *   - refuses to run without BOTH --tenant and --owner
 *   - counts before deleting so the operator sees blast radius
 *   - runs inside a transaction; any DELETE failure rolls back everything
 *   - --dry-run prints the same summary without mutating
 */

import { wipeWikiScope, countWikiScope } from "../src/lib/wiki/repository.js";
import { drainWikiCompileScope, enqueueAndDrainWikiRebuild } from "../src/lib/wiki/rebuild-runner.js";

interface CliArgs {
	tenantId: string | null;
	userId: string | null;
	dryRun: boolean;
	rebuild: boolean;
	drain: boolean;
	maxJobs: number;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		tenantId: null,
		userId: null,
		dryRun: false,
		rebuild: false,
		drain: false,
		maxJobs: 50,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--tenant":
				out.tenantId = argv[++i] ?? null;
				break;
			case "--owner":
				out.userId = argv[++i] ?? null;
				break;
			case "--dry-run":
				out.dryRun = true;
				break;
			case "--rebuild":
				out.rebuild = true;
				break;
			case "--drain":
				out.drain = true;
				break;
			case "--max-jobs": {
				const n = Number(argv[++i]);
				out.maxJobs = Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
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
                             [--rebuild] [--drain] [--max-jobs N]`,
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

	if (!args.tenantId || !args.userId) {
		console.error(
			"error: --tenant <uuid> and --owner <uuid> are both required",
		);
		printHelp();
		process.exit(2);
	}
	console.log(
		`[wiki-wipe-and-rebuild] scope tenant=${args.tenantId} owner=${args.userId} dryRun=${args.dryRun} rebuild=${args.rebuild} drain=${args.drain}`,
	);

	if (args.dryRun) {
		const counts = await countWikiScope({
			tenantId: args.tenantId,
			ownerId: args.userId,
		});
		formatCounts("current state (dry-run)", counts);
		console.log("\n(dry run — no rows deleted)");
		return;
	}

	if (args.rebuild || !args.drain) {
		const { before, after } = await wipeWikiScope({
			tenantId: args.tenantId,
			ownerId: args.userId,
		});
		formatCounts("before wipe", before);
		formatCounts("after wipe", after);
	}

	if (args.rebuild) {
		console.log(`\n[wiki-wipe-and-rebuild] enqueueing bootstrap compile`);
		const result = await enqueueAndDrainWikiRebuild({
			tenantId: args.tenantId,
			ownerId: args.userId,
			maxJobs: args.drain ? args.maxJobs : 1,
		});
		console.log(
			`[wiki-wipe-and-rebuild] rebuild enqueued=${result.enqueuedJobId ?? "null"} jobsRun=${result.jobsRun} pending=${result.pendingJobs} running=${result.runningJobs} failed=${result.failedJobId ?? "null"}`,
		);
		if (result.failedJobId || (args.drain && (result.pendingJobs > 0 || result.runningJobs > 0))) {
			process.exitCode = 1;
		}
	} else if (args.drain) {
		console.log(`\n[wiki-wipe-and-rebuild] draining existing compile jobs`);
		const result = await drainWikiCompileScope({
			tenantId: args.tenantId,
			ownerId: args.userId,
			maxJobs: args.maxJobs,
		});
		console.log(
			`[wiki-wipe-and-rebuild] drain jobsRun=${result.jobsRun} pending=${result.pendingJobs} running=${result.runningJobs} failed=${result.failedJobId ?? "null"}`,
		);
		if (result.failedJobId || result.pendingJobs > 0 || result.runningJobs > 0) {
			process.exitCode = 1;
		}
	}
}

main()
	.then(() => {
		process.exit(process.exitCode ?? 0);
	})
	.catch((err) => {
		console.error(`[wiki-wipe-and-rebuild] fatal: ${(err as Error).stack ?? err}`);
		process.exit(1);
	});
