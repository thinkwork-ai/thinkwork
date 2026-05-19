/**
 * `thinkwork wiki rebuild` — destructive: archive an agent's active wiki
 * pages and enqueue a fresh compile. Runs `resetWikiCursor(force=true)`
 * then `compileWikiNow` in sequence.
 *
 * Single-agent only. --all is intentionally rejected.
 *
 * Exit codes:
 *   0  archive + enqueue both succeeded
 *   1  either step failed (with a clear message; if reset succeeded but
 *      compile failed, the message points at the follow-up compile cmd)
 *   2  admin access denied
 */

import { confirm } from "@inquirer/prompts";
import ora from "ora";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, printJson, printKeyValue } from "../../lib/output.js";
import { printError, printSuccess, printWarning } from "../../ui.js";
import {
	CompileWikiNowDoc,
	ResetWikiCursorDoc,
	WikiCompileJobsDoc,
} from "./gql.js";
import {
	classifyMutationError,
	isTerminalCompileStatus,
	printForbiddenHint,
	resolveAgentScope,
	resolveWikiContext,
	shortJobId,
	type WikiCliContext,
	type WikiCliOptions,
} from "./helpers.js";

interface RebuildJson {
	ok: boolean;
	scope: { tenantId: string; tenantSlug: string; agentId: string };
	pagesArchived: number | null;
	brainPagesDeleted: number | null;
	jobId: string | null;
	dryRun: boolean;
	brainIncluded: boolean;
	impact: unknown | null;
	error: string | null;
}

export async function runWikiRebuild(opts: WikiCliOptions): Promise<void> {
	if (opts.all) {
		printError(
			"--all is not supported for rebuild. Rebuild one agent at a time to avoid mass-archiving pages across the tenant.",
		);
		process.exit(1);
	}

	const ctx = await resolveWikiContext(opts);
	const scope = await resolveAgentScope(ctx, opts, { allowAll: false });
	if (scope.mode !== "single") {
		// resolveAgentScope with allowAll:false never returns mode=all, but
		// belt-and-suspenders for exhaustive narrowing.
		printError("rebuild requires a single agent.");
		process.exit(1);
	}

	const { agentId, agentLabel } = scope;

	// Confirm unless --yes or --json (JSON mode is scripted and should not
	// hang on a prompt).
	const dryRun = opts.dryRun === true;
	const includeBrain = opts.includeBrain === true;
	const skipConfirm = dryRun || opts.yes === true || isJsonMode();
	if (!skipConfirm) {
		if (!isInteractive()) {
			requireTty("Rebuild confirmation (--yes)");
		}
		const ok = await promptOrExit(() =>
			confirm({
				message: `Rebuild wiki for ${agentLabel}? This archives every active page in the scope${includeBrain ? " and deletes tenant Brain derived rows" : ""}, then recompiles from scratch.`,
				default: false,
			}),
		);
		if (!ok) {
			if (!isJsonMode()) console.log("  Cancelled.");
			process.exit(0);
		}
	}

	// ── Step 1: reset cursor + archive active pages ───────────────────────────
	const resetSpinner = isJsonMode()
		? null
		: ora({
				text: `Archiving active pages for ${agentLabel}…`,
				prefixText: "  ",
			}).start();
	let pagesArchived = 0;
	let brainPagesDeleted = 0;
	let resetImpact: unknown | null = null;
	try {
		const data = await gqlMutate(ctx.client, ResetWikiCursorDoc, {
			tenantId: ctx.tenantId,
			ownerId: agentId,
			force: true,
			dryRun,
			includeBrain,
		});
		pagesArchived = data.resetWikiCursor.pagesArchived;
		brainPagesDeleted = extractImpactNumber(
			data.resetWikiCursor.impact,
			"brainPagesDeleted",
		);
		resetImpact = data.resetWikiCursor.impact ?? null;
		if (resetSpinner) {
			if (dryRun) resetSpinner.succeed("Dry-run impact report generated.");
			else {
				resetSpinner.succeed(
					`${pagesArchived} page${pagesArchived === 1 ? "" : "s"} archived, cursor cleared.`,
				);
			}
		}
	} catch (err) {
		const classified = classifyMutationError(err);
		if (resetSpinner) resetSpinner.fail(`Reset failed: ${classified.message}`);
		const result: RebuildJson = {
			ok: false,
			scope: {
				tenantId: ctx.tenantId,
				tenantSlug: ctx.tenantSlug,
				agentId,
			},
			pagesArchived: null,
			brainPagesDeleted: null,
			jobId: null,
			dryRun,
			brainIncluded: includeBrain,
			impact: null,
			error: classified.message,
		};
		if (isJsonMode()) printJson(result);
		if (classified.forbidden) {
			printForbiddenHint(ctx.tenantSlug);
			process.exit(2);
		}
		process.exit(1);
	}

	if (dryRun) {
		const result: RebuildJson = {
			ok: true,
			scope: {
				tenantId: ctx.tenantId,
				tenantSlug: ctx.tenantSlug,
				agentId,
			},
			pagesArchived,
			brainPagesDeleted,
			jobId: null,
			dryRun: true,
			brainIncluded: includeBrain,
			impact: resetImpact,
			error: null,
		};
		if (isJsonMode()) printJson(result);
		else renderImpact(resetImpact, { tenantSlug: ctx.tenantSlug, agentLabel });
		process.exit(0);
	}

	// ── Step 2: enqueue compile (reset has already committed) ────────────────
	const compileSpinner = isJsonMode()
		? null
		: ora({
				text: `Enqueuing fresh compile for ${agentLabel}…`,
				prefixText: "  ",
			}).start();
	let jobId: string | null = null;
	try {
		const data = await gqlMutate(ctx.client, CompileWikiNowDoc, {
			tenantId: ctx.tenantId,
			ownerId: agentId,
			modelId: opts.model ?? null,
			forceNew: true,
		});
		jobId = data.compileWikiNow.id;
		if (compileSpinner)
			compileSpinner.succeed(
				`Compile enqueued — job=${shortJobId(jobId)}  status=${data.compileWikiNow.status}`,
			);
	} catch (err) {
		const classified = classifyMutationError(err);
		if (compileSpinner)
			compileSpinner.fail(`Compile enqueue failed: ${classified.message}`);
		const result: RebuildJson = {
			ok: false,
			scope: {
				tenantId: ctx.tenantId,
				tenantSlug: ctx.tenantSlug,
				agentId,
			},
			pagesArchived,
			brainPagesDeleted,
			jobId: null,
			dryRun: false,
			brainIncluded: includeBrain,
			impact: resetImpact,
			error: classified.message,
		};
		if (isJsonMode()) printJson(result);
		else {
			printWarning(
				`Reset succeeded (${pagesArchived} page${pagesArchived === 1 ? "" : "s"} archived) but compile enqueue failed. Retry with:\n  thinkwork wiki compile --tenant ${ctx.tenantSlug} --agent ${agentId}`,
			);
		}
		if (classified.forbidden) {
			printForbiddenHint(ctx.tenantSlug);
			process.exit(2);
		}
		process.exit(1);
	}

	// ── Done ─────────────────────────────────────────────────────────────────
	const result: RebuildJson = {
		ok: true,
		scope: {
			tenantId: ctx.tenantId,
			tenantSlug: ctx.tenantSlug,
			agentId,
		},
		pagesArchived,
		brainPagesDeleted,
		jobId,
		dryRun: false,
		brainIncluded: includeBrain,
		impact: resetImpact,
		error: null,
	};
	if (isJsonMode()) {
		printJson(result);
	} else {
		console.log("");
		printKeyValue([
			["Tenant", ctx.tenantSlug],
			["Agent", agentLabel],
			["Pages archived", String(pagesArchived)],
			["Brain pages deleted", includeBrain ? String(brainPagesDeleted) : "—"],
			["Compile job", jobId ?? "—"],
			["Model override", opts.model ?? "(default)"],
		]);
		printSuccess(`Rebuild enqueued for ${agentLabel}.`);
	}

	if (opts.watch && jobId) {
		await watchRebuildJob(ctx, { agentId, jobId, agentLabel });
	}
}

function renderImpact(
	impact: unknown,
	args: { tenantSlug: string; agentLabel: string },
): void {
	const before = readObject(readObject(impact, "before"), "wiki");
	const brain = readObject(readObject(impact, "before"), "brain");
	const openJobs = readObject(readObject(impact, "before"), "openJobs");
	console.log("");
	printKeyValue([
		["Tenant", args.tenantSlug],
		["Agent", args.agentLabel],
		["Dry run", "yes"],
		["Active wiki pages", metric(before, "active_pages")],
		["Wiki sections", metric(before, "sections")],
		["Wiki links", metric(before, "links")],
		["Wiki aliases", metric(before, "aliases")],
		["Unresolved mentions", metric(before, "unresolved_mentions")],
		["Cursor present", metric(before, "has_cursor")],
		["Pending jobs", metric(openJobs, "pendingJobs")],
		["Running jobs", metric(openJobs, "runningJobs")],
		["Brain pages", brain ? metric(brain, "pages") : "not included"],
		["Brain sections", brain ? metric(brain, "sections") : "not included"],
		[
			"Brain section sources",
			brain ? metric(brain, "section_sources") : "not included",
		],
	]);
	printWarning("Dry run only. Re-run with --yes to archive/reset and enqueue.");
}

function extractImpactNumber(impact: unknown, key: string): number {
	const value = readObject(impact)?.[key];
	return typeof value === "number" ? value : 0;
}

function metric(obj: Record<string, unknown> | null, key: string): string {
	if (!obj) return "—";
	const value = obj[key];
	if (value == null) return "—";
	return String(value);
}

function readObject(value: unknown, key?: string): Record<string, unknown> | null {
	const target =
		key && value && typeof value === "object"
			? (value as Record<string, unknown>)[key]
			: value;
	return target && typeof target === "object"
		? (target as Record<string, unknown>)
		: null;
}

async function watchRebuildJob(
	ctx: WikiCliContext,
	target: { agentId: string; jobId: string; agentLabel: string },
): Promise<void> {
	const spinner = isJsonMode()
		? null
		: ora({
				text: `Watching rebuild job ${shortJobId(target.jobId)}…`,
				prefixText: "  ",
			}).start();
	const intervalMs = 3000;
	const deadline = Date.now() + 15 * 60 * 1000;
	try {
		while (Date.now() < deadline) {
			const data = await gqlQuery(ctx.client, WikiCompileJobsDoc, {
				tenantId: ctx.tenantId,
				ownerId: target.agentId,
				limit: 5,
			});
			const job = data.wikiCompileJobs.find((j) => j.id === target.jobId);
			if (job) {
				if (spinner) spinner.text = `status=${job.status}  attempt=${job.attempt}`;
				if (isTerminalCompileStatus(job.status)) {
					if (spinner) {
						if (job.status === "succeeded") spinner.succeed("rebuild succeeded");
						else if (job.status === "skipped") spinner.info("rebuild skipped");
						else spinner.fail(`${job.status}${job.error ? ` — ${job.error}` : ""}`);
					}
					process.exit(job.status === "succeeded" ? 0 : 1);
				}
			}
			await new Promise((r) => setTimeout(r, intervalMs));
		}
		if (spinner) spinner.warn("watch timeout — rebuild still in progress.");
		process.exit(2);
	} catch (err) {
		if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
