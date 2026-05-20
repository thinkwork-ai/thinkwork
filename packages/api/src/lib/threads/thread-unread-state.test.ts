import { describe, expect, it } from "vitest";
import {
  markSenderParticipantRead,
  type SenderReadStateRepository,
} from "./thread-unread-state.js";

describe("thread unread state", () => {
  it("marks the human sender read at the message timestamp", async () => {
    const repository = makeRepository();
    const readAt = new Date("2026-05-20T10:00:00.000Z");

    await expect(
      markSenderParticipantRead(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          senderType: "user",
          senderId: "user-1",
          readAt,
        },
        repository,
      ),
    ).resolves.toBe(true);

    expect(repository.updates).toEqual([
      {
        tenantId: "tenant-1",
        threadId: "thread-1",
        userId: "user-1",
        readAt,
      },
    ]);
  });

  it("leaves agent-authored messages unread for humans", async () => {
    const repository = makeRepository();
    await expect(
      markSenderParticipantRead(
        {
          tenantId: "tenant-1",
          threadId: "thread-1",
          senderType: "agent",
          senderId: "agent-1",
          readAt: new Date(),
        },
        repository,
      ),
    ).resolves.toBe(false);
    expect(repository.updates).toEqual([]);
  });
});

function makeRepository() {
  const repository = {
    updates: [] as Parameters<
      SenderReadStateRepository["markUserParticipantRead"]
    >[0][],
    async markUserParticipantRead(input) {
      repository.updates.push(input);
    },
  } satisfies SenderReadStateRepository & {
    updates: Parameters<
      SenderReadStateRepository["markUserParticipantRead"]
    >[0][];
  };
  return repository;
}
