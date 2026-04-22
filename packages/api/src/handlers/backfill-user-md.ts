/**
 * One-off backfill: re-run USER.md substitution for every agent whose
 * human_pair_id was set before Unit 6 landed.
 *
 * Why this exists:
 *   Unit 6 introduced write-at-assignment for USER.md — when a human is
 *   paired with an agent via `updateAgent`, `writeUserMdForAssignment`
 *   fires inside the same transaction and replaces `{{HUMAN_NAME}}` etc.
 *   with the paired human's values before writing to S3.
 *
 *   Unit 10's migration copied the template USER.md wholesale as an
 *   agent-override for every existing agent, but did NOT invoke the
 *   writer for pairings that already existed — so pre-Unit-6 pairings
 *   ended up with the raw template on disk. The runtime ultimately reads
 *   `Your primary human partner is **{{HUMAN_NAME}}**` literally and the
 *   agent tells the human it doesn't know who they are.
 *
 *   This handler simply calls `writeUserMdForAssignment` once for every
 *   (agent_id, human_pair_id) pair. It's idempotent: agents whose USER.md
 *   already has the name substituted get rewritten with the same content.
 *
 * Run locally:
 *   npx tsx packages/api/src/handlers/backfill-user-md.ts --dry-run [--tenant <slug>]
 *   npx tsx packages/api/src/handlers/backfill-user-md.ts --commit [--tenant <slug>]
 *
 * Lambda: invoke with payload { mode: "dry-run" | "commit", tenantSlug? }
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, tenants } from "@thinkwork/database-pg/schema";
import {
	UserMdWriterError,
	writeUserMdForAssignment,
} from "../lib/user-md-writer.js";

type Mode = "dry-run" | "commit";

interface BackfillResult {
	mode: Mode;
	total: number;
	rewrote: number;
	skipped: number;
	failed: Array<{ agentId: string; error: string }>;
}

async function run(opts: {
	mode: Mode;
	tenantSlug?: string;
}): Promise<BackfillResult> {
	const db = getDb();

	// Candidates: every agent with a human_pair_id set. Optional tenant
	// filter applied via a slug join so the caller can scope to one tenant.
	const whereClauses = [isNotNull(agents.human_pair_id)];
	let rows;
	if (opts.tenantSlug) {
		rows = await db
			.select({
				agentId: agents.id,
				humanPairId: agents.human_pair_id,
				agentName: agents.name,
				tenantSlug: tenants.slug,
			})
			.from(agents)
			.innerJoin(tenants, eq(tenants.id, agents.tenant_id))
			.where(and(...whereClauses, eq(tenants.slug, opts.tenantSlug)));
	} else {
		rows = await db
			.select({
				agentId: agents.id,
				humanPairId: agents.human_pair_id,
				agentName: agents.name,
				tenantSlug: tenants.slug,
			})
			.from(agents)
			.innerJoin(tenants, eq(tenants.id, agents.tenant_id))
			.where(and(...whereClauses));
	}

	const result: BackfillResult = {
		mode: opts.mode,
		total: rows.length,
		rewrote: 0,
		skipped: 0,
		failed: [],
	};

	for (const row of rows) {
		if (!row.humanPairId) {
			result.skipped += 1;
			continue;
		}

		if (opts.mode === "dry-run") {
			console.log(
				`[backfill-user-md] would rewrite agent=${row.agentId} tenant=${row.tenantSlug} name=${row.agentName}`,
			);
			result.rewrote += 1;
			continue;
		}

		try {
			// writeUserMdForAssignment does its own DB reads; no transaction
			// needed because we're only reading the existing pairing and
			// rewriting USER.md in S3 — no row we'd want to roll back here.
			// If the caller wants atomicity they can wrap this in db.transaction.
			await writeUserMdForAssignment(db, row.agentId, row.humanPairId);
			console.log(
				`[backfill-user-md] rewrote agent=${row.agentId} tenant=${row.tenantSlug}`,
			);
			result.rewrote += 1;
		} catch (err) {
			const message =
				err instanceof UserMdWriterError
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: String(err);
			console.error(
				`[backfill-user-md] FAILED agent=${row.agentId} tenant=${row.tenantSlug}: ${message}`,
			);
			result.failed.push({ agentId: row.agentId, error: message });
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Lambda + CLI entry points
// ---------------------------------------------------------------------------

export async function handler(event: {
	mode?: Mode;
	tenantSlug?: string;
}): Promise<BackfillResult> {
	return run({
		mode: event.mode ?? "dry-run",
		tenantSlug: event.tenantSlug,
	});
}

function parseArgs(): { mode: Mode; tenantSlug?: string } {
	const args = process.argv.slice(2);
	let mode: Mode = "dry-run";
	let tenantSlug: string | undefined;
	for (let i = 0; i < args.length; i += 1) {
		const a = args[i];
		if (a === "--dry-run") mode = "dry-run";
		else if (a === "--commit") mode = "commit";
		else if (a === "--tenant") tenantSlug = args[++i];
	}
	return { mode, tenantSlug };
}

if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith("backfill-user-md.ts")
) {
	(async () => {
		const opts = parseArgs();
		console.log(
			`[backfill-user-md] starting mode=${opts.mode} tenant=${opts.tenantSlug ?? "(all)"}`,
		);
		try {
			const out = await run(opts);
			console.log(
				`[backfill-user-md] done — total=${out.total} rewrote=${out.rewrote} skipped=${out.skipped} failed=${out.failed.length}`,
			);
			if (out.failed.length) {
				console.log(JSON.stringify(out.failed, null, 2));
				process.exitCode = 1;
			}
		} catch (err) {
			console.error(`[backfill-user-md] failed:`, err);
			process.exitCode = 1;
		}
	})();
}
