import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, threadParticipants } from "../../utils.js";
import {
  ensureUserThreadParticipant,
  loadVisibleThreadForPin,
  requireThreadPinCaller,
} from "./threadPins.shared.js";
import { threadParticipantToCamel } from "./types.js";

const ALLOWED_PREFERENCES = new Set(["subscribed", "mentions", "muted"]);

/**
 * Sets the CALLER's notification_preference on their own thread_participants
 * row (creating the row if they can see the thread but aren't a participant
 * yet — same ensure path as pinThread). The activity fan-out reads this
 * preference per recipient; a direct @mention still punches through
 * muted/mentions (publish-thread-activity.ts computeShouldNotify).
 */
export async function setThreadNotificationPreference(
  _parent: any,
  args: { tenantId: string; threadId: string; preference: string },
  ctx: GraphQLContext,
) {
  const preference = args.preference.toLowerCase();
  if (!ALLOWED_PREFERENCES.has(preference)) {
    throw new GraphQLError(`Unknown notification preference: ${args.preference}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

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

  await db
    .update(threadParticipants)
    .set({ notification_preference: preference, updated_at: new Date() })
    .where(eq(threadParticipants.id, participantId));

  const [row] = await db
    .select()
    .from(threadParticipants)
    .where(eq(threadParticipants.id, participantId))
    .limit(1);

  if (!row) {
    throw new GraphQLError("Thread participant was not saved", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  return threadParticipantToCamel(row as Record<string, unknown>);
}
