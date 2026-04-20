#!/usr/bin/env -S tsx
/**
 * wiki-record-expander-probe.ts
 *
 * One-shot probe: pulls a scope's hindsight memory_units and runs
 * `deriveParentCandidates` (the record-based expander, which is what the
 * deterministic linker actually uses at compile time) against them. Shows
 * which candidates the expander now produces after the 2026-04-20 fixes.
 *
 * Read-only. Companion to wiki-parent-link-audit.ts, which uses the
 * summary-based expander.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-record-expander-probe.ts \
 *     --bank <slug>
 */

import { sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import { deriveParentCandidates } from "../src/lib/wiki/parent-expander.js";
import type { ThinkWorkMemoryRecord } from "../src/lib/memory/types.js";

function parseArgs(argv: string[]): { bank: string | null } {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--bank") return { bank: argv[++i] ?? null };
	}
	return { bank: null };
}

async function main(): Promise<void> {
	const { bank } = parseArgs(process.argv.slice(2));
	if (!bank) {
		console.error("error: --bank <slug> required");
		process.exit(2);
	}

	const result = await db.execute(sql`
		SELECT id, text, metadata
		FROM hindsight.memory_units
		WHERE bank_id = ${bank}
		LIMIT 3000
	`);
	const rows =
		(result as unknown as {
			rows?: Array<{ id: string; text: string; metadata: unknown }>;
		}).rows ?? [];

	// Minimal-shape records — the expander only reads `id` and `metadata`.
	// Cast through unknown because reconstructing the full record type is
	// pointless for a read-only probe.
	const records = rows.map((r) => ({
		id: r.id,
		metadata: (r.metadata ?? {}) as Record<string, unknown>,
	})) as unknown as ThinkWorkMemoryRecord[];

	console.log(`loaded ${records.length} records from bank=${bank}`);
	const candidates = deriveParentCandidates(records);
	console.log(
		`derived ${candidates.length} candidates (min_cluster_size default = 2)\n`,
	);
	for (const c of candidates.slice(0, 30)) {
		console.log(
			`  ${c.reason.padEnd(11)} "${c.parentTitle}" (support=${c.supportingCount}, sectionSlug=${c.suggestedSectionSlug})`,
		);
	}
	if (candidates.length > 30) {
		console.log(`  … ${candidates.length - 30} more`);
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
