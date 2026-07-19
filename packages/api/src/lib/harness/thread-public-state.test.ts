import { describe, expect, it } from "vitest";
import {
  formatCanonicalArtifactReference,
  isPublicArtifactMetadata,
  loadCanonicalHarnessPrefix,
} from "./thread-public-state.js";

function queuedSelectDb(results: unknown[]) {
  let index = 0;
  return {
    select: () => {
      const value = results[index++];
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: () => builder,
        orderBy: () => builder,
        then: (
          resolve: (result: unknown) => unknown,
          reject?: (error: unknown) => unknown,
        ) => Promise.resolve(value).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe("canonical Harness artifact references", () => {
  it("projects only stable public metadata", () => {
    expect(
      formatCanonicalArtifactReference({
        id: "row-1",
        artifactId: "artifact-1",
        artifactType: "document",
        name: "Quarterly plan",
      }),
    ).toBe(
      "[Public artifact reference] name=Quarterly plan type=document artifact_id=artifact-1",
    );
  });

  it("fails closed when a captured artifact is later restricted", () => {
    expect(isPublicArtifactMetadata(undefined)).toBe(true);
    expect(isPublicArtifactMetadata({ access_state: "public" })).toBe(true);
    expect(isPublicArtifactMetadata({ access_state: "withheld" })).toBe(false);
    expect(isPublicArtifactMetadata({ access_state: "restricted" })).toBe(
      false,
    );
  });
});

describe("loadCanonicalHarnessPrefix action resume", () => {
  it("keeps the assistant question card in history and uses bounded action input", async () => {
    const db = queuedSelectDb([
      [{ id: "membership-1" }],
      [
        {
          id: 10,
          sourceKind: "message",
          sourceId: "message-user-1",
          eventKind: "insert",
        },
        {
          id: 11,
          sourceKind: "message",
          sourceId: "message-question-card-1",
          eventKind: "insert",
        },
      ],
      [
        {
          id: "message-user-1",
          role: "user",
          content: "Build a report.",
          senderId: "user-1",
          metadata: {},
        },
        {
          id: "message-question-card-1",
          role: "assistant",
          content: "Which quarter should I use?",
          senderId: null,
          metadata: {},
        },
      ],
    ]);

    const result = await loadCanonicalHarnessPrefix({
      tenantId: "tenant-1",
      threadId: "thread-1",
      participantUserId: "user-1",
      triggeringMessageId: "message-question-card-1",
      capturedHighWater: 11,
      actionCurrentMessage:
        "Continue using the canonical pending-question answer.",
      db: db as never,
    });

    expect(result.currentMessage).toBe(
      "Continue using the canonical pending-question answer.",
    );
    expect(result.currentMessageId).toBe("message-question-card-1");
    expect(result.history).toEqual([
      expect.objectContaining({
        role: "user",
        sourceMessageId: "message-user-1",
        content: "[Participant user-1] Build a report.",
      }),
      expect.objectContaining({
        role: "assistant",
        sourceMessageId: "message-question-card-1",
        content: "Which quarter should I use?",
      }),
    ]);
  });

  it("rejects an action anchor outside the canonical public prefix", async () => {
    const db = queuedSelectDb([
      [{ id: "membership-1" }],
      [
        {
          id: 10,
          sourceKind: "message",
          sourceId: "message-user-1",
          eventKind: "insert",
        },
      ],
      [
        {
          id: "message-user-1",
          role: "user",
          content: "Build a report.",
          senderId: "user-1",
          metadata: {},
        },
      ],
    ]);

    await expect(
      loadCanonicalHarnessPrefix({
        tenantId: "tenant-1",
        threadId: "thread-1",
        participantUserId: "user-1",
        triggeringMessageId: "message-question-card-1",
        capturedHighWater: 10,
        actionCurrentMessage:
          "Continue using the canonical pending-question answer.",
        db: db as never,
      }),
    ).rejects.toThrow("harness_trigger_not_in_public_prefix");
  });
});
