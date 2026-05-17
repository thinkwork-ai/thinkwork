import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  auditOutbox: {},
  COMPLIANCE_ACTOR_TYPES: ["user", "system"],
  COMPLIANCE_EVENT_TYPES: ["attachment.received"],
  computerEvents: {},
  computers: {},
  computerTasks: {},
  messages: {},
  slackWorkspaces: {},
  threadAttachments: {},
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

import type { SlackWorkspaceContext } from "../../src/handlers/slack/_shared.js";
import { createSlackEventsDispatcher } from "../../src/handlers/slack/events.js";
import { createSlackInteractivityDispatcher } from "../../src/handlers/slack/interactivity.js";
import { createSlackSlashCommandDispatcher } from "../../src/handlers/slack/slash-command.js";
import { createSlackMetrics } from "../../src/lib/slack/metrics.js";

const WORKSPACE_W1: SlackWorkspaceContext = {
  id: "slack-workspace-w1",
  tenantId: "tenant-1",
  slackTeamId: "T-W1",
  slackTeamName: "Finance Workspace",
  botUserId: "B-TW",
  botTokenSecretPath: "secret/w1",
  appId: "A-TW",
  status: "active",
};

const WORKSPACE_W2: SlackWorkspaceContext = {
  ...WORKSPACE_W1,
  id: "slack-workspace-w2",
  slackTeamId: "T-W2",
  slackTeamName: "Ops Workspace",
  botTokenSecretPath: "secret/w2",
};

interface EnqueuedTask {
  id: string;
  tenantId: string;
  computerId: string;
  taskInput: Record<string, any>;
  createdByUserId: string;
}

function makeHarness() {
  const tasks: EnqueuedTask[] = [];
  const idempotencyKeys = new Set<string>();
  const links = new Map<string, any>([
    [
      "T-W1:U-A",
      {
        userId: "user-a",
        slackUserName: "Alice",
        computerId: "computer-a",
        computerName: "Finance Computer",
        computerSlug: "finance-computer",
      },
    ],
    [
      "T-W1:U-B",
      {
        userId: "user-b",
        slackUserName: "Bob",
        computerId: "computer-b",
        computerName: "Sales Computer",
        computerSlug: "sales-computer",
      },
    ],
    [
      "T-W2:U-A",
      {
        userId: "user-a",
        slackUserName: "Alice",
        computerId: "computer-a",
        computerName: "Finance Computer",
        computerSlug: "finance-computer",
      },
    ],
  ]);
  const metrics = {
    dedupeHit: vi.fn(),
    dispatchSuccess: vi.fn(),
    dispatchFailure: vi.fn(),
    attributionDegraded: vi.fn(),
  };
  const visible = {
    placeholders: [] as any[],
    linkPrompts: [] as any[],
    postedMessages: [] as any[],
    updatedMessages: [] as any[],
    responseUrlPosts: [] as any[],
    modalUpdates: [] as any[],
  };
  const threadMessages = new Map<string, any[]>();
  const enqueueTask = vi.fn(async (input: any) => {
    if (idempotencyKeys.has(input.idempotencyKey)) {
      return {
        id: "duplicate-task",
        input: input.taskInput,
        wasCreated: false,
      };
    }
    idempotencyKeys.add(input.idempotencyKey);
    const task: EnqueuedTask = {
      id: `task-${tasks.length + 1}`,
      tenantId: input.tenantId,
      computerId: input.computerId,
      taskInput: input.taskInput,
      createdByUserId: input.createdByUserId,
    };
    tasks.push(task);
    return { id: task.id, input: task.taskInput, wasCreated: true };
  });
  const loadLinkedComputer = vi.fn(async (input: any) => {
    return links.get(`${input.slackTeamId}:${input.slackUserId}`) ?? null;
  });
  const resolveTarget = vi.fn(async (input: any) => {
    const link = links.get(`${input.slackTeamId}:${input.slackUserId}`);
    if (!link) return { status: "unlinked" as const };
    return {
      status: "resolved" as const,
      target: {
        ...link,
        prompt: String(input.text ?? "")
          .replace(/^finance\s+/i, "")
          .trim(),
        targetToken: "finance",
      },
    };
  });
  const updateTaskInput = vi.fn(async (input: any) => {
    const task = tasks.find((item) => item.id === input.taskId);
    if (task) task.taskInput = input.taskInput;
  });
  const materializeSlackFiles = vi.fn(async () => []);
  const resolveSlackThread = vi.fn(async (input: any) => ({
    threadId: `thread:${input.envelope.slackTeamId}:${input.envelope.channelId}`,
    messageId: `message:${input.envelope.eventId}`,
    wasCreated: true,
  }));
  const slackEventsApi = {
    fetchThreadMessages: vi.fn(async (input: any) => {
      return threadMessages.get(`${input.channel}:${input.threadTs}`) ?? [];
    }),
    postMessage: vi.fn(async (input: any) => {
      visible.placeholders.push(input);
      return { ok: true, ts: `placeholder-${visible.placeholders.length}` };
    }),
    sendLinkPrompt: vi.fn(async (input: any) => {
      visible.linkPrompts.push(input);
    }),
  };
  const slackDispatchApi = {
    postMessage: vi.fn(async (input: any) => {
      visible.postedMessages.push(input);
      return { ok: true, ts: `posted-${visible.postedMessages.length}` };
    }),
    updateMessage: vi.fn(async (input: any) => {
      visible.updatedMessages.push(input);
      return { ok: true, ts: input.ts };
    }),
    updateView: vi.fn(async (input: any) => {
      visible.modalUpdates.push(input);
      return { ok: true };
    }),
    postResponseUrl: vi.fn(async (input: any) => {
      visible.responseUrlPosts.push(input);
      return { ok: true };
    }),
    usersInfo: vi.fn(async (input: any) => ({
      ok: true,
      user: {
        real_name: input.userId === "U-B" ? "Bob" : "Alice",
        profile: { image_72: `https://example.com/${input.userId}.png` },
      },
    })),
  };
  const store = (items: any[]) => ({
    loadPending: vi.fn(async () => items),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    recordAttributionDegraded: vi.fn(async () => undefined),
  });

  return {
    tasks,
    links,
    metrics,
    visible,
    threadMessages,
    enqueueTask,
    loadLinkedComputer,
    resolveTarget,
    updateTaskInput,
    materializeSlackFiles,
    resolveSlackThread,
    slackEventsApi,
    slackDispatchApi,
    store,
  };
}

function eventArgs(workspace: SlackWorkspaceContext, payload: unknown) {
  const rawBodyText = JSON.stringify(payload);
  return {
    event: {} as any,
    headers: {},
    rawBody: Buffer.from(rawBodyText),
    rawBodyText,
    workspace,
    botToken: "xoxb-token",
  };
}

function appMentionPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T-W1",
    event_id: "Ev-AE1",
    event: {
      type: "app_mention",
      team: "T-W1",
      user: "U-A",
      channel: "C-finance",
      text: "<@B-TW> finance summarize revenue",
      ts: "1710000001.000000",
      ...overrides,
    },
  };
}

function dmPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T-W1",
    event_id: "Ev-DM",
    event: {
      type: "message",
      channel_type: "im",
      team: "T-W1",
      user: "U-A",
      channel: "D-finance",
      text: "Can you review this file?",
      ts: "1710000001.000000",
      ...overrides,
    },
  };
}

function slashArgs(workspace: SlackWorkspaceContext, overrides = {}) {
  const rawBodyText = new URLSearchParams({
    team_id: workspace.slackTeamId,
    user_id: "U-A",
    channel_id: "C-finance",
    text: "finance what was Q3 revenue?",
    response_url: "https://hooks.slack.com/commands/response",
    trigger_id: "trigger-slash",
    ...overrides,
  }).toString();
  return {
    event: {} as any,
    headers: {},
    rawBody: Buffer.from(rawBodyText),
    rawBodyText,
    workspace,
    botToken: "xoxb-token",
  };
}

function interactivityArgs(
  workspace: SlackWorkspaceContext,
  payload: Record<string, unknown>,
) {
  const rawBodyText = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  return {
    event: {} as any,
    headers: {},
    rawBody: Buffer.from(rawBodyText),
    rawBodyText,
    workspace,
    botToken: "xoxb-token",
  };
}

async function dispatchCompletedTask(harness: ReturnType<typeof makeHarness>) {
  const task = harness.tasks.at(-1)!;
  await replayCompletedTask(harness, task);
}

async function replayCompletedTask(
  harness: ReturnType<typeof makeHarness>,
  task: EnqueuedTask,
) {
  const slack = task.taskInput.slack;
  const response = "Quarterly revenue was $42M.";
  const attributed = {
    token: "xoxb-token",
    channel: slack.channelId,
    threadTs: slack.rootThreadTs || slack.sourceMessage?.ts || undefined,
    text: response,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: response } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Routed via @ThinkWork · Finance Computer · requested by Alice",
          },
        ],
      },
    ],
    username: "ThinkWork",
    iconUrl: "https://admin.thinkwork.ai/slack-icon.png",
  };
  if (slack.modalViewId) {
    await harness.slackDispatchApi.updateView({
      token: "xoxb-token",
      viewId: slack.modalViewId,
      text: "Posted to Slack",
      blocks: [],
    });
    await harness.slackDispatchApi.postMessage(attributed);
  } else if (slack.responseUrl) {
    await harness.slackDispatchApi.postResponseUrl({
      responseUrl: slack.responseUrl,
      text: response,
      blocks: [
        ...attributed.blocks,
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Post to channel" },
              action_id: "slack_promote_response",
            },
          ],
        },
      ],
    });
  } else if (slack.placeholderTs) {
    await harness.slackDispatchApi.updateMessage({
      ...attributed,
      ts: slack.placeholderTs,
    });
  } else {
    await harness.slackDispatchApi.postMessage(attributed);
  }
  harness.metrics.dispatchSuccess(slack.triggerSurface);
}

describe("Slack origin acceptance examples", () => {
  it("covers AE1: linked @mentions route to the selected shared Computer and requester", async () => {
    const harness = makeHarness();
    const dispatch = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });

    await dispatch(eventArgs(WORKSPACE_W1, appMentionPayload()));
    await dispatchCompletedTask(harness);

    expect(harness.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        computerId: "computer-a",
        createdByUserId: "user-a",
        taskInput: expect.objectContaining({
          slackUserId: "U-A",
          channelId: "C-finance",
          slack: expect.objectContaining({
            slackWorkspaceRowId: "slack-workspace-w1",
          }),
        }),
      }),
    );
    expect(harness.visible.placeholders[0]).toMatchObject({
      channel: "C-finance",
      username: "ThinkWork",
      iconUrl: "https://admin.thinkwork.ai/slack-icon.png",
      text: "Marco is thinking...",
    });
    expect(harness.visible.updatedMessages[0]).toMatchObject({
      channel: "C-finance",
      username: "ThinkWork",
      iconUrl: "https://admin.thinkwork.ai/slack-icon.png",
    });
    expect(harness.metrics.dispatchSuccess).toHaveBeenCalledWith("app_mention");
  });

  it("covers AE2: unlinked users get a link prompt, then proceed after linking", async () => {
    const harness = makeHarness();
    harness.links.delete("T-W1:U-A");
    const dispatch = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });

    const first = await dispatch(eventArgs(WORKSPACE_W1, appMentionPayload()));
    harness.links.set("T-W1:U-A", {
      userId: "user-a",
      slackUserName: "Alice",
      computerId: "computer-a",
      computerName: "Finance Computer",
      computerSlug: "finance-computer",
    });
    await dispatch(
      eventArgs(WORKSPACE_W1, {
        ...appMentionPayload({ ts: "1710000002.000000" }),
        event_id: "Ev-AE2-linked",
      }),
    );

    expect(JSON.parse(first.body || "{}")).toMatchObject({
      reason: "slack_user_unlinked",
    });
    expect(harness.visible.linkPrompts[0]).toMatchObject({
      slackUserId: "U-A",
      channelId: "C-finance",
    });
    expect(harness.tasks).toHaveLength(1);
  });

  it("covers AE3: slash commands respond ephemerally and promote to a public attributed message", async () => {
    const harness = makeHarness();
    const slash = createSlackSlashCommandDispatcher({
      enqueueTask: harness.enqueueTask,
      resolveTarget: harness.resolveTarget,
      resolveSlackThread: harness.resolveSlackThread,
      metrics: harness.metrics,
    });
    const interactivity = createSlackInteractivityDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      resolveSlackThread: harness.resolveSlackThread,
      slackApi: {
        openView: vi.fn(),
        postMessage: harness.slackDispatchApi.postMessage,
        respond: vi.fn(async () => undefined),
      },
      metrics: harness.metrics,
    });

    const ack = await slash(slashArgs(WORKSPACE_W1));
    await dispatchCompletedTask(harness);
    await interactivity(
      interactivityArgs(WORKSPACE_W1, {
        type: "block_actions",
        response_url: "https://hooks.slack.com/promote",
        team: { id: "T-W1" },
        user: { id: "U-A" },
        channel: { id: "C-finance" },
        message: {
          text: "Quarterly revenue was $42M.",
          ts: "1710000100.000000",
        },
        actions: [{ action_id: "slack_promote_response" }],
      }),
    );

    expect(ack).toMatchObject({ statusCode: 200, body: "" });
    expect(harness.visible.responseUrlPosts[0].blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "actions" })]),
    );
    expect(harness.visible.postedMessages[0].text).toContain(
      "Quarterly revenue was $42M.",
    );
    expect(harness.metrics.dispatchSuccess).toHaveBeenCalledWith(
      "slash_command",
    );
  });

  it("covers AE4: thread context is limited to the source thread and includes PDFs", async () => {
    const harness = makeHarness();
    harness.threadMessages.set("C-finance:1710000000.000000", [
      { user: "U-A", ts: "1710000000.000000", text: "Root" },
      { user: "U-B", ts: "1710000001.000000", text: "Prior 1" },
      { user: "U-A", ts: "1710000002.000000", text: "Prior 2" },
      { user: "U-B", ts: "1710000003.000000", text: "Prior 3" },
    ]);
    harness.threadMessages.set("C-finance:outside-thread", [
      { user: "U-B", ts: "outside-thread", text: "Do not include" },
    ]);
    const dispatch = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });

    await dispatch(
      eventArgs(
        WORKSPACE_W1,
        appMentionPayload({
          event_id: "Ev-AE4",
          thread_ts: "1710000000.000000",
          ts: "1710000004.000000",
          files: [
            {
              id: "F-pdf",
              name: "q3.pdf",
              mimetype: "application/pdf",
              url_private: "https://files.slack.com/q3.pdf",
            },
          ],
        }),
      ),
    );

    const input = harness.tasks[0].taskInput;
    expect(input.threadContext).toHaveLength(4);
    expect(
      input.threadContext.map((message: any) => message.text),
    ).not.toContain("Do not include");
    expect(input.fileRefs).toEqual([
      expect.objectContaining({ id: "F-pdf", mimetype: "application/pdf" }),
    ]);
  });

  it("covers AE4b: replies inherit files uploaded earlier in the Slack thread", async () => {
    const harness = makeHarness();
    harness.threadMessages.set("D-finance:1710000000.000000", [
      {
        user: "U-A",
        ts: "1710000000.000000",
        text: "summarize this file",
        files: [
          {
            id: "F-md",
            name: "agentic-etl-architecture-v5.md",
            mimetype: "text/plain",
            urlPrivate:
              "https://files.slack.com/agentic-etl-architecture-v5.md",
            urlPrivateDownload:
              "https://files.slack.com/download/agentic-etl-architecture-v5.md",
            permalink: "https://example.slack.com/files/F-md",
            sizeBytes: 28622,
          },
        ],
      },
      {
        user: "U-A",
        ts: "1710000001.000000",
        text: "Can you review this file?",
      },
    ]);
    const dispatch = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });

    await dispatch(
      eventArgs(
        WORKSPACE_W1,
        dmPayload({
          event_id: "Ev-AE4b",
          channel: "D-finance",
          text: "Can you review this file?",
          thread_ts: "1710000000.000000",
          ts: "1710000001.000000",
        }),
      ),
    );

    const input = harness.tasks[0].taskInput;
    expect(input.sourceMessage.files).toEqual([]);
    expect(input.fileRefs).toEqual([
      expect.objectContaining({
        id: "F-md",
        name: "agentic-etl-architecture-v5.md",
      }),
    ]);
    expect(harness.materializeSlackFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        fileRefs: [
          expect.objectContaining({
            id: "F-md",
            name: "agentic-etl-architecture-v5.md",
          }),
        ],
      }),
    );
  });

  it("covers AE5: one tenant can bind multiple Slack workspaces for the same user", async () => {
    const harness = makeHarness();
    const dispatch = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });

    await dispatch(eventArgs(WORKSPACE_W1, appMentionPayload()));
    await dispatch(
      eventArgs(WORKSPACE_W2, {
        ...appMentionPayload({
          team: "T-W2",
          channel: "C-ops",
        }),
        team_id: "T-W2",
        event_id: "Ev-AE5-W2",
      }),
    );

    expect(harness.tasks.map((task) => task.createdByUserId)).toEqual([
      "user-a",
      "user-a",
    ]);
    expect(
      harness.tasks.map((task) => task.taskInput.slack.slackWorkspaceRowId),
    ).toEqual(["slack-workspace-w1", "slack-workspace-w2"]);
  });

  it("covers AE6 and R15: all surfaces ack quickly, then receive completed responses", async () => {
    const harness = makeHarness();
    const events = createSlackEventsDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      updateTaskInput: harness.updateTaskInput,
      resolveSlackThread: harness.resolveSlackThread,
      materializeSlackFiles: harness.materializeSlackFiles,
      slackApi: harness.slackEventsApi,
      metrics: harness.metrics,
    });
    const slash = createSlackSlashCommandDispatcher({
      enqueueTask: harness.enqueueTask,
      resolveTarget: harness.resolveTarget,
      resolveSlackThread: harness.resolveSlackThread,
      metrics: harness.metrics,
    });
    const interactivity = createSlackInteractivityDispatcher({
      enqueueTask: harness.enqueueTask,
      loadLinkedComputer: harness.loadLinkedComputer,
      resolveSlackThread: harness.resolveSlackThread,
      slackApi: {
        openView: vi.fn(async () => ({ ok: true, view: { id: "V-modal" } })),
        postMessage: harness.slackDispatchApi.postMessage,
        respond: vi.fn(async () => undefined),
      },
      metrics: harness.metrics,
    });

    const started = Date.now();
    const appAck = await events(eventArgs(WORKSPACE_W1, appMentionPayload()));
    const slashAck = await slash(
      slashArgs(WORKSPACE_W1, { trigger_id: "trigger-ae6-slash" }),
    );
    const modalAck = await interactivity(
      interactivityArgs(WORKSPACE_W1, {
        type: "message_action",
        trigger_id: "trigger-ae6-modal",
        response_url: "https://hooks.slack.com/modal",
        team: { id: "T-W1" },
        user: { id: "U-A" },
        channel: { id: "C-finance" },
        message: {
          text: "Please analyze this thread",
          ts: "1710000200.000000",
        },
      }),
    );
    const ackMs = Date.now() - started;

    for (const task of harness.tasks) await replayCompletedTask(harness, task);

    expect([
      appAck.statusCode,
      slashAck.statusCode,
      modalAck.statusCode,
    ]).toEqual([200, 200, 200]);
    expect(ackMs).toBeLessThan(3000);
    expect(harness.visible.placeholders).toHaveLength(1);
    expect(harness.visible.updatedMessages).toHaveLength(1);
    expect(harness.visible.responseUrlPosts).toHaveLength(1);
    expect(harness.visible.modalUpdates).toHaveLength(1);
    expect(harness.visible.postedMessages).toHaveLength(1);
    expect(harness.metrics.dispatchSuccess).toHaveBeenCalledWith("app_mention");
    expect(harness.metrics.dispatchSuccess).toHaveBeenCalledWith(
      "slash_command",
    );
    expect(harness.metrics.dispatchSuccess).toHaveBeenCalledWith(
      "message_action",
    );
  });

  it("emits CloudWatch EMF for Slack ingress, dedupe, unknown-team, dispatch, and attribution metrics", () => {
    const envelopes: Record<string, unknown>[] = [];
    const metrics = createSlackMetrics(
      (payload) => envelopes.push(payload),
      () => 123,
    );

    metrics.ingestMs(42, { handler: "events" });
    metrics.dedupeHit({ surface: "app_mention" });
    metrics.unknownTeam({ handler: "events" });
    metrics.dispatchSuccess("slash_command");
    metrics.dispatchFailure("bot_token");
    metrics.attributionDegraded();

    expect(envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handler: "events",
          "slack.events.ingest_ms": 42,
        }),
        expect.objectContaining({
          surface: "app_mention",
          "slack.events.dedupe_hits": 1,
        }),
        expect.objectContaining({
          error_class: "bot_token",
          "slack.dispatch.failure": 1,
        }),
        expect.objectContaining({ "slack.attribution.degraded": 1 }),
      ]),
    );
    expect(envelopes[0]._aws).toMatchObject({
      Timestamp: 123,
      CloudWatchMetrics: [
        {
          Namespace: "ThinkWork/Slack",
          Metrics: [{ Name: "slack.events.ingest_ms", Unit: "Milliseconds" }],
        },
      ],
    });
  });
});
