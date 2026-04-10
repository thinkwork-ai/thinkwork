#!/usr/bin/env tsx
/**
 * PRD-31: Sync skill catalog YAML files to the skill_catalog DB table.
 *
 * Reads all skill.yaml files from the catalog directory and upserts into
 * the skill_catalog table. Run manually or as part of deploy.
 *
 * Usage: npx tsx packages/skill-catalog/scripts/sync-catalog-db.ts
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "@thinkwork/database-pg";
import { skillCatalog } from "@thinkwork/database-pg/schema";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Minimal YAML parser (reused from generate-index.ts)
// ---------------------------------------------------------------------------

function parseSkillYaml(content: string) {
	const result: Record<string, unknown> = {};
	let currentKey = "";
	let currentType: "list" | "map" | "" = "";
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === "" || line.trim().startsWith("#")) continue;

		const listMatch = line.match(/^\s+-\s+(.+)$/);
		if (listMatch && currentKey && currentType === "list") {
			const arr = result[currentKey] as string[];
			arr.push(listMatch[1].trim());
			continue;
		}

		const mapMatch = line.match(/^\s+(\w[\w_]*)\s*:\s*(.+)$/);
		if (mapMatch && currentKey && currentType === "map") {
			const map = result[currentKey] as Record<string, string>;
			let val = mapMatch[2].trim();
			if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
			map[mapMatch[1]] = val;
			continue;
		}

		const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
		if (kvMatch) {
			const [, key, rawValue] = kvMatch;
			let value: unknown = rawValue.trim();

			if (
				typeof value === "string" &&
				value.startsWith("[") &&
				value.endsWith("]")
			) {
				value = value
					.slice(1, -1)
					.split(",")
					.map((s) => s.trim());
				result[key] = value;
				currentKey = "";
				currentType = "";
				continue;
			}

			if (
				typeof value === "string" &&
				value.startsWith('"') &&
				value.endsWith('"')
			) {
				value = value.slice(1, -1);
			}

			if (value === "" || value === "|") {
				const nextLine = lines[i + 1] || "";
				if (nextLine.match(/^\s+-\s+/)) {
					result[key] = [];
					currentType = "list";
				} else {
					result[key] = {};
					currentType = "map";
				}
				currentKey = key;
				continue;
			}

			result[key] = value;
			currentKey = key;
			currentType = "";
		}
	}

	return result;
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
	let synced = 0;

	for (const dir of entries) {
		const yamlContent = readFileSync(
			join(catalogRoot, dir, "skill.yaml"),
			"utf-8",
		);
		const y = parseSkillYaml(yamlContent);

		const slug = y.slug as string;
		if (!slug) {
			console.warn(`⚠ Skipping ${dir}: no slug in skill.yaml`);
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
			tags: (y.tags as string[]) || [],
			source: "builtin" as const,
			is_default: y.is_default === "true" || y.is_default === true,
			execution: (y.execution as string) || "context",
			mode: (y.mode as string) || "tool",
			requires_env: (y.requires_env as string[]) || [],
			oauth_provider: y.oauth_provider as string | undefined,
			oauth_scopes: (y.oauth_scopes as string[]) || [],
			mcp_server: y.mcp_server as string | undefined,
			mcp_tools: (y.mcp_tools as string[]) || [],
			dependencies: (y.dependencies as string[]) || [],
			triggers: (y.triggers as string[]) || [],
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

		synced++;
		console.log(`✓ ${slug} (${row.execution}, default=${row.is_default})`);
	}

	console.log(`\nSynced ${synced} skills to skill_catalog table.`);
	process.exit(0);
}

main().catch((err) => {
	console.error("Failed to sync catalog:", err);
	process.exit(1);
});
