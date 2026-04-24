#!/usr/bin/env tsx
/**
 * PRD-31: Sync skill catalog YAML files to the skill_catalog DB table.
 *
 * Reads all skill.yaml files from the catalog directory and upserts into
 * the skill_catalog table. After upserts, deletes built-in rows whose slug
 * is not in the current catalog — ensures retired slugs (e.g. the
 * composition primitives deleted in the pure-skill-spec cleanup) are
 * physically removed from the table on every deploy, not just in the
 * YAML tree.
 *
 * Usage: npx tsx packages/skill-catalog/scripts/sync-catalog-db.ts
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { getDb } from "@thinkwork/database-pg";
import { skillCatalog } from "@thinkwork/database-pg/schema";
import { and, eq, inArray, not, sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(__dirname, "..");

function parseSkillYaml(content: string): Record<string, unknown> {
	return (parseYaml(content) as Record<string, unknown>) ?? {};
}

// Defensive array coercion. YAML can produce scalars, maps, or omitted keys
// where a text[] column expects a string list — coercing here keeps one
// authoring mistake from blowing up the whole bootstrap sync.
function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Discover skills
// ---------------------------------------------------------------------------

const entries = readdirSync(catalogRoot).filter((name) => {
	if (
		name === "scripts" ||
		name === "templates" ||
		name === "node_modules" ||
		name.startsWith(".")
	)
		return false;
	const fullPath = join(catalogRoot, name);
	try {
		return (
			statSync(fullPath).isDirectory() &&
			statSync(join(fullPath, "skill.yaml")).isFile()
		);
	} catch {
		return false;
	}
});

// ---------------------------------------------------------------------------
// Sync to DB
// ---------------------------------------------------------------------------

async function main() {
	const db = getDb();
	const activeSlugs: string[] = [];
	let synced = 0;

	for (const dir of entries) {
		const yamlContent = readFileSync(
			join(catalogRoot, dir, "skill.yaml"),
			"utf-8",
		);
		const y = parseSkillYaml(yamlContent);

		// Accept `slug:` or `id:` as the catalog key — the U8 deliverable
		// skills (sales-prep, account-health-review, renewal-prep,
		// customer-onboarding-reconciler) use `id:` per the census convention.
		const slug = (y.slug as string) || (y.id as string);
		if (!slug) {
			console.warn(`⚠ Skipping ${dir}: no slug or id in skill.yaml`);
			continue;
		}

		// Flatten description for multi-line YAML values
		let desc = y.description as string | undefined;
		if (typeof desc === "object") desc = undefined;

		const row = {
			slug,
			display_name: (y.display_name as string) || slug,
			description: desc,
			category: y.category as string | undefined,
			version: (y.version as string) || "1.0.0",
			author: (y.author as string) || "thinkwork",
			icon: y.icon as string | undefined,
			tags: toStringArray(y.tags),
			source: "builtin" as const,
			is_default: y.is_default === "true" || y.is_default === true,
			requires_env: toStringArray(y.requires_env),
			oauth_provider: y.oauth_provider as string | undefined,
			oauth_scopes: toStringArray(y.oauth_scopes),
			mcp_server: y.mcp_server as string | undefined,
			mcp_tools: toStringArray(y.mcp_tools),
			dependencies: toStringArray(y.dependencies),
			triggers: toStringArray(y.triggers),
			// RDS Data API needs JSONB serialized as a string
			tier1_metadata: JSON.stringify(y) as any,
			updated_at: new Date(),
		};

		await db
			.insert(skillCatalog)
			.values(row)
			.onConflictDoUpdate({
				target: skillCatalog.slug,
				set: {
					...row,
					// Don't overwrite created_at on update
					slug: undefined as any,
				},
			});

		activeSlugs.push(slug);
		synced++;
		console.log(
			`✓ ${slug} (execution=${y.execution ?? "unknown"}, default=${row.is_default})`,
		);
	}

	// Remove builtin rows whose slug is no longer in the catalog. Scoped to
	// `source='builtin'` so tenant-uploaded rows survive. Matching is case-
	// sensitive — slugs on disk and in DB must agree exactly.
	if (activeSlugs.length > 0) {
		const stale = await db
			.delete(skillCatalog)
			.where(
				and(
					eq(skillCatalog.source, "builtin"),
					not(inArray(skillCatalog.slug, activeSlugs)),
				),
			)
			.returning({ slug: skillCatalog.slug });
		if (stale.length > 0) {
			console.log(
				`\nRemoved ${stale.length} retired builtin slug(s) from skill_catalog: ` +
					stale.map((r) => r.slug).join(", "),
			);
		}
	}

	console.log(`\nSynced ${synced} skills to skill_catalog table.`);
	process.exit(0);
}

main().catch((err) => {
	console.error("Failed to sync catalog:", err);
	process.exit(1);
});
