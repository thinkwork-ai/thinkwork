#!/usr/bin/env -S tsx
/**
 * wiki-places-refresh.ts
 *
 * Operator escape-hatch for re-fetching Google Place Details on one or
 * more `wiki_places` rows. Never runs automatically; operators invoke
 * this by hand when they have a reason (an address outdated, a POI
 * renamed, etc.).
 *
 * Targets:
 *   --place-id <uuid>             — refresh exactly one row
 *   --tenant <uuid> --owner <uuid>  — refresh every eligible row in scope
 *   --stale-before <ISO>          — composable with scope; filters by
 *                                   wiki_places.updated_at (v1 uses
 *                                   updated_at as a proxy — see Note)
 *
 * Safety rails:
 *   --dry-run defaults ON. Pass --apply to actually call Google + write.
 *   Rows where source IN ('manual','journal_metadata') are always
 *   skipped — manual rows preserve user edits; journal_metadata rows
 *   have no google_place_id to refresh against.
 *   On breaker trip, the batch aborts and remaining candidates are
 *   reported in the summary.
 *
 * Note: The brainstorm's schema doesn't carry a `source_payload_fetched_at`
 * column, so `--stale-before` uses `updated_at` as a proxy. Good enough
 * for v1 ops; a dedicated fetched_at column is a trivial follow-up if
 * the proxy proves too coarse.
 *
 * Usage:
 *   DATABASE_URL="...sslmode=no-verify" \
 *     tsx packages/api/scripts/wiki-places-refresh.ts --place-id <uuid> [--apply]
 *   DATABASE_URL="...sslmode=no-verify" \
 *     tsx packages/api/scripts/wiki-places-refresh.ts \
 *       --tenant <uuid> --owner <uuid> --stale-before 2026-01-01 [--apply]
 *
 * See: docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md Unit 9
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import { wikiPlaces } from "@thinkwork/database-pg/schema";
import type {
	GooglePlacesClient,
	PlaceDetailsResponse,
} from "../src/lib/wiki/google-places-client.js";
import { loadGooglePlacesClientFromSsm } from "../src/lib/wiki/google-places-client.js";
import type { WikiPlaceRow } from "../src/lib/wiki/repository.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
	placeId: string | null;
	tenantId: string | null;
	ownerId: string | null;
	staleBefore: Date | null;
	apply: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {
		placeId: null,
		tenantId: null,
		ownerId: null,
		staleBefore: null,
		apply: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--place-id":
				out.placeId = argv[++i] ?? null;
				break;
			case "--tenant":
				out.tenantId = argv[++i] ?? null;
				break;
			case "--owner":
				out.ownerId = argv[++i] ?? null;
				break;
			case "--stale-before": {
				const raw = argv[++i] ?? "";
				const parsed = new Date(raw);
				if (Number.isNaN(parsed.getTime())) {
					throw new Error(
						`--stale-before: invalid date '${raw}' (expected ISO timestamp)`,
					);
				}
				out.staleBefore = parsed;
				break;
			}
			case "--apply":
				out.apply = true;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}
	return out;
}

export function validateArgs(args: CliArgs): string | null {
	const hasPlaceId = Boolean(args.placeId);
	const hasScope = Boolean(args.tenantId) && Boolean(args.ownerId);
	if ((args.tenantId && !args.ownerId) || (args.ownerId && !args.tenantId)) {
		return "--tenant and --owner must both be set";
	}
	if (hasPlaceId && hasScope) {
		return "cannot combine --place-id with --tenant/--owner";
	}
	if (!hasPlaceId && !hasScope) {
		return "provide either --place-id <uuid> or --tenant <uuid> --owner <uuid>";
	}
	if (hasPlaceId && args.staleBefore) {
		return "--stale-before requires --tenant/--owner (not composable with --place-id)";
	}
	return null;
}

function printHelp(): void {
	console.log(`wiki-places-refresh.ts

Usage:
  tsx packages/api/scripts/wiki-places-refresh.ts --place-id <uuid> [--apply]
  tsx packages/api/scripts/wiki-places-refresh.ts \\
    --tenant <uuid> --owner <uuid> [--stale-before <ISO>] [--apply]

Flags:
  --place-id       Single wiki_places.id to refresh.
  --tenant         Tenant scope (pair with --owner).
  --owner          Agent/owner scope (pair with --tenant).
  --stale-before   ISO timestamp — refresh only rows whose updated_at < X
                   (composable with --tenant/--owner).
  --apply          Actually call Google + write. Default is dry-run.
`);
}

// ---------------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------------

export type RefreshOutcome =
	| { kind: "updated"; placeId: string; googlePlaceId: string }
	| { kind: "skipped"; placeId: string; reason: SkipReason }
	| { kind: "error"; placeId: string; error: string };

export type SkipReason =
	| "manual_source"
	| "journal_metadata_source"
	| "no_google_place_id"
	| "not_found"
	| "breaker_tripped"
	| "dry_run";

export interface RefreshDeps {
	listCandidates: () => Promise<WikiPlaceRow[]>;
	fetchPlaceDetails: (
		googlePlaceId: string,
	) => Promise<PlaceDetailsResponse | null>;
	breakerState: () => { state: "closed" | "tripped" };
	applyRowUpdate: (args: {
		placeId: string;
		details: PlaceDetailsResponse;
	}) => Promise<void>;
	apply: boolean;
	log?: (line: string) => void;
}

export interface RefreshResult {
	processed: number;
	updated: number;
	skipped: number;
	errors: number;
	pending_on_breaker_trip: number;
	outcomes: RefreshOutcome[];
}

export async function runPlacesRefresh(
	deps: RefreshDeps,
): Promise<RefreshResult> {
	const log = deps.log ?? (() => {});
	const result: RefreshResult = {
		processed: 0,
		updated: 0,
		skipped: 0,
		errors: 0,
		pending_on_breaker_trip: 0,
		outcomes: [],
	};

	const candidates = await deps.listCandidates();
	log(`[refresh] ${candidates.length} candidate rows`);

	for (let i = 0; i < candidates.length; i++) {
		const row = candidates[i];
		result.processed += 1;

		// Source-based skips — honor manual edits and metadata-only rows.
		if (row.source === "manual") {
			const out: RefreshOutcome = {
				kind: "skipped",
				placeId: row.id,
				reason: "manual_source",
			};
			result.skipped += 1;
			result.outcomes.push(out);
			log(`[refresh] skip ${row.id} (source=manual — never overwrite user edits)`);
			continue;
		}
		if (row.source === "journal_metadata") {
			const out: RefreshOutcome = {
				kind: "skipped",
				placeId: row.id,
				reason: "journal_metadata_source",
			};
			result.skipped += 1;
			result.outcomes.push(out);
			log(
				`[refresh] skip ${row.id} (source=journal_metadata — no google_place_id to refresh against)`,
			);
			continue;
		}

		if (!row.google_place_id) {
			const out: RefreshOutcome = {
				kind: "skipped",
				placeId: row.id,
				reason: "no_google_place_id",
			};
			result.skipped += 1;
			result.outcomes.push(out);
			log(
				`[refresh] skip ${row.id} (source=${row.source}, no google_place_id — derived_hierarchy rows can't be refreshed directly)`,
			);
			continue;
		}

		if (deps.breakerState().state === "tripped") {
			// Abort the batch — remaining rows all fall through to a
			// pending count for operator follow-up.
			const pending = candidates.length - i;
			result.pending_on_breaker_trip = pending;
			log(
				`[refresh] breaker tripped — aborting with ${pending} row(s) pending`,
			);
			for (let j = i; j < candidates.length; j++) {
				result.outcomes.push({
					kind: "skipped",
					placeId: candidates[j].id,
					reason: "breaker_tripped",
				});
				result.skipped += 1;
			}
			break;
		}

		if (!deps.apply) {
			result.outcomes.push({
				kind: "skipped",
				placeId: row.id,
				reason: "dry_run",
			});
			result.skipped += 1;
			log(
				`[refresh] dry-run would refresh ${row.id} google_place_id=${row.google_place_id}`,
			);
			continue;
		}

		let details: PlaceDetailsResponse | null;
		try {
			details = await deps.fetchPlaceDetails(row.google_place_id);
		} catch (err) {
			const msg = (err as Error)?.message ?? String(err);
			result.errors += 1;
			result.outcomes.push({
				kind: "error",
				placeId: row.id,
				error: msg,
			});
			log(`[refresh] fetch_failed ${row.id}: ${msg}`);
			continue;
		}

		if (details === null) {
			// Client returned null — either NOT_FOUND, breaker just tripped,
			// or retries exhausted. Detect which by rechecking breakerState
			// AFTER the call.
			if (deps.breakerState().state === "tripped") {
				// Mid-call breaker trip — surface pending + abort.
				const pending = candidates.length - i - 1;
				result.pending_on_breaker_trip = pending;
				log(
					`[refresh] breaker tripped during ${row.id} — aborting with ${pending} row(s) pending`,
				);
				result.outcomes.push({
					kind: "error",
					placeId: row.id,
					error: "breaker_tripped_mid_call",
				});
				result.errors += 1;
				for (let j = i + 1; j < candidates.length; j++) {
					result.outcomes.push({
						kind: "skipped",
						placeId: candidates[j].id,
						reason: "breaker_tripped",
					});
					result.skipped += 1;
				}
				break;
			}
			// NOT_FOUND (or retries exhausted — client already logged).
			result.outcomes.push({
				kind: "skipped",
				placeId: row.id,
				reason: "not_found",
			});
			result.skipped += 1;
			log(
				`[refresh] not_found ${row.id} google_place_id=${row.google_place_id} (v1 schema has no last_refresh_error column — see audit logs)`,
			);
			continue;
		}

		try {
			await deps.applyRowUpdate({ placeId: row.id, details });
			result.updated += 1;
			result.outcomes.push({
				kind: "updated",
				placeId: row.id,
				googlePlaceId: row.google_place_id,
			});
			log(`[refresh] updated ${row.id} (google_place_id=${row.google_place_id})`);
		} catch (err) {
			const msg = (err as Error)?.message ?? String(err);
			result.errors += 1;
			result.outcomes.push({
				kind: "error",
				placeId: row.id,
				error: msg,
			});
			log(`[refresh] write_failed ${row.id}: ${msg}`);
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// DB adapters — wire the orchestrator against real tables + SSM-backed client
// ---------------------------------------------------------------------------

async function listCandidatesFromDb(args: {
	placeId: string | null;
	tenantId: string | null;
	ownerId: string | null;
	staleBefore: Date | null;
}): Promise<WikiPlaceRow[]> {
	const clauses = [] as any[];
	if (args.placeId) clauses.push(eq(wikiPlaces.id, args.placeId));
	if (args.tenantId) clauses.push(eq(wikiPlaces.tenant_id, args.tenantId));
	if (args.ownerId) clauses.push(eq(wikiPlaces.owner_id, args.ownerId));
	if (args.staleBefore) clauses.push(lt(wikiPlaces.updated_at, args.staleBefore));

	const rows = await db
		.select()
		.from(wikiPlaces)
		.where(clauses.length === 1 ? clauses[0] : and(...clauses));
	return rows as WikiPlaceRow[];
}

async function applyRowUpdateToDb(args: {
	placeId: string;
	details: PlaceDetailsResponse;
}): Promise<void> {
	const { placeId, details } = args;
	const displayName = details.displayName?.text ?? null;
	const lat = details.location?.latitude;
	const lon = details.location?.longitude;
	await db.execute(sql`
		UPDATE ${wikiPlaces}
		SET
			source_payload = ${JSON.stringify(details)}::jsonb,
			${displayName !== null ? sql`name = ${displayName},` : sql``}
			${lat !== undefined ? sql`geo_lat = ${String(lat)}::numeric,` : sql``}
			${lon !== undefined ? sql`geo_lon = ${String(lon)}::numeric,` : sql``}
			address = ${details.formattedAddress ?? null},
			updated_at = now()
		WHERE id = ${placeId}::uuid
	`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const validationError = validateArgs(args);
	if (validationError) {
		console.error(`error: ${validationError}`);
		printHelp();
		process.exit(2);
	}

	console.log(
		`[wiki-places-refresh] ${args.apply ? "APPLY" : "DRY RUN"}` +
			` place-id=${args.placeId ?? "-"} tenant=${args.tenantId ?? "-"}` +
			` owner=${args.ownerId ?? "-"} stale-before=${args.staleBefore?.toISOString() ?? "-"}`,
	);

	let client: GooglePlacesClient | null = null;
	if (args.apply) {
		client = await loadGooglePlacesClientFromSsm();
		if (!client) {
			console.error(
				"error: Google Places client failed to initialize (SSM param missing?). Aborting --apply.",
			);
			process.exit(1);
		}
	}

	const result = await runPlacesRefresh({
		apply: args.apply,
		listCandidates: () =>
			listCandidatesFromDb({
				placeId: args.placeId,
				tenantId: args.tenantId,
				ownerId: args.ownerId,
				staleBefore: args.staleBefore,
			}),
		fetchPlaceDetails: (googlePlaceId) =>
			client
				? client.fetchPlaceDetails(googlePlaceId)
				: Promise.resolve(null),
		breakerState: () =>
			client ? client.breakerState() : { state: "closed" },
		applyRowUpdate: (a) => applyRowUpdateToDb(a),
		log: (line) => console.log(line),
	});

	console.log(`\nJSON: ${JSON.stringify(result)}`);
	if (result.errors > 0 || result.pending_on_breaker_trip > 0) {
		process.exit(1);
	}
}

const isDirectInvocation =
	typeof process !== "undefined" &&
	process.argv[1]?.endsWith("wiki-places-refresh.ts");

if (isDirectInvocation) {
	main().catch((err) => {
		console.error(
			`[wiki-places-refresh] fatal: ${(err as Error).stack ?? err}`,
		);
		process.exit(1);
	});
}
