import { describe, expect, it, vi } from "vitest";
import { buildSlackThreadTurnInput } from "./envelope.js";
import {
  resolveOrCreateSlackThread,
  type SlackThreadMappingStore,
} from "./thread-mapping.js";

function makeStore() {
  const mappings = new Map<string, string>();
  let threadSeq = 0;
  let messageSeq = 0;
  const createMapping = vi.fn(async (input: any) => {
    mappings.set(key(input), input.threadId);
  });
  const createThread = vi.fn(async () => {
    threadSeq += 1;
    return { threadId: `thread-${threadSeq}` };
  });
  const createMessage = vi.fn(async () => {
    messageSeq += 1;
    return { messageId: `message-${messageSeq}` };
  });
  const store: SlackThreadMappingStore = {
    async withTransaction(fn) {
      return fn(store);
    },
    async findThread(input) {
      const threadId = mappings.get(key(input));
      return threadId ? { threadId } : null;
    },
    createThread,
    createMapping,
    createMessage,
  };
  return { store, createThread, createMapping, createMessage };
}

function key(input: {
  tenantId: string;
  slackTeamId: string;
  channelId: string;
  rootThreadTs: string | null;
}) {
  return [
    input.tenantId,
    input.slackTeamId,
    input.channelId,
    input.rootThreadTs ?? "<null>",
  ].join(":");
}

function appMentionEnvelope(overrides: Record<string, unknown> = {}) {
  return buildSlackThreadTurnInput({
    channelType: "app_mention",
    slackTeamId: "T123",
    slackUserId: "U123",
    slackWorkspaceRowId: "workspace-1",
    channelId: "C123",
    eventId: "Ev123",
    actorId: "user-1",
    event: {
      type: "app_mention",
      user: "U123",
      channel: "C123",
      channel_type: "channel",
      text: "help",
      ts: "1710000001.000000",
      thread_ts: "1710000000.000000",
      ...overrides,
    },
  });
}

describe("Slack thread mapping", () => {
  it("inserts a Slack thread mapping for a new team/channel/root triple", async () => {
    const deps = makeStore();

    const result = await resolveOrCreateSlackThread(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        actorId: "user-1",
        envelope: appMentionEnvelope(),
      },
      deps.store,
    );

    expect(result).toEqual({
      threadId: "thread-1",
      messageId: "message-1",
      wasCreated: true,
    });
    expect(deps.createMapping).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slackTeamId: "T123",
      channelId: "C123",
      rootThreadTs: "1710000000.000000",
      threadId: "thread-1",
    });
  });

  it("reuses the existing ThinkWork thread for the same Slack triple", async () => {
    const deps = makeStore();
    await resolveOrCreateSlackThread(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        actorId: "user-1",
        envelope: appMentionEnvelope(),
      },
      deps.store,
    );

    const second = await resolveOrCreateSlackThread(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        actorId: "user-1",
        envelope: appMentionEnvelope({ text: "again" }),
      },
      deps.store,
    );

    expect(second).toMatchObject({
      threadId: "thread-1",
      messageId: "message-2",
      wasCreated: false,
    });
    expect(deps.createThread).toHaveBeenCalledTimes(1);
    expect(deps.createMessage).toHaveBeenCalledTimes(2);
  });

  it("keys direct messages by team/channel/null root rather than message ts", async () => {
    const deps = makeStore();

    await resolveOrCreateSlackThread(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        actorId: "user-1",
        envelope: buildSlackThreadTurnInput({
          channelType: "im",
          slackTeamId: "T123",
          slackUserId: "U123",
          channelId: "D123",
          eventId: "EvDM1",
          actorId: "user-1",
          event: {
            type: "message",
            channel_type: "im",
            user: "U123",
            channel: "D123",
            text: "first",
            ts: "1710000001.000000",
          },
        }),
      },
      deps.store,
    );
    const second = await resolveOrCreateSlackThread(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        actorId: "user-1",
        envelope: buildSlackThreadTurnInput({
          channelType: "im",
          slackTeamId: "T123",
          slackUserId: "U123",
          channelId: "D123",
          eventId: "EvDM2",
          actorId: "user-1",
          event: {
            type: "message",
            channel_type: "im",
            user: "U123",
            channel: "D123",
            text: "second",
            ts: "1710000002.000000",
          },
        }),
      },
      deps.store,
    );

    expect(second.threadId).toBe("thread-1");
    expect(deps.createMapping).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "D123", rootThreadTs: null }),
    );
  });
});
