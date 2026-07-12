import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "../../lib/db.js";
import { dispatchDefaultAgentTurn } from "../../lib/mentions/default-agent-routing.js";
import { json } from "../../lib/response.js";
import {
  buildSlackThreadTurnInput,
  slackEventText,
  summarizeSlackThreadContext,
  type SlackThreadContextMessage,
} from "../../lib/slack/envelope.js";
import {
  materializeSlackFilesAsThreadAttachments,
  type MaterializedSlackAttachment,
} from "../../lib/slack/file-attachments.js";
import {
  classifySlackWebhook,
  fetchSlackThreadContext,
  postSlackThreadMessage,
  publishSlackHomeView,
  type SlackWebhookClassification,
} from "../../lib/slack/provider.js";
import {
  resolveOrCreateSlackThread,
  type SlackThreadMappingResult,
} from "../../lib/slack/thread-mapping.js";
import {
  loadLinkedSlackUser,
  type LinkedSlackUser,
} from "../../lib/slack/user-link-store.js";
import { slackMetrics, type SlackMetrics } from "../../lib/slack/metrics.js";
import {
  createSlackHandler,
  type SlackHandlerArgs,
  type SlackHandlerDeps,
} from "./_shared.js";

type DbClient = typeof db;
type DispatchDefaultAgent = typeof dispatchDefaultAgentTurn;

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
  slackApi?: SlackApi;
  loadLinkedUser?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  }) => Promise<LinkedSlackUser | null>;
  resolveSlackThread?: (input: {
    tenantId: string;
    actorId: string;
    envelope: ReturnType<typeof buildSlackThreadTurnInput>;
  }) => Promise<SlackThreadMappingResult>;
  materializeSlackFiles?: (input: {
    tenantId: string;
    threadId: string;
    messageId: string;
    uploadedBy: string;
    botToken: string;
    fileRefs: ReturnType<typeof buildSlackThreadTurnInput>["fileRefs"];
  }) => Promise<MaterializedSlackAttachment[]>;
  dispatchDefaultAgent?: DispatchDefaultAgent;
  metrics?: Pick<
    SlackMetrics,
    "dedupeHit" | "dispatchSuccess" | "dispatchFailure"
  >;
}

/**
 * The handler classifies the same request body in extractTeamId,
 * preDispatch, and dispatch. classifySlackWebhook is deterministic, so a
 * single-entry memo keyed on the exact body/headers references avoids
 * re-parsing the payload three times per invocation.
 */
let lastClassification: {
  rawBodyText: string;
  headers: Record<string, string> | undefined;
  classification: SlackWebhookClassification;
} | null = null;

function classifyEventsBody(args: {
  rawBodyText: string;
  headers?: Record<string, string>;
}): SlackWebhookClassification {
  if (
    lastClassification &&
    lastClassification.rawBodyText === args.rawBodyText &&
    lastClassification.headers === args.headers
  ) {
    return lastClassification.classification;
  }
  const classification = classifySlackWebhook(args);
  lastClassification = {
    rawBodyText: args.rawBodyText,
    headers: args.headers,
    classification,
  };
  return classification;
}

export async function handleUrlVerification(args: {
  rawBodyText: string;
  headers?: Record<string, string>;
}): Promise<APIGatewayProxyStructuredResultV2 | null> {
  const classification = classifyEventsBody(args);
  if (classification.kind !== "url_verification") return null;
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: classification.challenge,
  };
}

export function createSlackEventsDispatcher(deps: SlackEventsDeps = {}) {
  const dbClient = deps.dbClient ?? db;
  const slackApi = deps.slackApi ?? defaultSlackApi;
  const loadLinkedUser =
    deps.loadLinkedUser ?? ((input) => loadLinkedSlackUser(input, dbClient));
  const resolveSlackThread =
    deps.resolveSlackThread ?? ((input) => resolveOrCreateSlackThread(input));
  const materializeSlackFiles =
    deps.materializeSlackFiles ?? materializeSlackFilesAsThreadAttachments;
  const dispatchDefaultAgent =
    deps.dispatchDefaultAgent ?? dispatchDefaultAgentTurn;
  const metrics = deps.metrics ?? slackMetrics;

  return async function dispatchSlackEvent(
    args: SlackHandlerArgs,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const classification = classifyEventsBody({
      rawBodyText: args.rawBodyText,
      headers: args.headers,
    });
    if (classification.kind !== "event") {
      return json({ ok: true, ignored: true });
    }

    const event = classification.event as SlackEventBody;
    const channelType = classifySlackEvent(event, args.workspace.botUserId);
    if (!channelType) {
      return json({ ok: true, ignored: true, reason: "unsupported_event" });
    }

    const eventId = requiredString(classification.eventId);
    const slackTeamId = requiredString(
      classification.teamId ?? args.workspace.slackTeamId,
    );
    const slackUserId = requiredString(event.user);
    const channelId = requiredString(classification.replyTo.channelId);
    const link = await loadLinkedUser({
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

    // Provider continuation coordinates, already copied into plain
    // ThinkWork-owned data by the provider boundary.
    const threadTs = requiredString(classification.replyTo.threadTs);
    const threadContext = await safeFetchThreadContext(slackApi, {
      token: args.botToken,
      channel: channelId,
      threadTs,
    });
    const eventForTurn = {
      ...event,
      text: stripBotMention(slackEventText(event), args.workspace.botUserId),
    };
    const turnInput = buildSlackThreadTurnInput({
      channelType,
      slackTeamId,
      slackUserId,
      slackWorkspaceRowId: args.workspace.id,
      channelId,
      eventId,
      event: eventForTurn,
      threadContext,
      actorId: link.userId,
    });
    const mapping = await resolveSlackThread({
      tenantId: args.workspace.tenantId,
      actorId: link.userId,
      envelope: turnInput,
    });

    if (mapping.messageCreated) {
      await safeMaterializeSlackFiles(materializeSlackFiles, {
        tenantId: args.workspace.tenantId,
        threadId: mapping.threadId,
        messageId: mapping.messageId,
        uploadedBy: link.userId,
        botToken: args.botToken,
        fileRefs: turnInput.fileRefs,
      });
    } else {
      metrics.dedupeHit({ surface: channelType });
    }

    let wakeup: Awaited<ReturnType<DispatchDefaultAgent>>;
    try {
      wakeup = await dispatchDefaultAgent({
        tenantId: args.workspace.tenantId,
        threadId: mapping.threadId,
        spaceId: mapping.spaceId,
        messageId: mapping.messageId,
        content: turnInput.sourceMessage.text,
        sender: { type: "user", id: link.userId },
      });
      if (!wakeup) throw new Error("Tenant platform agent is unavailable");
      metrics.dispatchSuccess(channelType);
    } catch (error) {
      metrics.dispatchFailure(errorClass(error));
      throw error;
    }

    if (mapping.messageCreated || wakeup.enqueued) {
      await safePostAcknowledgement(slackApi, {
        token: args.botToken,
        channel: channelId,
        threadTs,
      });
    }

    if (!mapping.messageCreated) {
      return json({
        ok: true,
        duplicate: true,
        threadId: mapping.threadId,
        messageId: mapping.messageId,
      });
    }

    return json({
      ok: true,
      threadId: mapping.threadId,
      messageId: mapping.messageId,
      wakeupRequestId: wakeup.wakeupRequestId,
    });
  };
}

/**
 * Form-encoded payloads (slash commands, interactions, bare forms) have
 * never been valid ingress for the events handler; treat them like the
 * previous JSON-only parser did (no team id -> 400) instead of resolving a
 * workspace.
 */
function extractTeamId(
  classification: SlackWebhookClassification,
): string | null {
  if (classification.kind === "event") return classification.teamId;
  if (
    classification.kind === "unsupported" &&
    classification.encoding === "json"
  ) {
    return classification.teamId;
  }
  return null;
}

function classifySlackEvent(
  event: SlackEventBody,
  botUserId: string,
): "app_mention" | "im" | null {
  if (event.bot_id) return null;
  if (event.subtype && event.subtype !== "file_share") return null;
  if (event.type === "app_mention") return "app_mention";
  if (event.type === "message" && event.channel_type === "im") return "im";
  if (
    event.type === "message" &&
    event.subtype === "file_share" &&
    typeof event.text === "string" &&
    event.text.includes(`<@${botUserId}>`)
  ) {
    return "app_mention";
  }
  return null;
}

function stripBotMention(text: string, botUserId: string): string {
  const trimmed = text.trimStart();
  const mention = `<@${botUserId}>`;
  return trimmed.startsWith(mention)
    ? trimmed.slice(mention.length).trimStart()
    : text;
}

async function safeMaterializeSlackFiles(
  materializeSlackFiles: NonNullable<SlackEventsDeps["materializeSlackFiles"]>,
  input: Parameters<NonNullable<SlackEventsDeps["materializeSlackFiles"]>>[0],
): Promise<void> {
  if (input.fileRefs.length === 0) return;
  try {
    await materializeSlackFiles(input);
  } catch (error) {
    console.warn("[slack:events] failed to materialize Slack files", {
      error: error instanceof Error ? error.message : String(error),
      fileCount: input.fileRefs.length,
    });
  }
}

async function safeFetchThreadContext(
  slackApi: SlackApi,
  input: { token: string; channel: string; threadTs: string },
): Promise<SlackThreadContextMessage[]> {
  try {
    return summarizeSlackThreadContext(
      await slackApi.fetchThreadMessages(input),
    );
  } catch (error) {
    console.warn("[slack:events] failed to fetch thread context", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function safePostAcknowledgement(
  slackApi: SlackApi,
  input: { token: string; channel: string; threadTs: string },
): Promise<void> {
  try {
    const result = await slackApi.postMessage({
      ...input,
      text: "ThinkWork is working on it…",
    });
    if (!result.ok) {
      console.warn("[slack:events] acknowledgement post failed", {
        error: result.error ?? "unknown",
      });
    }
  } catch (error) {
    console.warn("[slack:events] acknowledgement post failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const defaultSlackApi: SlackApi = {
  async postMessage(input) {
    return postSlackThreadMessage({
      token: input.token,
      channel: input.channel,
      text: input.text,
      threadTs: input.threadTs,
    });
  },
  async fetchThreadMessages(input) {
    return fetchSlackThreadContext({
      token: input.token,
      channel: input.channel,
      threadTs: input.threadTs,
      limit: 50,
    });
  },
  async sendLinkPrompt(input) {
    const url = buildSlackLinkUrl(input.workspaceTeamId);
    await postSlackThreadMessage({
      token: input.token,
      channel: input.channelId,
      text: `Connect your Slack identity to ThinkWork before asking ThinkWork to act: ${url}`,
    });
    await publishSlackHomeView({
      token: input.token,
      userId: input.slackUserId,
      view: {
        type: "home",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Connect your ThinkWork account before asking ThinkWork to act from Slack.",
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

function requiredString(value: unknown): string {
  const stringValue = optionalString(value);
  if (!stringValue) throw new Error("Slack event is missing a required field");
  return stringValue;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function createSlackEventsHandler(
  deps: SlackEventsDeps = {},
  handlerDeps: SlackHandlerDeps = {},
) {
  return createSlackHandler(
    {
      name: "events",
      dispatchRetries: true,
      extractTeamId: ({ rawBodyText, headers }) =>
        extractTeamId(classifyEventsBody({ rawBodyText, headers })),
      preDispatch: handleUrlVerification,
      dispatch: createSlackEventsDispatcher(deps),
    },
    handlerDeps,
  );
}

export const handler = createSlackEventsHandler();
