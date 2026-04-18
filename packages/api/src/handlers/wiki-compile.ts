/**
 * wiki-compile Lambda handler.
 *
 * Invoked by memory-retain (fire-and-forget after a turn) or by admin
 * mutations (compileWikiNow, lint promotion sweep). Runs one compile job per
 * invocation — either the job whose id is in the event payload, or the next
 * pending job if none is specified.
 *
 * This handler never throws. Errors flow back as `{ ok: false, error }` so
 * the retry queue can decide what to do without a CloudWatch alarm storm.
 */

import { runCompileJob, runJobById } from "../lib/wiki/compiler.js";
import { claimNextCompileJob } from "../lib/wiki/repository.js";

type WikiCompileEvent = {
	jobId?: string;
};

type WikiCompileResult = {
	ok: boolean;
	jobId?: string;
	status?: "succeeded" | "failed" | "no_job" | "already_done";
	metrics?: unknown;
	error?: string;
};

export async function handler(
	event: WikiCompileEvent = {},
): Promise<WikiCompileResult> {
	try {
		if (event?.jobId) {
			const result = await runJobById(event.jobId);
			if (!result) {
				return { ok: true, jobId: event.jobId, status: "already_done" };
			}
			return {
				ok: result.status === "succeeded",
				jobId: result.jobId,
				status: result.status,
				metrics: result.metrics,
				error: result.error,
			};
		}

		const claimed = await claimNextCompileJob();
		if (!claimed) {
			return { ok: true, status: "no_job" };
		}
		const result = await runCompileJob(claimed);
		return {
			ok: result.status === "succeeded",
			jobId: result.jobId,
			status: result.status,
			metrics: result.metrics,
			error: result.error,
		};
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		console.error(`[wiki-compile] unexpected error: ${msg}`);
		return { ok: false, error: msg };
	}
}
