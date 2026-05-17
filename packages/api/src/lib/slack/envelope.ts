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

export type SlackChannelType = "channel" | "group" | "im" | "mpim" | "slash";

export type SlackTriggerSurface =
  | "app_mention"
  | "message_im"
  | "slash_command"
  | "message_action";

export interface SlackTaskEnvelope {
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId: string | null;
  channelId: string;
  channelType: SlackChannelType;
  rootThreadTs: string | null;
  responseUrl: string | null;
  triggerSurface: SlackTriggerSurface;
  sourceMessage: SlackSourceMessage | null;
  threadContext: SlackThreadContextMessage[];
  fileRefs: SlackFileRef[];
  placeholderTs: string | null;
  modalViewId: string | null;
}

export interface SlackThreadTurnInput {
  source: "slack";
  channelType: "app_mention" | "im" | "slash" | "message_action";
  slackTeamId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  eventId: string;
  sourceMessage: SlackSourceMessage;
  threadContext: SlackThreadContextMessage[];
  fileRefs: SlackFileRef[];
  responseUrl: string | null;
  placeholderTs: string | null;
  modalViewId: string | null;
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
    responseUrl: null,
    triggerSurface,
    sourceMessage,
    threadContext,
    fileRefs,
    placeholderTs: null,
    modalViewId: null,
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
    responseUrl: null,
    placeholderTs: null,
    modalViewId: null,
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
    triggerSurface,
    rootThreadTs,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    slack,
  };
}

export function mergeSlackFileRefs(...groups: SlackFileRef[][]): SlackFileRef[] {
  const byId = new Map<string, SlackFileRef>();
  for (const group of groups) {
    for (const file of group) {
      if (!byId.has(file.id)) byId.set(file.id, file);
    }
  }
  return Array.from(byId.values());
}

export function buildSlackSlashCommandInput(input: {
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId?: string | null;
  channelId: string;
  text: string;
  responseUrl: string;
  triggerId: string;
  actorId: string;
}): SlackThreadTurnInput {
  const eventId = `slash:${requiredSlackString(input.triggerId)}`;
  const slackTeamId = requiredSlackString(input.slackTeamId);
  const slackUserId = requiredSlackString(input.slackUserId);
  const channelId = requiredSlackString(input.channelId);
  const sourceMessage = {
    text: input.text.trim(),
    ts: eventId,
    user: slackUserId,
    channel: channelId,
    team: slackTeamId,
    permalink: null,
    files: [],
  };
  const slack = buildSlackTaskEnvelope({
    slackTeamId,
    slackUserId,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    channelId,
    channelType: "slash",
    rootThreadTs: null,
    responseUrl: requiredSlackString(input.responseUrl),
    triggerSurface: "slash_command",
    sourceMessage,
    threadContext: [],
    fileRefs: [],
    placeholderTs: null,
    modalViewId: null,
  });
  return {
    source: "slack",
    channelType: "slash",
    slackTeamId,
    slackUserId,
    channelId,
    threadTs: eventId,
    messageTs: eventId,
    eventId,
    sourceMessage,
    threadContext: [],
    fileRefs: [],
    responseUrl: requiredSlackString(input.responseUrl),
    placeholderTs: null,
    modalViewId: null,
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
    triggerSurface: "slash_command",
    rootThreadTs: null,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    slack,
  };
}

export function buildSlackMessageActionInput(input: {
  slackTeamId: string;
  slackUserId: string;
  slackWorkspaceRowId?: string | null;
  channelId: string;
  triggerId: string;
  responseUrl?: string | null;
  modalViewId: string;
  message: SlackMessageLike;
  actorId: string;
  permalink?: string | null;
}): SlackThreadTurnInput {
  const eventId = `message_action:${requiredSlackString(input.triggerId)}`;
  const messageTs = requiredSlackString(input.message.ts);
  const slackTeamId = requiredSlackString(input.slackTeamId);
  const slackUserId = requiredSlackString(input.slackUserId);
  const channelId = requiredSlackString(input.channelId);
  const sourceUser = optionalSlackString(input.message.user) || slackUserId;
  const fileRefs = slackFileRefs(input.message.files);
  const rootThreadTs = optionalSlackString(input.message.thread_ts);
  const responseUrl =
    typeof input.responseUrl === "string" && input.responseUrl.trim()
      ? input.responseUrl.trim()
      : null;
  const sourceMessage = {
    text: slackEventText(input.message),
    ts: messageTs,
    user: sourceUser,
    channel: channelId,
    team: slackTeamId,
    permalink: input.permalink || null,
    files: fileRefs,
  };
  const slack = buildSlackTaskEnvelope({
    slackTeamId,
    slackUserId,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    channelId,
    channelType: inferConversationChannelType(input.message, "message_action"),
    rootThreadTs,
    responseUrl,
    triggerSurface: "message_action",
    sourceMessage,
    threadContext: [],
    fileRefs,
    placeholderTs: null,
    modalViewId: requiredSlackString(input.modalViewId),
  });
  return {
    source: "slack",
    channelType: "message_action",
    slackTeamId,
    slackUserId,
    channelId,
    threadTs: slackThreadTs(input.message),
    messageTs,
    eventId,
    sourceMessage,
    threadContext: [],
    fileRefs,
    responseUrl,
    placeholderTs: null,
    modalViewId: requiredSlackString(input.modalViewId),
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
    triggerSurface: "message_action",
    rootThreadTs,
    slackWorkspaceRowId: input.slackWorkspaceRowId ?? null,
    slack,
  };
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
    responseUrl: optionalSlackString(input.responseUrl),
    threadContext: summarizeSlackThreadContext(input.threadContext ?? []),
    fileRefs: input.fileRefs ?? [],
    placeholderTs: optionalSlackString(input.placeholderTs),
    modalViewId: optionalSlackString(input.modalViewId),
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
  if (triggerSurface === "slash_command") return "slash";
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

function requiredSlackString(value: unknown): string {
  const stringValue = optionalSlackString(value);
  if (!stringValue) throw new Error("Slack event is missing a required field");
  return stringValue;
}

function optionalSlackString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
