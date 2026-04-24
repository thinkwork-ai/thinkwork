#!/usr/bin/env tsx
/**
 * Regenerate AGENTS.md + CONTEXT.md + manifest for every agent in every
 * tenant. Used after the skill catalog changes (add/retire slugs) so the
 * on-disk workspace map reflects the new canonical set instead of waiting
 * for the next setAgentSkills mutation to re-sync each agent individually.
 *
 * Post plan §U6 + the pure-skill-spec cleanup this became load-bearing:
 * retired slugs (frame/synthesize/gather/compound) need to stop appearing
 * in AGENTS.md Skills & Tools tables. Without an explicit regen pass the
 * table would hold stale entries until an operator re-saved skills.
 *
 * Safe to run multiple times. Per-agent failure is caught + logged; the
 * script exits 0 as long as SOME agents succeeded, so a single bad
 * workspace can't wedge a deploy.
 *
 * Usage:
 *   DATABASE_URL=... pnpm -C packages/api exec tsx scripts/regen-all-workspace-maps.ts
 */

import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";
import { regenerateWorkspaceMap } from "../src/lib/workspace-map-generator.js";

async function main() {
	const db = getDb();
	const rows = await db
		.select({ id: agents.id, name: agents.name, tenant_id: agents.tenant_id })
		.from(agents)
		.execute();

	console.log(`Found ${rows.length} agent(s) to regenerate.`);
	let ok = 0;
	let failed = 0;

	for (const a of rows) {
		try {
			await regenerateWorkspaceMap(a.id);
			ok++;
			console.log(`  ✓ ${a.id} (${a.name || "unnamed"})`);
		} catch (err) {
			failed++;
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`  ✗ ${a.id} (${a.name || "unnamed"}): ${msg}`);
		}
	}

	console.log(`\nRegen complete: ${ok} ok, ${failed} failed.`);
	// A deploy that has zero agents is valid (fresh stage) — still exit 0.
	// Partial failures don't block the deploy; the next setAgentSkills
	// mutation for each bad agent will re-attempt regen.
	process.exit(0);
}

main().catch((err) => {
	console.error("Fatal error in regen-all-workspace-maps:", err);
	process.exit(1);
});
