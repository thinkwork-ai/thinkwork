export interface SlackSourceMessage {
  text: string;
  ts: string;
  user: string;
  channel: string;
  team: string;
  permalink: string | null;
  files?: SlackFileRef[];
}

export interface SlackFileRef {
  id: string;
  name: string | null;
  mimetype: string | null;
  urlPrivate: string | null;
  urlPrivateDownload: string | null;
  permalink: string | null;
  sizeBytes: number | null;
}

export interface SlackThreadContextMessage {
  user: string | null;
  botId: string | null;
  ts: string;
  text: string;
  files?: SlackFileRef[];
}

export type SlackChannelType = "channel" | "group" | "im" | "mpim";

export type SlackTriggerSurface = "app_mention" | "message_im";

export interface SlackTaskEnvelope {
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId: string | null;
  channelId: string;
  channelType: SlackChannelType;
  rootThreadTs: string | null;
  triggerSurface: SlackTriggerSurface;
  sourceMessage: SlackSourceMessage | null;
  threadContext: SlackThreadContextMessage[];
  fileRefs: SlackFileRef[];
}

export interface SlackThreadTurnInput {
  source: "slack";
  channelType: "app_mention" | "im";
  slackTeamId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  eventId: string;
  sourceMessage: SlackSourceMessage;
  threadContext: SlackThreadContextMessage[];
  fileRefs: SlackFileRef[];
  actorType: "user";
  actorId: string;
  triggerSurface: SlackTriggerSurface;
  rootThreadTs: string | null;
  slackWorkspaceRowId: string | null;
  slack: SlackTaskEnvelope;
  threadId?: string;
  messageId?: string;
}

export interface SlackEventFile {
  id?: unknown;
  name?: unknown;
  mimetype?: unknown;
  url_private?: unknown;
  url_private_download?: unknown;
  permalink?: unknown;
  size?: unknown;
}

export interface SlackMessageLike {
  type?: unknown;
  team?: unknown;
  user?: unknown;
  channel?: unknown;
  text?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
  channel_type?: unknown;
  files?: unknown;
}

export function slackThreadTs(event: SlackMessageLike): string {
  return optionalSlackString(event.thread_ts) || requiredSlackString(event.ts);
}

export function slackEventText(event: SlackMessageLike): string {
  return optionalSlackString(event.text) || "";
}

export function slackFileRefs(files: unknown): SlackFileRef[] {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => {
      if (!file || typeof file !== "object") return null;
      const item = file as SlackEventFile;
      const id = optionalSlackString(item.id);
      if (!id) return null;
      return {
        id,
        name: optionalSlackString(item.name),
        mimetype: optionalSlackString(item.mimetype),
        urlPrivate: optionalSlackString(item.url_private),
        urlPrivateDownload: optionalSlackString(item.url_private_download),
        permalink: optionalSlackString(item.permalink),
        sizeBytes: optionalSlackNumber(item.size),
      };
    })
    .filter((file): file is SlackFileRef => file !== null);
}

function optionalSlackNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function summarizeSlackThreadContext(
  messages: SlackThreadContextMessage[],
  maxMessages = 50,
  maxChars = 4_000,
): SlackThreadContextMessage[] {
  const cappedMessages = messages.slice(-maxMessages);
  let remaining = maxChars;
  const out: SlackThreadContextMessage[] = [];
  for (const message of cappedMessages) {
    if (remaining <= 0) {
      if ((message.files ?? []).length > 0) out.push({ ...message, text: "" });
      continue;
    }
    const text = message.text.slice(0, remaining);
    remaining -= text.length;
    out.push({ ...message, text });
  }
  return out;
}

export function buildSlackThreadTurnInput(input: {
  channelType: "app_mention" | "im";
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId?: string | null;
  channelId: string;
  eventId: string;
  event: SlackMessageLike;
  threadContext?: SlackThreadContextMessage[];
  actorId: string;
  permalink?: string | null;
}): SlackThreadTurnInput {
  const messageTs = requiredSlackString(input.event.ts);
  const channelId = requiredSlackString(input.channelId);
  const slackTeamId = requiredSlackString(input.slackTeamId);
  const slackUserId = requiredSlackString(input.slackUserId);
  const sourceFileRefs = slackFileRefs(input.event.files);
  const threadContext = input.threadContext ?? [];
  const fileRefs = mergeSlackFileRefs(
    sourceFileRefs,
    ...threadContext.map((message) => message.files ?? []),
  );
  const triggerSurface =
    input.channelType === "im" ? "message_im" : "app_mention";
  const rootThreadTs = optionalSlackString(input.event.thread_ts);
  const sourceMessage = {
    text: slackEventText(input.event),
    ts: messageTs,
    user: slackUserId,
    channel: channelId,
    team: slackTeamId,
    permalink: input.permalink || null,
    files: sourceFileRefs,
  };
  const slack = buildSlackTaskEnvelope({
    slackTeamId,
    slackUserId,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    channelId,
    channelType: inferConversationChannelType(input.event, triggerSurface),
    rootThreadTs,
    triggerSurface,
    sourceMessage,
    threadContext,
    fileRefs,
  });
  return {
    source: "slack",
    channelType: input.channelType,
    slackTeamId,
    slackUserId,
    channelId,
    threadTs: slackThreadTs(input.event),
    messageTs,
    eventId: requiredSlackString(input.eventId),
    sourceMessage,
    threadContext: slack.threadContext,
    fileRefs,
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
    triggerSurface,
    rootThreadTs,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    slack,
  };
}

export function mergeSlackFileRefs(
  ...groups: SlackFileRef[][]
): SlackFileRef[] {
  const byId = new Map<string, SlackFileRef>();
  for (const group of groups) {
    for (const file of group) {
      if (!byId.has(file.id)) byId.set(file.id, file);
    }
  }
  return Array.from(byId.values());
}

export function buildSlackTaskEnvelope(
  input: SlackTaskEnvelope,
): SlackTaskEnvelope {
  return {
    ...input,
    slackTeamId: requiredSlackString(input.slackTeamId),
    slackUserId: requiredSlackString(input.slackUserId),
    slackWorkspaceRowId: optionalSlackString(input.slackWorkspaceRowId),
    channelId: requiredSlackString(input.channelId),
    rootThreadTs: optionalSlackString(input.rootThreadTs),
    threadContext: summarizeSlackThreadContext(input.threadContext ?? []),
    fileRefs: input.fileRefs ?? [],
  };
}

export function withSlackThreadMapping(
  input: SlackThreadTurnInput,
  mapping: { threadId: string; messageId: string },
): SlackThreadTurnInput {
  return {
    ...input,
    threadId: requiredSlackString(mapping.threadId),
    messageId: requiredSlackString(mapping.messageId),
  };
}

function inferConversationChannelType(
  message: SlackMessageLike,
  triggerSurface: SlackTriggerSurface,
): SlackChannelType {
  const value = optionalSlackString(message.channel_type);
  if (
    value === "channel" ||
    value === "group" ||
    value === "im" ||
    value === "mpim"
  ) {
    return value;
  }
  if (triggerSurface === "message_im") return "im";
  return "channel";
}

export function requiredSlackString(value: unknown): string {
  const stringValue = optionalSlackString(value);
  if (!stringValue) throw new Error("Slack event is missing a required field");
  return stringValue;
}

export function optionalSlackString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
