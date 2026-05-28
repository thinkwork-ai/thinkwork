import { GraphQLError } from "graphql";
import { getTableColumns } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  asc,
  desc,
  sql,
  threads,
  threadParticipants,
  threadToCamel,
} from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";

const threadColumns = getTableColumns(threads);

export interface ThreadPinCaller {
  tenantId: string;
  userId: string;
}

export async function requireThreadPinCaller(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<ThreadPinCaller> {
  if (ctx.auth?.authType !== "cognito") {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const callerTenantId = await resolveCallerTenantId(ctx);
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerTenantId || !callerUserId || callerTenantId !== tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  return { tenantId: callerTenantId, userId: callerUserId };
}

export async function loadVisibleThreadForPin(input: {
  tenantId: string;
  callerUserId: string;
  threadId: string;
}) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
        callerVisibleThreadPredicate(input.tenantId, input.callerUserId),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new GraphQLError("Thread not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  return thread;
}

export async function ensureUserThreadParticipant(input: {
  tenantId: string;
  userId: string;
  thread: any;
}) {
  const [existing] = await db
    .select({ id: threadParticipants.id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.thread_id, input.thread.id),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.userId),
      ),
    )
    .limit(1);

  if (existing) return existing.id as string;

  await db
    .insert(threadParticipants)
    .values({
      tenant_id: input.tenantId,
      thread_id: input.thread.id,
      space_id: input.thread.space_id,
      participant_type: "user",
      user_id: input.userId,
      role: input.thread.user_id === input.userId ? "requester" : "member",
      source: "thread_pin",
      notification_preference: "subscribed",
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflictDoNothing();

  const [created] = await db
    .select({ id: threadParticipants.id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.thread_id, input.thread.id),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.userId),
      ),
    )
    .limit(1);

  if (!created) {
    throw new GraphQLError("Thread participant required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  return created.id as string;
}

export async function nextPinOrder(input: ThreadPinCaller) {
  const [row] = await db
    .select({
      maxOrder: sql<number>`COALESCE(MAX(${threadParticipants.pin_order}), 0)::int`,
    })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.userId),
        sql`${threadParticipants.pinned_at} IS NOT NULL`,
      ),
    );

  return (row?.maxOrder ?? 0) + 1;
}

export async function loadPinnedThreads(input: ThreadPinCaller & {
  limit?: number | null;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 0), 100);
  if (limit === 0) return [];

  const rows = await db
    .select({
      ...threadColumns,
      pinned_at: threadParticipants.pinned_at,
      pin_order: threadParticipants.pin_order,
    })
    .from(threadParticipants)
    .innerJoin(
      threads,
      and(
        eq(threads.tenant_id, threadParticipants.tenant_id),
        eq(threads.id, threadParticipants.thread_id),
      ),
    )
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.userId),
        sql`${threadParticipants.pinned_at} IS NOT NULL`,
        sql`${threads.archived_at} IS NULL`,
        callerVisibleThreadPredicate(input.tenantId, input.userId),
      ),
    )
    .orderBy(
      asc(threadParticipants.pin_order),
      desc(threadParticipants.pinned_at),
    )
    .limit(limit);

  return rows.map(rowToPinnedThread);
}

export async function loadPinnedThread(input: ThreadPinCaller & {
  threadId: string;
}) {
  const rows = await loadPinnedThreads({ ...input, limit: 100 });
  return rows.find((row) => row.thread.id === input.threadId) ?? null;
}

export function rowToPinnedThread(row: Record<string, unknown>) {
  const thread = threadToCamel(row);
  return {
    thread,
    pinnedAt:
      row.pinned_at instanceof Date
        ? row.pinned_at.toISOString()
        : row.pinned_at,
    pinOrder:
      typeof row.pin_order === "number"
        ? row.pin_order
        : Number(row.pin_order ?? 0),
  };
}
