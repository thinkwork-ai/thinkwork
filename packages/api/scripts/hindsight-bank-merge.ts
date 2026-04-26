#!/usr/bin/env -S tsx
/**
 * Audit or apply the legacy Hindsight bank merge.
 *
 * Canonical Hindsight memory is never wiped. Dry-run is the default; apply
 * requires --apply and aborts on blocking conflicts.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/hindsight-bank-merge.ts
 *   DATABASE_URL=... tsx packages/api/scripts/hindsight-bank-merge.ts --user <uuid> --alias loki=<uuid>
 *   DATABASE_URL=... tsx packages/api/scripts/hindsight-bank-merge.ts --apply --user <uuid>
 */

import {
	parseAliasMappings,
	runHindsightBankMerge,
	type BankMergePairReport,
	type BankTableCounts,
} from "../src/lib/memory/hindsight-bank-merge.js";

interface CliArgs {
	apply: boolean;
	tenantId?: string;
	userId?: string;
	aliases: string[];
	json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { apply: false, aliases: [], json: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--apply":
				args.apply = true;
				break;
			case "--tenant":
				args.tenantId = argv[++i];
				break;
			case "--user":
				args.userId = argv[++i];
				break;
			case "--alias":
				args.aliases.push(argv[++i]);
				break;
			case "--json":
				args.json = true;
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
	console.log(`Usage: hindsight-bank-merge [--tenant <uuid>] [--user <uuid>] [--alias source=userId] [--json] [--apply]

Dry-run is the default. Alias values may also be source=tenantId:userId when
the same historical bank name could exist in multiple tenants.`);
}

function printCounts(label: string, counts: BankTableCounts): void {
	const active = Object.entries(counts.tables)
		.filter(([, count]) => count > 0)
		.map(([table, count]) => `${table}=${count}`)
		.join(" ");
	console.log(`  ${label}: ${counts.bankId} total=${counts.total}${active ? ` ${active}` : ""}`);
}

function printPair(pair: BankMergePairReport): void {
	console.log(`\n${pair.sourceBankId} -> ${pair.destinationBankId}`);
	printCounts("source before", pair.before.source);
	printCounts("dest before", pair.before.destination);
	const c = pair.conflicts;
	console.log(
		`  conflicts: duplicateDocs=${c.duplicateDocuments} blockingDocs=${c.blockingDocuments} duplicateMentalModels=${c.duplicateMentalModels} blockingMentalModels=${c.blockingMentalModels} duplicateEntities=${c.duplicateEntitiesByName}`,
	);
	if (pair.apply) {
		const moved = Object.entries(pair.apply.movedRows)
			.filter(([, count]) => count > 0)
			.map(([table, count]) => `${table}=${count}`)
			.join(" ");
		console.log(
			`  applied: mergedEntities=${pair.apply.mergedEntities} removedDuplicateDocs=${pair.apply.removedDuplicateDocuments} removedDuplicateMentalModels=${pair.apply.removedDuplicateMentalModels}${moved ? ` moved ${moved}` : ""}`,
		);
		if (pair.after) {
			printCounts("source after", pair.after.source);
			printCounts("dest after", pair.after.destination);
		}
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const report = await runHindsightBankMerge({
		apply: args.apply,
		tenantId: args.tenantId,
		userId: args.userId,
		aliases: parseAliasMappings(args.aliases),
	});

	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log(`[hindsight-bank-merge] generated=${report.generatedAt} apply=${report.apply}`);
	console.log(`\nMappings: ${report.mappings.length}`);
	for (const mapping of report.mappings) {
		console.log(
			`  tenant=${mapping.tenantId} user=${mapping.userId} dest=${mapping.destinationBankId} agents=${mapping.agentIds.length} candidates=${mapping.candidateLegacyBankIds.join(",") || "(none)"}`,
		);
	}

	console.log(`\nMerge pairs with source data: ${report.pairs.length}`);
	for (const pair of report.pairs) printPair(pair);

	console.log(`\nUnmapped non-empty banks: ${report.unmapped.length}`);
	for (const counts of report.unmapped.slice(0, 25)) {
		printCounts("unmapped", counts);
	}
	if (report.unmapped.length > 25) {
		console.log(`  ... ${report.unmapped.length - 25} more`);
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(`[hindsight-bank-merge] fatal: ${(err as Error).stack ?? err}`);
		process.exit(1);
	});
