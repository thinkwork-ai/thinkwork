#!/usr/bin/env -S tsx
/**
 * journal-import-resume.ts
 *
 * Local, resumable driver for the journal.idea → Hindsight ingest.
 *
 * The Lambda handler (`wiki-bootstrap-import`) is capped at 900s and times
 * out on accounts with more than ~300 ideas. Running the same `retain` path
 * locally has no such cap and lets us resume mid-stream by passing
 * `--start-after-id`, so we don't re-ingest what's already in Hindsight.
 *
 * Usage:
 *   DATABASE_URL=... HINDSIGHT_ENDPOINT=http://... MEMORY_ENGINE=hindsight \
 *     tsx packages/api/scripts/journal-import-resume.ts \
 *       --account <acctId> --tenant <uuid> --agent <uuid> \
 *       [--start-after-id <journalIdeaId>] [--limit N] [--enqueue-compile]
 *
 * Flags:
 *   --account           journal.account.id to ingest from
 *   --tenant            tenant_id
 *   --agent             agent_id (owner_id)
 *   --start-after-id    resume cursor; skip all idea.id <= this value
 *   --limit             optional cap on ideas processed
 *   --enqueue-compile   after ingest, enqueue one terminal compile job
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import { getMemoryServices } from "../src/lib/memory/index.js";
import { buildRetainPayload } from "../src/lib/wiki/journal-import.js";
import { enqueueCompileJob } from "../src/lib/wiki/repository.js";

interface CliArgs {
	accountId: string | null;
	tenantId: string | null;
	agentId: string | null;
	startAfterId: string;
	limit: number;
	enqueueCompile: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		accountId: null,
		tenantId: null,
		agentId: null,
		startAfterId: "",
		limit: Number.POSITIVE_INFINITY,
		enqueueCompile: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--account": out.accountId = argv[++i] ?? null; break;
			case "--tenant":  out.tenantId  = argv[++i] ?? null; break;
			case "--agent":   out.agentId   = argv[++i] ?? null; break;
			case "--start-after-id": out.startAfterId = argv[++i] ?? ""; break;
			case "--limit": {
				const n = Number(argv[++i]);
				out.limit = Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
				break;
			}
			case "--enqueue-compile": out.enqueueCompile = true; break;
			case "-h":
			case "--help":
				console.log(
					"journal-import-resume --account X --tenant Y --agent Z [--start-after-id ID] [--limit N] [--enqueue-compile]",
				);
				process.exit(0);
		}
	}
	return out;
}

const BATCH_SIZE = 200;

interface JournalRow {
	id: string;
	body: string | null;
	tags: string[] | null;
	created: Date | string | null;
	date_created: Date | string | null;
	is_visit: boolean | null;
	is_favorite: boolean | null;
	geo_lat: number | null;
	geo_lon: number | null;
	images: string[] | null;
	external_id: number | null;
	idea_metadata: Record<string, unknown> | null;
	place_id: string | null;
	place_name: string | null;
	place_address: string | null;
	place_types: string[] | null;
	place_lat: number | null;
	place_lon: number | null;
	place_google_id: string | null;
	place_metadata: Record<string, unknown> | null;
	journal_id: string | null;
	journal_title: string | null;
	journal_description: string | null;
	journal_start_date: Date | string | null;
	journal_end_date: Date | string | null;
	journal_tags: string[] | null;
}

async function fetchPage(
	accountId: string,
	lastId: string,
	limit: number,
): Promise<JournalRow[]> {
	const result = await db.execute(sql`
		SELECT
			i.id, i.body, i.tags, i.created, i.date_created,
			i.is_visit, i.is_favorite, i.geo_lat, i.geo_lon, i.images,
			i.external_id, i.metadata AS idea_metadata,
			i.place_id,
			p.name AS place_name, p.address AS place_address,
			p.types AS place_types, p.geo_lat AS place_lat, p.geo_lon AS place_lon,
			p.google_place_id AS place_google_id, p.metadata AS place_metadata,
			i.journal_id,
			j.title AS journal_title, j.description AS journal_description,
			j.start_date AS journal_start_date, j.end_date AS journal_end_date,
			j.tags AS journal_tags
		FROM journal.idea i
		LEFT JOIN journal.place p ON p.id = i.place_id
		LEFT JOIN journal.journal j ON j.id = i.journal_id
		WHERE i.account_id = ${accountId}
		  AND i.id > ${lastId}
		ORDER BY i.id ASC
		LIMIT ${limit}
	`);
	return ((result as unknown as { rows?: JournalRow[] }).rows ?? []) as JournalRow[];
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.accountId || !args.tenantId || !args.agentId) {
		console.error("error: --account, --tenant, --agent all required");
		process.exit(2);
	}

	console.log(
		`[journal-import-resume] account=${args.accountId} tenant=${args.tenantId} agent=${args.agentId} start-after=${args.startAfterId || "(beginning)"} limit=${args.limit === Number.POSITIVE_INFINITY ? "none" : args.limit}`,
	);

	const { adapter } = getMemoryServices();
	const started = Date.now();
	let lastId = args.startAfterId;
	let ingested = 0;
	let skipped = 0;
	let errors = 0;

	const processed = () => ingested + skipped + errors;
	while (processed() < args.limit) {
		const remaining = args.limit - processed();
		const pageSize = Math.min(BATCH_SIZE, remaining);
		const rows = await fetchPage(args.accountId, lastId, pageSize);
		if (rows.length === 0) break;
		for (const row of rows) {
			lastId = row.id;
			try {
				const payload = buildRetainPayload(row as any, {
					tenantId: args.tenantId!,
					agentId: args.agentId!,
				});
				if (!payload) { skipped += 1; continue; }
				await adapter.retain(payload);
				ingested += 1;
				if (ingested % 25 === 0) {
					const secs = ((Date.now() - started) / 1000).toFixed(1);
					const rate = (ingested / ((Date.now() - started) / 1000)).toFixed(2);
					console.log(
						`[journal-import-resume] ingested=${ingested} skipped=${skipped} errors=${errors} last=${lastId} elapsed=${secs}s rate=${rate}/s`,
					);
				}
			} catch (err) {
				errors += 1;
				console.warn(
					`[journal-import-resume] idea=${row.id} retain failed: ${(err as Error)?.message}`,
				);
			}
		}
		if (rows.length < pageSize) break;
	}

	const totalSecs = ((Date.now() - started) / 1000).toFixed(1);
	console.log(
		`[journal-import-resume] done ingested=${ingested} skipped=${skipped} errors=${errors} last=${lastId} elapsed=${totalSecs}s`,
	);

	if (args.enqueueCompile && ingested > 0) {
		const { inserted, job } = await enqueueCompileJob({
			tenantId: args.tenantId!,
			ownerId: args.agentId!,
			trigger: "bootstrap_import",
		});
		console.log(
			`[journal-import-resume] terminal compile job=${job.id} inserted=${inserted}`,
		);
	}
}

main().catch((err) => {
	console.error(`[journal-import-resume] fatal: ${(err as Error).stack ?? err}`);
	process.exit(1);
});
