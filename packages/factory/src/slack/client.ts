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
 * Inbound surface: the daemon registers ONE handler via `onMessage` (user
 * `message` events in the configured channel) and ONE via `onAction`
 * (`block_actions` interaction payloads — answer-form button clicks). Both
 * ride the SAME Socket Mode WebSocket; no public Request URL exists anywhere
 * in this daemon. `start()`/`stop()` open and close the connection. All
 * @slack/* imports are dynamic and confined to `createSlackGateway`, so the
 * fake path (and the whole test suite) never loads the SDK.
 *
 * ⚠️ Slack app setup for buttons: the app must have **Interactivity enabled**
 * in its configuration (Interactivity & Shortcuts). With Socket Mode no
 * Request URL is needed — but with Interactivity off, Slack renders the
 * buttons and silently delivers NOTHING when they are clicked. There is no
 * error anywhere; clicks just go nowhere.
 */

export interface SlackPostOptions {
  /** Reply inside this thread (a parent message ts). Omit for a root post. */
  threadTs?: string;
  /** User ids to @mention; rendered as `<@U…>` prepended to the text. */
  mentionUserIds?: string[];
  /**
   * Block Kit blocks (answer-form buttons). The plain `text` is still sent —
   * Slack requires it as the notification/accessibility fallback, and it is
   * what renders when a client cannot show blocks.
   */
  blocks?: unknown[];
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

/** A normalized `block_actions` interaction (an answer-form button click). */
export interface SlackBlockAction {
  /** Channel id the clicked message lives in. */
  channel: string;
  /** The ts of the MESSAGE carrying the clicked button (for chat.update). */
  messageTs: string;
  /** Parent thread ts of that message; null when it is a root message. */
  threadTs: string | null;
  /** The clicker's Slack user id — checked against the operator allowlist. */
  userId: string;
  /** The clicked button's action_id (`factory-answer…`). */
  actionId: string;
  /** The clicked button's value (JSON string, see AnswerButtonValue). */
  value: string;
}

export type SlackActionHandler = (
  action: SlackBlockAction,
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
  /**
   * Edit an already-posted message (chat.update) — used to replace an answered
   * escalation's buttons with a summary so a form cannot double-fire. Callers
   * treat failures as best-effort (log and continue).
   */
  updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: unknown[],
  ): Promise<void>;
  /**
   * Upload local files (screenshots) inline into a thread via files.uploadV2.
   * Requires the `files:write` bot scope — a missing scope surfaces as a
   * Slack `missing_scope` error the caller acks (U10 documents the setup).
   */
  uploadFiles(channel: string, threadTs: string, paths: string[]): Promise<void>;
  /** Pin a message in the channel (pins.add; needs `pins:write`). */
  pinMessage(channel: string, ts: string): Promise<void>;
  /**
   * List pinned items (pins.list). Side-effect-free probe for the `pins:read`
   * scope — doctor uses it; throws on missing scope.
   */
  listPins(channel: string): Promise<number>;
  /** Permalink for a message (chat.getPermalink), or null on failure. */
  getPermalink(channel: string, ts: string): Promise<string | null>;
  /** Register the single inbound-message handler (Socket Mode). */
  onMessage(handler: SlackMessageHandler): void;
  /** Register the single block-action (button click) handler (Socket Mode). */
  onAction(handler: SlackActionHandler): void;
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
  let actionHandler: SlackActionHandler | null = null;

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

  // Button clicks arrive as `interactive` envelopes on the SAME socket. Ack
  // first, always — exactly like the message handler above, an unacked
  // envelope is redelivered, and a redelivered click would double-relay the
  // answer before the relay's own no-open-question guard can catch it.
  socket.on(
    "interactive",
    async ({ body, ack }: { body?: unknown; ack?: () => Promise<void> }) => {
      if (ack) await ack();
      if (actionHandler === null || body === null || typeof body !== "object")
        return;
      const b = body as Record<string, unknown>;
      if (b.type !== "block_actions") return;
      const user = b.user as Record<string, unknown> | undefined;
      const userId = typeof user?.id === "string" ? user.id : null;
      if (userId === null) return;
      // channel id lives on payload.channel.id for message-container actions;
      // container.channel_id is the documented fallback.
      const container = b.container as Record<string, unknown> | undefined;
      const channelObj = b.channel as Record<string, unknown> | undefined;
      const channel =
        typeof channelObj?.id === "string"
          ? channelObj.id
          : typeof container?.channel_id === "string"
            ? container.channel_id
            : null;
      if (channel === null || channel !== opts.channelId) return;
      const messageTs =
        typeof container?.message_ts === "string" ? container.message_ts : null;
      if (messageTs === null) return;
      const message = b.message as Record<string, unknown> | undefined;
      const threadTs =
        typeof message?.thread_ts === "string" ? message.thread_ts : null;
      const actions = Array.isArray(b.actions) ? b.actions : [];
      const first = actions[0] as Record<string, unknown> | undefined;
      const actionId = typeof first?.action_id === "string" ? first.action_id : null;
      if (actionId === null) return;
      // Defensive: only OUR buttons are routed — answer forms
      // (`factory-answer*`) and console actions (`factory-console:*`) share
      // the `factory-` namespace. Any other block action (a future feature, a
      // stray app) is dropped here, never handed to a handler.
      if (!actionId.startsWith("factory-")) return;
      const value = typeof first?.value === "string" ? first.value : "";
      await actionHandler({
        channel,
        messageTs,
        threadTs,
        userId,
        actionId,
        value,
      });
    },
  );

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
      // Never unfurl: a permalink in an operational message (board rows link
      // to their threads) otherwise becomes a quoted-message attachment that
      // sticks to the message even after edits remove the link — a ghost of a
      // long-gone board row (live: THINK-270's enrollment quote stayed glued
      // to the board a day after the issue was Done).
      unfurl_links: false,
      unfurl_media: false,
      ...(options?.threadTs !== undefined
        ? { thread_ts: options.threadTs }
        : {}),
      // `text` stays alongside blocks as the notification fallback — Slack
      // requires it (and warns without it).
      ...(options?.blocks !== undefined
        ? { blocks: options.blocks as never }
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

    async updateMessage(channel, ts, text, blocks) {
      await web.chat.update({
        channel,
        ts,
        text,
        // Strip unfurl attachments accumulated before unfurling was disabled
        // (chat.update leaves existing attachments in place unless the field
        // is sent) — heals already-haunted messages on their next edit.
        attachments: [],
        ...(blocks !== undefined ? { blocks: blocks as never } : {}),
      });
    },

    async pinMessage(channel, ts) {
      await web.pins.add({ channel, timestamp: ts });
    },

    async listPins(channel) {
      const res = (await web.pins.list({ channel })) as { items?: unknown[] };
      return res.items?.length ?? 0;
    },

    async getPermalink(channel, ts) {
      try {
        const res = (await web.chat.getPermalink({
          channel,
          message_ts: ts,
        })) as { permalink?: string };
        return res.permalink ?? null;
      } catch {
        return null;
      }
    },

    async uploadFiles(channel, threadTs, paths) {
      if (paths.length === 0) return;
      const { basename } = await import("node:path");
      await web.files.uploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        file_uploads: paths.map((p) => ({ file: p, filename: basename(p) })),
      });
    },

    onMessage(h) {
      handler = h;
    },

    onAction(h) {
      actionHandler = h;
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
