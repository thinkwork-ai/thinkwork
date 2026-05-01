/**
 * Draft-review writeback (U5 of plan 2026-05-01-002).
 *
 * Called from `runDraftCompileJob` after the agentic compile finishes. Owns
 * everything user-facing: creates the review thread, the workspace_run, the
 * workspace_event with the structured payload, and the announcement message.
 * Three outcomes:
 *
 *   - success (regions > 0):
 *       writes S3 sidecar (proposedBodyMd + snapshotMd + regions JSON),
 *       inserts thread + thread_turn + agent_workspace_runs row with
 *       status='awaiting_review', inserts agent_workspace_events row with
 *       payload.kind='brain_enrichment_draft_review', inserts a "draft is
 *       ready" message. The mobile thread render dispatches to the new
 *       `BrainEnrichmentDraftReviewPanel` (U4) on this payload kind.
 *
 *   - no-op (regions === 0):
 *       creates a thread that opens directly in `done` status with a
 *       "no enrichment landed" message. NO workspace_run is created — there
 *       is nothing to review.
 *
 *   - failed:
 *       creates a thread in `cancelled` status with the error message and
 *       metadata.reason='compile_failed'.
 *
 * Push notification dispatch is intentionally deferred to a follow-up; the
 * thread itself + the existing thread-list subscription are the user's
 * visibility surface for v1.
 */

import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GraphQLError } from "graphql";

import {
	agentWorkspaceEvents,
	agentWorkspaceRuns,
	agents,
	and,
	db as defaultDb,
	eq,
	messages,
	sql,
	tenants,
	threadTurns,
	threads,
} from "../../graphql/utils.js";
import type {
	DraftCompileCandidate,
	DraftCompileResult,
} from "../wiki/draft-compile.js";
import type { WikiCompileJobRow } from "../wiki/repository.js";

type DbLike = typeof defaultDb;

export type DraftWritebackTargetTable = "wiki_pages" | "tenant_entity_pages";

export interface DraftWritebackContext {
	job: WikiCompileJobRow;
	pageTable: DraftWritebackTargetTable;
	pageId: string;
	pageTitle: string;
	candidates: DraftCompileCandidate[];
}

export interface DraftWritebackIO {
	db?: DbLike;
	s3?: S3Client;
	bucket?: string;
}

export interface DraftWritebackResult {
	threadId: string;
	threadTurnId: string;
	workspaceRunId: string | null;
	reviewObjectKey: string | null;
	status: "awaiting_review" | "done" | "cancelled";
}

const PAYLOAD_KIND = "brain_enrichment_draft_review";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Success path: write the S3 sidecar + open a workspace review for the user.
 *
 * Duplicate-write protection works in two layers:
 *   - The runner (`runDraftCompileJobById`) short-circuits on succeeded /
 *     skipped / failed / running job statuses, so the writeback is invoked
 *     at most once per job in normal operation.
 *   - The `agent_workspace_events` insert uses `onConflictDoNothing` on
 *     idempotency_key=`brain-enrichment-draft:<jobId>` as defense in depth.
 *     A duplicate writeback that slips past the runner gate writes a fresh
 *     thread + workspace_run + S3 sidecar (those tables have no idempotency
 *     anchor in U5), but does not throw on the event insert — so the catch
 *     path in the runner does not synthesize a *third* failure thread on top.
 *
 * Wrapping the multi-step writes in a `db.transaction` is a known follow-up
 * (rel-2 from review run 20260501-132529-bca3799a). Today this mirrors the
 * legacy `createReviewThread` precedent — partial failures can leak orphan
 * thread/turn/run rows. The reconciler is the recovery path.
 */
export async function writeDraftReviewSuccess(args: {
	context: DraftWritebackContext;
	result: DraftCompileResult;
	io?: DraftWritebackIO;
}): Promise<DraftWritebackResult> {
	const io = args.io ?? {};
	const db = io.db ?? defaultDb;
	const bucket = io.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
	if (!bucket) {
		throw new GraphQLError("WORKSPACE_BUCKET is not configured", {
			extensions: { code: "FAILED_PRECONDITION" },
		});
	}
	const s3 = io.s3 ?? new S3Client({});

	const { tenantSlug, agentId, agentSlug } = await resolveAgentContext({
		db,
		tenantId: args.context.job.tenant_id,
		userId: args.context.job.owner_id,
	});

	const reviewId = randomUUID();
	const reviewObjectKey = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/review/brain-enrichment-draft-${reviewId}.json`;

	const payload = {
		kind: PAYLOAD_KIND as typeof PAYLOAD_KIND,
		proposedBodyMd: args.result.proposedBodyMd,
		snapshotMd: args.result.snapshotMd,
		regions: args.result.regions,
		pageTitle: args.context.pageTitle,
		targetPageTable: args.context.pageTable,
		targetPageId: args.context.pageId,
		// Snapshotted candidate input — useful for trace/diagnostics; the
		// review surface ignores it (regions carry their own provenance).
		candidates: args.context.candidates,
	};

	const put = await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: reviewObjectKey,
			Body: JSON.stringify(payload),
			ContentType: "application/json; charset=utf-8",
			Metadata: { "thinkwork-review-kind": PAYLOAD_KIND },
		}),
	);

	const { thread, turn, threadIdentifier } = await openThread({
		db,
		tenantId: args.context.job.tenant_id,
		agentId,
		userId: args.context.job.owner_id,
		title: `Review Brain enrichment draft: ${args.context.pageTitle}`,
		preview:
			args.result.regions.length === 1
				? "1 page region needs review."
				: `${args.result.regions.length} page regions need review.`,
		status: "todo",
		metadata: {
			kind: PAYLOAD_KIND,
			targetPageTable: args.context.pageTable,
			targetPageId: args.context.pageId,
			regionCount: args.result.regions.length,
			compileJobId: args.context.job.id,
		},
	});

	const [run] = await db
		.insert(agentWorkspaceRuns)
		.values({
			tenant_id: args.context.job.tenant_id,
			agent_id: agentId,
			target_path: `brain/${args.context.pageTable}/${args.context.pageId}`,
			status: "awaiting_review",
			source_object_key: reviewObjectKey,
			request_object_key: reviewObjectKey,
			current_thread_turn_id: turn.id,
			last_event_at: new Date(),
			updated_at: new Date(),
		})
		.returning({ id: agentWorkspaceRuns.id });

	// onConflictDoNothing on idempotency_key — defense in depth. The runner's
	// terminal-status short-circuit (runDraftCompileJobById's running/failed
	// guards) is the primary protection against duplicate writebacks. If a
	// duplicate slips through anyway (e.g., concurrent worker race that the
	// FOR UPDATE SKIP LOCKED claim somehow bypasses), this swallows the
	// duplicate event silently rather than throwing mid-writeback after
	// thread/turn/run have already been written.
	await db
		.insert(agentWorkspaceEvents)
		.values({
			tenant_id: args.context.job.tenant_id,
			agent_id: agentId,
			run_id: run.id,
			event_type: "review.requested",
			idempotency_key: `brain-enrichment-draft:${args.context.job.id}`,
			bucket,
			source_object_key: reviewObjectKey,
			object_etag: put.ETag ?? null,
			sequencer: reviewId,
			reason: PAYLOAD_KIND,
			payload,
			actor_type: "user",
			actor_id: args.context.job.owner_id,
		})
		.onConflictDoNothing();

	await db.insert(messages).values({
		thread_id: thread.id,
		tenant_id: args.context.job.tenant_id,
		role: "assistant",
		content: renderDraftReadyMessage({
			pageTitle: args.context.pageTitle,
			regionCount: args.result.regions.length,
		}),
		sender_type: "system",
		sender_id: args.context.job.owner_id,
		metadata: {
			kind: "brain_enrichment_draft_ready",
			compileJobId: args.context.job.id,
			workspaceRunId: run.id,
			regionCount: args.result.regions.length,
		},
	});

	return {
		threadId: thread.id,
		threadTurnId: turn.id,
		workspaceRunId: run.id,
		reviewObjectKey,
		status: "awaiting_review",
	};
}

/**
 * No-op path: model concluded the page already covers all the new facts.
 * Creates a thread that opens already-resolved (`status='done'`) so the user
 * sees a record of the run without an open review surface.
 */
export async function writeDraftReviewNoOp(args: {
	context: DraftWritebackContext;
	io?: DraftWritebackIO;
}): Promise<DraftWritebackResult> {
	const io = args.io ?? {};
	const db = io.db ?? defaultDb;
	const { agentId } = await resolveAgentContext({
		db,
		tenantId: args.context.job.tenant_id,
		userId: args.context.job.owner_id,
	});

	const { thread, turn } = await openThread({
		db,
		tenantId: args.context.job.tenant_id,
		agentId,
		userId: args.context.job.owner_id,
		title: `Brain enrichment: ${args.context.pageTitle}`,
		preview: "No enrichment landed — page already covers all facts.",
		status: "done",
		metadata: {
			kind: "brain_enrichment_draft_no_op",
			targetPageTable: args.context.pageTable,
			targetPageId: args.context.pageId,
			compileJobId: args.context.job.id,
		},
	});

	await db.insert(messages).values({
		thread_id: thread.id,
		tenant_id: args.context.job.tenant_id,
		role: "assistant",
		content: `No enrichment landed: the draft compile concluded "${args.context.pageTitle}" already covers all the new facts in the requested sources.`,
		sender_type: "system",
		sender_id: args.context.job.owner_id,
		metadata: {
			kind: "brain_enrichment_draft_no_op",
			compileJobId: args.context.job.id,
		},
	});

	// Close the turn — there's no review surface to wait on.
	await db
		.update(threadTurns)
		.set({
			status: "succeeded",
			finished_at: new Date(),
			last_activity_at: new Date(),
		})
		.where(eq(threadTurns.id, turn.id));

	return {
		threadId: thread.id,
		threadTurnId: turn.id,
		workspaceRunId: null,
		reviewObjectKey: null,
		status: "done",
	};
}

/**
 * Failure path: surface the error in a thread so the user knows the run
 * happened and didn't silently disappear. No review surface is created.
 */
export async function writeDraftReviewFailure(args: {
	context: DraftWritebackContext;
	error: string;
	io?: DraftWritebackIO;
}): Promise<DraftWritebackResult> {
	const io = args.io ?? {};
	const db = io.db ?? defaultDb;
	const { agentId } = await resolveAgentContext({
		db,
		tenantId: args.context.job.tenant_id,
		userId: args.context.job.owner_id,
	});

	const { thread, turn } = await openThread({
		db,
		tenantId: args.context.job.tenant_id,
		agentId,
		userId: args.context.job.owner_id,
		title: `Brain enrichment failed: ${args.context.pageTitle}`,
		preview: "Draft compile failed.",
		status: "cancelled",
		metadata: {
			kind: "brain_enrichment_draft_failed",
			reason: "compile_failed",
			targetPageTable: args.context.pageTable,
			targetPageId: args.context.pageId,
			compileJobId: args.context.job.id,
			error: args.error,
		},
	});

	await db.insert(messages).values({
		thread_id: thread.id,
		tenant_id: args.context.job.tenant_id,
		role: "assistant",
		content: `Draft compile for "${args.context.pageTitle}" failed: ${args.error}`,
		sender_type: "system",
		sender_id: args.context.job.owner_id,
		metadata: {
			kind: "brain_enrichment_draft_failed",
			compileJobId: args.context.job.id,
			error: args.error,
		},
	});

	await db
		.update(threadTurns)
		.set({
			status: "cancelled",
			finished_at: new Date(),
			last_activity_at: new Date(),
		})
		.where(eq(threadTurns.id, turn.id));

	return {
		threadId: thread.id,
		threadTurnId: turn.id,
		workspaceRunId: null,
		reviewObjectKey: null,
		status: "cancelled",
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveAgentContext(args: {
	db: DbLike;
	tenantId: string;
	userId: string;
}): Promise<{
	tenantSlug: string;
	agentId: string;
	agentSlug: string;
}> {
	const [tenantInfo] = await args.db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, args.tenantId))
		.limit(1);
	if (!tenantInfo) {
		throw new GraphQLError("Tenant not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}

	const [paired] = await args.db
		.select({ id: agents.id, slug: agents.slug })
		.from(agents)
		.where(
			and(
				eq(agents.tenant_id, args.tenantId),
				eq(agents.human_pair_id, args.userId),
			),
		)
		.limit(1);
	if (paired) {
		return {
			tenantSlug: tenantInfo.slug,
			agentId: paired.id,
			agentSlug: paired.slug ?? paired.id,
		};
	}

	const [fallback] = await args.db
		.select({ id: agents.id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.tenant_id, args.tenantId))
		.limit(1);
	if (!fallback) {
		throw new GraphQLError("No agent is available to host this review", {
			extensions: { code: "FAILED_PRECONDITION" },
		});
	}
	return {
		tenantSlug: tenantInfo.slug,
		agentId: fallback.id,
		agentSlug: fallback.slug ?? fallback.id,
	};
}

async function openThread(args: {
	db: DbLike;
	tenantId: string;
	agentId: string;
	userId: string;
	title: string;
	preview: string;
	status: "todo" | "done" | "cancelled";
	metadata: Record<string, unknown>;
}): Promise<{
	thread: { id: string };
	turn: { id: string };
	threadIdentifier: string;
}> {
	const [tenant] = await args.db
		.update(tenants)
		.set({ issue_counter: sql`${tenants.issue_counter} + 1` })
		.where(eq(tenants.id, args.tenantId))
		.returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
	if (!tenant) {
		throw new GraphQLError("Tenant not found", {
			extensions: { code: "NOT_FOUND" },
		});
	}
	const identifier = `API-${tenant.nextNumber}`;

	const [thread] = await args.db
		.insert(threads)
		.values({
			tenant_id: args.tenantId,
			agent_id: args.agentId,
			user_id: args.userId,
			number: tenant.nextNumber,
			identifier,
			title: args.title,
			status: args.status,
			priority: "medium",
			type: "task",
			channel: "api",
			assignee_type: "user",
			assignee_id: args.userId,
			reporter_id: args.userId,
			labels: ["brain", "enrichment", "draft"],
			last_response_preview: args.preview,
			metadata: args.metadata,
			created_by_type: "system",
			created_by_id: args.userId,
		})
		.returning({ id: threads.id });

	const [turn] = await args.db
		.insert(threadTurns)
		.values({
			tenant_id: args.tenantId,
			agent_id: args.agentId,
			invocation_source: "brain_enrichment_draft",
			trigger_detail: `brain_enrichment_draft:${args.metadata.compileJobId}`,
			thread_id: thread.id,
			status: args.status === "todo" ? "running" : "succeeded",
			kind: "agent_turn",
			started_at: new Date(),
			last_activity_at: new Date(),
		})
		.returning({ id: threadTurns.id });

	return { thread, turn, threadIdentifier: identifier };
}

function renderDraftReadyMessage(args: {
	pageTitle: string;
	regionCount: number;
}): string {
	const regionWord = args.regionCount === 1 ? "region" : "regions";
	return [
		`A draft enrichment for **${args.pageTitle}** is ready to review.`,
		"",
		`The draft has ${args.regionCount} changed ${regionWord}. Tap to review the proposed page in place, toggle accept/reject per region, or use "Show changes" to see a stacked before/after diff.`,
	].join("\n");
}
