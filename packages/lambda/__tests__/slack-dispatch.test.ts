import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => mocks.db,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  computerEvents: {},
  computerTasks: {},
  slackWorkspaces: {},
  users: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  asc: (arg: unknown) => ({ asc: arg }),
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: (...args: unknown[]) => ({ sql: args }),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(),
  GetSecretValueCommand: vi.fn(),
}));

import { dispatchSlackCompletions } from "../slack-dispatch.js";

function pending(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    tenantId: "tenant-1",
    computerId: "computer-1",
    taskId: "task-1",
    response: "Quarterly revenue was $42M.",
    botTokenSecretPath: "secret/slack-bot",
    actor: {
      userId: "user-1",
      displayName: "Eric",
      avatarUrl: "https://example.com/avatar.png",
    },
    slack: {
      slackTeamId: "T123",
      slackUserId: "U123",
      channelId: "C123",
      channelType: "channel",
      rootThreadTs: "1710000000.000000",
      responseUrl: null,
      triggerSurface: "app_mention",
      sourceMessage: { ts: "1710000001.000000" },
      threadContext: [],
      fileRefs: [],
      placeholderTs: null,
      modalViewId: null,
    },
    ...overrides,
  };
}

function makeStore(items: Array<Record<string, unknown>>): any {
  return {
    loadPending: vi.fn(async () => items),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    recordAttributionDegraded: vi.fn(async () => undefined),
  };
}

function makeSlackApi(overrides: Record<string, unknown> = {}) {
  return {
    postMessage: vi.fn(async () => ({ ok: true, ts: "1720000000.000000" })),
    updateMessage: vi.fn(async () => ({ ok: true, ts: "1710000002.000000" })),
    updateView: vi.fn(async () => ({ ok: true })),
    postResponseUrl: vi.fn(async () => ({ ok: true })),
    usersInfo: vi.fn(async () => ({
      ok: true,
      user: {
        real_name: "Slack Eric",
        profile: { image_72: "https://example.com/slack-avatar.png" },
      },
    })),
    ...overrides,
  };
}

describe("slack dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates an existing placeholder instead of posting a second message", async () => {
    const store = makeStore([
      pending({
        slack: {
          ...pending().slack,
          placeholderTs: "1710000002.000000",
        },
      }),
    ]);
    const slackApi = makeSlackApi();

    const result = await dispatchSlackCompletions(
      {},
      {
        store,
        slackApi,
        getBotToken: async () => "xoxb-token",
      },
    );

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(slackApi.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        ts: "1710000002.000000",
        username: "Eric's Computer",
        iconUrl: "https://example.com/avatar.png",
      }),
    );
    expect(slackApi.postMessage).not.toHaveBeenCalled();
    expect(store.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "chat_update", degraded: false }),
    );
  });

  it("uses response_url for slash command completions and includes promote button", async () => {
    const store = makeStore([
      pending({
        slack: {
          ...pending().slack,
          responseUrl: "https://hooks.slack.com/actions/response",
          triggerSurface: "slash_command",
        },
      }),
    ]);
    const slackApi = makeSlackApi();

    await dispatchSlackCompletions(
      {},
      { store, slackApi, getBotToken: async () => "xoxb-token" },
    );

    expect(slackApi.postResponseUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        responseUrl: "https://hooks.slack.com/actions/response",
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: "actions" }),
        ]),
      }),
    );
    expect(slackApi.postMessage).not.toHaveBeenCalled();
    expect(store.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "response_url" }),
    );
  });

  it("updates the message action modal and posts in the source thread", async () => {
    const store = makeStore([
      pending({
        slack: {
          ...pending().slack,
          modalViewId: "V123",
          triggerSurface: "message_action",
        },
      }),
    ]);
    const slackApi = makeSlackApi();

    await dispatchSlackCompletions(
      {},
      { store, slackApi, getBotToken: async () => "xoxb-token" },
    );

    expect(slackApi.updateView).toHaveBeenCalledWith(
      expect.objectContaining({ viewId: "V123" }),
    );
    expect(slackApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        threadTs: "1710000000.000000",
      }),
    );
    expect(store.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "modal_post_message" }),
    );
  });

  it("falls back to bot identity when customize scope is missing", async () => {
    const store = makeStore([pending()]);
    const slackApi = makeSlackApi({
      postMessage: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: "missing_scope" })
        .mockResolvedValueOnce({ ok: true, ts: "1720000000.000000" }),
    });

    await dispatchSlackCompletions(
      {},
      { store, slackApi, getBotToken: async () => "xoxb-token" },
    );

    expect(store.recordAttributionDegraded).toHaveBeenCalledWith(
      expect.objectContaining({ error: "missing_scope" }),
    );
    expect(slackApi.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        username: undefined,
        iconUrl: null,
        text: expect.stringContaining("*Eric's Computer:*"),
      }),
    );
    expect(store.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ degraded: true }),
    );
  });

  it("records a terminal failure when the workspace bot token is gone", async () => {
    const store = makeStore([pending({ botTokenSecretPath: null })]);
    const slackApi = makeSlackApi();

    const result = await dispatchSlackCompletions(
      {},
      { store, slackApi, getBotToken: async () => "xoxb-token" },
    );

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: true,
        error: "Slack bot token secret path is missing",
      }),
    );
  });

  it("includes the attribution footer on every outbound Slack message", async () => {
    const store = makeStore([pending()]);
    const slackApi = makeSlackApi();

    await dispatchSlackCompletions(
      {},
      { store, slackApi, getBotToken: async () => "xoxb-token" },
    );

    expect(slackApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "context",
            elements: expect.arrayContaining([
              expect.objectContaining({
                text: "Routed via @ThinkWork · Eric's Computer",
              }),
            ]),
          }),
        ]),
      }),
    );
  });
});
