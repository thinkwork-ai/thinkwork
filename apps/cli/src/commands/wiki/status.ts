/**
 * `thinkwork wiki status` — show recent compile jobs for a tenant, with
 * optional filter to a single agent and optional --watch polling.
 *
 * Exit codes:
 *   0  query succeeded (or --watch settled on `succeeded`)
 *   1  query failed (network / forbidden treated identically here — no
 *      mutation happened, so the hint-tone is "you can't see this")
 *   2  --watch timed out with the job still running, OR not-terminal /
 *      non-success terminal (matches `thinkwork eval watch` semantics)
 */

import ora from "ora";
import { gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printTable } from "../../lib/output.js";
import { printError, printWarning } from "../../ui.js";
import { AllTenantAgentsForWikiDoc, WikiCompileJobsDoc } from "./gql.js";
import {
	classifyMutationError,
	isTerminalCompileStatus,
	printForbiddenHint,
	resolveWikiContext,
	shortJobId,
	type WikiCliContext,
	type WikiCliOptions,
} from "./helpers.js";

const DEFAULT_WATCH_INTERVAL_MS = 3000;

export async function runWikiStatus(opts: WikiCliOptions): Promise<void> {
	const ctx = await resolveWikiContext(opts);
	const ownerId = opts.agent ?? null;
	const limit = toInt(opts.limit, 10);
	const timeoutSec = toInt(opts.timeout, 900);

	// Agent-name cache for tenant-wide pretty rendering. Populated lazily on
	// the first query so we don't pay for it in single-agent mode.
	let agentNameById: Record<string, string> | null = null;
	const resolveAgentName = async (): Promise<Record<string, string>> => {
		if (agentNameById) return agentNameById;
		const data = await gqlQuery(ctx.client, AllTenantAgentsForWikiDoc, {
			tenantId: ctx.tenantId,
		});
		agentNameById = Object.fromEntries(
			(data.allTenantAgents ?? []).map((a) => [a.id, a.name ?? a.id]),
		);
		return agentNameById;
	};

	let jobs;
	try {
		jobs = await fetchJobs(ctx, { ownerId, limit });
	} catch (err) {
		const classified = classifyMutationError(err);
		printError(classified.message);
		if (classified.forbidden) {
			printForbiddenHint(ctx.tenantSlug);
			process.exit(2);
		}
		process.exit(1);
	}

	if (!opts.watch) {
		await renderJobs(jobs, {
			tenantSlug: ctx.tenantSlug,
			scope: ownerId ? { agentId: ownerId } : { tenantWide: true },
			resolveAgentName,
		});
		process.exit(0);
	}

	// --watch: poll until the most-recent job reaches a terminal state OR the
	// timeout expires.
	if (jobs.length === 0) {
		printWarning(
			`No compile jobs yet for this scope. --watch exits immediately; re-run once activity starts.`,
		);
		if (isJsonMode()) {
			printJson({
				ok: true,
				scope: { tenantId: ctx.tenantId, ownerId },
				jobs: [],
			});
		}
		process.exit(0);
	}

	const latestId = jobs[0].id;
	const spinner = isJsonMode()
		? null
		: ora({
				text: `Watching job ${shortJobId(latestId)}…`,
				prefixText: "  ",
			}).start();

	const deadline = Date.now() + timeoutSec * 1000;
	try {
		while (Date.now() < deadline) {
			const next = await fetchJobs(ctx, { ownerId, limit: 5 });
			const latest = next.find((j) => j.id === latestId) ?? next[0];
			if (latest) {
				if (spinner)
					spinner.text = `status=${latest.status}  attempt=${latest.attempt}`;
				if (isTerminalCompileStatus(latest.status)) {
					if (spinner) {
						if (latest.status === "succeeded") spinner.succeed("succeeded");
						else if (latest.status === "skipped") spinner.info("skipped");
						else
							spinner.fail(
								`${latest.status}${latest.error ? ` — ${latest.error}` : ""}`,
							);
					}
					if (isJsonMode()) {
						printJson({
							ok: latest.status === "succeeded",
							scope: { tenantId: ctx.tenantId, ownerId },
							job: latest,
						});
					}
					process.exit(latest.status === "succeeded" ? 0 : 2);
				}
			}
			await new Promise((r) => setTimeout(r, DEFAULT_WATCH_INTERVAL_MS));
		}
		if (spinner) spinner.warn(`watch timeout after ${timeoutSec}s.`);
		process.exit(2);
	} catch (err) {
		if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

interface FetchArgs {
	ownerId: string | null;
	limit: number;
}

async function fetchJobs(ctx: WikiCliContext, args: FetchArgs) {
	const data = await gqlQuery(ctx.client, WikiCompileJobsDoc, {
		tenantId: ctx.tenantId,
		ownerId: args.ownerId,
		limit: args.limit,
	});
	return data.wikiCompileJobs;
}

interface RenderArgs {
	tenantSlug: string;
	scope: { agentId: string } | { tenantWide: true };
	resolveAgentName: () => Promise<Record<string, string>>;
}

async function renderJobs(
	jobs: Array<{
		id: string;
		ownerId: string;
		status: string;
		trigger: string;
		attempt: number;
		startedAt?: string | null;
		finishedAt?: string | null;
		createdAt: string;
		error?: string | null;
		metrics?: unknown;
	}>,
	args: RenderArgs,
): Promise<void> {
	if (isJsonMode()) {
		printJson({
			ok: true,
			scope:
				"agentId" in args.scope
					? { agentId: args.scope.agentId }
					: { tenantWide: true },
			jobs,
		});
		return;
	}

	if (jobs.length === 0) {
		const label =
			"agentId" in args.scope
				? `agent ${args.scope.agentId}`
				: `tenant ${args.tenantSlug}`;
		console.log(`  No recent compile jobs for ${label}.`);
		return;
	}

	const names =
		"tenantWide" in args.scope ? await args.resolveAgentName() : {};

	const rows = jobs.map((j) => ({
		id: j.id.slice(0, 8),
		agent:
			"tenantWide" in args.scope ? (names[j.ownerId] ?? j.ownerId.slice(0, 8)) : "—",
		status: j.status,
		trigger: j.trigger,
		attempt: String(j.attempt),
		duration: fmtDuration(j.startedAt, j.finishedAt),
		records: extractMetric(j.metrics, "records_read"),
		pages: extractMetric(j.metrics, "pages_upserted"),
		started: fmtIso(j.startedAt ?? j.createdAt),
	}));

	const columns: Array<{ key: keyof (typeof rows)[number]; header: string }> = [
		{ key: "id", header: "JOB" },
	];
	if ("tenantWide" in args.scope) columns.push({ key: "agent", header: "AGENT" });
	columns.push(
		{ key: "status", header: "STATUS" },
		{ key: "trigger", header: "TRIGGER" },
		{ key: "attempt", header: "TRY" },
		{ key: "duration", header: "DUR" },
		{ key: "records", header: "RECS" },
		{ key: "pages", header: "PAGES" },
		{ key: "started", header: "STARTED" },
	);

	printTable(rows, columns);
}

function toInt(v: string | number | undefined, fallback: number): number {
	if (v == null || v === "") return fallback;
	const n = typeof v === "number" ? v : Number.parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fmtIso(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fmtDuration(
	startedAt: string | null | undefined,
	finishedAt: string | null | undefined,
): string {
	if (!startedAt) return "—";
	const start = new Date(startedAt).getTime();
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
	const sec = Math.round((end - start) / 1000);
	if (sec < 60) return `${sec}s`;
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${m}m${s.toString().padStart(2, "0")}s`;
}

function extractMetric(metrics: unknown, key: string): string {
	if (!metrics || typeof metrics !== "object") return "—";
	const v = (metrics as Record<string, unknown>)[key];
	if (v == null) return "—";
	if (typeof v === "number") return String(v);
	return String(v);
}
