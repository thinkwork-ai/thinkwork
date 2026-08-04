import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  threadParticipants,
} from "../../utils.js";
import {
  loadVisibleThreadForPin,
  requireThreadPinCaller,
} from "./threadPins.shared.js";

export async function unpinThread(
  _parent: any,
  args: { tenantId: string; threadId: string },
  ctx: GraphQLContext,
) {
  const caller = await requireThreadPinCaller(ctx, args.tenantId);
  await loadVisibleThreadForPin({
    tenantId: caller.tenantId,
    callerUserId: caller.userId,
    threadId: args.threadId,
  });

  await db
    .update(threadParticipants)
    .set({ pinned_at: null, pin_order: null, updated_at: new Date() })
    .where(
      and(
        eq(threadParticipants.tenant_id, caller.tenantId),
        eq(threadParticipants.thread_id, args.threadId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, caller.userId),
      ),
    );

  return true;
}
