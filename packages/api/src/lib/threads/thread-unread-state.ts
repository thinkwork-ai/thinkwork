import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadParticipants } from "@thinkwork/database-pg/schema";

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
