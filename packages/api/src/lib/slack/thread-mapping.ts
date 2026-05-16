import { and, eq, isNull, sql } from "drizzle-orm";
import {
  messages,
  slackThreads,
  tenants,
  threads,
} from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import type { SlackThreadTurnInput } from "./envelope.js";

export interface SlackThreadMappingResult {
  threadId: string;
  messageId: string;
  wasCreated: boolean;
}

export interface SlackThreadMappingStore {
  withTransaction<T>(
    fn: (store: SlackThreadMappingStore) => Promise<T>,
  ): Promise<T>;
  findThread(input: SlackThreadKey): Promise<{ threadId: string } | null>;
  createThread(input: SlackThreadCreateInput): Promise<{ threadId: string }>;
  createMapping(input: SlackThreadCreateMappingInput): Promise<void>;
  createMessage(
    input: SlackThreadCreateMessageInput,
  ): Promise<{ messageId: string }>;
}

export interface SlackThreadKey {
  tenantId: string;
  slackTeamId: string;
  channelId: string;
  rootThreadTs: string | null;
}

interface SlackThreadCreateInput {
  tenantId: string;
  computerId: string;
  actorId: string;
  title: string;
}

interface SlackThreadCreateMappingInput extends SlackThreadKey {
  threadId: string;
}

interface SlackThreadCreateMessageInput {
  tenantId: string;
  threadId: string;
  actorId: string;
  content: string;
  envelope: SlackThreadTurnInput["slack"];
}

export async function resolveOrCreateSlackThread(
  input: {
    tenantId: string;
    computerId: string;
    actorId: string;
    envelope: SlackThreadTurnInput;
  },
  store: SlackThreadMappingStore = createDrizzleSlackThreadMappingStore(),
): Promise<SlackThreadMappingResult> {
  return store.withTransaction(async (tx) => {
    const key = slackThreadKey(input.tenantId, input.envelope);
    const existing = await tx.findThread(key);
    const thread = existing ?? (await createMappedThread(input, key, tx));
    const message = await tx.createMessage({
      tenantId: input.tenantId,
      threadId: thread.threadId,
      actorId: input.actorId,
      content: input.envelope.slack.sourceMessage?.text ?? "",
      envelope: input.envelope.slack,
    });
    return {
      threadId: thread.threadId,
      messageId: message.messageId,
      wasCreated: !existing,
    };
  });
}

function slackThreadKey(
  tenantId: string,
  envelope: SlackThreadTurnInput,
): SlackThreadKey {
  return {
    tenantId,
    slackTeamId: envelope.slack.slackTeamId,
    channelId: envelope.slack.channelId,
    rootThreadTs: slackThreadMappingRoot(envelope),
  };
}

function slackThreadMappingRoot(envelope: SlackThreadTurnInput): string | null {
  if (envelope.slack.triggerSurface === "message_im") return null;
  return envelope.slack.rootThreadTs ?? envelope.messageTs;
}

async function createMappedThread(
  input: {
    tenantId: string;
    computerId: string;
    actorId: string;
    envelope: SlackThreadTurnInput;
  },
  key: SlackThreadKey,
  store: SlackThreadMappingStore,
) {
  const thread = await store.createThread({
    tenantId: input.tenantId,
    computerId: input.computerId,
    actorId: input.actorId,
    title: slackThreadTitle(input.envelope),
  });
  await store.createMapping({ ...key, threadId: thread.threadId });
  return thread;
}

function slackThreadTitle(envelope: SlackThreadTurnInput): string {
  const text = envelope.slack.sourceMessage?.text?.trim() ?? "";
  const prefix =
    envelope.slack.triggerSurface === "slash_command"
      ? "Slack /thinkwork"
      : "Slack";
  if (!text) return prefix;
  return text.length <= 80
    ? text
    : text.substring(0, 80).replace(/\s+\S*$/, "...");
}

function createDrizzleSlackThreadMappingStore(
  dbClient: any = db,
): SlackThreadMappingStore {
  return {
    withTransaction(fn) {
      return dbClient.transaction((tx: any) =>
        fn(createDrizzleSlackThreadMappingStore(tx)),
      );
    },
    async findThread(input) {
      const rootCondition =
        input.rootThreadTs === null
          ? isNull(slackThreads.root_thread_ts)
          : eq(slackThreads.root_thread_ts, input.rootThreadTs);
      const [row] = await dbClient
        .select({ threadId: slackThreads.thread_id })
        .from(slackThreads)
        .where(
          and(
            eq(slackThreads.tenant_id, input.tenantId),
            eq(slackThreads.slack_team_id, input.slackTeamId),
            eq(slackThreads.channel_id, input.channelId),
            rootCondition,
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async createThread(input) {
      const [tenant] = await dbClient
        .update(tenants)
        .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
        .where(eq(tenants.id, input.tenantId))
        .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
      if (!tenant) throw new Error("Tenant not found");
      const [thread] = await dbClient
        .insert(threads)
        .values({
          tenant_id: input.tenantId,
          computer_id: input.computerId,
          user_id: input.actorId,
          number: tenant.nextNumber,
          identifier: `SLACK-${tenant.nextNumber}`,
          title: input.title,
          status: "in_progress",
          channel: "slack",
          created_by_type: "user",
          created_by_id: input.actorId,
        })
        .returning({ threadId: threads.id });
      if (!thread) throw new Error("Slack thread insert failed");
      return thread;
    },
    async createMapping(input) {
      await dbClient.insert(slackThreads).values({
        tenant_id: input.tenantId,
        slack_team_id: input.slackTeamId,
        channel_id: input.channelId,
        root_thread_ts: input.rootThreadTs,
        thread_id: input.threadId,
      });
    },
    async createMessage(input) {
      const [message] = await dbClient
        .insert(messages)
        .values({
          tenant_id: input.tenantId,
          thread_id: input.threadId,
          role: "user",
          content: input.content,
          sender_type: "user",
          sender_id: input.actorId,
          metadata: { source: "slack", slack: input.envelope },
        })
        .returning({ messageId: messages.id });
      if (!message) throw new Error("Slack thread message insert failed");
      return message;
    },
  };
}
