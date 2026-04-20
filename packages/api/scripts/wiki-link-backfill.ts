#!/usr/bin/env -S tsx
/**
 * wiki-link-backfill.ts
 *
 * Apply Units 2 + 3 of the link-densification plan to the existing
 * wiki corpus for a single (tenant, owner) scope without re-running the
 * LLM compile. Phase A emits deterministic `reference` links derived
 * from page summaries; Phase B emits reciprocal entity↔entity
 * co-mention links via `wiki_section_sources`.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/api/scripts/wiki-link-backfill.ts \
 *     --tenant <uuid> --owner <uuid> [--dry-run]
 *
 * Flags:
 *   --tenant   (required) tenant_id — scope safety rail.
 *   --owner    (required) owner/agent_id — scope safety rail.
 *   --dry-run  Skip writes; log the plan (candidates and edge counts).
 *
 * Idempotency: `upsertPageLink` uses `onConflictDoNothing` on the
 * `(from_page_id, to_page_id, kind)` unique index, so re-running the
 * script is a no-op beyond read traffic.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import {
	wikiPageLinks,
	wikiPageSections,
	wikiPages,
	wikiSectionSources,
} from "@thinkwork/database-pg/schema";
import {
	findMemoryUnitPageSources,
	findPagesByExactTitle,
	upsertPageLink,
} from "../src/lib/wiki/repository.js";
import { runLinkBackfill } from "../src/lib/wiki/link-backfill.js";

interface CliArgs {
	tenantId: string | null;
	ownerId: string | null;
	dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = { tenantId: null, ownerId: null, dryRun: false };
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
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}
	return out;
}

function printHelp(): void {
	console.log(`wiki-link-backfill.ts

Usage:
  tsx packages/api/scripts/wiki-link-backfill.ts \\
    --tenant <uuid> --owner <uuid> [--dry-run]

Flags:
  --tenant   (required) tenant_id scope.
  --owner    (required) owner/agent_id scope.
  --dry-run  Log candidates + counts without writing links.
`);
}

async function listAllActivePages(args: {
	tenantId: string;
	ownerId: string;
}): Promise<
	Array<{
		id: string;
		type: "entity" | "topic" | "decision";
		slug: string;
		title: string;
		summary: string | null;
	}>
> {
	const rows = await db
		.select({
			id: wikiPages.id,
			type: wikiPages.type,
			slug: wikiPages.slug,
			title: wikiPages.title,
			summary: wikiPages.summary,
		})
		.from(wikiPages)
		.where(
			and(
				eq(wikiPages.tenant_id, args.tenantId),
				eq(wikiPages.owner_id, args.ownerId),
				eq(wikiPages.status, "active"),
			),
		);
	return rows as Array<{
		id: string;
		type: "entity" | "topic" | "decision";
		slug: string;
		title: string;
		summary: string | null;
	}>;
}

async function listMemoryUnitIdsInScope(args: {
	tenantId: string;
	ownerId: string;
}): Promise<string[]> {
	const result = await db.execute(sql`
		SELECT DISTINCT ${wikiSectionSources.source_ref}::text AS memory_unit_id
		FROM ${wikiSectionSources}
		JOIN ${wikiPageSections}
			ON ${wikiPageSections.id} = ${wikiSectionSources.section_id}
		JOIN ${wikiPages} ON ${wikiPages.id} = ${wikiPageSections.page_id}
		WHERE ${wikiSectionSources.source_kind} = 'memory_unit'
			AND ${wikiPages.tenant_id} = ${args.tenantId}
			AND ${wikiPages.owner_id} = ${args.ownerId}
			AND ${wikiPages.status} = 'active'
	`);
	const rows =
		(result as unknown as { rows?: Array<{ memory_unit_id: string }> })
			.rows ?? [];
	return rows.map((r) => r.memory_unit_id);
}

async function countReferenceLinks(scope: {
	tenantId: string;
	ownerId: string;
}): Promise<number> {
	const result = await db.execute(sql`
		SELECT COUNT(*)::int AS n
		FROM ${wikiPageLinks} wpl
		JOIN ${wikiPages} wp ON wp.id = wpl.from_page_id
		WHERE wpl.kind = 'reference'
			AND wp.tenant_id = ${scope.tenantId}
			AND wp.owner_id = ${scope.ownerId}
	`);
	const rows =
		(result as unknown as { rows?: Array<{ n: number }> }).rows ?? [];
	return rows[0]?.n ?? 0;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tenantId || !args.ownerId) {
		console.error("error: --tenant <uuid> and --owner <uuid> are required");
		process.exit(2);
	}
	const scope = { tenantId: args.tenantId, ownerId: args.ownerId };

	console.log(
		`[wiki-link-backfill] scope tenant=${scope.tenantId} owner=${scope.ownerId}` +
			(args.dryRun ? " (DRY RUN)" : ""),
	);

	const baseline = args.dryRun ? null : await countReferenceLinks(scope);

	await runLinkBackfill({
		scope,
		dryRun: args.dryRun,
		listAllActivePages: () => listAllActivePages(scope),
		listMemoryUnitIds: () => listMemoryUnitIdsInScope(scope),
		lookupParentPages: (lookupArgs) => findPagesByExactTitle(lookupArgs),
		lookupMemorySources: (lookupArgs) => findMemoryUnitPageSources(lookupArgs),
		upsertPageLink: (linkArgs) =>
			upsertPageLink({
				fromPageId: linkArgs.fromPageId,
				toPageId: linkArgs.toPageId,
				context: linkArgs.context,
			}),
		log: (msg) => console.log(msg),
	});

	if (!args.dryRun && baseline !== null) {
		const after = await countReferenceLinks(scope);
		console.log(
			`[summary] reference-link count: ${baseline} → ${after}` +
				` (+${after - baseline})`,
		);
	}
}

main().catch((err) => {
	console.error(
		`[wiki-link-backfill] fatal: ${(err as Error).stack ?? err}`,
	);
	process.exit(1);
});
