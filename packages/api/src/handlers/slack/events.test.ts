import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  computeSlackSignature,
  type SlackWorkspaceContext,
} from "./_shared.js";
import {
  resolveOrCreateSlackThread,
  type SlackThreadMappingStore,
} from "../../lib/slack/thread-mapping.js";
import {
  createSlackEventsDispatcher,
  createSlackEventsHandler,
  handleUrlVerification,
} from "./events.js";

const WORKSPACE: SlackWorkspaceContext = {
  id: "workspace-1",
  tenantId: "tenant-1",
  slackTeamId: "T123",
  slackTeamName: "Acme",
  botUserId: "B123",
  botTokenSecretPath:
    "thinkwork/tenants/tenant-1/slack/workspaces/T123/bot-token",
  appId: "A123",
  status: "active",
};

function makeArgs(payload: unknown) {
  const rawBodyText = JSON.stringify(payload);
  return {
    event: {} as any,
    headers: {},
    rawBody: Buffer.from(rawBodyText),
    rawBodyText,
    workspace: WORKSPACE,
    botToken: "xoxb-token",
  };
}

function appMentionPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev123",
    event: {
      type: "app_mention",
      team: "T123",
      user: "U123",
      channel: "C123",
      channel_type: "channel",
      text: "<@B123> research this vendor",
      ts: "1710000001.000000",
      ...overrides,
    },
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const loadLinkedUser = vi.fn(async () => ({
    userId: "user-1",
    slackUserName: "Eric",
    slackUserEmail: null,
  }));
  const resolveSlackThread = vi.fn(async () => ({
    threadId: "thread-1",
    spaceId: "space-1",
    messageId: "message-1",
    wasCreated: true,
    messageCreated: true,
  }));
  const dispatchDefaultAgent = vi.fn(async () => ({
    agentId: "agent-1",
    enqueued: true,
    wakeupRequestId: "wakeup-1",
  }));
  const materializeSlackFiles = vi.fn(async () => []);
  const persistAckTs = vi.fn(async () => {});
  const setAssistantStatus = vi.fn(
    async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
  );
  const slackApi = {
    fetchThreadMessages: vi.fn(async () => [
      { user: "U123", botId: null, ts: "1710000000.000000", text: "Earlier" },
    ]),
    postMessage: vi.fn(async () => ({ ok: true, ts: "1710000002.000000" })),
    sendLinkPrompt: vi.fn(async () => {}),
  };
  const metrics = {
    dedupeHit: vi.fn(),
    dispatchSuccess: vi.fn(),
    dispatchFailure: vi.fn(),
  };
  return {
    loadLinkedUser,
    resolveSlackThread,
    dispatchDefaultAgent,
    materializeSlackFiles,
    persistAckTs,
    setAssistantStatus,
    slackApi,
    metrics,
    ...overrides,
  };
}

function dmPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T123",
    event_id: "EvDM",
    event: {
      type: "message",
      channel_type: "im",
      team: "T123",
      user: "U123",
      channel: "D123",
      text: "hello",
      ts: "1710000003.000000",
      ...overrides,
    },
  };
}

describe("Slack events handler", () => {
  it("responds to Slack URL verification before workspace lookup", async () => {
    const result = await handleUrlVerification({
      rawBodyText: JSON.stringify({
        type: "url_verification",
        challenge: "challenge-1",
      }),
    });

    expect(result).toMatchObject({ statusCode: 200, body: "challenge-1" });
  });

  it("dispatches a linked app mention through the durable default-agent wakeup", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(appMentionPayload()));

    expect(result.statusCode).toBe(200);
    expect(deps.loadLinkedUser).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slackTeamId: "T123",
      slackUserId: "U123",
    });
    expect(deps.resolveSlackThread).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        actorId: "user-1",
        envelope: expect.objectContaining({
          eventId: "Ev123",
          sourceMessage: expect.objectContaining({
            text: "research this vendor",
          }),
        }),
      }),
    );
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      spaceId: "space-1",
      messageId: "message-1",
      content: "research this vendor",
      sender: { type: "user", id: "user-1" },
    });
    expect(deps.slackApi.postMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      threadTs: "1710000001.000000",
      text: "ThinkWork is working on it…",
    });
    expect(JSON.parse(result.body || "{}")).toEqual({
      ok: true,
      threadId: "thread-1",
      messageId: "message-1",
      wakeupRequestId: "wakeup-1",
    });
  });

  it("stamps the ack ts onto the triggering message after a successful ack post", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    await dispatch(makeArgs(appMentionPayload()));

    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.persistAckTs).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      messageId: "message-1",
      ackTs: "1710000002.000000",
    });
  });

  it("does not stamp and does not throw when the ack post fails", async () => {
    const deps = makeDeps({
      slackApi: {
        fetchThreadMessages: vi.fn(async () => []),
        postMessage: vi.fn(async () => ({
          ok: false,
          error: "channel_not_found",
        })),
        sendLinkPrompt: vi.fn(async () => {}),
      },
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(appMentionPayload()));

    expect(result.statusCode).toBe(200);
    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.persistAckTs).not.toHaveBeenCalled();
  });

  it("shows the native DM typing status instead of posting a placeholder", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(dmPayload()));

    expect(result.statusCode).toBe(200);
    expect(deps.setAssistantStatus).toHaveBeenCalledWith({
      token: "xoxb-token",
      channelId: "D123",
      threadTs: "1710000003.000000",
      status: "is thinking…",
    });
    // Slack clears the status when the finalizer posts the real answer, so
    // there is no placeholder message to update in place.
    expect(deps.slackApi.postMessage).not.toHaveBeenCalled();
    expect(deps.persistAckTs).not.toHaveBeenCalled();
  });

  it("falls back to the placeholder when the DM status scope is missing", async () => {
    const deps = makeDeps({
      setAssistantStatus: vi.fn(async () => ({
        ok: false,
        error: "missing_scope",
      })),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(dmPayload()));

    expect(result.statusCode).toBe(200);
    expect(deps.setAssistantStatus).toHaveBeenCalledTimes(1);
    expect(deps.slackApi.postMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "D123",
      threadTs: "1710000003.000000",
      text: "ThinkWork is working on it…",
    });
    expect(deps.persistAckTs).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      messageId: "message-1",
      ackTs: "1710000002.000000",
    });
  });

  it("falls back to the placeholder when the DM status call throws", async () => {
    const deps = makeDeps({
      setAssistantStatus: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(dmPayload()));

    expect(result.statusCode).toBe(200);
    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.persistAckTs).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      messageId: "message-1",
      ackTs: "1710000002.000000",
    });
  });

  it("never attempts the typing status for a channel mention", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    await dispatch(makeArgs(appMentionPayload()));

    // Slack has no typing-status API for a channel @mention — the in-place
    // placeholder is the only option there.
    expect(deps.setAssistantStatus).not.toHaveBeenCalled();
    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
    expect(deps.persistAckTs).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      messageId: "message-1",
      ackTs: "1710000002.000000",
    });
  });

  it("accepts a linked direct message without requiring a bot mention", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    await dispatch(
      makeArgs({
        type: "event_callback",
        team_id: "T123",
        event_id: "EvDM",
        event: {
          type: "message",
          channel_type: "im",
          team: "T123",
          user: "U123",
          channel: "D123",
          text: "hello",
          ts: "1710000003.000000",
        },
      }),
    );

    expect(deps.resolveSlackThread).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          channelType: "im",
          channelId: "D123",
          triggerSurface: "message_im",
        }),
      }),
    );
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
  });

  it("returns an account-link action for an unlinked user without dispatch", async () => {
    const deps = makeDeps({
      loadLinkedUser: vi.fn(async () => null),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(result.body || "{}")).toEqual({
      ok: true,
      ignored: true,
      reason: "slack_user_unlinked",
    });
    expect(deps.slackApi.sendLinkPrompt).toHaveBeenCalledWith({
      token: "xoxb-token",
      workspaceTeamId: "T123",
      slackUserId: "U123",
      channelId: "C123",
    });
    expect(deps.resolveSlackThread).not.toHaveBeenCalled();
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("does not create a second wakeup or acknowledgement for a completed duplicate", async () => {
    const deps = makeDeps({
      resolveSlackThread: vi.fn(async () => ({
        threadId: "thread-1",
        spaceId: "space-1",
        messageId: "message-1",
        wasCreated: false,
        messageCreated: false,
      })),
      dispatchDefaultAgent: vi.fn(async () => ({
        agentId: "agent-1",
        enqueued: false,
        wakeupRequestId: "wakeup-1",
      })),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(result.body || "{}")).toEqual({
      ok: true,
      duplicate: true,
      threadId: "thread-1",
      messageId: "message-1",
    });
    expect(deps.metrics.dedupeHit).toHaveBeenCalledWith({
      surface: "app_mention",
    });
    expect(deps.materializeSlackFiles).not.toHaveBeenCalled();
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
    expect(deps.slackApi.postMessage).not.toHaveBeenCalled();
  });

  it("recovers a persisted source event whose durable wakeup was not created", async () => {
    const deps = makeDeps({
      resolveSlackThread: vi.fn(async () => ({
        threadId: "thread-1",
        spaceId: "space-1",
        messageId: "message-1",
        wasCreated: false,
        messageCreated: false,
      })),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(result.body || "{}")).toMatchObject({
      ok: true,
      duplicate: true,
    });
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
  });

  it("integrates source-event persistence with message-keyed wakeup idempotency", async () => {
    const mappings = new Map<string, { threadId: string; spaceId: string }>();
    const messages = new Map<
      string,
      { messageId: string; threadId: string; spaceId: string }
    >();
    const store: SlackThreadMappingStore = {
      async withTransaction(fn) {
        return fn(store);
      },
      async findThread() {
        return mappings.get("conversation") ?? null;
      },
      async createThread() {
        return { threadId: "thread-1", spaceId: "space-1" };
      },
      async createMapping(input) {
        mappings.set("conversation", {
          threadId: input.threadId,
          spaceId: input.spaceId,
        });
      },
      async createMessage(input) {
        const existing = messages.get(input.sourceEventId);
        if (existing) return { ...existing, wasCreated: false };
        const created = {
          messageId: "message-1",
          threadId: input.threadId,
          spaceId: input.spaceId,
        };
        messages.set(input.sourceEventId, created);
        return { ...created, wasCreated: true };
      },
    };
    let wakeupsCreated = 0;
    const dispatchDefaultAgent = vi.fn(async () => {
      const enqueued = wakeupsCreated === 0;
      if (enqueued) wakeupsCreated += 1;
      return {
        agentId: "agent-1",
        enqueued,
        wakeupRequestId: "wakeup-1",
      };
    });
    const deps = makeDeps({
      resolveSlackThread: (
        input: Parameters<typeof resolveOrCreateSlackThread>[0],
      ) => resolveOrCreateSlackThread(input, store),
      dispatchDefaultAgent,
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const first = await dispatch(makeArgs(appMentionPayload()));
    const duplicate = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(first.body || "{}")).toMatchObject({ ok: true });
    expect(JSON.parse(duplicate.body || "{}")).toMatchObject({
      ok: true,
      duplicate: true,
    });
    expect(messages.size).toBe(1);
    expect(wakeupsCreated).toBe(1);
    expect(dispatchDefaultAgent).toHaveBeenCalledTimes(2);
    expect(deps.slackApi.postMessage).toHaveBeenCalledTimes(1);
  });

  it("acknowledges unsupported and bot-authored event types without dispatch", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    for (const event of [
      { type: "reaction_added", user: "U123", channel: "C123" },
      {
        type: "message",
        channel_type: "im",
        user: "U123",
        channel: "D123",
        bot_id: "B999",
      },
    ]) {
      const result = await dispatch(
        makeArgs({
          type: "event_callback",
          team_id: "T123",
          event_id: "EvIgnored",
          event,
        }),
      );
      expect(JSON.parse(result.body || "{}")).toMatchObject({
        ok: true,
        ignored: true,
        reason: "unsupported_event",
      });
    }
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("promotes a channel file_share mention of the bot to an app_mention turn", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch(
      makeArgs(
        appMentionPayload({
          type: "message",
          subtype: "file_share",
          text: "<@B123> summarize this",
          files: [
            {
              id: "F123",
              name: "brief.pdf",
              mimetype: "application/pdf",
              url_private: "https://files.slack.com/files-pri/F123",
            },
          ],
        }),
      ),
    );

    expect(result.statusCode).toBe(200);
    expect(deps.resolveSlackThread).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          channelType: "app_mention",
          fileRefs: [expect.objectContaining({ id: "F123" })],
        }),
      }),
    );
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a malformed event body without dispatch", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    const result = await dispatch({
      ...makeArgs({}),
      rawBodyText: "{not json",
      rawBody: Buffer.from("{not json"),
    });

    expect(JSON.parse(result.body || "{}")).toEqual({
      ok: true,
      ignored: true,
    });
    expect(deps.loadLinkedUser).not.toHaveBeenCalled();
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("continues text dispatch when Slack attachment materialization fails", async () => {
    const materializeSlackFiles = vi.fn(async () => {
      throw new Error("s3 unavailable");
    });
    const deps = makeDeps({ materializeSlackFiles });
    const dispatch = createSlackEventsDispatcher(deps);

    await dispatch(
      makeArgs(
        appMentionPayload({
          files: [
            {
              id: "F123",
              name: "brief.pdf",
              mimetype: "application/pdf",
              url_private: "https://files.slack.com/files-pri/F123",
            },
          ],
        }),
      ),
    );

    expect(materializeSlackFiles).toHaveBeenCalled();
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
  });
});

describe("Slack events handler end to end", () => {
  const NOW_SECONDS = 1_800_000_000;
  const NOW_MS = NOW_SECONDS * 1000;
  const SIGNING_SECRET = "slack-signing-secret";

  function makeSignedEvent(
    rawBody: string,
    opts: { signature?: string; timestamp?: string } = {},
  ): APIGatewayProxyEventV2 {
    const timestamp = opts.timestamp ?? String(NOW_SECONDS);
    const signature =
      opts.signature ??
      computeSlackSignature(SIGNING_SECRET, timestamp, Buffer.from(rawBody));
    return {
      version: "2.0",
      routeKey: "POST /slack/events",
      rawPath: "/slack/events",
      rawQueryString: "",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      requestContext: {
        http: {
          method: "POST",
          path: "/slack/events",
          sourceIp: "127.0.0.1",
          userAgent: "Slackbot",
        },
      } as APIGatewayProxyEventV2["requestContext"],
      body: rawBody,
      isBase64Encoded: false,
    };
  }

  function makeSignedHandler(deps: ReturnType<typeof makeDeps>) {
    return createSlackEventsHandler(deps, {
      loadSigningSecret: async () => SIGNING_SECRET,
      lookupWorkspace: async () => WORKSPACE,
      loadBotToken: async () => "xoxb-token",
      nowMs: () => NOW_MS,
    });
  }

  it("parses a recorded signed app_mention into the same dispatch input", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);

    const response = await handler(
      makeSignedEvent(JSON.stringify(appMentionPayload())),
    );

    expect(response.statusCode).toBe(200);
    expect(deps.resolveSlackThread).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        actorId: "user-1",
        envelope: expect.objectContaining({
          slackTeamId: "T123",
          slackUserId: "U123",
          channelId: "C123",
          threadTs: "1710000001.000000",
          eventId: "Ev123",
          sourceMessage: expect.objectContaining({
            text: "research this vendor",
          }),
        }),
      }),
    );
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      spaceId: "space-1",
      messageId: "message-1",
      content: "research this vendor",
      sender: { type: "user", id: "user-1" },
    });
    expect(JSON.parse(response.body || "{}")).toEqual({
      ok: true,
      threadId: "thread-1",
      messageId: "message-1",
      wakeupRequestId: "wakeup-1",
    });
  });

  it("keeps direct-message behavior for a recorded signed message.im", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);

    const response = await handler(
      makeSignedEvent(
        JSON.stringify({
          type: "event_callback",
          team_id: "T123",
          event_id: "EvDM",
          event: {
            type: "message",
            channel_type: "im",
            team: "T123",
            user: "U123",
            channel: "D123",
            text: "hello",
            ts: "1710000003.000000",
          },
        }),
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(deps.resolveSlackThread).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          channelType: "im",
          channelId: "D123",
          triggerSurface: "message_im",
        }),
      }),
    );
    expect(deps.dispatchDefaultAgent).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered signature before any dispatch", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);

    const response = await handler(
      makeSignedEvent(JSON.stringify(appMentionPayload()), {
        signature: "v0=" + "ab".repeat(32),
      }),
    );

    expect(response.statusCode).toBe(401);
    expect(deps.loadLinkedUser).not.toHaveBeenCalled();
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("rejects a signed malformed body with the previous 400 outcome", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);

    const response = await handler(makeSignedEvent("{not json"));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body || "{}")).toEqual({
      error: "Slack team_id is required",
    });
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("rejects a signed form-encoded body with the previous 400 outcome", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);
    const event = makeSignedEvent("team_id=T123&text=hello");
    event.headers["content-type"] = "application/x-www-form-urlencoded";

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body || "{}")).toEqual({
      error: "Slack team_id is required",
    });
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });

  it("rejects a stale signing timestamp before any dispatch", async () => {
    const deps = makeDeps();
    const handler = makeSignedHandler(deps);

    const response = await handler(
      makeSignedEvent(JSON.stringify(appMentionPayload()), {
        timestamp: String(NOW_SECONDS - 6 * 60),
      }),
    );

    expect(response.statusCode).toBe(401);
    expect(deps.dispatchDefaultAgent).not.toHaveBeenCalled();
  });
});
