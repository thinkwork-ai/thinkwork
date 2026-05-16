export interface SlackSourceMessage {
  text: string;
  ts: string;
  user: string;
  channel: string;
  team: string;
  permalink: string | null;
}

export interface SlackFileRef {
  id: string;
  name: string | null;
  mimetype: string | null;
  urlPrivate: string | null;
}

export interface SlackThreadContextMessage {
  user: string | null;
  botId: string | null;
  ts: string;
  text: string;
}

export interface SlackThreadTurnInput {
  source: "slack";
  channelType: "app_mention" | "im" | "slash";
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
  actorType: "user";
  actorId: string;
}

export interface SlackEventFile {
  id?: unknown;
  name?: unknown;
  mimetype?: unknown;
  url_private?: unknown;
}

export interface SlackMessageLike {
  type?: unknown;
  team?: unknown;
  user?: unknown;
  channel?: unknown;
  text?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
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
      };
    })
    .filter((file): file is SlackFileRef => file !== null);
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
    if (remaining <= 0) break;
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
  return {
    source: "slack",
    channelType: input.channelType,
    slackTeamId,
    slackUserId,
    channelId,
    threadTs: slackThreadTs(input.event),
    messageTs,
    eventId: requiredSlackString(input.eventId),
    sourceMessage: {
      text: slackEventText(input.event),
      ts: messageTs,
      user: slackUserId,
      channel: channelId,
      team: slackTeamId,
      permalink: input.permalink || null,
    },
    threadContext: summarizeSlackThreadContext(input.threadContext ?? []),
    fileRefs: slackFileRefs(input.event.files),
    responseUrl: null,
    placeholderTs: null,
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
  };
}

export function buildSlackSlashCommandInput(input: {
  slackTeamId: string;
  slackUserId: string;
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
  return {
    source: "slack",
    channelType: "slash",
    slackTeamId,
    slackUserId,
    channelId,
    threadTs: eventId,
    messageTs: eventId,
    eventId,
    sourceMessage: {
      text: input.text.trim(),
      ts: eventId,
      user: slackUserId,
      channel: channelId,
      team: slackTeamId,
      permalink: null,
    },
    threadContext: [],
    fileRefs: [],
    responseUrl: requiredSlackString(input.responseUrl),
    placeholderTs: null,
    actorType: "user",
    actorId: requiredSlackString(input.actorId),
  };
}

function requiredSlackString(value: unknown): string {
  const stringValue = optionalSlackString(value);
  if (!stringValue) throw new Error("Slack event is missing a required field");
  return stringValue;
}

function optionalSlackString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
