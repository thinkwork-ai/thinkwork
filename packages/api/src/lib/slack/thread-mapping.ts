import { and, eq, isNull, sql } from "drizzle-orm";
import {
  messages,
  slackThreads,
  spaces,
  tenants,
  threadParticipants,
  threads,
} from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import type { SlackThreadTurnInput } from "./envelope.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";

export interface SlackThreadMappingResult {
  threadId: string;
  spaceId: string;
  messageId: string;
  wasCreated: boolean;
  messageCreated: boolean;
}

export interface SlackThreadMappingStore {
  withTransaction<T>(
    fn: (store: SlackThreadMappingStore) => Promise<T>,
  ): Promise<T>;
  findThread(
    input: SlackThreadKey,
  ): Promise<{ threadId: string; spaceId: string } | null>;
  createThread(
    input: SlackThreadCreateInput,
  ): Promise<{ threadId: string; spaceId: string }>;
  createMapping(input: SlackThreadCreateMappingInput): Promise<void>;
  createMessage(input: SlackThreadCreateMessageInput): Promise<{
    messageId: string;
    threadId: string;
    spaceId: string;
    wasCreated: boolean;
  }>;
}

export interface SlackThreadKey {
  tenantId: string;
  slackTeamId: string;
  channelId: string;
  rootThreadTs: string | null;
}

interface SlackThreadCreateInput {
  tenantId: string;
  actorId: string;
  title: string;
}

interface SlackThreadCreateMappingInput extends SlackThreadKey {
  threadId: string;
  spaceId: string;
}

interface SlackThreadCreateMessageInput {
  tenantId: string;
  threadId: string;
  spaceId: string;
  actorId: string;
  content: string;
  envelope: SlackThreadTurnInput["slack"];
  sourceEventId: string;
}

export async function resolveOrCreateSlackThread(
  input: {
    tenantId: string;
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
      spaceId: thread.spaceId,
      actorId: input.actorId,
      content: input.envelope.slack.sourceMessage?.text ?? "",
      envelope: input.envelope.slack,
      sourceEventId: slackSourceEventId(input.envelope.eventId),
    });
    return {
      threadId: message.threadId,
      spaceId: message.spaceId,
      messageId: message.messageId,
      wasCreated: !existing,
      messageCreated: message.wasCreated,
    };
  });
}

export function slackSourceEventId(eventId: string): string {
  return `slack:${eventId}`;
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
    actorId: string;
    envelope: SlackThreadTurnInput;
  },
  key: SlackThreadKey,
  store: SlackThreadMappingStore,
) {
  const thread = await store.createThread({
    tenantId: input.tenantId,
    actorId: input.actorId,
    title: slackThreadTitle(input.envelope),
  });
  await store.createMapping({
    ...key,
    threadId: thread.threadId,
    spaceId: thread.spaceId,
  });
  return thread;
}

function slackThreadTitle(envelope: SlackThreadTurnInput): string {
  const text = envelope.slack.sourceMessage?.text?.trim() ?? "";
  if (!text) return "Slack";
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
        .select({
          threadId: slackThreads.thread_id,
          spaceId: threads.space_id,
        })
        .from(slackThreads)
        .innerJoin(threads, eq(threads.id, slackThreads.thread_id))
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
      const [space] = await dbClient
        .insert(spaces)
        .values({
          tenant_id: input.tenantId,
          slug: "general",
          workspace_folder_name: "general",
          name: "General",
          description:
            "Default Space for conversations that are not part of a configured workflow.",
          prompt:
            "Use this Space for general collaboration, ad hoc questions, and Threads that do not belong to a specialized workflow.",
          status: "active",
          kind: "custom",
          template_key: "general",
          config: {
            workflow: "general",
            version: 1,
            source: "slack_thread_mapping",
          },
        })
        .onConflictDoUpdate({
          target: [spaces.tenant_id, spaces.slug],
          set: { status: "active", updated_at: new Date() },
        })
        .returning({ id: spaces.id });
      if (!space) throw new Error("Default Space not found");
      const [tenant] = await dbClient
        .update(tenants)
        .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
        .where(eq(tenants.id, input.tenantId))
        .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
      if (!tenant) throw new Error("Tenant not found");
      const existingThreads = await dbClient
        .select({
          id: threads.id,
          workspaceFolderName: threads.workspace_folder_name,
        })
        .from(threads)
        .where(eq(threads.tenant_id, input.tenantId));
      const identifier = `SLACK-${tenant.nextNumber}`;
      const [thread] = await dbClient
        .insert(threads)
        .values({
          tenant_id: input.tenantId,
          space_id: space.id,
          user_id: input.actorId,
          number: tenant.nextNumber,
          identifier,
          title: input.title,
          workspace_folder_name: workspaceFolderName(
            input.title || identifier,
            existingThreads.map(
              (row: { workspaceFolderName: string | null; id: string }) =>
                row.workspaceFolderName ?? row.id,
            ),
            "thread",
          ),
          status: "in_progress",
          channel: "slack",
          created_by_type: "user",
          created_by_id: input.actorId,
        })
        .returning({ threadId: threads.id });
      if (!thread) throw new Error("Slack thread insert failed");
      await dbClient.insert(threadParticipants).values({
        tenant_id: input.tenantId,
        thread_id: thread.threadId,
        space_id: space.id,
        participant_type: "user",
        user_id: input.actorId,
        role: "requester",
        source: "thread_creator",
      });
      return { ...thread, spaceId: space.id };
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
          source_event_id: input.sourceEventId,
          metadata: { source: "slack", slack: input.envelope },
        })
        .onConflictDoNothing({
          target: [messages.tenant_id, messages.source_event_id],
          targetWhere: sql`${messages.source_event_id} IS NOT NULL`,
        })
        .returning({ messageId: messages.id });
      if (message) {
        return {
          messageId: message.messageId,
          threadId: input.threadId,
          spaceId: input.spaceId,
          wasCreated: true,
        };
      }
      const [existing] = await dbClient
        .select({
          messageId: messages.id,
          threadId: messages.thread_id,
          spaceId: threads.space_id,
        })
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.thread_id))
        .where(
          and(
            eq(messages.tenant_id, input.tenantId),
            eq(messages.source_event_id, input.sourceEventId),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("Slack source event dedupe lookup failed");
      return { ...existing, wasCreated: false };
    },
  };
}
