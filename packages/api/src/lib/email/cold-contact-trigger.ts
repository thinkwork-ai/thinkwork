import { eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  messages,
  tenants,
  threadParticipants,
  threads,
} from "@thinkwork/database-pg/schema";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { resolveTenantPlatformAgent } from "../agents/tenant-platform-agent.js";

const db = getDb();

export interface CreateColdContactThreadInput {
  tenantId: string;
  spaceId: string;
  senderUserId: string;
  emailBody: string;
  emailSubject: string;
  senderEmail: string;
  sesMessageId: string;
  originalMessageId?: string | null;
}

export async function createColdContactThread(
  input: CreateColdContactThreadInput,
) {
  const platformAgent = await resolveTenantPlatformAgent(input.tenantId);
  const agentId = platformAgent.id;

  const title = titleFromSubject(input.emailSubject);
  const createdAt = new Date();
  const { threadId, messageId } = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
      .where(eq(tenants.id, input.tenantId))
      .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
    if (!tenant) throw new Error("Tenant not found");
    const existingThreads = await tx
      .select({
        id: threads.id,
        workspaceFolderName: threads.workspace_folder_name,
      })
      .from(threads)
      .where(eq(threads.tenant_id, input.tenantId));
    const identifier = `EMAIL-${tenant.nextNumber}`;

    const [thread] = await tx
      .insert(threads)
      .values({
        tenant_id: input.tenantId,
        agent_id: agentId,
        space_id: input.spaceId,
        user_id: input.senderUserId,
        number: tenant.nextNumber,
        identifier,
        title,
        workspace_folder_name: workspaceFolderName(
          title || identifier,
          existingThreads.map((row) => row.workspaceFolderName ?? row.id),
          "thread",
        ),
        status: "in_progress",
        channel: "email",
        created_by_type: "user",
        created_by_id: input.senderUserId,
        metadata: {
          emailColdContact: {
            senderEmail: input.senderEmail,
            sesMessageId: input.sesMessageId,
            originalMessageId: input.originalMessageId ?? null,
          },
        },
        created_at: createdAt,
        updated_at: createdAt,
      })
      .returning({ id: threads.id });
    if (!thread) throw new Error("Cold-contact thread insert failed");

    const [message] = await tx
      .insert(messages)
      .values({
        tenant_id: input.tenantId,
        thread_id: thread.id,
        role: "user",
        content: input.emailBody || "(empty email)",
        sender_type: "user",
        sender_id: input.senderUserId,
        metadata: {
          source: "email_cold_contact",
          senderEmail: input.senderEmail,
          subject: input.emailSubject,
          sesMessageId: input.sesMessageId,
          originalMessageId: input.originalMessageId ?? null,
        },
        created_at: createdAt,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("Cold-contact message insert failed");

    await tx
      .insert(threadParticipants)
      .values([
        {
          tenant_id: input.tenantId,
          thread_id: thread.id,
          space_id: input.spaceId,
          participant_type: "user",
          user_id: input.senderUserId,
          role: "requester",
          source: "email_cold_contact",
          last_read_at: createdAt,
        },
        {
          tenant_id: input.tenantId,
          thread_id: thread.id,
          space_id: input.spaceId,
          participant_type: "agent",
          agent_id: agentId,
          role: "agent",
          source: "space_auto_subscribe",
          notification_preference: "subscribed",
        },
      ])
      .onConflictDoNothing();

    return { threadId: thread.id, messageId: message.id };
  });

  return { threadId, messageId };
}

function titleFromSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Email conversation";
  return trimmed.length <= 80
    ? trimmed
    : `${trimmed.substring(0, 80).replace(/\s+\S*$/, "")}...`;
}
