import { and, eq, sql } from "drizzle-orm";
import {
	wikiCompileCursors,
	wikiPages,
	wikiUnresolvedMentions,
} from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../db.js";
import { runJobById } from "./compiler.js";
import {
	countWikiScope,
	enqueueCompileJob,
	type DbClient,
	type WikiCompileJobRow,
	type WikiScopeCounts,
} from "./repository.js";

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

export interface BrainDerivedCounts {
	pages: number;
	sections: number;
	links: number;
	aliases: number;
	section_sources: number;
}

export interface WikiRebuildImpact {
	wiki: WikiScopeCounts & { active_pages: number };
	brain: BrainDerivedCounts | null;
	openJobs: { pendingJobs: number; runningJobs: number };
}

export interface ScopedRebuildResetResult {
	dryRun: boolean;
	brainIncluded: boolean;
	cursorCleared: boolean;
	pagesArchived: number;
	unresolvedMentionsDeleted: number;
	brainPagesDeleted: number;
	before: WikiRebuildImpact;
	after: WikiRebuildImpact | null;
}

interface ResetArgs {
	tenantId: string;
	ownerId: string;
	includeBrain?: boolean;
	dryRun?: boolean;
	db?: DbClient;
}

export class WikiRebuildInProgressError extends Error {
	constructor(
		readonly pendingJobs: number,
		readonly runningJobs: number,
	) {
		super(
			`Refusing destructive wiki rebuild reset while ${pendingJobs} pending and ${runningJobs} running compile job(s) exist for this scope.`,
		);
		this.name = "WikiRebuildInProgressError";
	}
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

export async function inspectScopedWikiRebuildImpact(
	args: ResetArgs,
): Promise<WikiRebuildImpact> {
	const db = args.db ?? defaultDb;
	const [wiki, activePages, brain, openJobs] = await Promise.all([
		countWikiScope(args, db),
		countActiveWikiPages(args, db),
		args.includeBrain ? countBrainDerivedScope(args, db) : Promise.resolve(null),
		countOpenJobs(args, db),
	]);
	return {
		wiki: {
			...wiki,
			active_pages: activePages,
		},
		brain,
		openJobs,
	};
}

export async function resetScopedWikiRebuild(
	args: ResetArgs,
): Promise<ScopedRebuildResetResult> {
	const db = args.db ?? defaultDb;
	const includeBrain = args.includeBrain === true;
	const before = await inspectScopedWikiRebuildImpact({ ...args, includeBrain, db });
	if (args.dryRun) {
		return {
			dryRun: true,
			brainIncluded: includeBrain,
			cursorCleared: false,
			pagesArchived: 0,
			unresolvedMentionsDeleted: 0,
			brainPagesDeleted: 0,
			before,
			after: null,
		};
	}

	if (before.openJobs.pendingJobs > 0 || before.openJobs.runningJobs > 0) {
		throw new WikiRebuildInProgressError(
			before.openJobs.pendingJobs,
			before.openJobs.runningJobs,
		);
	}

	let pagesArchived = 0;
	let unresolvedMentionsDeleted = 0;
	let brainPagesDeleted = 0;
	await runTransaction(db, async (tx) => {
		const mentions = await tx
			.delete(wikiUnresolvedMentions)
			.where(
				and(
					eq(wikiUnresolvedMentions.tenant_id, args.tenantId),
					eq(wikiUnresolvedMentions.owner_id, args.ownerId),
				),
			)
			.returning({ id: wikiUnresolvedMentions.id });
		unresolvedMentionsDeleted = mentions.length;

		const pages = await tx
			.update(wikiPages)
			.set({ status: "archived", updated_at: sql`now()` as any })
			.where(
				and(
					eq(wikiPages.tenant_id, args.tenantId),
					eq(wikiPages.owner_id, args.ownerId),
					eq(wikiPages.status, "active"),
				),
			)
			.returning({ id: wikiPages.id });
		pagesArchived = pages.length;

		await tx
			.delete(wikiCompileCursors)
			.where(
				and(
					eq(wikiCompileCursors.tenant_id, args.tenantId),
					eq(wikiCompileCursors.owner_id, args.ownerId),
				),
			);

		if (includeBrain) {
			brainPagesDeleted = await deleteBrainDerivedScope(args, tx);
		}
	});

	const after = await inspectScopedWikiRebuildImpact({ ...args, includeBrain, db });
	return {
		dryRun: false,
		brainIncluded: includeBrain,
		cursorCleared: true,
		pagesArchived,
		unresolvedMentionsDeleted,
		brainPagesDeleted,
		before,
		after,
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

async function countActiveWikiPages(
	args: { tenantId: string; ownerId: string },
	db: DbClient,
): Promise<number> {
	const result = await db.execute(sql`
		SELECT COUNT(*)::int AS n
		FROM wiki.pages
		WHERE tenant_id = ${args.tenantId}
		  AND owner_id = ${args.ownerId}
		  AND status = 'active'
	`);
	return Number(((result as any).rows?.[0] ?? {}).n ?? 0);
}

async function countBrainDerivedScope(
	args: { tenantId: string },
	db: DbClient,
): Promise<BrainDerivedCounts> {
	const result = await db.execute(sql`
		WITH tenant_pages AS (
			SELECT id
			FROM brain.pages
			WHERE tenant_id = ${args.tenantId}
		)
		SELECT
			(SELECT COUNT(*)::int FROM tenant_pages) AS pages,
			(SELECT COUNT(*)::int FROM brain.page_sections s INNER JOIN tenant_pages p ON p.id = s.page_id) AS sections,
			(SELECT COUNT(*)::int FROM brain.page_links l INNER JOIN tenant_pages p ON p.id = l.from_page_id) AS links,
			(SELECT COUNT(*)::int FROM brain.page_aliases a INNER JOIN tenant_pages p ON p.id = a.page_id) AS aliases,
			(
				SELECT COUNT(*)::int
				FROM brain.section_sources ss
				INNER JOIN brain.page_sections s ON s.id = ss.section_id
				INNER JOIN tenant_pages p ON p.id = s.page_id
			) AS section_sources
	`);
	const row = (result as any).rows?.[0] ?? {};
	return {
		pages: Number(row.pages ?? 0),
		sections: Number(row.sections ?? 0),
		links: Number(row.links ?? 0),
		aliases: Number(row.aliases ?? 0),
		section_sources: Number(row.section_sources ?? 0),
	};
}

async function deleteBrainDerivedScope(
	args: { tenantId: string },
	db: DbClient,
): Promise<number> {
	await db.execute(sql`
		DELETE FROM brain.section_sources ss
		USING brain.page_sections s, brain.pages p
		WHERE ss.section_id = s.id
		  AND s.page_id = p.id
		  AND p.tenant_id = ${args.tenantId}
	`);
	const result = await db.execute(sql`
		DELETE FROM brain.pages
		WHERE tenant_id = ${args.tenantId}
		RETURNING id
	`);
	return ((result as any).rows ?? []).length;
}

async function runTransaction(
	db: DbClient,
	fn: (tx: DbClient) => Promise<void>,
): Promise<void> {
	if ("transaction" in db && typeof (db as any).transaction === "function") {
		await (db as any).transaction(fn);
		return;
	}
	await fn(db);
}
