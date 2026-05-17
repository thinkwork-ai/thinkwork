import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computerEvents,
  computerTasks,
  slackWorkspaces,
  users,
} from "@thinkwork/database-pg/schema";

interface SlackDispatchEvent {
  type?: string;
  botToken?: string;
  channelId?: string;
  threadTs?: string;
  text?: string;
  limit?: number;
}

interface SlackTaskEnvelope {
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId?: string | null;
  channelId: string;
  channelType: string;
  rootThreadTs: string | null;
  responseUrl: string | null;
  triggerSurface: string;
  sourceMessage: { text?: string; ts?: string; user?: string } | null;
  threadContext: unknown[];
  fileRefs: unknown[];
  placeholderTs: string | null;
  modalViewId: string | null;
}

interface PendingSlackDispatch {
  eventId: string;
  tenantId: string;
  computerId: string;
  taskId: string;
  response: string;
  slack: SlackTaskEnvelope;
  actor: {
    userId: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  botTokenSecretPath: string | null;
}

interface SlackDispatchStore {
  loadPending(limit: number): Promise<PendingSlackDispatch[]>;
  recordSuccess(input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    eventId: string;
    channelId: string;
    ts?: string | null;
    mode: string;
    degraded: boolean;
  }): Promise<void>;
  recordFailure(input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    eventId: string;
    error: string;
    terminal?: boolean;
  }): Promise<void>;
  recordAttributionDegraded(input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    eventId: string;
    error: string;
  }): Promise<void>;
}

interface SlackDispatchApi {
  postMessage(input: SlackMessageInput): Promise<SlackApiResponse>;
  updateMessage(
    input: SlackMessageInput & { ts: string },
  ): Promise<SlackApiResponse>;
  updateView(input: {
    token: string;
    viewId: string;
    text: string;
    blocks: Array<Record<string, unknown>>;
  }): Promise<SlackApiResponse>;
  postResponseUrl(input: {
    responseUrl: string;
    text: string;
    blocks: Array<Record<string, unknown>>;
  }): Promise<SlackApiResponse>;
  usersInfo(input: { token: string; userId: string }): Promise<{
    ok: boolean;
    user?: {
      real_name?: string;
      name?: string;
      profile?: { image_72?: string };
    };
    error?: string;
  }>;
}

interface SlackMessageInput {
  token: string;
  channel: string;
  text: string;
  blocks: Array<Record<string, unknown>>;
  threadTs?: string | null;
  username?: string;
  iconUrl?: string | null;
}

interface SlackApiResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

interface DispatchDeps {
  store?: SlackDispatchStore;
  slackApi?: SlackDispatchApi;
  getBotToken?: (secretPath: string) => Promise<string>;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
  metrics?: SlackDispatchMetrics;
}

interface SlackDispatchMetrics {
  dispatchSuccess(surface: string): void;
  dispatchFailure(errorClass: string): void;
  attributionDegraded(): void;
}

const db = getDb();
const secretCache = new Map<string, string>();
let smClient: SecretsManagerClient | null = null;

export async function handler(event: SlackDispatchEvent = {}): Promise<{
  ok: boolean;
  processed?: number;
  skipped?: boolean;
  ts?: string | null;
}> {
  if (event.type === "placeholder") return postLegacyPlaceholder(event);
  const result = await dispatchSlackCompletions({ limit: event.limit });
  return { ok: true, processed: result.processed };
}

export async function dispatchSlackCompletions(
  options: { limit?: number } = {},
  deps: DispatchDeps = {},
): Promise<{ processed: number; failed: number }> {
  const store = deps.store ?? createDrizzleSlackDispatchStore();
  const slackApi = deps.slackApi ?? defaultSlackApi;
  const getBotToken = deps.getBotToken ?? getSlackBotToken;
  const logger = deps.logger ?? console;
  const metrics = deps.metrics ?? slackDispatchMetrics;
  const pending = await store.loadPending(normalizeLimit(options.limit));
  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      if (!item.botTokenSecretPath) {
        throw new Error("Slack bot token secret path is missing");
      }
      const token = await getBotToken(item.botTokenSecretPath);
      const attribution = await resolveAttribution(item, token, slackApi);
      const posted = await deliverSlackResponse(item, token, attribution, {
        store,
        slackApi,
        metrics,
      });
      await store.recordSuccess({
        tenantId: item.tenantId,
        computerId: item.computerId,
        taskId: item.taskId,
        eventId: item.eventId,
        channelId: item.slack.channelId,
        ts: posted.ts ?? null,
        mode: posted.mode,
        degraded: posted.degraded,
      });
      metrics.dispatchSuccess(item.slack.triggerSurface || posted.mode);
      processed += 1;
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      metrics.dispatchFailure(errorClass(error));
      logger.error("[slack-dispatch] dispatch failed", {
        taskId: item.taskId,
        eventId: item.eventId,
        error,
      });
      await store.recordFailure({
        tenantId: item.tenantId,
        computerId: item.computerId,
        taskId: item.taskId,
        eventId: item.eventId,
        error,
        terminal: true,
      });
    }
  }

  return { processed, failed };
}

async function deliverSlackResponse(
  item: PendingSlackDispatch,
  token: string,
  attribution: SlackComputerAttribution,
  deps: {
    store: SlackDispatchStore;
    slackApi: SlackDispatchApi;
    metrics: SlackDispatchMetrics;
  },
): Promise<{ mode: string; ts?: string | null; degraded: boolean }> {
  if (item.slack.modalViewId) {
    await deps.slackApi.updateView({
      token,
      viewId: item.slack.modalViewId,
      text: "Posted to Slack",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Posted to Slack." },
        },
      ],
    });
    const posted = await postSlackMessage(item, token, attribution, deps);
    return { ...posted, mode: "modal_post_message" };
  }

  if (item.slack.responseUrl) {
    await deps.slackApi.postResponseUrl({
      responseUrl: item.slack.responseUrl,
      ...slackComputerEphemeralResponse(item.response, attribution),
    });
    return { mode: "response_url", degraded: false };
  }

  if (item.slack.placeholderTs) {
    return updateSlackMessage(item, token, attribution, deps);
  }

  return postSlackMessage(item, token, attribution, deps);
}

async function postSlackMessage(
  item: PendingSlackDispatch,
  token: string,
  attribution: SlackComputerAttribution,
  deps: {
    store: SlackDispatchStore;
    slackApi: SlackDispatchApi;
    metrics: SlackDispatchMetrics;
  },
) {
  const response = await callWithAttributionFallback(
    item,
    attribution,
    deps,
    false,
    (degraded) =>
      deps.slackApi.postMessage({
        token,
        channel: item.slack.channelId,
        threadTs: responseThreadTs(item.slack),
        ...attributedMessage(item.response, attribution, degraded),
      }),
  );
  return {
    mode: "chat_postMessage",
    ts: response.ts ?? null,
    degraded: response.degraded,
  };
}

async function updateSlackMessage(
  item: PendingSlackDispatch,
  token: string,
  attribution: SlackComputerAttribution,
  deps: {
    store: SlackDispatchStore;
    slackApi: SlackDispatchApi;
    metrics: SlackDispatchMetrics;
  },
) {
  const response = await callWithAttributionFallback(
    item,
    attribution,
    deps,
    false,
    (degraded) =>
      deps.slackApi.updateMessage({
        token,
        channel: item.slack.channelId,
        ts: requiredString(item.slack.placeholderTs, "placeholderTs"),
        threadTs: responseThreadTs(item.slack),
        ...attributedMessage(item.response, attribution, degraded),
      }),
  );
  return {
    mode: "chat_update",
    ts: response.ts ?? item.slack.placeholderTs,
    degraded: response.degraded,
  };
}

async function callWithAttributionFallback(
  item: PendingSlackDispatch,
  attribution: SlackComputerAttribution,
  deps: { store: SlackDispatchStore; metrics?: SlackDispatchMetrics },
  degraded: boolean,
  send: (degraded: boolean) => Promise<SlackApiResponse>,
): Promise<SlackApiResponse & { degraded: boolean }> {
  const response = await send(degraded);
  if (response.ok) return { ...response, degraded };
  if (!degraded && isAttributionScopeError(response.error)) {
    await deps.store.recordAttributionDegraded({
      tenantId: item.tenantId,
      computerId: item.computerId,
      taskId: item.taskId,
      eventId: item.eventId,
      error: response.error ?? "missing_scope",
    });
    (deps.metrics ?? slackDispatchMetrics).attributionDegraded();
    return callWithAttributionFallback(item, attribution, deps, true, send);
  }
  throw new Error(`Slack API failed: ${response.error ?? "unknown_error"}`);
}

async function resolveAttribution(
  item: PendingSlackDispatch,
  token: string,
  slackApi: SlackDispatchApi,
): Promise<SlackComputerAttribution> {
  const dbName = item.actor.displayName?.trim();
  const dbAvatar = item.actor.avatarUrl?.trim();
  if (dbName && dbAvatar) return { displayName: dbName, avatarUrl: dbAvatar };

  const info = await slackApi.usersInfo({
    token,
    userId: item.slack.slackUserId,
  });
  const profile = info.user?.profile;
  return {
    displayName:
      dbName ||
      info.user?.real_name?.trim() ||
      info.user?.name?.trim() ||
      item.actor.userId ||
      item.slack.slackUserId,
    avatarUrl: dbAvatar || profile?.image_72 || null,
  };
}

function attributedMessage(
  text: string,
  attribution: SlackComputerAttribution,
  degraded: boolean,
) {
  return {
    text: slackComputerResponseText(text, attribution, { degraded }),
    blocks: slackComputerResponseBlocks(text, attribution, { degraded }),
    username: degraded
      ? undefined
      : slackComputerUsername(attribution.displayName),
    iconUrl: degraded ? null : attribution.avatarUrl,
  };
}

function responseThreadTs(slack: SlackTaskEnvelope): string | null {
  return slack.rootThreadTs || slack.sourceMessage?.ts || null;
}

function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return 10;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

function isAttributionScopeError(error: string | undefined): boolean {
  return error === "missing_scope" || error === "not_allowed_token_type";
}

function requiredString(
  value: string | null | undefined,
  name: string,
): string {
  if (value?.trim()) return value.trim();
  throw new Error(`${name} is required`);
}

function createDrizzleSlackDispatchStore(
  dbClient: any = db,
): SlackDispatchStore {
  return {
    async loadPending(limit) {
      const rows = await dbClient
        .select({
          eventId: computerEvents.id,
          tenantId: computerEvents.tenant_id,
          computerId: computerEvents.computer_id,
          taskId: computerTasks.id,
          input: computerTasks.input,
          output: computerTasks.output,
          actorUserId: computerTasks.created_by_user_id,
          actorName: users.name,
          actorAvatarUrl: users.image,
          botTokenSecretPath: slackWorkspaces.bot_token_secret_path,
        })
        .from(computerEvents)
        .innerJoin(computerTasks, eq(computerEvents.task_id, computerTasks.id))
        .leftJoin(users, eq(computerTasks.created_by_user_id, users.id))
        .leftJoin(
          slackWorkspaces,
          and(
            eq(slackWorkspaces.tenant_id, computerEvents.tenant_id),
            eq(
              slackWorkspaces.slack_team_id,
              sql<string>`${computerTasks.input}->'slack'->>'slackTeamId'`,
            ),
          ),
        )
        .where(
          and(
            eq(computerEvents.event_type, "task_completed"),
            sql`${computerTasks.input}->>'source' = 'slack'`,
            sql`NOT EXISTS (
              SELECT 1
              FROM computer_events dispatch_events
              WHERE dispatch_events.task_id = ${computerEvents.task_id}
                AND dispatch_events.event_type IN ('slack.dispatch_completed','slack.dispatch_failed')
            )`,
          ),
        )
        .orderBy(asc(computerEvents.created_at))
        .limit(limit);

      return rows.map((row: any) => {
        const input = objectPayload(row.input);
        const output = objectPayload(row.output);
        return {
          eventId: row.eventId,
          tenantId: row.tenantId,
          computerId: row.computerId,
          taskId: row.taskId,
          response: String(output.response ?? ""),
          slack: normalizeSlackEnvelope(input.slack),
          actor: {
            userId: row.actorUserId ?? null,
            displayName: row.actorName ?? null,
            avatarUrl: row.actorAvatarUrl ?? null,
          },
          botTokenSecretPath: row.botTokenSecretPath ?? null,
        };
      });
    },
    async recordSuccess(input) {
      await dbClient.insert(computerEvents).values({
        tenant_id: input.tenantId,
        computer_id: input.computerId,
        task_id: input.taskId,
        event_type: "slack.dispatch_completed",
        level: "info",
        payload: {
          sourceEventId: input.eventId,
          channelId: input.channelId,
          ts: input.ts ?? null,
          mode: input.mode,
          degraded: input.degraded,
        },
      });
    },
    async recordFailure(input) {
      await dbClient.insert(computerEvents).values({
        tenant_id: input.tenantId,
        computer_id: input.computerId,
        task_id: input.taskId,
        event_type: "slack.dispatch_failed",
        level: "error",
        payload: { sourceEventId: input.eventId, error: input.error },
      });
      if (input.terminal) {
        await dbClient
          .update(computerTasks)
          .set({
            status: "failed",
            error: { reason: "slack_dispatch_failed", message: input.error },
            updated_at: new Date(),
          })
          .where(
            and(
              eq(computerTasks.tenant_id, input.tenantId),
              eq(computerTasks.computer_id, input.computerId),
              eq(computerTasks.id, input.taskId),
            ),
          );
      }
    },
    async recordAttributionDegraded(input) {
      await dbClient.insert(computerEvents).values({
        tenant_id: input.tenantId,
        computer_id: input.computerId,
        task_id: input.taskId,
        event_type: "slack.attribution_degraded",
        level: "warn",
        payload: { sourceEventId: input.eventId, error: input.error },
      });
    },
  };
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSlackEnvelope(value: unknown): SlackTaskEnvelope {
  const payload = objectPayload(value);
  return {
    slackTeamId: requiredString(payload.slackTeamId as string, "slackTeamId"),
    slackUserId: requiredString(payload.slackUserId as string, "slackUserId"),
    slackWorkspaceRowId:
      typeof payload.slackWorkspaceRowId === "string"
        ? payload.slackWorkspaceRowId
        : null,
    channelId: requiredString(payload.channelId as string, "channelId"),
    channelType: String(payload.channelType ?? "channel"),
    rootThreadTs:
      typeof payload.rootThreadTs === "string" ? payload.rootThreadTs : null,
    responseUrl:
      typeof payload.responseUrl === "string" ? payload.responseUrl : null,
    triggerSurface: String(payload.triggerSurface ?? "unknown"),
    sourceMessage:
      payload.sourceMessage && typeof payload.sourceMessage === "object"
        ? (payload.sourceMessage as SlackTaskEnvelope["sourceMessage"])
        : null,
    threadContext: Array.isArray(payload.threadContext)
      ? payload.threadContext
      : [],
    fileRefs: Array.isArray(payload.fileRefs) ? payload.fileRefs : [],
    placeholderTs:
      typeof payload.placeholderTs === "string" ? payload.placeholderTs : null,
    modalViewId:
      typeof payload.modalViewId === "string" ? payload.modalViewId : null,
  };
}

async function postLegacyPlaceholder(
  event: SlackDispatchEvent,
): Promise<{ ok: boolean; ts?: string | null; skipped?: boolean }> {
  if (!event.botToken || !event.channelId || !event.text) {
    console.log("Slack dispatch handler skipped unsupported event", {
      type: event.type ?? "unknown",
    });
    return { ok: true, skipped: true };
  }
  const response = await defaultSlackApi.postMessage({
    token: event.botToken,
    channel: event.channelId,
    text: event.text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: event.text } }],
    threadTs: event.threadTs || undefined,
  });
  if (!response.ok) {
    throw new Error(
      `Slack placeholder post failed: ${response.error ?? "unknown"}`,
    );
  }
  return { ok: true, ts: response.ts ?? null };
}

const defaultSlackApi: SlackDispatchApi = {
  postMessage(input) {
    return slackApiRequest("chat.postMessage", {
      token: input.token,
      body: slackMessageBody(input),
    });
  },
  updateMessage(input) {
    return slackApiRequest("chat.update", {
      token: input.token,
      body: { ...slackMessageBody(input), ts: input.ts },
    });
  },
  updateView(input) {
    return slackApiRequest("views.update", {
      token: input.token,
      body: {
        view_id: input.viewId,
        view: {
          type: "modal",
          title: { type: "plain_text", text: "ThinkWork" },
          close: { type: "plain_text", text: "Close" },
          blocks: input.blocks,
        },
      },
    });
  },
  async postResponseUrl(input) {
    const response = await fetch(input.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        response_type: "ephemeral",
        replace_original: false,
        text: input.text,
        blocks: input.blocks,
      }),
    });
    if (!response.ok) {
      return { ok: false, error: `response_url_http_${response.status}` };
    }
    return { ok: true };
  },
  usersInfo(input) {
    return slackApiRequest("users.info", {
      token: input.token,
      body: { user: input.userId },
    });
  },
};

function slackMessageBody(input: SlackMessageInput): Record<string, unknown> {
  return {
    channel: input.channel,
    text: input.text,
    blocks: input.blocks,
    thread_ts: input.threadTs || undefined,
    username: input.username || undefined,
    icon_url: input.iconUrl || undefined,
  };
}

async function slackApiRequest<T extends SlackApiResponse>(
  method: string,
  input: { token: string; body: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(input.body),
  });
  if (!response.ok) {
    return { ok: false, error: `http_${response.status}` } as T;
  }
  return (await response.json()) as T;
}

async function getSlackBotToken(secretPath: string): Promise<string> {
  const cached = secretCache.get(secretPath);
  if (cached) return cached;
  const client =
    smClient ??
    new SecretsManagerClient({
      region:
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  smClient = client;
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: secretPath }),
  );
  const token = parseBotTokenSecret(res.SecretString || "");
  if (!token) throw new Error(`Slack bot token secret ${secretPath} is empty`);
  secretCache.set(secretPath, token);
  return token;
}

function parseBotTokenSecret(secretString: string): string {
  const trimmed = secretString.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { bot_token?: string };
    return parsed.bot_token || "";
  } catch {
    return "";
  }
}

interface SlackComputerAttribution {
  displayName: string;
  avatarUrl: string | null;
}

function slackComputerUsername(displayName: string): string {
  return `${normalizeSlackDisplayName(displayName)}'s Computer`;
}

function slackComputerFooter(displayName: string): string {
  return `Routed via @ThinkWork · ${slackComputerUsername(displayName)}`;
}

function slackComputerResponseText(
  text: string,
  attribution: SlackComputerAttribution,
  options: { degraded?: boolean } = {},
): string {
  const body = text.trim() || "ThinkWork response";
  if (!options.degraded) return body;
  return `*${slackComputerUsername(attribution.displayName)}:*\n${body}`;
}

function slackComputerResponseBlocks(
  text: string,
  attribution: SlackComputerAttribution,
  options: { degraded?: boolean } = {},
): Array<Record<string, unknown>> {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackComputerResponseText(text, attribution, options),
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: slackComputerFooter(attribution.displayName) },
      ],
    },
  ];
}

function slackComputerEphemeralResponse(
  text: string,
  attribution: SlackComputerAttribution,
): { text: string; blocks: Array<Record<string, unknown>> } {
  return {
    text: slackComputerResponseText(text, attribution),
    blocks: [
      ...slackComputerResponseBlocks(text, attribution),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Post to channel" },
            action_id: "slack_promote_response",
            value: "completed_response",
          },
        ],
      },
    ],
  };
}

function normalizeSlackDisplayName(displayName: string): string {
  return displayName.trim() || "User";
}

const slackDispatchMetrics: SlackDispatchMetrics = {
  dispatchSuccess(surface) {
    emitSlackDispatchMetric("slack.dispatch.success", {
      surface: surface || "unknown",
    });
  },
  dispatchFailure(errorClassValue) {
    emitSlackDispatchMetric("slack.dispatch.failure", {
      error_class: errorClassValue || "unknown",
    });
  },
  attributionDegraded() {
    emitSlackDispatchMetric("slack.attribution.degraded");
  },
};

function emitSlackDispatchMetric(
  name:
    | "slack.dispatch.success"
    | "slack.dispatch.failure"
    | "slack.attribution.degraded",
  dimensions: Record<string, string> = {},
): void {
  const dimensionNames = Object.keys(dimensions).sort();
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "ThinkWork/Slack",
            Dimensions: [dimensionNames],
            Metrics: [{ Name: name, Unit: "Count" }],
          },
        ],
      },
      ...dimensions,
      [name]: 1,
    }),
  );
}

function errorClass(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("bot token")) return "bot_token";
  if (lower.includes("slack api failed")) return "slack_api";
  if (lower.includes("response_url")) return "response_url";
  if (lower.includes("required")) return "invalid_payload";
  return "unknown";
}
