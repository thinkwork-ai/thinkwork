import { and, eq, isNotNull } from "drizzle-orm";
import { threadParticipants } from "@thinkwork/database-pg/schema";

type DbLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

/**
 * Returns the distinct user ids of every USER participant in a thread. Used to
 * fan out per-participant activity notifications. Agent participants are
 * excluded (they don't receive desktop notifications). Covered by
 * idx_thread_participants_thread (tenantId, threadId).
 */
export async function selectThreadParticipantUserIds({
  db,
  tenantId,
  threadId,
}: {
  db: DbLike;
  tenantId: string;
  threadId: string;
}): Promise<string[]> {
  const rows: Array<{ userId: string | null }> = await db
    .select({ userId: threadParticipants.user_id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, tenantId),
        eq(threadParticipants.thread_id, threadId),
        eq(threadParticipants.participant_type, "user"),
        isNotNull(threadParticipants.user_id),
      ),
    );

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.userId) ids.add(row.userId);
  }
  return [...ids];
}

export type ThreadNotificationPreference = "subscribed" | "mentions" | "muted";

export interface ThreadParticipantActivityTarget {
  userId: string;
  /**
   * Per-participant notification preference (thread_participants CHECK is
   * one of subscribed | mentions | muted). This is the first reader of the
   * column — every existing row defaults to "subscribed".
   */
  notificationPreference: ThreadNotificationPreference;
}

/**
 * Like {@link selectThreadParticipantUserIds}, but also returns each USER
 * participant's notification_preference so the activity fan-out can compute a
 * per-recipient shouldNotify (KTD5). Distinct by userId; if a duplicate row
 * exists the first-seen preference wins. Agent participants are excluded.
 */
export async function selectThreadParticipantsForActivity({
  db,
  tenantId,
  threadId,
}: {
  db: DbLike;
  tenantId: string;
  threadId: string;
}): Promise<ThreadParticipantActivityTarget[]> {
  const rows: Array<{
    userId: string | null;
    notificationPreference: string | null;
  }> = await db
    .select({
      userId: threadParticipants.user_id,
      notificationPreference: threadParticipants.notification_preference,
    })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, tenantId),
        eq(threadParticipants.thread_id, threadId),
        eq(threadParticipants.participant_type, "user"),
        isNotNull(threadParticipants.user_id),
      ),
    );

  const byUser = new Map<string, ThreadParticipantActivityTarget>();
  for (const row of rows) {
    if (!row.userId || byUser.has(row.userId)) continue;
    byUser.set(row.userId, {
      userId: row.userId,
      notificationPreference: normalizeNotificationPreference(
        row.notificationPreference,
      ),
    });
  }
  return [...byUser.values()];
}

function normalizeNotificationPreference(
  value: string | null,
): ThreadNotificationPreference {
  return value === "mentions" || value === "muted" ? value : "subscribed";
}
