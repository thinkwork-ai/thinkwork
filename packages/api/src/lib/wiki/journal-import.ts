/**
 * Bulk import of an external "journal" dataset into Hindsight as normalized
 * memory records, scoped to one (tenant, agent) pair.
 *
 * v1 use case: seed the Compounding Memory pipeline for agent GiGi with
 * Amy's historical restaurant notes. One source row (`journal.idea`)
 * becomes one memory record, with the joined place + journal context
 * carried in `metadata` so the compile pipeline has everything it needs
 * to build compounded pages (see .prds/compounding-memory-v1-build-plan.md
 * PR 5).
 *
 * Key behavior:
 *   - Streams rows in batches of 200 via keyset pagination (idea.id > :last)
 *   - Renders a deterministic prose `content.text` + short `content.summary`
 *   - Calls `adapter.retain()` (NOT `retainTurn`) — these are already
 *     distilled units, not conversational turns
 *   - Suppresses the per-record compile enqueue by construction: the
 *     import path talks to the adapter directly; the memory-retain handler
 *     is never invoked, so its enqueue hook never fires
 *   - On completion, enqueues ONE terminal compile job so the full cursor
 *     drains in a single pass
 */

import { sql } from "drizzle-orm";
import type { MemoryAdapter } from "../memory/adapter.js";
import { getMemoryServices } from "../memory/index.js";
import { db } from "../db.js";
import { enqueueCompileJob } from "./repository.js";

export interface JournalImportArgs {
	accountId: string;
	tenantId: string;
	agentId: string;
	/** Optional cap for smoke-tests (e.g. 50). Unset = ingest everything. */
	limit?: number;
	/** Injected for tests; defaults to the process memory adapter. */
	adapter?: MemoryAdapter;
}

export interface JournalImportResult {
	accountId: string;
	tenantId: string;
	agentId: string;
	recordsIngested: number;
	recordsSkipped: number;
	errors: number;
	compileJobId: string | null;
	compileJobDeduped: boolean;
	latencyMs: number;
}

// `pg` returns timestamp columns as Date by default but as string in some
// pool configurations (no type parser bound for OID 1114/1184). Accept both
// shapes; the prose + metadata path routes every timestamp through
// toIsoSafe() so neither case throws.
interface JournalIdeaRow {
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

const BATCH_SIZE = 200;
const SUMMARY_MAX = 240;

export async function runJournalImport(
	args: JournalImportArgs,
): Promise<JournalImportResult> {
	const started = Date.now();
	const adapter = args.adapter ?? getMemoryServices().adapter;
	const hardLimit = args.limit && args.limit > 0 ? args.limit : Number.POSITIVE_INFINITY;

	let lastId = "";
	let recordsIngested = 0;
	let recordsSkipped = 0;
	let errors = 0;

	// Include errors in the processed-count so a scope-wide failure still
	// respects the limit. Otherwise 338 broken rows would spin through the
	// whole account even when the caller asked for 10.
	const processed = () => recordsIngested + recordsSkipped + errors;
	while (processed() < hardLimit) {
		const remaining = hardLimit - processed();
		const pageSize = Math.min(BATCH_SIZE, remaining);
		const rows = await fetchPage(args.accountId, lastId, pageSize);
		if (rows.length === 0) break;

		for (const row of rows) {
			lastId = row.id;
			try {
				const payload = buildRetainPayload(row, {
					tenantId: args.tenantId,
					agentId: args.agentId,
				});
				if (!payload) {
					recordsSkipped += 1;
					continue;
				}
				await adapter.retain(payload);
				recordsIngested += 1;
			} catch (err) {
				errors += 1;
				console.warn(
					`[journal-import] idea=${row.id} retain failed: ${(err as Error)?.message}`,
				);
			}
		}

		if (rows.length < pageSize) break;
	}

	// Single terminal compile for the whole ingest. bootstrap_import trigger
	// signals to any observer that this job was a bulk operation, not a
	// post-turn enqueue.
	let compileJobId: string | null = null;
	let compileJobDeduped = false;
	if (recordsIngested > 0) {
		try {
			const { inserted, job } = await enqueueCompileJob({
				tenantId: args.tenantId,
				ownerId: args.agentId,
				trigger: "bootstrap_import",
			});
			compileJobId = job.id;
			compileJobDeduped = !inserted;
		} catch (err) {
			console.warn(
				`[journal-import] terminal compile enqueue failed: ${(err as Error)?.message}`,
			);
		}
	}

	return {
		accountId: args.accountId,
		tenantId: args.tenantId,
		agentId: args.agentId,
		recordsIngested,
		recordsSkipped,
		errors,
		compileJobId,
		compileJobDeduped,
		latencyMs: Date.now() - started,
	};
}

// ---------------------------------------------------------------------------
// Query — keyset pagination on (account_id, id). `journal.idea.id` is a cuid-
// style text key; ordering is stable.
// ---------------------------------------------------------------------------

async function fetchPage(
	accountId: string,
	lastId: string,
	limit: number,
): Promise<JournalIdeaRow[]> {
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
	return ((result as unknown as { rows?: JournalIdeaRow[] }).rows ??
		[]) as JournalIdeaRow[];
}

// ---------------------------------------------------------------------------
// Prose rendering — deterministic, grounded. Matches the template in the
// build plan; tests pin the exact output for representative rows.
// ---------------------------------------------------------------------------

export interface BuildPayloadOwner {
	tenantId: string;
	agentId: string;
}

export function buildRetainPayload(
	row: JournalIdeaRow,
	owner: BuildPayloadOwner,
) {
	const text = renderRecordText(row);
	// Skip records with neither body text nor a place anchor — nothing the
	// compiler could meaningfully compound on.
	const hasBody = !!(row.body && row.body.trim().length > 0);
	const hasPlace = !!(row.place_name && row.place_name.trim().length > 0);
	if (!hasBody && !hasPlace) return null;

	const summary = buildSummary(row);
	const metadata = buildMetadata(row);

	return {
		tenantId: owner.tenantId,
		ownerType: "agent" as const,
		ownerId: owner.agentId,
		sourceType: "import" as const,
		content: text,
		metadata,
	};
}

function renderRecordText(row: JournalIdeaRow): string {
	const parts: string[] = [];
	parts.push((row.body && row.body.trim()) || "Visited.");

	if (row.journal_title) {
		let line = `From journal "${row.journal_title.trim()}"`;
		if (row.journal_start_date) {
			const start = formatDate(row.journal_start_date);
			const end = row.journal_end_date
				? `–${formatDate(row.journal_end_date)}`
				: "";
			line += ` (${start}${end})`;
		}
		parts.push(`\n${line}.`);
	}

	if (row.place_name) {
		let line = `Place: ${row.place_name.trim()}`;
		if (row.place_address) line += ` — ${row.place_address.trim()}`;
		if (row.place_types && row.place_types.length > 0) {
			line += ` [${row.place_types.join(", ")}]`;
		}
		parts.push(`\n${line}.`);
	}

	if (row.tags && row.tags.length > 0) {
		parts.push(`\nTags: ${row.tags.join(", ")}.`);
	}

	return parts.join("\n").trim();
}

function buildSummary(row: JournalIdeaRow): string {
	const body = row.body?.trim();
	if (body && body.length > 0) {
		return body.length <= SUMMARY_MAX ? body : `${body.slice(0, SUMMARY_MAX - 1)}…`;
	}
	const bits: string[] = [];
	if (row.place_name) bits.push(`Visited ${row.place_name}`);
	if (row.tags && row.tags.length > 0) bits.push(`[${row.tags.join(", ")}]`);
	if (row.place_types && row.place_types.length > 0) {
		bits.push(`(${row.place_types.slice(0, 3).join(", ")})`);
	}
	const joined = bits.join(" ").trim();
	return joined.length === 0
		? "Imported journal entry"
		: joined.length <= SUMMARY_MAX
			? joined
			: `${joined.slice(0, SUMMARY_MAX - 1)}…`;
}

/**
 * Build metadata as a FLAT string-only dict.
 *
 * Hindsight's memory_units metadata column is typed `Dict[str, str]` — nested
 * objects and non-string values are rejected with HTTP 422. We flatten the
 * (idea, place, journal, import) groups into `group_key` top-level strings
 * so both Hindsight and the downstream compiler get something structured and
 * scan-friendly. Booleans render as "true"/"false", arrays as
 * comma-separated, nothing nested.
 */
function buildMetadata(row: JournalIdeaRow): Record<string, string> {
	const meta: Record<string, string> = {};

	setIf(meta, "idea_external_id", row.external_id);
	setIf(meta, "idea_tags", joinList(row.tags));
	setIf(meta, "idea_is_visit", row.is_visit ? "true" : undefined);
	setIf(meta, "idea_is_favorite", row.is_favorite ? "true" : undefined);
	setIf(meta, "idea_image_count", row.images ? row.images.length : undefined);
	setIf(
		meta,
		"idea_created",
		toIsoSafe(row.created) ?? toIsoSafe(row.date_created),
	);
	setIf(meta, "idea_geo_lat", row.geo_lat);
	setIf(meta, "idea_geo_lon", row.geo_lon);

	meta.import_source = "journal.idea";
	meta.import_journal_idea_id = row.id;

	if (row.place_id || row.place_name) {
		setIf(meta, "place_id", row.place_id);
		setIf(meta, "place_google_place_id", row.place_google_id);
		setIf(meta, "place_name", row.place_name);
		setIf(meta, "place_address", row.place_address);
		setIf(meta, "place_types", joinList(row.place_types));
		setIf(meta, "place_geo_lat", row.place_lat);
		setIf(meta, "place_geo_lon", row.place_lon);
		// Fold the non-noisy Google Places fields in too — rating/phone/hours
		// are the ones the planner will actually use.
		foldExtraPlaceFields(meta, row.place_metadata);
	}

	if (row.journal_id) {
		setIf(meta, "journal_id", row.journal_id);
		setIf(meta, "journal_title", row.journal_title);
		setIf(meta, "journal_description", row.journal_description);
		setIf(meta, "journal_start_date", formatDate(row.journal_start_date));
		setIf(meta, "journal_end_date", formatDate(row.journal_end_date));
		setIf(meta, "journal_tags", joinList(row.journal_tags));
	}

	return meta;
}

/** Set `key` on the dict only when `value` stringifies to something non-empty. */
function setIf(
	dict: Record<string, string>,
	key: string,
	value: unknown,
): void {
	if (value == null) return;
	if (typeof value === "string") {
		if (value.length === 0) return;
		dict[key] = value;
		return;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return;
		dict[key] = String(value);
		return;
	}
	if (typeof value === "boolean") {
		dict[key] = value ? "true" : "false";
		return;
	}
	// Fallback — serialize; still a string so Hindsight accepts it.
	try {
		dict[key] = JSON.stringify(value);
	} catch {
		/* skip */
	}
}

function joinList(values: string[] | null | undefined): string | undefined {
	if (!values || values.length === 0) return undefined;
	const joined = values
		.map((v) => String(v).trim())
		.filter((v) => v.length > 0)
		.join(", ");
	return joined.length === 0 ? undefined : joined;
}

/**
 * Fold a small allow-list of useful Google Places fields into the flat dict,
 * under `place_*` prefixes. Photos and pathological-size fields are skipped.
 * Oversize strings are truncated so we stay under Hindsight's per-field
 * length expectations.
 */
function foldExtraPlaceFields(
	dict: Record<string, string>,
	metadata: Record<string, unknown> | null,
): void {
	if (!metadata) return;
	const ALLOW = new Set([
		"phone",
		"rating",
		"price_level",
		"website",
		"openingHours",
		"opening_hours",
		"hours",
	]);
	for (const [k, v] of Object.entries(metadata)) {
		if (!ALLOW.has(k)) continue;
		if (v == null) continue;
		const destKey = `place_${k.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
		if (Array.isArray(v)) {
			const joined = joinList(v.filter((x) => typeof x === "string") as string[]);
			if (joined) dict[destKey] = truncate(joined, 800);
			continue;
		}
		if (typeof v === "string") {
			dict[destKey] = truncate(v, 800);
			continue;
		}
		setIf(dict, destKey, v);
	}
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function formatDate(date: Date | string | null | undefined): string | null {
	const iso = toIsoSafe(date);
	return iso ? iso.slice(0, 10) : null;
}

/**
 * pg returns timestamp columns as Date in some configs but as string in
 * others (esp. when the column has no `pg` parser installed on the pool).
 * Normalize to ISO string or null — never throw.
 */
function toIsoSafe(
	value: Date | string | number | null | undefined,
): string | null {
	if (value == null) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	try {
		const d = new Date(value as any);
		return Number.isNaN(d.getTime()) ? null : d.toISOString();
	} catch {
		return null;
	}
}
