#!/usr/bin/env tsx
/**
 * PRD-31: Sync skill catalog metadata to the skill_catalog DB table.
 *
 * Reads each skill's SKILL.md frontmatter (post plan 2026-04-24-009 §U2 the
 * canonical source — `skill.yaml` was retired) and upserts into the
 * skill_catalog table. After upserts, deletes built-in rows whose slug is
 * not in the current catalog — ensures retired slugs (e.g. the composition
 * primitives deleted in the pure-skill-spec cleanup) are physically
 * removed from the table on every deploy, not just in the on-disk tree.
 *
 * tier1_metadata JSONB shape contract: this script writes the full parsed
 * frontmatter (the dict returned by parseSkillMdInternal) into
 * skill_catalog.tier1_metadata. Downstream consumers — notably
 * setAgentSkills.mutation.ts::parseTier1Metadata and
 * extractDefaultEnabledOps — read `permissions_model` and
 * `scripts[].{name, default_enabled}` directly off this blob. The U2
 * frontmatter merge preserved every field that lived in skill.yaml, so
 * the JSONB shape is a drop-in replacement for the prior YAML-parse
 * output.
 *
 * Usage: npx tsx packages/skill-catalog/scripts/sync-catalog-db.ts
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "@thinkwork/database-pg";
import { skillCatalog } from "@thinkwork/database-pg/schema";
import { and, eq, inArray, not } from "drizzle-orm";
import { parseSkillMdInternal } from "../../api/src/lib/skill-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(__dirname, "..");

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
		name === "__tests__" ||
		name.startsWith(".")
	)
		return false;
	const fullPath = join(catalogRoot, name);
	try {
		return (
			statSync(fullPath).isDirectory() &&
			statSync(join(fullPath, "SKILL.md")).isFile()
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
		const mdPath = join(catalogRoot, dir, "SKILL.md");
		const mdContent = readFileSync(mdPath, "utf-8");
		const result = parseSkillMdInternal(mdContent, mdPath);
		if (!result.valid) {
			console.warn(
				`⚠ Skipping ${dir}: SKILL.md frontmatter parse failed — ${result.errors
					.map((e) => e.message)
					.join("; ")}`,
			);
			continue;
		}
		const y = result.parsed.data;

		// Frontmatter `name` is the canonical slug (post-U2). For belt-and-
		// braces tolerance during the migration window, fall back to
		// legacy `slug:` / `id:` keys if a stray pre-U2 file slips through.
		const slug =
			(typeof y.name === "string" && y.name) ||
			(typeof y.slug === "string" && (y.slug as string)) ||
			(typeof y.id === "string" && (y.id as string)) ||
			"";
		if (!slug) {
			console.warn(`⚠ Skipping ${dir}: no name/slug/id in SKILL.md frontmatter`);
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
			version: stringifyVersion(y.version) || "1.0.0",
			author:
				(y.author as string) ||
				(((y.metadata as Record<string, unknown>) || {}).author as string) ||
				"thinkwork",
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
			// RDS Data API needs JSONB serialized as a string. Store the full
			// parsed frontmatter so consumers like
			// setAgentSkills.mutation.ts::parseTier1Metadata can read
			// permissions_model and scripts[] off the blob.
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

/**
 * `version:` is sometimes a YAML int (e.g. `version: 2`) and sometimes a
 * quoted string (`version: "1.0.0"`). The DB column is text — coerce both.
 */
function stringifyVersion(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return undefined;
}

main().catch((err) => {
	console.error("Failed to sync catalog:", err);
	process.exit(1);
});
