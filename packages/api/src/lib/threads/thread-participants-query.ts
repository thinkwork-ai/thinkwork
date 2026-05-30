import { and, eq, isNotNull } from "drizzle-orm";
import { threadParticipants } from "@thinkwork/database-pg";

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
    .select({ userId: threadParticipants.userId })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenantId, tenantId),
        eq(threadParticipants.threadId, threadId),
        eq(threadParticipants.participantType, "user"),
        isNotNull(threadParticipants.userId),
      ),
    );

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.userId) ids.add(row.userId);
  }
  return [...ids];
}
