#!/usr/bin/env -S tsx
/**
 * wiki-link-density-baseline.ts
 *
 * Snapshot of `wiki_page_links` coverage per agent for the (tenant, owner)
 * scope — used to measure R1-R3 / R5 from the link-densification plan
 * before flipping `WIKI_DETERMINISTIC_LINKING_ENABLED`.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-link-density-baseline.ts \
 *     --tenant <uuid> [--owner <uuid>] [--no-write]
 *
 * By default the script appends a timestamped markdown snapshot to
 * `docs/metrics/wiki-link-density-<ISO>.md` so before/after runs can be
 * diffed. Pass `--no-write` to skip the file write (e.g. from CI smoke).
 */

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { db } from "../src/lib/db.js";
import {
	formatDensityReport,
	queryLinkDensity,
} from "../src/lib/wiki/link-density-reporter.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	writeFile: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = { tenantId: null, ownerId: null, writeFile: true };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--tenant") out.tenantId = argv[++i] ?? null;
		else if (argv[i] === "--owner") out.ownerId = argv[++i] ?? null;
		else if (argv[i] === "--no-write") out.writeFile = false;
	}
	return out;
}

function defaultOutputPath(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return resolve(
		process.cwd(),
		"docs",
		"metrics",
		`wiki-link-density-${stamp}.md`,
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId) {
		console.error("error: --tenant <uuid> is required");
		process.exit(2);
	}

	const rows = await queryLinkDensity(db, {
		tenantId: args.tenantId,
		ownerId: args.ownerId ?? undefined,
	});

	const scopeHeader =
		`# wiki link density — ${new Date().toISOString()}\n` +
		`- tenant: ${args.tenantId}\n` +
		`- owner:  ${args.ownerId ?? "(all agents)"}\n` +
		`- agents: ${rows.length}\n`;

	const report = formatDensityReport(rows);

	console.log(scopeHeader);
	console.log("```");
	console.log(report);
	console.log("```");

	if (args.writeFile) {
		const outPath = defaultOutputPath();
		if (!existsSync(dirname(outPath))) {
			mkdirSync(dirname(outPath), { recursive: true });
		}
		appendFileSync(
			outPath,
			`${scopeHeader}\n\`\`\`\n${report}\n\`\`\`\n\n`,
			"utf8",
		);
		console.log(`\n[wrote] ${outPath}`);
	}
}

main().catch((err) => {
	console.error(
		`[wiki-link-density-baseline] fatal: ${(err as Error).stack ?? err}`,
	);
	process.exit(1);
});
