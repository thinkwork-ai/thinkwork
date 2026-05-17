import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { enqueueComputerTask } from "../../lib/computers/tasks.js";
import { error, json } from "../../lib/response.js";
import {
  publicSlackResponseBlocks,
  publicSlackResponseText,
} from "../../lib/slack/attribution.js";
import {
  buildSlackMessageActionInput,
  withSlackThreadMapping,
} from "../../lib/slack/envelope.js";
import {
  loadLinkedSlackComputer,
  type SlackLinkedComputer,
} from "../../lib/slack/linked-computer.js";
import { slackMetrics, type SlackMetrics } from "../../lib/slack/metrics.js";
import {
  resolveOrCreateSlackThread,
  type SlackThreadMappingResult,
} from "../../lib/slack/thread-mapping.js";
import { createSlackHandler, type SlackHandlerArgs } from "./_shared.js";

type EnqueueTaskInput = Parameters<typeof enqueueComputerTask>[0];
type EnqueueTask = (
  input: EnqueueTaskInput,
) => Promise<{ id: string; input?: unknown; wasCreated?: boolean }>;

interface SlackViewOpenResponse {
  ok: boolean;
  view?: { id?: string };
  error?: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

interface SlackInteractivityApi {
  openView(input: {
    token: string;
    triggerId: string;
    view: Record<string, unknown>;
  }): Promise<SlackViewOpenResponse>;
  postMessage(input: {
    token: string;
    channel: string;
    text: string;
    threadTs?: string | null;
    blocks?: Array<Record<string, unknown>>;
  }): Promise<SlackPostMessageResponse>;
  respond(input: {
    responseUrl: string;
    body: Record<string, unknown>;
  }): Promise<void>;
}

export interface SlackInteractivityDeps {
  enqueueTask?: EnqueueTask;
  loadLinkedComputer?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
    text?: string;
  }) => Promise<SlackLinkedComputer | null>;
  slackApi?: SlackInteractivityApi;
  resolveSlackThread?: (input: {
    tenantId: string;
    computerId: string;
    actorId: string;
    envelope: ReturnType<typeof buildSlackMessageActionInput>;
  }) => Promise<SlackThreadMappingResult>;
  metrics?: Pick<SlackMetrics, "dedupeHit">;
}

interface SlackMessageActionPayload {
  type: "message_action";
  callback_id?: unknown;
  trigger_id?: unknown;
  response_url?: unknown;
  team?: { id?: unknown };
  user?: { id?: unknown };
  channel?: { id?: unknown };
  message?: Record<string, unknown>;
}

interface SlackBlockActionsPayload {
  type: "block_actions";
  response_url?: unknown;
  team?: { id?: unknown };
  user?: { id?: unknown };
  channel?: { id?: unknown };
  message?: {
    text?: unknown;
    ts?: unknown;
    thread_ts?: unknown;
    blocks?: unknown;
  };
  actions?: Array<{ action_id?: unknown; value?: unknown }>;
}

export function createSlackInteractivityDispatcher(
  deps: SlackInteractivityDeps = {},
) {
  const enqueueTask = deps.enqueueTask ?? enqueueComputerTask;
  const loadLinkedComputer =
    deps.loadLinkedComputer ?? ((input) => loadLinkedSlackComputer(input));
  const slackApi = deps.slackApi ?? defaultSlackApi;
  const resolveSlackThread =
    deps.resolveSlackThread ?? ((input) => resolveOrCreateSlackThread(input));
  const metrics = deps.metrics ?? slackMetrics;

  return async function dispatchSlackInteractivity(
    args: SlackHandlerArgs,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const payload = parseInteractivityPayload(args.rawBodyText);
    switch (payload.type) {
      case "message_action":
        return handleMessageAction(
          args,
          payload as unknown as SlackMessageActionPayload,
          {
            enqueueTask,
            loadLinkedComputer,
            slackApi,
            resolveSlackThread,
            metrics,
          },
        );
      case "block_actions":
        return handleBlockActions(
          args,
          payload as unknown as SlackBlockActionsPayload,
          slackApi,
        );
      default:
        return error("Unsupported Slack interactivity payload type", 400);
    }
  };
}

export function parseInteractivityPayload(
  rawBodyText: string,
): Record<string, unknown> {
  const encodedPayload = new URLSearchParams(rawBodyText).get("payload");
  if (!encodedPayload) {
    throw new Error("Slack interactivity payload is required");
  }
  const parsed = JSON.parse(encodedPayload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Slack interactivity payload must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function extractInteractivityTeamId(rawBodyText: string): string | null {
  try {
    return objectId(parseInteractivityPayload(rawBodyText).team);
  } catch {
    return null;
  }
}

async function handleMessageAction(
  args: SlackHandlerArgs,
  payload: SlackMessageActionPayload,
  deps: {
    enqueueTask: EnqueueTask;
    loadLinkedComputer: (input: {
      tenantId: string;
      slackTeamId: string;
      slackUserId: string;
      text?: string;
    }) => Promise<SlackLinkedComputer | null>;
    slackApi: SlackInteractivityApi;
    resolveSlackThread: (input: {
      tenantId: string;
      computerId: string;
      actorId: string;
      envelope: ReturnType<typeof buildSlackMessageActionInput>;
    }) => Promise<SlackThreadMappingResult>;
    metrics: Pick<SlackMetrics, "dedupeHit">;
  },
): Promise<APIGatewayProxyStructuredResultV2> {
  const triggerId = requiredString(payload.trigger_id);
  const slackTeamId = requiredString(payload.team?.id);
  const slackUserId = requiredString(payload.user?.id);
  const channelId = requiredString(payload.channel?.id);
  const message = coerceObject(payload.message);

  const openedView = await deps.slackApi.openView({
    token: args.botToken,
    triggerId,
    view: buildWorkingModalView(),
  });
  if (!openedView.ok || !openedView.view?.id) {
    console.warn("[slack:interactivity] message action modal open failed", {
      error: openedView.error ?? "missing_view",
    });
    return json({
      response_type: "ephemeral",
      text: "The Slack shortcut expired. Please try again.",
    });
  }

  const link = await deps.loadLinkedComputer({
    tenantId: args.workspace.tenantId,
    slackTeamId,
    slackUserId,
    text: messageText(message),
  });
  if (!link) {
    return json({
      response_type: "ephemeral",
      text: "Link your Slack identity to ThinkWork before using this shortcut.",
    });
  }

  const taskInput = buildSlackMessageActionInput({
    slackTeamId,
    slackUserId,
    slackWorkspaceRowId: args.workspace.id,
    channelId,
    triggerId,
    responseUrl: optionalString(payload.response_url),
    modalViewId: openedView.view.id,
    message,
    actorId: link.userId,
  });
  const mapping = await deps.resolveSlackThread({
    tenantId: args.workspace.tenantId,
    computerId: link.computerId,
    actorId: link.userId,
    envelope: taskInput,
  });
  const task = await deps.enqueueTask({
    tenantId: args.workspace.tenantId,
    computerId: link.computerId,
    taskType: "thread_turn",
    taskInput: withSlackThreadMapping(taskInput, mapping),
    idempotencyKey: taskInput.eventId,
    createdByUserId: link.userId,
  });
  if ((task as { wasCreated?: boolean }).wasCreated === false) {
    deps.metrics.dedupeHit({ surface: "message_action" });
  }

  return json({ ok: true, taskId: task.id });
}

async function handleBlockActions(
  args: SlackHandlerArgs,
  payload: SlackBlockActionsPayload,
  slackApi: SlackInteractivityApi,
): Promise<APIGatewayProxyStructuredResultV2> {
  const actionId = optionalString(payload.actions?.[0]?.action_id);
  switch (actionId) {
    case "slack_promote_response":
      return promoteEphemeralResponse(args, payload, slackApi);
    case "connect_thinkwork":
      return json({
        ok: true,
        redirect_url: buildSlackLinkUrl(requiredString(payload.team?.id)),
      });
    default:
      return error("Unsupported Slack block action", 400);
  }
}

async function promoteEphemeralResponse(
  args: SlackHandlerArgs,
  payload: SlackBlockActionsPayload,
  slackApi: SlackInteractivityApi,
): Promise<APIGatewayProxyStructuredResultV2> {
  const slackUserId = requiredString(payload.user?.id);
  const responseUrl = requiredString(payload.response_url);
  const text = extractOriginalMessageText(payload.message);
  const posted = await slackApi.postMessage({
    token: args.botToken,
    channel: requiredString(payload.channel?.id),
    threadTs:
      optionalString(payload.message?.thread_ts) ??
      optionalString(payload.message?.ts),
    text: publicSlackResponseText(text, slackUserId),
    blocks: publicSlackResponseBlocks(text, slackUserId),
  });
  if (!posted.ok) {
    console.warn("[slack:interactivity] public promotion post failed", {
      error: posted.error ?? "unknown",
    });
    return json({ ok: false, error: "slack_post_failed" });
  }
  await slackApi.respond({
    responseUrl,
    body: { delete_original: true },
  });
  return json({ ok: true });
}

function buildWorkingModalView(): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "thinkwork_message_action",
    title: { type: "plain_text", text: "ThinkWork" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Working on this with the selected Computer...",
        },
      },
    ],
  };
}

function extractOriginalMessageText(
  message: SlackBlockActionsPayload["message"],
): string {
  const firstSectionText = Array.isArray(message?.blocks)
    ? message.blocks
        .map((block) => {
          const record = coerceObjectOrNull(block);
          const text = coerceObjectOrNull(record?.text);
          return optionalString(text?.text);
        })
        .find((text): text is string => Boolean(text))
    : null;
  return firstSectionText ?? optionalString(message?.text) ?? "";
}

const defaultSlackApi: SlackInteractivityApi = {
  async openView(input) {
    return slackApiCall(input.token, "views.open", {
      trigger_id: input.triggerId,
      view: input.view,
    });
  },
  async postMessage(input) {
    return slackApiCall(input.token, "chat.postMessage", {
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs || undefined,
      blocks: input.blocks,
    });
  },
  async respond(input) {
    const response = await fetch(input.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body),
    });
    if (!response.ok) {
      throw new Error(`Slack response_url failed with ${response.status}`);
    }
  },
};

async function slackApiCall<T = { ok: boolean; error?: string }>(
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

function coerceObject(value: unknown): Record<string, unknown> {
  const object = coerceObjectOrNull(value);
  if (!object) throw new Error("Slack interactivity payload is malformed");
  return object;
}

function messageText(message: Record<string, unknown>): string {
  const text = message.text;
  return typeof text === "string" ? text : "";
}

function coerceObjectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function objectId(value: unknown): string | null {
  return optionalString(coerceObjectOrNull(value)?.id);
}

function requiredString(value: unknown): string {
  const stringValue = optionalString(value);
  if (!stringValue) {
    throw new Error("Slack interactivity payload is missing a required field");
  }
  return stringValue;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const handler = createSlackHandler({
  name: "interactivity",
  extractTeamId: ({ rawBodyText }) => extractInteractivityTeamId(rawBodyText),
  dispatch: createSlackInteractivityDispatcher(),
});
