/**
 * Idempotent thread upsert for an external task event.
 *
 * Identity key: `(tenantId, provider, externalTaskId, connectionId)`.
 *
 * - If a matching thread exists → return it (reuses identifier/number).
 * - Otherwise → `ensureThreadForWork({ channel: "task" })` then persist the
 *   `external` metadata block so future lookups and refreshes find the row.
 *
 * Denormalized column writes (title, status, priority, due_at, description,
 * assignee, updated_at) happen here so the Tasks tab list query can render
 * a fresh row without loading `metadata.external.latestEnvelope`.
 *
 * Assignee is always the human (`assignee_type="user"`) — external tasks are
 * Human-in-the-Loop work. `agent_id` is set to the user's per-provider opt-in
 * (`connections.metadata.{provider}.default_agent_id`) so chat in the task
 * thread wakes up the user's chosen assistant.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, ensureThreadForWork } from "@thinkwork/database-pg";
import type {
	ExternalTaskEnvelope,
	TaskProvider,
} from "./types.js";

const { threads } = schema;
const db = getDb();

const VALID_THREAD_STATUSES = new Set([
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"blocked",
	"done",
	"cancelled",
]);

const VALID_THREAD_PRIORITIES = new Set([
	"low",
	"medium",
	"high",
	"urgent",
	"critical",
]);

function mapStatusToThread(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return VALID_THREAD_STATUSES.has(value) ? value : undefined;
}

function mapPriorityToThread(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value === "normal") return "medium";
	return VALID_THREAD_PRIORITIES.has(value) ? value : undefined;
}

type DenormalizedFields = {
	description?: string | null;
	due_at?: Date | null;
	status?: string;
	priority?: string;
};

function denormalizeFromEnvelope(
	envelope: ExternalTaskEnvelope | undefined,
): DenormalizedFields {
	if (!envelope) return {};
	const core = envelope.item.core;
	const out: DenormalizedFields = {
		description: core.description ?? null,
		due_at: core.dueAt ? new Date(core.dueAt) : null,
	};
	const status = mapStatusToThread(core.status?.value);
	if (status) out.status = status;
	const priority = mapPriorityToThread(core.priority?.value);
	if (priority) out.priority = priority;
	return out;
}

export type ExternalThreadMeta = {
	provider: TaskProvider;
	externalTaskId: string;
	connectionId: string;
	providerId: string;
	providerUserId?: string;
	latestEnvelope?: ExternalTaskEnvelope;
	createdAt?: string;
	lastUpdatedAt?: string;
};

export type EnsureExternalTaskThreadArgs = {
	tenantId: string;
	provider: TaskProvider;
	externalTaskId: string;
	connectionId: string;
	providerId: string;
	providerUserId?: string;
	userId?: string;
	/** User-opt-in agent (from connections.metadata.{provider}.default_agent_id). */
	defaultAgentId?: string;
	title: string;
	envelope?: ExternalTaskEnvelope;
};

export type EnsureExternalTaskThreadResult = {
	threadId: string;
	created: boolean;
};

export async function ensureExternalTaskThread(
	args: EnsureExternalTaskThreadArgs,
): Promise<EnsureExternalTaskThreadResult> {
	const existing = await db
		.select({ id: threads.id, metadata: threads.metadata })
		.from(threads)
		.where(
			and(
				eq(threads.tenant_id, args.tenantId),
				sql`${threads.metadata}->'external'->>'provider' = ${args.provider}`,
				sql`${threads.metadata}->'external'->>'externalTaskId' = ${args.externalTaskId}`,
				sql`${threads.metadata}->'external'->>'connectionId' = ${args.connectionId}`,
			),
		)
		.limit(1);

	const denorm = denormalizeFromEnvelope(args.envelope);

	if (existing.length > 0) {
		const [row] = existing;
		const currentMeta = (row.metadata ?? {}) as Record<string, unknown>;
		const currentExternal = (currentMeta.external ?? {}) as Partial<ExternalThreadMeta>;
		const nextExternal: ExternalThreadMeta = {
			...currentExternal,
			provider: args.provider,
			externalTaskId: args.externalTaskId,
			connectionId: args.connectionId,
			providerId: args.providerId,
			providerUserId: args.providerUserId ?? currentExternal.providerUserId,
			latestEnvelope: args.envelope ?? currentExternal.latestEnvelope,
			lastUpdatedAt: new Date().toISOString(),
		};
		await db
			.update(threads)
			.set({
				// Only overwrite the existing title when we have a rich
				// envelope — that's the only path where `args.title` is
				// authoritative. Without an envelope, `args.title` is the
				// ingestEvent fallback (either the raw webhook task.title or
				// the `External task <id>` placeholder) and would clobber a
				// better title that another code path (e.g. outbound
				// syncExternalTaskOnCreate) already wrote onto the row.
				...(args.envelope ? { title: args.title } : {}),
				metadata: { ...currentMeta, external: nextExternal },
				// Self-heal assignee on every upsert so pre-Phase-A threads recover.
				...(args.userId
					? { assignee_type: "user", assignee_id: args.userId }
					: {}),
				...(args.envelope
					? {
							description: denorm.description ?? null,
							due_at: denorm.due_at ?? null,
							...(denorm.status ? { status: denorm.status } : {}),
							...(denorm.priority ? { priority: denorm.priority } : {}),
						}
					: {}),
				updated_at: new Date(),
			})
			.where(eq(threads.id, row.id));
		return { threadId: row.id, created: false };
	}

	const { threadId } = await ensureThreadForWork({
		tenantId: args.tenantId,
		userId: args.userId,
		title: args.title,
		channel: "task",
	});

	const nowIso = new Date().toISOString();
	const externalMeta: ExternalThreadMeta = {
		provider: args.provider,
		externalTaskId: args.externalTaskId,
		connectionId: args.connectionId,
		providerId: args.providerId,
		providerUserId: args.providerUserId,
		latestEnvelope: args.envelope,
		createdAt: nowIso,
		lastUpdatedAt: nowIso,
	};

	await db
		.update(threads)
		.set({
			metadata: { external: externalMeta },
			...(args.userId
				? { assignee_type: "user", assignee_id: args.userId }
				: {}),
			...(args.defaultAgentId ? { agent_id: args.defaultAgentId } : {}),
			...(args.envelope
				? {
						description: denorm.description ?? null,
						due_at: denorm.due_at ?? null,
						...(denorm.status ? { status: denorm.status } : {}),
						...(denorm.priority ? { priority: denorm.priority } : {}),
					}
				: {}),
			updated_at: new Date(),
		})
		.where(eq(threads.id, threadId));

	return { threadId, created: true };
}

export async function closeExternalTaskThread(args: {
	tenantId: string;
	provider: TaskProvider;
	externalTaskId: string;
	connectionId: string;
	reason: string;
}): Promise<string | null> {
	const [row] = await db
		.select({ id: threads.id })
		.from(threads)
		.where(
			and(
				eq(threads.tenant_id, args.tenantId),
				sql`${threads.metadata}->'external'->>'provider' = ${args.provider}`,
				sql`${threads.metadata}->'external'->>'externalTaskId' = ${args.externalTaskId}`,
				sql`${threads.metadata}->'external'->>'connectionId' = ${args.connectionId}`,
			),
		)
		.limit(1);
	if (!row) return null;

	await db
		.update(threads)
		.set({
			status: "done",
			closed_at: new Date(),
			updated_at: new Date(),
		})
		.where(eq(threads.id, row.id));

	return row.id;
}
