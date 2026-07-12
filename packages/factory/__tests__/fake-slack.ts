/**
 * In-memory SlackGateway fake for threads/relay/status tests. Records every
 * outbound post; `deliver()` simulates an inbound Socket Mode message so a
 * test can drive the full answer round-trip with no network.
 */

import {
  withMentions,
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
  /** The ts this post was assigned. */
  ts: string;
}

export class FakeSlackGateway implements SlackGateway {
  posts: SlackPost[] = [];
  started = false;
  private handler: SlackMessageHandler | null = null;
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
      ts,
    });
    return ts;
  }

  postThreadReply(
    channel: string,
    threadTs: string,
    text: string,
    opts?: Omit<SlackPostOptions, "threadTs">,
  ): Promise<string> {
    return this.postMessage(channel, text, { ...opts, threadTs });
  }

  onMessage(handler: SlackMessageHandler): void {
    this.handler = handler;
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
