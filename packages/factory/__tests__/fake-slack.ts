/**
 * In-memory SlackGateway fake for threads/relay/status tests. Records every
 * outbound post; `deliver()` simulates an inbound Socket Mode message so a
 * test can drive the full answer round-trip with no network.
 */

import {
  withMentions,
  type SlackActionHandler,
  type SlackBlockAction,
  type SlackGateway,
  type SlackInboundMessage,
  type SlackMessageHandler,
  type SlackPostOptions,
} from "../src/slack/client.js";

export interface SlackPost {
  channel: string;
  /** Rendered text WITH any @mentions prepended (what Slack would show). */
  text: string;
  threadTs?: string;
  mentionUserIds?: string[];
  /** Block Kit blocks, when the post carried an answer form. */
  blocks?: unknown[];
  /** The ts this post was assigned. */
  ts: string;
}

/** A recorded chat.update call (button-strip after an answered form). */
export interface SlackUpdate {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}

export class FakeSlackGateway implements SlackGateway {
  posts: SlackPost[] = [];
  updates: SlackUpdate[] = [];
  uploads: { channel: string; threadTs: string; paths: string[] }[] = [];
  pins: { channel: string; ts: string }[] = [];
  /** When set, updateMessage throws for these ts values (board self-heal). */
  updateFailsFor = new Set<string>();
  /** When set, uploadFiles throws (missing files:write scope, etc.). */
  uploadError: Error | null = null;
  started = false;
  private handler: SlackMessageHandler | null = null;
  private actionHandler: SlackActionHandler | null = null;
  private seq = 1;
  botUserId = "UBOT";

  async postMessage(
    channel: string,
    text: string,
    opts?: SlackPostOptions,
  ): Promise<string> {
    const ts = `${1000 + this.seq}.${String(this.seq).padStart(6, "0")}`;
    this.seq += 1;
    this.posts.push({
      channel,
      text: withMentions(text, opts?.mentionUserIds),
      threadTs: opts?.threadTs,
      mentionUserIds: opts?.mentionUserIds,
      blocks: opts?.blocks,
      ts,
    });
    return ts;
  }

  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: unknown[],
  ): Promise<void> {
    if (this.updateFailsFor.has(ts)) throw new Error("message_not_found");
    this.updates.push({ channel, ts, text, blocks });
  }

  async pinMessage(channel: string, ts: string): Promise<void> {
    this.pins.push({ channel, ts });
  }

  /** When set, listPins throws (missing pins:read). */
  listPinsError: Error | null = null;

  async listPins(channel: string): Promise<number> {
    if (this.listPinsError !== null) throw this.listPinsError;
    return this.pins.filter((p) => p.channel === channel).length;
  }

  async getPermalink(channel: string, ts: string): Promise<string | null> {
    return `https://slack.test/archives/${channel}/p${ts.replace(".", "")}`;
  }

  postThreadReply(
    channel: string,
    threadTs: string,
    text: string,
    opts?: Omit<SlackPostOptions, "threadTs">,
  ): Promise<string> {
    return this.postMessage(channel, text, { ...opts, threadTs });
  }

  async uploadFiles(
    channel: string,
    threadTs: string,
    paths: string[],
  ): Promise<void> {
    if (this.uploadError !== null) throw this.uploadError;
    this.uploads.push({ channel, threadTs, paths });
  }

  onMessage(handler: SlackMessageHandler): void {
    this.handler = handler;
  }

  onAction(handler: SlackActionHandler): void {
    this.actionHandler = handler;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async authTest(): Promise<{ userId: string; team: string }> {
    return { userId: this.botUserId, team: "TFAKE" };
  }

  async channelReachable(): Promise<boolean> {
    return true;
  }

  /** Simulate an inbound reply arriving over Socket Mode. */
  async deliver(message: SlackInboundMessage): Promise<void> {
    if (this.handler === null) throw new Error("no onMessage handler registered");
    await this.handler(message);
  }

  /** Simulate a block_actions button click arriving over Socket Mode. */
  async emitAction(action: SlackBlockAction): Promise<void> {
    if (this.actionHandler === null)
      throw new Error("no onAction handler registered");
    await this.actionHandler(action);
  }

  /** Posts that carried an @mention (escalations). */
  mentions(): SlackPost[] {
    return this.posts.filter(
      (p) => p.mentionUserIds !== undefined && p.mentionUserIds.length > 0,
    );
  }

  /** Replies inside a given thread. */
  repliesIn(threadTs: string): SlackPost[] {
    return this.posts.filter((p) => p.threadTs === threadTs);
  }
}
