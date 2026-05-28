import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, inArray, sql, threadParticipants } from "../../utils.js";
import {
  loadPinnedThreads,
  requireThreadPinCaller,
} from "./threadPins.shared.js";

export async function reorderPinnedThreads(
  _parent: any,
  args: { tenantId: string; threadIds: string[] },
  ctx: GraphQLContext,
) {
  const caller = await requireThreadPinCaller(ctx, args.tenantId);
  const threadIds = [...new Set(args.threadIds)];
  if (threadIds.length === 0) {
    return loadPinnedThreads(caller);
  }

  const rows = await db
    .select({ thread_id: threadParticipants.thread_id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, caller.tenantId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, caller.userId),
        inArray(threadParticipants.thread_id, threadIds),
        sql`${threadParticipants.pinned_at} IS NOT NULL`,
      ),
    );
  const pinnedIds = new Set(rows.map((row) => row.thread_id));
  const missing = threadIds.filter((threadId) => !pinnedIds.has(threadId));
  if (missing.length > 0) {
    throw new GraphQLError("Pinned thread required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  for (const [index, threadId] of threadIds.entries()) {
    await db
      .update(threadParticipants)
      .set({ pin_order: index + 1, updated_at: new Date() })
      .where(
        and(
          eq(threadParticipants.tenant_id, caller.tenantId),
          eq(threadParticipants.participant_type, "user"),
          eq(threadParticipants.user_id, caller.userId),
          eq(threadParticipants.thread_id, threadId),
        ),
      );
  }

  return loadPinnedThreads(caller);
}
