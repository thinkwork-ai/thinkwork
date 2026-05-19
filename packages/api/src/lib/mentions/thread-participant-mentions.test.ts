import { describe, expect, it } from "vitest";
import {
  buildMentionParticipantRows,
  insertMentionParticipants,
  toThreadParticipantInsert,
  type MentionParticipantRepository,
} from "./thread-participant-mentions.js";

const targets = [
  {
    id: "user:user-2",
    targetType: "user" as const,
    targetId: "user-2",
    displayName: "Alex Finance",
    aliases: ["alex@example.com"],
    role: "member",
  },
  {
    id: "agent:agent-1",
    targetType: "agent" as const,
    targetId: "agent-1",
    displayName: "Coordinator",
    aliases: ["coordinator"],
    role: "coordinator",
  },
];

const mentions = [
  {
    targetType: "user" as const,
    targetId: "user-2",
    displayName: "Alex Finance",
    rawText: "@Alex Finance",
    startOffset: 0,
    endOffset: 13,
  },
  {
    targetType: "agent" as const,
    targetId: "agent-1",
    displayName: "Coordinator",
    rawText: "@Coordinator",
    startOffset: 18,
    endOffset: 30,
  },
];

describe("thread participant mentions", () => {
  it("builds subscribed participant rows for mentioned people and agents", () => {
    expect(
      buildMentionParticipantRows({
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        mentions,
        targets,
      }),
    ).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        participantType: "user",
        userId: "user-2",
        role: "member",
        source: "mention",
        notificationPreference: "subscribed",
      },
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        participantType: "agent",
        agentId: "agent-1",
        role: "coordinator",
        source: "mention",
        notificationPreference: "subscribed",
      },
    ]);
  });

  it("deduplicates repeated mentions and ignores targets outside the validated set", () => {
    expect(
      buildMentionParticipantRows({
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        mentions: [
          mentions[0],
          mentions[0],
          {
            targetType: "user",
            targetId: "user-outside-space",
            displayName: "Mallory",
            rawText: "@Mallory",
            startOffset: 31,
            endOffset: 39,
          },
        ],
        targets,
      }),
    ).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        participantType: "user",
        userId: "user-2",
        role: "member",
        source: "mention",
        notificationPreference: "subscribed",
      },
    ]);
  });

  it("keeps insert idempotency in the repository boundary", async () => {
    const repository = makeRepository();

    await insertMentionParticipants(
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        spaceId: "space-1",
        mentions,
        targets,
      },
      repository,
    );

    expect(repository.rows).toHaveLength(2);
    expect(repository.rows.map(toThreadParticipantInsert)).toEqual([
      {
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        space_id: "space-1",
        participant_type: "user",
        user_id: "user-2",
        agent_id: undefined,
        role: "member",
        source: "mention",
        notification_preference: "subscribed",
      },
      {
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        space_id: "space-1",
        participant_type: "agent",
        user_id: undefined,
        agent_id: "agent-1",
        role: "coordinator",
        source: "mention",
        notification_preference: "subscribed",
      },
    ]);
  });
});

function makeRepository() {
  const repository = {
    rows: [] as Parameters<
      MentionParticipantRepository["insertParticipants"]
    >[0],
    async insertParticipants(rows) {
      repository.rows.push(...rows);
    },
  } satisfies MentionParticipantRepository & {
    rows: Parameters<MentionParticipantRepository["insertParticipants"]>[0];
  };
  return repository;
}
