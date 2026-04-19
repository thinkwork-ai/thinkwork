/**
 * `thinkwork wiki compile` — enqueue a wiki compile for one agent or fan
 * out to every agent in a tenant.
 *
 * Exit codes:
 *   0  every enqueue succeeded
 *   1  scope resolution failed, or one-or-more enqueues failed
 *   2  admin access denied (resolver threw `WikiAuthError`)
 */

import ora from "ora";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson, printKeyValue } from "../../lib/output.js";
import { printError, printSuccess, printWarning } from "../../ui.js";
import {
	CompileWikiNowDoc,
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

interface JobResult {
	agentId: string;
	agentLabel: string;
	jobId: string | null;
	status: string | null;
	error: string | null;
}

export async function runWikiCompile(opts: WikiCliOptions): Promise<void> {
	const ctx = await resolveWikiContext(opts);
	const scope = await resolveAgentScope(ctx, opts, { allowAll: true });

	const targets =
		scope.mode === "single"
			? [{ id: scope.agentId, label: scope.agentLabel }]
			: scope.agentIds.map((id) => ({
					id,
					label: scope.agentLabels[id] ?? id,
				}));

	if (targets.length === 0) {
		if (isJsonMode()) {
			printJson({
				ok: true,
				scope: { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, agentIds: [] },
				jobs: [],
				errors: [],
			});
		} else {
			printWarning("No agents found for this tenant — nothing to compile.");
		}
		return;
	}

	const jobs: JobResult[] = [];
	const errors: Array<{ agentId: string; message: string }> = [];
	let forbiddenHit = false;

	for (const target of targets) {
		const spinner =
			isJsonMode() || scope.mode === "all"
				? null
				: ora({
						text: `Enqueuing compile for ${target.label}…`,
						prefixText: "  ",
					}).start();
		try {
			const data = await gqlMutate(ctx.client, CompileWikiNowDoc, {
				tenantId: ctx.tenantId,
				ownerId: target.id,
				modelId: opts.model ?? null,
			});
			const job = data.compileWikiNow;
			jobs.push({
				agentId: target.id,
				agentLabel: target.label,
				jobId: job.id,
				status: job.status,
				error: null,
			});
			if (spinner) {
				spinner.succeed(
					`${target.label}  →  job=${shortJobId(job.id)} (${job.status})`,
				);
			} else if (!isJsonMode()) {
				console.log(
					`  ✓ ${target.label}  →  job=${shortJobId(job.id)} (${job.status})`,
				);
			}
		} catch (err) {
			const classified = classifyMutationError(err);
			errors.push({ agentId: target.id, message: classified.message });
			jobs.push({
				agentId: target.id,
				agentLabel: target.label,
				jobId: null,
				status: null,
				error: classified.message,
			});
			if (spinner) spinner.fail(`${target.label}  →  ${classified.message}`);
			else if (!isJsonMode())
				console.log(`  ✗ ${target.label}  →  ${classified.message}`);

			if (classified.forbidden) {
				forbiddenHit = true;
				if (scope.mode === "all") {
					// Admin check fails identically for every agent in the scope —
					// short-circuit instead of printing N identical errors.
					break;
				}
			}
		}
	}

	const anyFailed = errors.length > 0;
	const ok = !anyFailed;

	if (isJsonMode()) {
		printJson({
			ok,
			scope: {
				tenantId: ctx.tenantId,
				tenantSlug: ctx.tenantSlug,
				mode: scope.mode,
				agentIds: targets.map((t) => t.id),
			},
			model: opts.model ?? null,
			jobs,
			errors,
		});
	} else if (scope.mode === "all") {
		console.log("");
		printKeyValue([
			["Tenant", ctx.tenantSlug],
			["Agents queued", `${jobs.filter((j) => j.jobId).length} / ${targets.length}`],
			["Failures", String(errors.length)],
			["Model override", opts.model ?? "(default)"],
		]);
	}

	if (forbiddenHit) {
		printForbiddenHint(ctx.tenantSlug);
		process.exit(2);
	}

	if (anyFailed) {
		process.exit(1);
	}

	if (!isJsonMode() && jobs.length === 1) {
		printSuccess(`Compile enqueued for ${jobs[0].agentLabel}.`);
		console.log(
			`  Use \`thinkwork wiki status --tenant ${ctx.tenantSlug} --agent ${jobs[0].agentId} --watch\` to follow the job.`,
		);
	}

	// --watch for single-agent runs
	if (opts.watch && scope.mode === "single" && jobs.length === 1 && jobs[0].jobId) {
		await watchSingleJob(ctx, {
			agentId: jobs[0].agentId,
			jobId: jobs[0].jobId,
			agentLabel: jobs[0].agentLabel,
		});
	} else if (opts.watch && scope.mode === "all") {
		printWarning(
			"--watch is ignored for --all. Use `thinkwork wiki status --tenant " +
				ctx.tenantSlug +
				" --watch` instead.",
		);
	}
}

async function watchSingleJob(
	ctx: WikiCliContext,
	target: { agentId: string; jobId: string; agentLabel: string },
): Promise<void> {
	const spinner = isJsonMode()
		? null
		: ora({
				text: `Watching job ${shortJobId(target.jobId)} for ${target.agentLabel}…`,
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
			if (!job) {
				if (spinner) spinner.warn("job not visible yet — polling…");
			} else {
				if (spinner) spinner.text = `status=${job.status}  attempt=${job.attempt}`;
				if (isTerminalCompileStatus(job.status)) {
					if (spinner) {
						if (job.status === "succeeded") spinner.succeed(`succeeded`);
						else if (job.status === "skipped") spinner.info("skipped");
						else spinner.fail(`${job.status}${job.error ? ` — ${job.error}` : ""}`);
					}
					if (isJsonMode()) {
						printJson({
							ok: job.status === "succeeded",
							jobId: job.id,
							status: job.status,
							error: job.error,
							metrics: job.metrics,
						});
					}
					process.exit(job.status === "succeeded" ? 0 : 1);
				}
			}
			await new Promise((r) => setTimeout(r, intervalMs));
		}
		if (spinner) spinner.warn("watch timeout — job still in progress.");
		process.exit(2);
	} catch (err) {
		if (spinner) spinner.fail(err instanceof Error ? err.message : String(err));
		printError("Watch failed. The compile job itself may still complete.");
		process.exit(1);
	}
}

