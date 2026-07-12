/**
 * Thin gateway over @slack/web-api + @slack/socket-mode so the daemon,
 * thread-lifecycle, relay, and status code never touch the Slack SDKs
 * directly — every test runs against an in-memory fake implementing
 * SlackGateway, with no network.
 *
 * Two Slack tokens, two jobs (keep them straight — this is the #1 setup
 * mistake):
 *   - BOT token   (`xoxb-…`) → WebClient, for outbound chat.postMessage.
 *   - APP token   (`xapp-…`, connections:write) → SocketModeClient, for the
 *     inbound WebSocket that delivers operators' in-thread replies.
 *
 * Inbound surface: the daemon registers ONE handler via `onMessage`; the
 * gateway invokes it for every user `message` event in the configured
 * channel. `start()`/`stop()` open and close the Socket Mode connection. All
 * @slack/* imports are dynamic and confined to `createSlackGateway`, so the
 * fake path (and the whole test suite) never loads the SDK.
 */

export interface SlackPostOptions {
  /** Reply inside this thread (a parent message ts). Omit for a root post. */
  threadTs?: string;
  /** User ids to @mention; rendered as `<@U…>` prepended to the text. */
  mentionUserIds?: string[];
}

/** A normalized inbound Slack message event (only the fields the relay needs). */
export interface SlackInboundMessage {
  /** Channel id the message was posted in. */
  channel: string;
  /**
   * Parent thread ts when this is a threaded reply; null for a root-level
   * message. The relay only acts on threaded replies (an answer must be a
   * reply IN the issue's thread).
   */
  threadTs: string | null;
  /** This message's own ts (used as the relay idempotency high-water mark). */
  ts: string;
  /** The replier's Slack user id — checked against the operator allowlist. */
  userId: string;
  /** Message text. */
  text: string;
}

export type SlackMessageHandler = (
  message: SlackInboundMessage,
) => void | Promise<void>;

export interface SlackGateway {
  /**
   * Post a message. Returns the message ts. With `opts.threadTs` it is a
   * threaded reply; with `opts.mentionUserIds` the mentions are prepended.
   */
  postMessage(
    channel: string,
    text: string,
    opts?: SlackPostOptions,
  ): Promise<string>;
  /** Convenience: reply inside a thread. Returns the reply ts. */
  postThreadReply(
    channel: string,
    threadTs: string,
    text: string,
    opts?: Omit<SlackPostOptions, "threadTs">,
  ): Promise<string>;
  /** Register the single inbound-message handler (Socket Mode). */
  onMessage(handler: SlackMessageHandler): void;
  /** Open the Socket Mode connection (no-op until called). */
  start(): Promise<void>;
  /** Close the Socket Mode connection. */
  stop(): Promise<void>;
  /** Verify the bot token (auth.test). Returns the bot user id. Doctor uses this. */
  authTest(): Promise<{ userId: string; team: string }>;
  /** Verify the channel is reachable (conversations.info). Doctor uses this. */
  channelReachable(channel: string): Promise<boolean>;
}

/** Render `<@U1> <@U2> text`. Exported for the fake and unit tests. */
export function withMentions(text: string, mentionUserIds?: string[]): string {
  if (mentionUserIds === undefined || mentionUserIds.length === 0) return text;
  const mentions = mentionUserIds.map((id) => `<@${id}>`).join(" ");
  return `${mentions} ${text}`;
}

export interface CreateSlackGatewayOptions {
  botToken: string;
  appToken: string;
  /** Channel whose messages the inbound listener surfaces. */
  channelId: string;
  /**
   * The bot's own user id, when known, so the listener drops the bot's own
   * posts. Resolved lazily via auth.test when omitted.
   */
  botUserId?: string;
}

/**
 * Real gateway. Dynamically imports the Slack SDKs so nothing loads them in
 * tests. Inbound: subscribes to Socket Mode `message` events, filters to the
 * configured channel and to genuine user messages (no bot posts, no edits /
 * subtype events), normalizes, and fans out to the registered handler. Every
 * envelope is `ack()`-ed immediately so Slack does not redeliver (the relay's
 * own last-relayed-ts guard is the second line of defense against dupes).
 */
export async function createSlackGateway(
  opts: CreateSlackGatewayOptions,
): Promise<SlackGateway> {
  const { WebClient } = await import("@slack/web-api");
  const { SocketModeClient } = await import("@slack/socket-mode");

  const web = new WebClient(opts.botToken);
  const socket = new SocketModeClient({ appToken: opts.appToken });
  let botUserId = opts.botUserId ?? null;
  let handler: SlackMessageHandler | null = null;

  socket.on("message", async ({ event, ack }: { event?: unknown; ack?: () => Promise<void> }) => {
    // Ack first, always — an unacked envelope is redelivered.
    if (ack) await ack();
    if (handler === null || event === null || typeof event !== "object") return;
    const e = event as Record<string, unknown>;
    // Drop bot posts, message edits/deletes, and other subtype events — only
    // genuine human messages carry an answer.
    if (typeof e.subtype === "string") return;
    if (typeof e.bot_id === "string") return;
    const user = typeof e.user === "string" ? e.user : null;
    if (user === null || (botUserId !== null && user === botUserId)) return;
    const channel = typeof e.channel === "string" ? e.channel : null;
    if (channel === null || channel !== opts.channelId) return;
    const ts = typeof e.ts === "string" ? e.ts : null;
    if (ts === null) return;
    const threadTs = typeof e.thread_ts === "string" ? e.thread_ts : null;
    const text = typeof e.text === "string" ? e.text : "";
    await handler({ channel, threadTs, ts, userId: user, text });
  });

  async function resolveBotUserId(): Promise<string> {
    if (botUserId !== null) return botUserId;
    const res = (await web.auth.test()) as { user_id?: string };
    botUserId = res.user_id ?? "";
    return botUserId;
  }

  const postMessage: SlackGateway["postMessage"] = async (
    channel,
    text,
    options,
  ) => {
    const res = (await web.chat.postMessage({
      channel,
      text: withMentions(text, options?.mentionUserIds),
      ...(options?.threadTs !== undefined
        ? { thread_ts: options.threadTs }
        : {}),
    })) as { ts?: string };
    if (res.ts === undefined) {
      throw new Error("slack chat.postMessage returned no ts");
    }
    return res.ts;
  };

  return {
    postMessage,

    postThreadReply(channel, threadTs, text, options) {
      return postMessage(channel, text, { ...options, threadTs });
    },

    onMessage(h) {
      handler = h;
    },

    async start() {
      await resolveBotUserId();
      await socket.start();
    },

    async stop() {
      await socket.disconnect();
    },

    async authTest() {
      const res = (await web.auth.test()) as {
        user_id?: string;
        team?: string;
      };
      return { userId: res.user_id ?? "", team: res.team ?? "" };
    },

    async channelReachable(channel) {
      try {
        const res = (await web.conversations.info({ channel })) as {
          ok?: boolean;
        };
        return res.ok === true;
      } catch {
        return false;
      }
    },
  };
}
