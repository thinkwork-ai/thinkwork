import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  retryThreadReplySlackForTurn,
  sendThreadReplySlack,
  type SlackThreadReplyStore,
  type SlackTurnArtifact,
} from "./thread-reply.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const ASSISTANT_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const REQUESTER_USER_ID = "66666666-6666-4666-8666-666666666666";
const ARTIFACT_ID = "77777777-7777-4777-8777-777777777777";
const ARTIFACT_CREATOR_ID = "88888888-8888-4888-8888-888888888888";

class FakeStore implements SlackThreadReplyStore {
  context: Awaited<ReturnType<SlackThreadReplyStore["loadContext"]>> = {
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    body: "Final answer",
    assistantMetadata: { sourceTurnId: TURN_ID },
    triggeringUserMetadata: slackUserMetadata(),
    requesterUserId: REQUESTER_USER_ID,
  };
  turnArtifacts: SlackTurnArtifact[] = [];
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

  async loadTurnArtifacts() {
    return this.turnArtifacts;
  }
}

let store: FakeStore;
let getBotToken: ReturnType<typeof vi.fn>;
let postMessage: ReturnType<typeof vi.fn>;
let updateMessage: ReturnType<typeof vi.fn>;
let getShare: ReturnType<typeof vi.fn>;
let signToken: ReturnType<typeof vi.fn>;
let shareBase: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = new FakeStore();
  getBotToken = vi.fn().mockResolvedValue("xoxb-token");
  postMessage = vi
    .fn()
    .mockResolvedValue({ ok: true, ts: "1710000002.000000" });
  updateMessage = vi
    .fn()
    .mockResolvedValue({ ok: true, ts: "1710000001.000000" });
  getShare = vi.fn().mockResolvedValue({ shareId: "share-1", created: true });
  signToken = vi.fn().mockReturnValue("signed-token");
  shareBase = vi.fn().mockReturnValue("https://api.test");
});

describe("sendThreadReplySlack", () => {
  it("posts the persisted assistant body once to the originating Slack thread", async () => {
    await expect(send()).resolves.toEqual({
      delivered: true,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      providerMessageTs: "1710000002.000000",
    });
  });

  it("updates the acknowledgement message in place when an ack ts is present", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = slackUserMetadata(
      null,
      "message_im",
      "1710000001.000000",
    );

    await expect(send()).resolves.toEqual({
      delivered: true,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      providerMessageTs: "1710000001.000000",
    });
    expect(updateMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      ts: "1710000001.000000",
      text: "Final answer",
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(store.delivered).toHaveLength(1);
    expect(store.delivered[0]).toMatchObject({
      providerMessageTs: "1710000001.000000",
    });
  });

  it("falls back to a fresh post when the ack update reports not found", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.triggeringUserMetadata = slackUserMetadata(
      null,
      "message_im",
      "1710000001.000000",
    );
    updateMessage.mockResolvedValueOnce({
      ok: false,
      error: "message_not_found",
    });

    await expect(send()).resolves.toEqual({
      delivered: true,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      providerMessageTs: "1710000002.000000",
    });
    expect(updateMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      text: "Final answer",
      threadTs: "1710000001.000000",
      clientMessageId: ASSISTANT_MESSAGE_ID,
    });
    expect(store.delivered).toHaveLength(1);
    expect(store.delivered[0]).toMatchObject({
      providerMessageTs: "1710000002.000000",
    });
  });

  it("posts a new message when no ack ts is present", async () => {
    await expect(send()).resolves.toMatchObject({ delivered: true });
    expect(updateMessage).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("mints a claim id with the default randomUUID (no ERR_INVALID_THIS)", async () => {
    // Regression: the default randomUUID must not be `crypto.randomUUID`
    // detached from its receiver, which throws ERR_INVALID_THIS when called
    // on the deployed Node runtime (THINK-84 U4). Omit the injected
    // randomUUID so the real default runs.
    const result = await sendThreadReplySlack(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
      },
      { store, getBotToken, postMessage, now: () => new Date() },
    );
    expect(result.delivered).toBe(true);
    expect(store.claimed).toBe(1);

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
      requesterUserId: REQUESTER_USER_ID,
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

  it("converts the markdown body to Slack mrkdwn before posting", async () => {
    if (!store.context) throw new Error("missing context");
    store.context.body = "## Update\n- ship **bold** now";

    await expect(send()).resolves.toMatchObject({ delivered: true });
    const text = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(text).toContain("*Update*");
    expect(text).toContain("• ship *bold* now");
    expect(text).not.toContain("##");
    expect(text).not.toContain("**");
  });

  it("appends a public share link when the turn produced an artifact", async () => {
    store.turnArtifacts = [
      {
        id: ARTIFACT_ID,
        title: "Q3 Pipeline Report",
        createdByUserId: ARTIFACT_CREATOR_ID,
      },
    ];

    await expect(send()).resolves.toMatchObject({ delivered: true });
    const text = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(text).toBe(
      "Final answer\n\n📄 <https://api.test/share/signed-token|Q3 Pipeline Report>",
    );
    expect(getShare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        artifactId: ARTIFACT_ID,
        createdBy: ARTIFACT_CREATOR_ID,
        source: "lambda",
      }),
    );
    expect(signToken).toHaveBeenCalledWith("share-1");
  });

  it("falls back to the requester as the share creator when the artifact has none", async () => {
    store.turnArtifacts = [
      { id: ARTIFACT_ID, title: "Untitled", createdByUserId: null },
    ];

    await expect(send()).resolves.toMatchObject({ delivered: true });
    expect(getShare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdBy: REQUESTER_USER_ID }),
    );
  });

  it("posts only the formatted body when the turn produced no artifacts", async () => {
    store.turnArtifacts = [];

    await expect(send()).resolves.toMatchObject({ delivered: true });
    const text = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(text).toBe("Final answer");
    expect(text).not.toContain("📄");
    expect(getShare).not.toHaveBeenCalled();
  });

  it("still delivers when the share mint throws (best-effort links)", async () => {
    store.turnArtifacts = [
      {
        id: ARTIFACT_ID,
        title: "Broken Share",
        createdByUserId: ARTIFACT_CREATOR_ID,
      },
    ];
    getShare.mockRejectedValueOnce(new Error("share mint failed"));

    await expect(send()).resolves.toMatchObject({ delivered: true });
    const text = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(text).toBe("Final answer");
    expect(text).not.toContain("📄");
  });

  it("skips link appending when the share base is unresolved", async () => {
    store.turnArtifacts = [
      {
        id: ARTIFACT_ID,
        title: "No Base",
        createdByUserId: ARTIFACT_CREATOR_ID,
      },
    ];
    shareBase.mockReturnValue(null);

    await expect(send()).resolves.toMatchObject({ delivered: true });
    const text = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(text).toBe("Final answer");
    expect(getShare).not.toHaveBeenCalled();
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
    updateMessage,
    now: () => new Date("2026-07-12T05:00:00.000Z"),
    randomUUID: () => CLAIM_ID,
    getShare,
    signToken,
    shareBase,
  };
}

function slackUserMetadata(
  rootThreadTs: string | null = null,
  triggerSurface = "message_im",
  ackTs: string | null = null,
) {
  return {
    source: "slack",
    slack: {
      slackTeamId: "T123",
      channelId: "C123",
      rootThreadTs,
      triggerSurface,
      ...(ackTs ? { ackTs } : {}),
      sourceMessage: { ts: "1710000001.000000" },
    },
  };
}
