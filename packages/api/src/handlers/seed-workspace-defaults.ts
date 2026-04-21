/**
 * Seed Workspace Defaults
 *
 * Iterates every tenant and ensures its
 * `tenants/{tenantSlug}/agents/_catalog/defaults/workspace/` prefix holds
 * the current canonical default content (DEFAULTS_VERSION from
 * @thinkwork/workspace-defaults). Per-tenant behavior:
 *
 *   • Stored `_defaults_version` === DEFAULTS_VERSION → no-op.
 *   • Stored version < DEFAULTS_VERSION (or missing) → rewrite all 11 files
 *     + bump the version key.
 *
 * The seeding logic itself lives in `ensureDefaultsExist()` in
 * packages/api/src/lib/workspace-copy.ts — this handler just iterates tenants
 * and delegates per-tenant work.
 *
 * Run via:
 *   • Lambda invoke (post-deploy or scheduled)
 *   • `npx tsx packages/api/src/handlers/seed-workspace-defaults.ts`
 *
 * Unit 3 of docs/plans/2026-04-21-006-feat-agent-workspace-overlay-and-seeding-plan.md.
 */

import { isNotNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenants } from "@thinkwork/database-pg/schema";
import { DEFAULTS_VERSION } from "@thinkwork/workspace-defaults";
import { ensureDefaultsExist } from "../lib/workspace-copy.js";

const db = getDb();

type PerTenantResult = {
	tenantId: string;
	tenantSlug: string;
	outcome: "seeded" | "already-current" | "error";
	previousVersion?: number;
	currentVersion?: number;
	error?: string;
};

type SeedSummary = {
	targetVersion: number;
	totalTenants: number;
	seeded: number;
	alreadyCurrent: number;
	errors: number;
	results: PerTenantResult[];
};

export async function handler(): Promise<SeedSummary> {
	if (!process.env.WORKSPACE_BUCKET) {
		throw new Error("WORKSPACE_BUCKET environment variable is required");
	}

	console.log(
		`[seed-defaults] Starting; target DEFAULTS_VERSION=${DEFAULTS_VERSION}`,
	);

	const rows = await db
		.select({ id: tenants.id, slug: tenants.slug })
		.from(tenants)
		.where(isNotNull(tenants.slug));

	console.log(`[seed-defaults] Found ${rows.length} tenant(s) with a slug`);

	const results: PerTenantResult[] = [];
	let seeded = 0;
	let alreadyCurrent = 0;
	let errors = 0;

	for (const row of rows) {
		const tenantSlug = row.slug!;
		try {
			const outcome = await ensureDefaultsExist(tenantSlug);
			const result: PerTenantResult = {
				tenantId: row.id,
				tenantSlug,
				outcome: outcome.seeded ? "seeded" : "already-current",
				previousVersion: outcome.previousVersion,
				currentVersion: outcome.currentVersion,
			};
			results.push(result);
			if (outcome.seeded) {
				seeded++;
				console.log(
					`[seed-defaults] ${tenantSlug}: seeded (v${outcome.previousVersion} → v${outcome.currentVersion})`,
				);
			} else {
				alreadyCurrent++;
				console.log(
					`[seed-defaults] ${tenantSlug}: already current (v${outcome.currentVersion})`,
				);
			}
		} catch (err) {
			errors++;
			const message = err instanceof Error ? err.message : String(err);
			results.push({
				tenantId: row.id,
				tenantSlug,
				outcome: "error",
				error: message,
			});
			console.error(`[seed-defaults] ${tenantSlug}: failed — ${message}`);
		}
	}

	const summary: SeedSummary = {
		targetVersion: DEFAULTS_VERSION,
		totalTenants: rows.length,
		seeded,
		alreadyCurrent,
		errors,
		results,
	};

	console.log(
		`[seed-defaults] Done: ${seeded} seeded, ${alreadyCurrent} already current, ${errors} error(s)`,
	);

	return summary;
}

// Allow direct execution: npx tsx packages/api/src/handlers/seed-workspace-defaults.ts
if (
	process.argv[1]?.endsWith("seed-workspace-defaults.ts") ||
	process.argv[1]?.endsWith("seed-workspace-defaults.js")
) {
	handler()
		.then((result) => {
			console.log("[seed-defaults] Summary:", JSON.stringify(result, null, 2));
			process.exit(result.errors > 0 ? 1 : 0);
		})
		.catch((err) => {
			console.error("[seed-defaults] Fatal error:", err);
			process.exit(1);
		});
}
