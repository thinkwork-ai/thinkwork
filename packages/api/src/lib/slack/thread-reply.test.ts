import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  retryThreadReplySlackForTurn,
  sendThreadReplySlack,
  type SlackThreadReplyStore,
} from "./thread-reply.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const ASSISTANT_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";

class FakeStore implements SlackThreadReplyStore {
  context: Awaited<ReturnType<SlackThreadReplyStore["loadContext"]>> = {
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    body: "Final answer",
    assistantMetadata: { sourceTurnId: TURN_ID },
    triggeringUserMetadata: slackUserMetadata(),
  };
  target: Awaited<ReturnType<SlackThreadReplyStore["loadTarget"]>> = {
    status: "ready",
    botTokenSecretPath: "thinkwork/tenants/t/slack/workspaces/T123/bot-token",
  };
  status: string | null = null;
  claimed = 0;
  delivered: Array<Record<string, unknown>> = [];
  failed: Array<Record<string, unknown>> = [];
  targets: Array<Record<string, unknown>> = [];
  findForTurn: string | null = ASSISTANT_MESSAGE_ID;

  async loadContext() {
    return this.context;
  }

  async loadTarget(input: Record<string, unknown>) {
    this.targets.push(input);
    return this.target;
  }

  async claimDelivery() {
    if (this.status === "succeeded" || this.status === "sending") {
      return { claimed: false as const, status: this.status };
    }
    this.claimed += 1;
    this.status = "sending";
    return { claimed: true as const };
  }

  async markDelivered(input: Record<string, unknown>) {
    this.status = "succeeded";
    this.delivered.push(input);
    return true;
  }

  async markFailed(input: Record<string, unknown>) {
    this.status = "failed";
    this.failed.push(input);
    return true;
  }

  async findAssistantMessageForTurn() {
    return this.findForTurn;
  }
}

let store: FakeStore;
let getBotToken: ReturnType<typeof vi.fn>;
let postMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new FakeStore();
  getBotToken = vi.fn().mockResolvedValue("xoxb-token");
  postMessage = vi
    .fn()
    .mockResolvedValue({ ok: true, ts: "1710000002.000000" });
});

describe("sendThreadReplySlack", () => {
  it("posts the persisted assistant body once to the originating Slack thread", async () => {
    await expect(send()).resolves.toEqual({
      delivered: true,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      providerMessageTs: "1710000002.000000",
    });

    expect(getBotToken).toHaveBeenCalledWith(
      "thinkwork/tenants/t/slack/workspaces/T123/bot-token",
    );
    expect(postMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      text: "Final answer",
      threadTs: "1710000001.000000",
      clientMessageId: ASSISTANT_MESSAGE_ID,
    });
    expect(store.claimed).toBe(1);
    expect(store.delivered).toHaveLength(1);
    expect(store.targets).toEqual([
      expect.objectContaining({
        slackTeamId: "T123",
        channelId: "C123",
        rootThreadTs: null,
      }),
    ]);
  });

  it("continues a Slack reply under the mapped root timestamp", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = slackUserMetadata(
      "1710000000.000000",
      "app_mention",
    );

    await expect(send()).resolves.toMatchObject({ delivered: true });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: "1710000000.000000" }),
    );
    expect(store.targets[0]).toMatchObject({
      rootThreadTs: "1710000000.000000",
    });
  });

  it("uses the source message as the mapping root for a top-level mention", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = slackUserMetadata(
      null,
      "app_mention",
    );

    await expect(send()).resolves.toMatchObject({ delivered: true });
    expect(store.targets[0]).toMatchObject({
      rootThreadTs: "1710000001.000000",
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: "1710000001.000000" }),
    );
  });

  it("does not post when the triggering user message came from web", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = { source: "web" };

    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: false,
      reason: "not_slack_origin",
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(store.claimed).toBe(0);
  });

  it("skips missing messages, empty bodies, and active delivery claims", async () => {
    store.context = null;
    await expect(send()).resolves.toMatchObject({
      retryable: false,
      reason: "assistant_message_missing",
    });

    store.context = {
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      body: "   ",
      assistantMetadata: { sourceTurnId: TURN_ID },
      triggeringUserMetadata: slackUserMetadata(),
    };
    await expect(send()).resolves.toMatchObject({
      retryable: false,
      reason: "empty_body",
    });

    store.context.body = "Final answer";
    store.status = "sending";
    await expect(send()).resolves.toMatchObject({
      retryable: true,
      reason: "delivery_in_progress",
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not post twice after a successful persisted delivery", async () => {
    await expect(send()).resolves.toMatchObject({ delivered: true });
    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: false,
      reason: "already_delivered",
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("records a provider rejection and retries with the same client message id", async () => {
    postMessage
      .mockResolvedValueOnce({ ok: false, error: "ratelimited" })
      .mockResolvedValueOnce({ ok: true, ts: "1710000003.000000" });

    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: true,
      reason: "provider_rejected",
      error: "ratelimited",
    });
    expect(store.failed).toHaveLength(1);

    await expect(send()).resolves.toMatchObject({ delivered: true });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0]?.[0]?.clientMessageId).toBe(
      ASSISTANT_MESSAGE_ID,
    );
    expect(postMessage.mock.calls[1]?.[0]?.clientMessageId).toBe(
      ASSISTANT_MESSAGE_ID,
    );
  });

  it("normalizes token, transport, and malformed-provider failures as retryable", async () => {
    getBotToken.mockRejectedValueOnce(new Error("secret missing"));
    await expect(send()).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      reason: "token_unavailable",
      error: "secret missing",
    });

    postMessage.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(send()).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      reason: "transport_error",
    });

    postMessage.mockResolvedValueOnce({ ok: true, ts: "not-a-slack-ts" });
    await expect(send()).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      reason: "invalid_provider_response",
    });
    expect(store.failed).toHaveLength(3);
  });

  it("fails closed when the mapped workspace is unavailable", async () => {
    store.target = { status: "workspace_unavailable" };

    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: true,
      reason: "workspace_unavailable",
      error: "Slack workspace is unavailable",
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(store.failed).toHaveLength(1);
  });

  it("persists permanent Slack rejection without retrying the agent callback", async () => {
    postMessage.mockResolvedValueOnce({
      ok: false,
      error: "channel_not_found",
    });

    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: true,
      reason: "provider_rejected",
      error: "channel_not_found",
    });
  });

  it("persists a typed failure when the ThinkWork-to-Slack mapping is missing", async () => {
    store.target = { status: "missing_thread_mapping" };

    await expect(send()).resolves.toEqual({
      delivered: false,
      retryable: true,
      reason: "missing_thread_mapping",
      error: "Slack thread mapping is missing",
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(store.failed).toHaveLength(1);
  });

  it("rejects incomplete Slack provenance before claiming delivery", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = {
      source: "slack",
      slack: {
        slackTeamId: "T123",
        channelId: "C123",
        rootThreadTs: "bad",
        sourceMessage: {},
      },
    };

    await expect(send()).resolves.toMatchObject({
      delivered: false,
      reason: "not_slack_origin",
    });
    expect(store.claimed).toBe(0);
  });
});

describe("retryThreadReplySlackForTurn", () => {
  it("locates the persisted assistant message and retries only failed delivery", async () => {
    store.status = "failed";

    await expect(
      retryThreadReplySlackForTurn(
        {
          tenantId: TENANT_ID,
          threadId: THREAD_ID,
          threadTurnId: TURN_ID,
        },
        deps(),
      ),
    ).resolves.toMatchObject({ delivered: true });
    expect(postMessage).toHaveBeenCalledTimes(1);

    await expect(
      retryThreadReplySlackForTurn(
        {
          tenantId: TENANT_ID,
          threadId: THREAD_ID,
          threadTurnId: TURN_ID,
        },
        deps(),
      ),
    ).resolves.toMatchObject({ reason: "already_delivered" });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("returns a typed skip when the turn produced no assistant message", async () => {
    store.findForTurn = null;
    await expect(
      retryThreadReplySlackForTurn(
        {
          tenantId: TENANT_ID,
          threadId: THREAD_ID,
          threadTurnId: TURN_ID,
        },
        deps(),
      ),
    ).resolves.toEqual({
      delivered: false,
      retryable: false,
      reason: "assistant_message_missing",
    });
  });
});

function send() {
  return sendThreadReplySlack(
    {
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
    },
    deps(),
  );
}

function deps() {
  return {
    store,
    getBotToken,
    postMessage,
    now: () => new Date("2026-07-12T05:00:00.000Z"),
    randomUUID: () => CLAIM_ID,
  };
}

function slackUserMetadata(
  rootThreadTs: string | null = null,
  triggerSurface = "message_im",
) {
  return {
    source: "slack",
    slack: {
      slackTeamId: "T123",
      channelId: "C123",
      rootThreadTs,
      triggerSurface,
      sourceMessage: { ts: "1710000001.000000" },
    },
  };
}
