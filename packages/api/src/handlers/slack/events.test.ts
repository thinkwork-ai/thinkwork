import { describe, expect, it, vi } from "vitest";
import type { SlackWorkspaceContext } from "./_shared.js";
import {
  createSlackEventsDispatcher,
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

const LINKED_COMPUTER = {
  userId: "user-1",
  slackUserName: "Eric",
  computerId: "computer-1",
  computerName: "Eric's Computer",
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

function makeDeps(overrides: Record<string, unknown> = {}) {
  const enqueueTask = vi.fn(async (input: any) => ({
    id: "task-1",
    tenantId: input.tenantId,
    computerId: input.computerId,
    input: input.taskInput,
    idempotencyKey: input.idempotencyKey,
    wasCreated: true,
  }));
  const loadLinkedComputer = vi.fn(async () => LINKED_COMPUTER);
  const updateTaskInput = vi.fn(async () => {});
  const resolveSlackThread = vi.fn(async () => ({
    threadId: "thread-1",
    messageId: "message-1",
    wasCreated: true,
  }));
  const slackApi = {
    fetchThreadMessages: vi.fn(async () => [
      { user: "U123", botId: null, ts: "1710000000.000000", text: "Earlier" },
      { user: "U123", botId: null, ts: "1710000001.000000", text: "Help" },
    ]),
    postMessage: vi.fn(async () => ({ ok: true, ts: "1710000002.000000" })),
    sendLinkPrompt: vi.fn(async () => {}),
  };
  const metrics = {
    dedupeHit: vi.fn(),
  };
  return {
    enqueueTask,
    loadLinkedComputer,
    updateTaskInput,
    resolveSlackThread,
    slackApi,
    metrics,
    ...overrides,
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
      text: "<@B123> help",
      ts: "1710000001.000000",
      files: [
        {
          id: "F123",
          name: "brief.pdf",
          mimetype: "application/pdf",
          url_private: "https://files.slack.com/files-pri/F123",
        },
      ],
      ...overrides,
    },
  };
}

describe("Slack events handler", () => {
  it("responds to Slack URL verification before workspace lookup", async () => {
    const res = await handleUrlVerification({
      rawBodyText: JSON.stringify({
        type: "url_verification",
        challenge: "challenge-1",
      }),
    });

    expect(res?.statusCode).toBe(200);
    expect(res?.body).toBe("challenge-1");
  });

  it("enqueues linked app mentions with Slack envelope, context, files, and branded placeholder metadata", async () => {
    const deps = makeDeps();
    const dispatch = createSlackEventsDispatcher(deps);

    const res = await dispatch(makeArgs(appMentionPayload()));

    expect(res.statusCode).toBe(200);
    expect(deps.loadLinkedComputer).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slackTeamId: "T123",
      slackUserId: "U123",
    });
    expect(deps.slackApi.fetchThreadMessages).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      threadTs: "1710000001.000000",
    });
    expect(deps.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskType: "thread_turn",
        idempotencyKey: "Ev123",
        createdByUserId: "user-1",
        taskInput: expect.objectContaining({
          source: "slack",
          channelType: "app_mention",
          slackTeamId: "T123",
          slackUserId: "U123",
          threadId: "thread-1",
          messageId: "message-1",
          triggerSurface: "app_mention",
          channelId: "C123",
          threadTs: "1710000001.000000",
          sourceMessage: expect.objectContaining({ text: "<@B123> help" }),
          threadContext: expect.arrayContaining([
            expect.objectContaining({ text: "Earlier" }),
          ]),
          fileRefs: [
            {
              id: "F123",
              name: "brief.pdf",
              mimetype: "application/pdf",
              urlPrivate: "https://files.slack.com/files-pri/F123",
              permalink: null,
            },
          ],
          slack: expect.objectContaining({
            slackWorkspaceRowId: "workspace-1",
            triggerSurface: "app_mention",
          }),
        }),
      }),
    );
    expect(deps.slackApi.postMessage).toHaveBeenCalledWith({
      token: "xoxb-token",
      channel: "C123",
      threadTs: "1710000001.000000",
      text: "Marco is thinking...",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Marco is thinking..." },
        },
      ],
      username: "ThinkWork",
      iconUrl: "https://admin.thinkwork.ai/slack-icon.png",
    });
    expect(deps.updateTaskInput).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        taskInput: expect.objectContaining({
          placeholderTs: "1710000002.000000",
          slack: expect.objectContaining({
            placeholderTs: "1710000002.000000",
          }),
        }),
      }),
    );
  });

  it("accepts direct messages as Slack thread turns", async () => {
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
          ts: "1710000001.000000",
        },
      }),
    );

    expect(deps.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskInput: expect.objectContaining({
          channelType: "im",
          channelId: "D123",
        }),
      }),
    );
  });

  it("does not enqueue duplicate Slack event ids", async () => {
    const deps = makeDeps({
      enqueueTask: vi.fn(async (input: any) => ({
        id: "task-1",
        input: input.taskInput,
        wasCreated: false,
      })),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const res = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(res.body || "{}")).toEqual({
      ok: true,
      duplicate: true,
      taskId: "task-1",
    });
    expect(deps.metrics.dedupeHit).toHaveBeenCalledWith({
      surface: "app_mention",
    });
    expect(deps.slackApi.postMessage).not.toHaveBeenCalled();
    expect(deps.updateTaskInput).not.toHaveBeenCalled();
  });

  it("prompts unlinked Slack users instead of enqueuing Computer work", async () => {
    const deps = makeDeps({
      loadLinkedComputer: vi.fn(async () => null),
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const res = await dispatch(makeArgs(appMentionPayload()));

    expect(JSON.parse(res.body || "{}")).toEqual({
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
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it("does not fail enqueue when placeholder posting fails", async () => {
    const deps = makeDeps({
      slackApi: {
        fetchThreadMessages: vi.fn(async () => []),
        postMessage: vi.fn(async () => ({ ok: false, error: "channel_error" })),
        sendLinkPrompt: vi.fn(async () => {}),
      },
    });
    const dispatch = createSlackEventsDispatcher(deps);

    const res = await dispatch(makeArgs(appMentionPayload()));

    expect(res.statusCode).toBe(200);
    expect(deps.enqueueTask).toHaveBeenCalledTimes(1);
    expect(deps.updateTaskInput).not.toHaveBeenCalled();
  });
});
