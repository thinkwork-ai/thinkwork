import { describe, expect, it, vi } from "vitest";
import type { SlackWorkspaceContext } from "./_shared.js";
import {
  createSlackInteractivityDispatcher,
  extractInteractivityTeamId,
  parseInteractivityPayload,
} from "./interactivity.js";

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

const LINKED_COMPUTER = {
  userId: "user-1",
  slackUserName: "Eric",
  computerId: "computer-1",
  computerName: "Finance Computer",
  computerSlug: "finance-computer",
};

function makeRawPayload(payload: Record<string, unknown>) {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

function makeArgs(payload: Record<string, unknown>) {
  const rawBodyText = makeRawPayload(payload);
  return {
    event: {} as any,
    headers: {},
    rawBody: Buffer.from(rawBodyText),
    rawBodyText,
    workspace: WORKSPACE,
    botToken: "xoxb-token",
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const callOrder: string[] = [];
  const enqueueTask = vi.fn(async (input: any) => {
    callOrder.push("enqueueTask");
    return {
      id: "task-1",
      input: input.taskInput,
      wasCreated: true,
    };
  });
  const loadLinkedComputer = vi.fn(async () => LINKED_COMPUTER);
  const resolveSlackThread = vi.fn(async () => ({
    threadId: "thread-1",
    messageId: "message-1",
    wasCreated: true,
  }));
  const slackApi = {
    openView: vi.fn(async () => {
      callOrder.push("openView");
      return { ok: true, view: { id: "V123" } };
    }),
    postMessage: vi.fn(async () => ({ ok: true, ts: "1710000002.000000" })),
    respond: vi.fn(async () => {}),
  };
  return {
    callOrder,
    enqueueTask,
    loadLinkedComputer,
    resolveSlackThread,
    slackApi,
    ...overrides,
  };
}

function messageActionPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "message_action",
    callback_id: "thinkwork_message_action",
    trigger_id: "trigger-1",
    response_url: "https://hooks.slack.com/actions/response",
    team: { id: "T123" },
    user: { id: "U123" },
    channel: { id: "C123" },
    message: {
      user: "U456",
      text: "Review this file",
      ts: "1710000001.000000",
      thread_ts: "1710000000.000000",
      files: [
        {
          id: "F123",
          name: "brief.pdf",
          mimetype: "application/pdf",
          url_private: "https://files.slack.com/files-pri/F123",
        },
      ],
    },
    ...overrides,
  };
}

function promoteActionPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "block_actions",
    response_url: "https://hooks.slack.com/actions/response",
    team: { id: "T123" },
    user: { id: "U123" },
    channel: { id: "C123" },
    message: {
      text: "Here is the answer.",
      ts: "1710000001.000000",
      thread_ts: "1710000000.000000",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Here is the answer." },
        },
      ],
    },
    actions: [{ action_id: "slack_promote_response" }],
    ...overrides,
  };
}

describe("Slack interactivity handler", () => {
  it("parses form-encoded interactivity payloads", () => {
    const rawBody = makeRawPayload(messageActionPayload());

    expect(extractInteractivityTeamId(rawBody)).toBe("T123");
    expect(parseInteractivityPayload(rawBody)).toMatchObject({
      type: "message_action",
      trigger_id: "trigger-1",
    });
  });

  it("opens the message-action modal before enqueueing the linked Computer task", async () => {
    const deps = makeDeps();
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(makeArgs(messageActionPayload()));

    expect(res.statusCode).toBe(200);
    expect(deps.callOrder).toEqual(["openView", "enqueueTask"]);
    expect(deps.slackApi.openView).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-token",
        triggerId: "trigger-1",
      }),
    );
    expect(deps.loadLinkedComputer).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "Review this file",
      }),
    );
    expect(deps.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskType: "thread_turn",
        idempotencyKey: "message_action:trigger-1",
        createdByUserId: "user-1",
        taskInput: expect.objectContaining({
          source: "slack",
          channelType: "message_action",
          slackTeamId: "T123",
          slackUserId: "U123",
          threadId: "thread-1",
          messageId: "message-1",
          triggerSurface: "message_action",
          channelId: "C123",
          threadTs: "1710000000.000000",
          messageTs: "1710000001.000000",
          responseUrl: "https://hooks.slack.com/actions/response",
          modalViewId: "V123",
          sourceMessage: expect.objectContaining({
            text: "Review this file",
          }),
          fileRefs: [
            {
              id: "F123",
              name: "brief.pdf",
              mimetype: "application/pdf",
              urlPrivate: "https://files.slack.com/files-pri/F123",
              urlPrivateDownload: null,
              permalink: null,
              sizeBytes: null,
            },
          ],
          slack: expect.objectContaining({
            slackWorkspaceRowId: "workspace-1",
            triggerSurface: "message_action",
          }),
        }),
      }),
    );
  });

  it("returns a graceful message and does not enqueue when the trigger is expired", async () => {
    const deps = makeDeps({
      slackApi: {
        openView: vi.fn(async () => ({
          ok: false,
          error: "expired_trigger_id",
        })),
        postMessage: vi.fn(async () => ({ ok: true })),
        respond: vi.fn(async () => {}),
      },
    });
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(makeArgs(messageActionPayload()));
    const body = JSON.parse(res.body || "{}");

    expect(res.statusCode).toBe(200);
    expect(body.text).toContain("try again");
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it("promotes an ephemeral response to a public channel message and deletes the original", async () => {
    const deps = makeDeps();
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(makeArgs(promoteActionPayload()));

    expect(res.statusCode).toBe(200);
    expect(deps.slackApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-token",
        channel: "C123",
        threadTs: "1710000000.000000",
        text: expect.stringContaining("Here is the answer."),
      }),
    );
    expect(deps.slackApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Posted from ThinkWork by <@U123>."),
      }),
    );
    expect(deps.slackApi.respond).toHaveBeenCalledWith({
      responseUrl: "https://hooks.slack.com/actions/response",
      body: { delete_original: true },
    });
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it("keeps the ephemeral response when public promotion fails", async () => {
    const deps = makeDeps({
      slackApi: {
        openView: vi.fn(async () => ({ ok: true, view: { id: "V123" } })),
        postMessage: vi.fn(async () => ({
          ok: false,
          error: "not_in_channel",
        })),
        respond: vi.fn(async () => {}),
      },
    });
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(makeArgs(promoteActionPayload()));
    const body = JSON.parse(res.body || "{}");

    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ ok: false, error: "slack_post_failed" });
    expect(deps.slackApi.respond).not.toHaveBeenCalled();
  });

  it("returns a connect URL for the App Home connect button without enqueueing", async () => {
    const deps = makeDeps();
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(
      makeArgs({
        type: "block_actions",
        team: { id: "T123" },
        user: { id: "U123" },
        actions: [{ action_id: "connect_thinkwork" }],
      }),
    );
    const body = JSON.parse(res.body || "{}");

    expect(res.statusCode).toBe(200);
    expect(body.redirect_url).toContain("slackTeamId=T123");
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it("returns a structured 400 for unknown payload types without invoking downstream work", async () => {
    const deps = makeDeps();
    const dispatch = createSlackInteractivityDispatcher(deps);

    const res = await dispatch(
      makeArgs({
        type: "view_submission",
        team: { id: "T123" },
        user: { id: "U123" },
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body || "{}")).toEqual({
      error: "Unsupported Slack interactivity payload type",
    });
    expect(deps.enqueueTask).not.toHaveBeenCalled();
    expect(deps.slackApi.openView).not.toHaveBeenCalled();
  });
});
