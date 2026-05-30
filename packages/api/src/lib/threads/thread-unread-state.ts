import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadParticipants } from "@thinkwork/database-pg/schema";

/**
 * Batch-write the caller's read marker across an explicit set of threads.
 *
 * The WHERE clause is the security boundary: it touches ONLY the caller's own
 * `user` participant rows in the caller's tenant, so a foreign-tenant id or a
 * thread the caller never joined simply matches zero rows — no upsert, no
 * phantom participant rows, no cross-user writes. `readAt = null` marks unread.
 * Returns the number of participant rows actually updated.
 */
export async function markCallerThreadsRead(input: {
  tenantId: string;
  userId: string;
  threadIds: string[];
  readAt: Date | null;
}): Promise<number> {
  if (input.threadIds.length === 0) return 0;
  const db = getDb();
  const rows = await db
    .update(threadParticipants)
    .set({ last_read_at: input.readAt, updated_at: new Date() })
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.userId),
        inArray(threadParticipants.thread_id, input.threadIds),
      ),
    )
    .returning({ id: threadParticipants.id });
  return rows.length;
}

export interface SenderReadStateRepository {
  markUserParticipantRead(input: {
    tenantId: string;
    threadId: string;
    userId: string;
    readAt: Date;
  }): Promise<void>;
}

export async function markSenderParticipantRead(
  input: {
    tenantId: string;
    threadId: string;
    senderType?: string | null;
    senderId?: string | null;
    readAt: Date;
  },
  repository: SenderReadStateRepository = new DrizzleSenderReadStateRepository(),
) {
  if (input.senderType !== "user" || !input.senderId) return false;
  await repository.markUserParticipantRead({
    tenantId: input.tenantId,
    threadId: input.threadId,
    userId: input.senderId,
    readAt: input.readAt,
  });
  return true;
}

class DrizzleSenderReadStateRepository implements SenderReadStateRepository {
  private readonly db = getDb();

  async markUserParticipantRead(input: {
    tenantId: string;
    threadId: string;
    userId: string;
    readAt: Date;
  }) {
    await this.db
      .update(threadParticipants)
      .set({ last_read_at: input.readAt, updated_at: new Date() })
      .where(
        and(
          eq(threadParticipants.tenant_id, input.tenantId),
          eq(threadParticipants.thread_id, input.threadId),
          eq(threadParticipants.participant_type, "user"),
          eq(threadParticipants.user_id, input.userId),
        ),
      );
  }
}
