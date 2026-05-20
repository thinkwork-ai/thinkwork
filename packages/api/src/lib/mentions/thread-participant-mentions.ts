import { getDb } from "@thinkwork/database-pg";
import { threadParticipants } from "@thinkwork/database-pg/schema";
import type { ParsedMention } from "./parse-message-mentions.js";
import type { ThreadMentionTarget } from "./thread-mention-targets.js";

export interface MentionParticipantInsert {
  tenantId: string;
  threadId: string;
  spaceId: string;
  participantType: "user" | "agent";
  userId?: string;
  agentId?: string;
  role: string;
  source: "mention";
  notificationPreference: "subscribed";
}

export interface MentionParticipantRepository {
  insertParticipants(rows: MentionParticipantInsert[]): Promise<void>;
}

export function buildMentionParticipantRows(input: {
  tenantId: string;
  threadId: string;
  spaceId?: string | null;
  mentions: ParsedMention[];
  targets: ThreadMentionTarget[];
}): MentionParticipantInsert[] {
  if (!input.spaceId || input.mentions.length === 0) return [];

  const targetsByKey = new Map(
    input.targets.map((target) => [
      participantKey(target.targetType, target.targetId),
      target,
    ]),
  );
  const rowsByKey = new Map<string, MentionParticipantInsert>();

  for (const mention of input.mentions) {
    const target = targetsByKey.get(
      participantKey(mention.targetType, mention.targetId),
    );
    if (!target) continue;

    const key = participantKey(mention.targetType, mention.targetId);
    if (rowsByKey.has(key)) continue;

    if (mention.targetType === "user") {
      rowsByKey.set(key, {
        tenantId: input.tenantId,
        threadId: input.threadId,
        spaceId: input.spaceId,
        participantType: "user",
        userId: mention.targetId,
        role: target.role ?? "member",
        source: "mention",
        notificationPreference: "subscribed",
      });
    } else {
      rowsByKey.set(key, {
        tenantId: input.tenantId,
        threadId: input.threadId,
        spaceId: input.spaceId,
        participantType: "agent",
        agentId: mention.targetId,
        role: target.role ?? "agent",
        source: "mention",
        notificationPreference: "subscribed",
      });
    }
  }

  return [...rowsByKey.values()];
}

export async function insertMentionParticipants(
  input: {
    tenantId: string;
    threadId: string;
    spaceId?: string | null;
    mentions: ParsedMention[];
    targets: ThreadMentionTarget[];
  },
  repository: MentionParticipantRepository = new DrizzleMentionParticipantRepository(),
) {
  const rows = buildMentionParticipantRows(input);
  if (rows.length === 0) return rows;
  await repository.insertParticipants(rows);
  return rows;
}

export function toThreadParticipantInsert(row: MentionParticipantInsert) {
  return {
    tenant_id: row.tenantId,
    thread_id: row.threadId,
    space_id: row.spaceId,
    participant_type: row.participantType,
    user_id: row.userId,
    agent_id: row.agentId,
    role: row.role,
    source: row.source,
    notification_preference: row.notificationPreference,
  } satisfies typeof threadParticipants.$inferInsert;
}

class DrizzleMentionParticipantRepository
  implements MentionParticipantRepository
{
  private readonly db = getDb();

  async insertParticipants(rows: MentionParticipantInsert[]) {
    await this.db
      .insert(threadParticipants)
      .values(rows.map(toThreadParticipantInsert))
      .onConflictDoNothing();
  }
}

function participantKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}
