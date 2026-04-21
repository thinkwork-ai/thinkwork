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
import {
	loadGooglePlacesClientFromSsm,
	type GooglePlacesClient,
} from "../lib/wiki/google-places-client.js";

// Pre-warm the Google Places client on cold start so the "initialized" vs
// "key missing" log line lands immediately instead of at first compile.
// The call is idempotent and caches at module scope — warm invocations
// hit the cache without SSM or KMS traffic. A null return is fine: the
// compile pipeline degrades gracefully to metadata-only place rows.
let googlePlacesClientReady: Promise<GooglePlacesClient | null> | null = null;
function primeGooglePlacesClient(): Promise<GooglePlacesClient | null> {
	if (!googlePlacesClientReady) {
		googlePlacesClientReady = loadGooglePlacesClientFromSsm().catch((err) => {
			console.warn(
				`[wiki-compile] google places init error: ${(err as Error)?.message || err}`,
			);
			return null;
		});
	}
	return googlePlacesClientReady;
}

type WikiCompileEvent = {
	jobId?: string;
	/**
	 * Optional Bedrock model override for this invocation. Threads through
	 * to the planner, aggregation planner, and section writer so the whole
	 * pipeline for this job lands on the same model. Leave unset to use the
	 * Lambda's BEDROCK_MODEL_ID env (or the code default).
	 */
	modelId?: string;
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
		const googlePlacesClient = await primeGooglePlacesClient();
		const opts = {
			...(event.modelId ? { modelId: event.modelId } : {}),
			googlePlacesClient,
		};
		if (event?.jobId) {
			const result = await runJobById(event.jobId, opts);
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
		const result = await runCompileJob(claimed, opts);
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
