import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { and, eq, ne } from "drizzle-orm";
import {
  computers,
  computerTasks,
  slackUserLinks,
} from "@thinkwork/database-pg/schema";
import { db } from "../../lib/db.js";
import { enqueueComputerTask } from "../../lib/computers/tasks.js";
import { json } from "../../lib/response.js";
import {
  buildSlackThreadTurnInput,
  slackThreadTs,
  summarizeSlackThreadContext,
  type SlackThreadContextMessage,
} from "../../lib/slack/envelope.js";
import { createSlackHandler, type SlackHandlerArgs } from "./_shared.js";

type DbClient = typeof db;
type EnqueueTaskInput = Parameters<typeof enqueueComputerTask>[0];
type EnqueueTask = (
  input: EnqueueTaskInput,
) => Promise<{ id: string; input?: unknown; wasCreated?: boolean }>;

interface SlackEventCallback {
  type?: unknown;
  team_id?: unknown;
  event_id?: unknown;
  event?: SlackEventBody;
}

interface SlackEventBody {
  type?: unknown;
  subtype?: unknown;
  bot_id?: unknown;
  team?: unknown;
  user?: unknown;
  channel?: unknown;
  channel_type?: unknown;
  text?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
  files?: unknown;
}

interface LinkedComputer {
  userId: string;
  slackUserName: string | null;
  computerId: string;
  computerName: string;
}

interface SlackApi {
  postMessage(input: {
    token: string;
    channel: string;
    text: string;
    threadTs?: string | null;
  }): Promise<{ ok: boolean; ts?: string; error?: string }>;
  fetchThreadMessages(input: {
    token: string;
    channel: string;
    threadTs: string;
  }): Promise<SlackThreadContextMessage[]>;
  sendLinkPrompt(input: {
    token: string;
    workspaceTeamId: string;
    slackUserId: string;
    channelId: string;
  }): Promise<void>;
}

export interface SlackEventsDeps {
  dbClient?: DbClient;
  enqueueTask?: EnqueueTask;
  slackApi?: SlackApi;
  loadLinkedComputer?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  }) => Promise<LinkedComputer | null>;
  updateTaskInput?: (input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    taskInput: Record<string, unknown>;
  }) => Promise<void>;
}

export async function handleUrlVerification(args: {
  rawBodyText: string;
}): Promise<APIGatewayProxyStructuredResultV2 | null> {
  const body = parseJsonObject(args.rawBodyText);
  if (body?.type !== "url_verification") return null;
  const challenge = typeof body.challenge === "string" ? body.challenge : "";
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: challenge,
  };
}

export function createSlackEventsDispatcher(deps: SlackEventsDeps = {}) {
  const dbClient = deps.dbClient ?? db;
  const enqueueTask = deps.enqueueTask ?? enqueueComputerTask;
  const slackApi = deps.slackApi ?? defaultSlackApi;
  const loadLinkedComputer =
    deps.loadLinkedComputer ??
    ((input) => defaultLoadLinkedComputer(input, dbClient));
  const updateTaskInput =
    deps.updateTaskInput ??
    ((input) => defaultUpdateTaskInput(input, dbClient));

  return async function dispatchSlackEvent(
    args: SlackHandlerArgs,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const body = parseJsonObject(args.rawBodyText) as SlackEventCallback | null;
    if (!body || body.type !== "event_callback") {
      return json({ ok: true, ignored: true });
    }

    const event = body.event;
    if (!event || typeof event !== "object") {
      return json({ ok: true, ignored: true, reason: "missing_event" });
    }

    const eventId = requiredString(body.event_id);
    const slackTeamId = requiredString(
      body.team_id ?? event.team ?? args.workspace.slackTeamId,
    );
    const channelType = classifySlackEvent(event);
    if (!channelType) {
      return json({ ok: true, ignored: true, reason: "unsupported_event" });
    }

    const slackUserId = requiredString(event.user);
    const channelId = requiredString(event.channel);
    const link = await loadLinkedComputer({
      tenantId: args.workspace.tenantId,
      slackTeamId,
      slackUserId,
    });
    if (!link) {
      await slackApi.sendLinkPrompt({
        token: args.botToken,
        workspaceTeamId: slackTeamId,
        slackUserId,
        channelId,
      });
      return json({ ok: true, ignored: true, reason: "slack_user_unlinked" });
    }

    const threadTs = slackThreadTs(event);
    const threadContext = await safeFetchThreadContext(slackApi, {
      token: args.botToken,
      channel: channelId,
      threadTs,
    });
    const taskInput = buildSlackThreadTurnInput({
      channelType,
      slackTeamId,
      slackUserId,
      channelId,
      eventId,
      event,
      threadContext,
      actorId: link.userId,
    });

    const task = await enqueueTask({
      tenantId: args.workspace.tenantId,
      computerId: link.computerId,
      taskType: "thread_turn",
      taskInput,
      idempotencyKey: eventId,
      createdByUserId: link.userId,
    });

    if ((task as { wasCreated?: boolean }).wasCreated === false) {
      return json({ ok: true, duplicate: true, taskId: task.id });
    }

    const placeholder = await safePostPlaceholder(slackApi, {
      token: args.botToken,
      channel: channelId,
      threadTs,
      text: `${link.computerName || "Your Computer"} is thinking...`,
    });
    if (placeholder?.ts) {
      try {
        await updateTaskInput({
          tenantId: args.workspace.tenantId,
          computerId: link.computerId,
          taskId: task.id,
          taskInput: { ...taskInput, placeholderTs: placeholder.ts },
        });
      } catch (err) {
        console.warn("[slack:events] placeholder metadata update failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return json({ ok: true, taskId: task.id });
  };
}

function extractTeamId(rawBodyText: string): string | null {
  const body = parseJsonObject(rawBodyText);
  const event =
    body?.event && typeof body.event === "object"
      ? (body.event as Record<string, unknown>)
      : {};
  return optionalString(body?.team_id) ?? optionalString(event.team);
}

function classifySlackEvent(
  event: SlackEventBody,
): "app_mention" | "im" | null {
  if (event.bot_id || event.subtype) return null;
  if (event.type === "app_mention") return "app_mention";
  if (event.type === "message" && event.channel_type === "im") return "im";
  return null;
}

async function defaultLoadLinkedComputer(
  input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  },
  dbClient: DbClient,
): Promise<LinkedComputer | null> {
  const [row] = await dbClient
    .select({
      userId: slackUserLinks.user_id,
      slackUserName: slackUserLinks.slack_user_name,
      computerId: computers.id,
      computerName: computers.name,
    })
    .from(slackUserLinks)
    .innerJoin(
      computers,
      and(
        eq(computers.tenant_id, slackUserLinks.tenant_id),
        eq(computers.owner_user_id, slackUserLinks.user_id),
        ne(computers.status, "archived"),
      ),
    )
    .where(
      and(
        eq(slackUserLinks.tenant_id, input.tenantId),
        eq(slackUserLinks.slack_team_id, input.slackTeamId),
        eq(slackUserLinks.slack_user_id, input.slackUserId),
        eq(slackUserLinks.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function defaultUpdateTaskInput(
  input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    taskInput: Record<string, unknown>;
  },
  dbClient: DbClient,
): Promise<void> {
  await dbClient
    .update(computerTasks)
    .set({ input: input.taskInput, updated_at: new Date() })
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.id, input.taskId),
      ),
    );
}

async function safeFetchThreadContext(
  slackApi: SlackApi,
  input: { token: string; channel: string; threadTs: string },
): Promise<SlackThreadContextMessage[]> {
  try {
    return summarizeSlackThreadContext(
      await slackApi.fetchThreadMessages(input),
    );
  } catch (err) {
    console.warn("[slack:events] failed to fetch thread context", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function safePostPlaceholder(
  slackApi: SlackApi,
  input: {
    token: string;
    channel: string;
    threadTs: string;
    text: string;
  },
): Promise<{ ok: boolean; ts?: string; error?: string } | null> {
  try {
    const res = await slackApi.postMessage(input);
    if (!res.ok) {
      console.warn("[slack:events] placeholder post failed", {
        error: res.error ?? "unknown",
      });
      return null;
    }
    return res;
  } catch (err) {
    console.warn("[slack:events] placeholder post failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const defaultSlackApi: SlackApi = {
  async postMessage(input) {
    return slackApiCall(input.token, "chat.postMessage", {
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs || undefined,
    });
  },
  async fetchThreadMessages(input) {
    const res = await slackApiCall<{
      ok: boolean;
      messages?: Array<Record<string, unknown>>;
      error?: string;
    }>(input.token, "conversations.replies", {
      channel: input.channel,
      ts: input.threadTs,
      limit: 50,
    });
    if (!res.ok) throw new Error(res.error || "conversations.replies failed");
    return (res.messages ?? []).map((message) => ({
      user: optionalString(message.user),
      botId: optionalString(message.bot_id),
      ts: requiredString(message.ts),
      text: optionalString(message.text) ?? "",
    }));
  },
  async sendLinkPrompt(input) {
    const url = buildSlackLinkUrl(input.workspaceTeamId);
    await slackApiCall(input.token, "chat.postMessage", {
      channel: input.channelId,
      text: `Connect your Slack identity to ThinkWork before using your Computer from Slack: ${url}`,
    });
    await slackApiCall(input.token, "views.publish", {
      user_id: input.slackUserId,
      view: {
        type: "home",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Connect your ThinkWork account to use your Computer from Slack.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Connect ThinkWork" },
                url,
              },
            ],
          },
        ],
      },
    });
  },
};

async function slackApiCall<T = { ok: boolean; ts?: string; error?: string }>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack Web API ${method} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function buildSlackLinkUrl(slackTeamId: string): string {
  const base =
    process.env.THINKWORK_APP_URL ||
    process.env.MOBILE_APP_URL ||
    process.env.ADMIN_APP_URL ||
    "https://app.thinkwork.ai";
  const url = new URL("/settings/credentials", base);
  url.searchParams.set("integration", "slack");
  url.searchParams.set("slackTeamId", slackTeamId);
  return url.toString();
}

function parseJsonObject(rawBodyText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBodyText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function requiredString(value: unknown): string {
  const stringValue = optionalString(value);
  if (!stringValue) throw new Error("Slack event is missing a required field");
  return stringValue;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const handler = createSlackHandler({
  name: "events",
  extractTeamId: ({ rawBodyText }) => extractTeamId(rawBodyText),
  preDispatch: handleUrlVerification,
  dispatch: createSlackEventsDispatcher(),
});
