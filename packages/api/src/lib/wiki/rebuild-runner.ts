import { sql } from "drizzle-orm";

import { db as defaultDb } from "../db.js";
import { runJobById } from "./compiler.js";
import { enqueueCompileJob, type DbClient, type WikiCompileJobRow } from "./repository.js";

export interface WikiRebuildDrainResult {
	enqueuedJobId: string | null;
	jobsRun: number;
	failedJobId: string | null;
	pendingJobs: number;
	runningJobs: number;
}

interface DrainArgs {
	tenantId: string;
	ownerId: string;
	trigger?: "bootstrap_import" | "admin";
	maxJobs?: number;
	db?: DbClient;
}

export async function enqueueAndDrainWikiRebuild(
	args: DrainArgs,
): Promise<WikiRebuildDrainResult> {
	const db = args.db ?? defaultDb;
	const { job } = await enqueueCompileJob(
		{
			tenantId: args.tenantId,
			ownerId: args.ownerId,
			trigger: args.trigger ?? "bootstrap_import",
		},
		db,
	);
	const drained = await drainWikiCompileScope({
		...args,
		db,
	});
	return {
		...drained,
		enqueuedJobId: job.id,
	};
}

export async function drainWikiCompileScope(
	args: DrainArgs,
): Promise<WikiRebuildDrainResult> {
	const db = args.db ?? defaultDb;
	const maxJobs = Math.max(1, args.maxJobs ?? 50);
	let jobsRun = 0;
	let failedJobId: string | null = null;

	while (jobsRun < maxJobs) {
		const failed = await latestFailedJob(args, db);
		if (failed) {
			failedJobId = failed.id;
			break;
		}

		const pending = await nextPendingJob(args, db);
		if (!pending) break;

		const result = await runJobById(pending.id);
		jobsRun += 1;
		if (result?.status === "failed") {
			failedJobId = pending.id;
			break;
		}
	}

	const { pendingJobs, runningJobs } = await countOpenJobs(args, db);
	return {
		enqueuedJobId: null,
		jobsRun,
		failedJobId,
		pendingJobs,
		runningJobs,
	};
}

async function nextPendingJob(
	args: { tenantId: string; ownerId: string },
	db: DbClient,
): Promise<WikiCompileJobRow | null> {
	const result = await db.execute(sql`
		SELECT *
		FROM wiki.compile_jobs
		WHERE tenant_id = ${args.tenantId}
		  AND owner_id = ${args.ownerId}
		  AND status = 'pending'
		ORDER BY created_at ASC
		LIMIT 1
	`);
	return ((result as any).rows?.[0] ?? null) as WikiCompileJobRow | null;
}

async function latestFailedJob(
	args: { tenantId: string; ownerId: string },
	db: DbClient,
): Promise<WikiCompileJobRow | null> {
	const result = await db.execute(sql`
		SELECT *
		FROM wiki.compile_jobs
		WHERE tenant_id = ${args.tenantId}
		  AND owner_id = ${args.ownerId}
		  AND status = 'failed'
		ORDER BY finished_at DESC NULLS LAST, created_at DESC
		LIMIT 1
	`);
	return ((result as any).rows?.[0] ?? null) as WikiCompileJobRow | null;
}

async function countOpenJobs(
	args: { tenantId: string; ownerId: string },
	db: DbClient,
): Promise<{ pendingJobs: number; runningJobs: number }> {
	const result = await db.execute(sql`
		SELECT
			COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_jobs,
			COUNT(*) FILTER (WHERE status = 'running')::int AS running_jobs
		FROM wiki.compile_jobs
		WHERE tenant_id = ${args.tenantId}
		  AND owner_id = ${args.ownerId}
		  AND status IN ('pending', 'running')
	`);
	const row = (result as any).rows?.[0] ?? {};
	return {
		pendingJobs: Number(row.pending_jobs ?? 0),
		runningJobs: Number(row.running_jobs ?? 0),
	};
}
