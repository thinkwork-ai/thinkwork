import { describe, expect, it, vi } from "vitest";
import type { SlackWorkspaceContext } from "./_shared.js";
import {
  createSlackSlashCommandDispatcher,
  extractSlashTeamId,
  parseSlashCommandForm,
} from "./slash-command.js";

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

function makeRawForm(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    team_id: "T123",
    user_id: "U123",
    channel_id: "C123",
    text: "summarize Q3 revenue",
    response_url: "https://hooks.slack.com/commands/response",
    trigger_id: "trigger-1",
    ...overrides,
  });
  return params.toString();
}

function makeArgs(rawBodyText = makeRawForm()) {
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
    input: input.taskInput,
    wasCreated: true,
  }));
  const loadLinkedComputer = vi.fn(async () => LINKED_COMPUTER);
  const resolveSlackThread = vi.fn(async () => ({
    threadId: "thread-1",
    messageId: "message-1",
    wasCreated: true,
  }));
  return { enqueueTask, loadLinkedComputer, resolveSlackThread, ...overrides };
}

describe("Slack slash command handler", () => {
  it("parses form-encoded slash command bodies", () => {
    const rawBody = makeRawForm({ text: "hello world" });

    expect(extractSlashTeamId(rawBody)).toBe("T123");
    expect(parseSlashCommandForm(rawBody)).toEqual({
      teamId: "T123",
      userId: "U123",
      channelId: "C123",
      text: "hello world",
      responseUrl: "https://hooks.slack.com/commands/response",
      triggerId: "trigger-1",
    });
  });

  it("acks linked slash commands with an empty body and enqueues a response_url-backed task", async () => {
    const deps = makeDeps();
    const dispatch = createSlackSlashCommandDispatcher(deps);

    const res = await dispatch(makeArgs());

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    expect(deps.loadLinkedComputer).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slackTeamId: "T123",
      slackUserId: "U123",
    });
    expect(deps.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskType: "thread_turn",
        idempotencyKey: "slash:trigger-1",
        createdByUserId: "user-1",
        taskInput: expect.objectContaining({
          source: "slack",
          channelType: "slash",
          slackTeamId: "T123",
          slackUserId: "U123",
          channelId: "C123",
          responseUrl: "https://hooks.slack.com/commands/response",
          sourceMessage: expect.objectContaining({
            text: "summarize Q3 revenue",
          }),
        }),
      }),
    );
  });

  it("returns an ephemeral link prompt for unlinked slash command users", async () => {
    const deps = makeDeps({ loadLinkedComputer: vi.fn(async () => null) });
    const dispatch = createSlackSlashCommandDispatcher(deps);

    const res = await dispatch(makeArgs());
    const body = JSON.parse(res.body || "{}");

    expect(body).toMatchObject({
      response_type: "ephemeral",
      text: "Link your Slack identity to ThinkWork before using /thinkwork.",
    });
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it("returns an ephemeral usage hint for empty prompts without enqueueing work", async () => {
    const deps = makeDeps();
    const dispatch = createSlackSlashCommandDispatcher(deps);

    const res = await dispatch(makeArgs(makeRawForm({ text: "   " })));
    const body = JSON.parse(res.body || "{}");

    expect(body).toMatchObject({
      response_type: "ephemeral",
      text: "Usage: /thinkwork <prompt>",
    });
    expect(deps.loadLinkedComputer).not.toHaveBeenCalled();
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });
});
