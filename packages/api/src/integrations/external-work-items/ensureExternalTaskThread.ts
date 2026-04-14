/**
 * Idempotent thread upsert for an external task event.
 *
 * Identity key: `(tenantId, provider, externalTaskId, connectionId)`.
 *
 * - If a matching thread exists → return it (reuses identifier/number).
 * - Otherwise → `ensureThreadForWork({ channel: "task" })` then persist the
 *   `external` metadata block so future lookups and refreshes find the row.
 *
 * Denormalized column writes (title, updated_at) happen here so the thread
 * list can show a fresh title without loading `metadata.external.latestEnvelope`.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, ensureThreadForWork } from "@thinkwork/database-pg";
import type {
	ExternalTaskEnvelope,
	TaskProvider,
} from "./types.js";

const { threads } = schema;
const db = getDb();

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
				title: args.title,
				metadata: { ...currentMeta, external: nextExternal },
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
