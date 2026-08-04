import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import { db, eq, threadParticipants } from "../../utils.js";
import {
  ensureUserThreadParticipant,
  loadPinnedThread,
  loadVisibleThreadForPin,
  nextPinOrder,
  requireThreadPinCaller,
} from "./threadPins.shared.js";

export async function pinThread(
  _parent: any,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  const caller = await requireThreadPinCaller(ctx, args.tenantId);
  const thread = await loadVisibleThreadForPin({
    tenantId: caller.tenantId,
    callerUserId: caller.userId,
    threadId: args.threadId,
  });
  const participantId = await ensureUserThreadParticipant({
    tenantId: caller.tenantId,
    userId: caller.userId,
    thread,
  });

  const existing = await loadPinnedThread({ ...caller, threadId: args.threadId });
  const pinnedAt = new Date();
  await db
    .update(threadParticipants)
    .set({
      pinned_at: pinnedAt,
      pin_order: existing ? existing.pinOrder : await nextPinOrder(caller),
      updated_at: new Date(),
    })
    .where(eq(threadParticipants.id, participantId));

  const pinnedThread = await loadPinnedThread({
    ...caller,
    threadId: args.threadId,
  });
  if (!pinnedThread) {
    throw new GraphQLError("Thread pin was not saved", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return pinnedThread;
}
