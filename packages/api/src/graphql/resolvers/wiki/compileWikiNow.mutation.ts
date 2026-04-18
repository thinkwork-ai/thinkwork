/**
 * compileWikiNow — admin-only: ad-hoc enqueue of a compile job for a
 * specific (tenant, agent). Returns the job row so the admin UI can poll.
 *
 * Semantics match the post-turn enqueue path: dedupe on the 5-minute
 * bucket, fire-and-forget invoke of `wiki-compile` Lambda, never fail.
 */

import type { GraphQLContext } from "../../context.js";
import { enqueueCompileJob } from "../../../lib/wiki/repository.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface CompileWikiNowArgs {
	tenantId: string;
	ownerId: string;
}

export const compileWikiNow = async (
	_parent: unknown,
	args: CompileWikiNowArgs,
	ctx: GraphQLContext,
) => {
	await assertCanAdminWikiScope(ctx, args);

	const { job } = await enqueueCompileJob({
		tenantId: args.tenantId,
		ownerId: args.ownerId,
		trigger: "admin",
	});

	// Best-effort invoke of the compile Lambda. We don't await because the
	// dedupe job row gives us our idempotency guarantee; the Lambda handler
	// can also pick it up via claimNextCompileJob if this invoke fails.
	invokeWikiCompile(job.id).catch((err) => {
		console.warn(
			`[compileWikiNow] invoke failed (job will be picked up by worker): ${(err as Error)?.message}`,
		);
	});

	return {
		id: job.id,
		tenantId: job.tenant_id,
		ownerId: job.owner_id,
		status: job.status,
		trigger: job.trigger,
		dedupeKey: job.dedupe_key,
		attempt: job.attempt,
		claimedAt: job.claimed_at?.toISOString() ?? null,
		startedAt: job.started_at?.toISOString() ?? null,
		finishedAt: job.finished_at?.toISOString() ?? null,
		error: job.error,
		metrics: job.metrics,
		createdAt: job.created_at.toISOString(),
	};
};

async function invokeWikiCompile(jobId: string): Promise<void> {
	const fnName =
		process.env.WIKI_COMPILE_FN ??
		(process.env.STAGE
			? `thinkwork-${process.env.STAGE}-api-wiki-compile`
			: null);
	if (!fnName) return;
	const { LambdaClient, InvokeCommand } = await import(
		"@aws-sdk/client-lambda"
	);
	const lambda = new LambdaClient({});
	await lambda.send(
		new InvokeCommand({
			FunctionName: fnName,
			InvocationType: "Event",
			Payload: new TextEncoder().encode(JSON.stringify({ jobId })),
		}),
	);
}
