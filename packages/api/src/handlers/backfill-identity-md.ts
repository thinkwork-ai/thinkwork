/**
 * One-off backfill: force-overwrite IDENTITY.md + SOUL.md for every agent
 * with the current template content.
 *
 * This is the "template migration" backfill — distinct from the name-line
 * surgery that `writeIdentityMdForAgent` performs on agent rename. When the
 * template SHAPE changes (as in the Zig-era personality refresh), every
 * existing agent override needs a full rewrite to adopt the new structure;
 * name-line surgery alone would leave the old shape in place below the
 * Name line.
 *
 * What this handler does:
 *   - IDENTITY.md: writes the current template with `{{AGENT_NAME}}`
 *     substituted from the agent row. Agent-authored prose below the Name
 *     line IS clobbered — that's the intent of a template migration. If
 *     you need to preserve agent-authored personality prose, DO NOT run
 *     this handler; use a targeted accept-template-update flow instead.
 *   - SOUL.md: writes the current template verbatim (no placeholders).
 *
 * USER.md is handled by `backfill-user-md.ts` (it needs per-human
 * placeholder resolution from the pairing).
 *
 * Run locally:
 *   npx tsx packages/api/src/handlers/backfill-identity-md.ts --dry-run \
 *     [--tenant <slug>] [--files identity,soul]
 *   npx tsx packages/api/src/handlers/backfill-identity-md.ts --commit \
 *     [--tenant <slug>] [--files identity,soul]
 *
 * Lambda: invoke with payload
 *   { mode: "dry-run" | "commit", tenantSlug?, files?: ("identity"|"soul")[] }
 */

import { eq } from "drizzle-orm";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import { agents, tenants } from "@thinkwork/database-pg/schema";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import { substitute } from "../lib/placeholder-substitution.js";
import { invalidateComposerCache } from "../lib/workspace-overlay.js";

type Mode = "dry-run" | "commit";
type FileTarget = "identity" | "soul";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

interface BackfillResult {
	mode: Mode;
	files: FileTarget[];
	total: number;
	identityRewrote: number;
	soulRewrote: number;
	failed: Array<{ agentId: string; file: FileTarget; error: string }>;
}

async function forceWriteFromTemplate(
	tenantSlug: string,
	agentSlug: string,
	tenantId: string,
	agentId: string,
	file: "IDENTITY.md" | "SOUL.md",
	agentName: string,
): Promise<void> {
	const template = loadDefaults()[file];
	// SOUL.md has no placeholders; IDENTITY.md has only {{AGENT_NAME}}.
	// Running substitute with an empty values object for SOUL.md is a
	// safe no-op, but we only call substitute for files that need it to
	// keep the intent explicit.
	const rendered =
		file === "IDENTITY.md"
			? substitute({ AGENT_NAME: agentName }, template)
			: template;
	const key = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${file}`;
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			Body: rendered,
			ContentType: "text/markdown",
		}),
	);
	invalidateComposerCache({ tenantId, agentId });
}

async function run(opts: {
	mode: Mode;
	tenantSlug?: string;
	files: FileTarget[];
}): Promise<BackfillResult> {
	const db = getDb();

	const base = db
		.select({
			agentId: agents.id,
			agentSlug: agents.slug,
			agentName: agents.name,
			tenantId: agents.tenant_id,
			tenantSlug: tenants.slug,
		})
		.from(agents)
		.innerJoin(tenants, eq(tenants.id, agents.tenant_id));
	const rows = opts.tenantSlug
		? await base.where(eq(tenants.slug, opts.tenantSlug))
		: await base;

	const result: BackfillResult = {
		mode: opts.mode,
		files: opts.files,
		total: rows.length,
		identityRewrote: 0,
		soulRewrote: 0,
		failed: [],
	};

	for (const row of rows) {
		if (!row.agentSlug) {
			console.warn(
				`[backfill-identity-md] skipping agent=${row.agentId} (no slug)`,
			);
			continue;
		}
		const agentSlug = row.agentSlug;

		const doFile = async (
			target: FileTarget,
			s3File: "IDENTITY.md" | "SOUL.md",
			counter: "identityRewrote" | "soulRewrote",
		) => {
			if (!opts.files.includes(target)) return;
			if (opts.mode === "dry-run") {
				console.log(
					`[backfill-identity-md] would force-rewrite ${s3File} for agent=${row.agentId} tenant=${row.tenantSlug} name=${row.agentName}`,
				);
				result[counter] += 1;
				return;
			}
			try {
				await forceWriteFromTemplate(
					row.tenantSlug,
					agentSlug,
					row.tenantId,
					row.agentId,
					s3File,
					row.agentName,
				);
				console.log(
					`[backfill-identity-md] force-rewrote ${s3File} agent=${row.agentId} tenant=${row.tenantSlug}`,
				);
				result[counter] += 1;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`[backfill-identity-md] FAILED ${s3File} agent=${row.agentId}: ${message}`,
				);
				result.failed.push({
					agentId: row.agentId,
					file: target,
					error: message,
				});
			}
		};

		await doFile("identity", "IDENTITY.md", "identityRewrote");
		await doFile("soul", "SOUL.md", "soulRewrote");
	}

	return result;
}

// ---------------------------------------------------------------------------
// Lambda + CLI entry points
// ---------------------------------------------------------------------------

export async function handler(event: {
	mode?: Mode;
	tenantSlug?: string;
	files?: FileTarget[];
}): Promise<BackfillResult> {
	return run({
		mode: event.mode ?? "dry-run",
		tenantSlug: event.tenantSlug,
		files: event.files ?? ["identity", "soul"],
	});
}

function parseArgs(): {
	mode: Mode;
	tenantSlug?: string;
	files: FileTarget[];
} {
	const args = process.argv.slice(2);
	let mode: Mode = "dry-run";
	let tenantSlug: string | undefined;
	let files: FileTarget[] = ["identity", "soul"];
	for (let i = 0; i < args.length; i += 1) {
		const a = args[i];
		if (a === "--dry-run") mode = "dry-run";
		else if (a === "--commit") mode = "commit";
		else if (a === "--tenant") tenantSlug = args[++i];
		else if (a === "--files") {
			const raw = args[++i] ?? "";
			const parsed = raw
				.split(",")
				.map((s) => s.trim())
				.filter(
					(s): s is FileTarget => s === "identity" || s === "soul",
				);
			if (parsed.length > 0) files = parsed;
		}
	}
	return { mode, tenantSlug, files };
}

if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith("backfill-identity-md.ts")
) {
	(async () => {
		const opts = parseArgs();
		console.log(
			`[backfill-identity-md] starting mode=${opts.mode} tenant=${opts.tenantSlug ?? "(all)"} files=${opts.files.join(",")}`,
		);
		try {
			const out = await run(opts);
			console.log(
				`[backfill-identity-md] done — total=${out.total} identity=${out.identityRewrote} soul=${out.soulRewrote} failed=${out.failed.length}`,
			);
			if (out.failed.length) {
				console.log(JSON.stringify(out.failed, null, 2));
				process.exitCode = 1;
			}
		} catch (err) {
			console.error(`[backfill-identity-md] failed:`, err);
			process.exitCode = 1;
		}
	})();
}
