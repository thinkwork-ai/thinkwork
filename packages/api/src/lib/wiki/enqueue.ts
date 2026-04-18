/**
 * Post-turn wiki-compile enqueue — called best-effort by memory-retain after a
 * successful retainTurn(). Never throws; never fails the caller.
 *
 * Semantics (see .prds/compounding-memory-v1-build-plan.md PR 2):
 * - Skip silently when the tenant's `wiki_compile_enabled` flag is off.
 * - Skip silently when the active memory adapter isn't Hindsight (AgentCore
 *   can't drive a cursor in v1).
 * - Insert a compile job with a 5-minute dedupe key `${tenant}:${owner}:${bucket}`.
 *   ON CONFLICT DO NOTHING — if a job is already running or queued for this
 *   bucket, skip the async invoke.
 * - On insert, async-invoke the `wiki-compile` Lambda (InvocationType=Event).
 *   If the invoke fails, the job row still exists and can be picked up by any
 *   compile worker (lint sweep, scheduled backfill, admin trigger).
 */

import { eq } from "drizzle-orm";
import { tenants } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import { enqueueCompileJob } from "./repository.js";

export interface PostTurnCompileArgs {
	tenantId: string;
	ownerId: string;
	adapterKind: string;
}

export interface PostTurnCompileResult {
	status:
		| "skipped_flag_off"
		| "skipped_adapter"
		| "skipped_missing_inputs"
		| "skipped_tenant_not_found"
		| "deduped"
		| "enqueued"
		| "enqueued_invoke_failed"
		| "error";
	jobId?: string;
	error?: string;
}

/**
 * Best-effort: resolve enqueue conditions, insert job, attempt async invoke.
 * All errors are captured and returned as a status so callers can log without
 * throwing.
 */
export async function maybeEnqueuePostTurnCompile(
	args: PostTurnCompileArgs,
): Promise<PostTurnCompileResult> {
	if (!args.tenantId || !args.ownerId) {
		return { status: "skipped_missing_inputs" };
	}
	if (args.adapterKind !== "hindsight") {
		return { status: "skipped_adapter" };
	}

	try {
		const [tenantRow] = await db
			.select({ enabled: tenants.wiki_compile_enabled })
			.from(tenants)
			.where(eq(tenants.id, args.tenantId))
			.limit(1);

		if (!tenantRow) return { status: "skipped_tenant_not_found" };
		if (!tenantRow.enabled) return { status: "skipped_flag_off" };

		const { inserted, job } = await enqueueCompileJob({
			tenantId: args.tenantId,
			ownerId: args.ownerId,
			trigger: "memory_retain",
		});

		if (!inserted) {
			return { status: "deduped", jobId: job.id };
		}

		const invokeErr = await invokeWikiCompile(job.id).catch((err) => err);
		if (invokeErr instanceof Error) {
			return {
				status: "enqueued_invoke_failed",
				jobId: job.id,
				error: invokeErr.message,
			};
		}

		return { status: "enqueued", jobId: job.id };
	} catch (err) {
		return { status: "error", error: (err as Error)?.message ?? String(err) };
	}
}

// ---------------------------------------------------------------------------
// Async Lambda invoke (fire-and-forget). The function name follows the repo
// convention `thinkwork-${stage}-api-${handler}`; env var override wins if set
// (useful for tests and when the caller already knows the ARN).
// ---------------------------------------------------------------------------

async function invokeWikiCompile(jobId: string): Promise<void> {
	const fnName = resolveWikiCompileFunctionName();
	if (!fnName) {
		console.warn(
			"[wiki-enqueue] wiki-compile function name unresolved (no STAGE or WIKI_COMPILE_FN); skipping invoke",
		);
		return;
	}

	const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
	const lambda = new LambdaClient({});
	await lambda.send(
		new InvokeCommand({
			FunctionName: fnName,
			InvocationType: "Event",
			Payload: new TextEncoder().encode(JSON.stringify({ jobId })),
		}),
	);
}

function resolveWikiCompileFunctionName(): string | null {
	if (process.env.WIKI_COMPILE_FN) return process.env.WIKI_COMPILE_FN;
	const stage = process.env.STAGE;
	if (!stage) return null;
	return `thinkwork-${stage}-api-wiki-compile`;
}
