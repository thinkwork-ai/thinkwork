import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  messages,
  tenants,
  threadParticipants,
  threads,
} from "@thinkwork/database-pg/schema";
import { enqueueComputerThreadTurn } from "../computers/thread-cutover.js";
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
  const routing = await resolveColdContactComputer({
    tenantId: input.tenantId,
    spaceId: input.spaceId,
  });

  const title = titleFromSubject(input.emailSubject);
  const createdAt = new Date();
  const { threadId, messageId } = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
      .where(eq(tenants.id, input.tenantId))
      .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
    if (!tenant) throw new Error("Tenant not found");

    const [thread] = await tx
      .insert(threads)
      .values({
        tenant_id: input.tenantId,
        computer_id: routing.computerId,
        agent_id: routing.agentId,
        space_id: input.spaceId,
        user_id: input.senderUserId,
        number: tenant.nextNumber,
        identifier: `EMAIL-${tenant.nextNumber}`,
        title,
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
          agent_id: routing.agentId,
          role: routing.localRole ?? "agent",
          source: "space_auto_subscribe",
          notification_preference: "subscribed",
        },
      ])
      .onConflictDoNothing();

    return { threadId: thread.id, messageId: message.id };
  });

  await enqueueComputerThreadTurn({
    tenantId: input.tenantId,
    computerId: routing.computerId,
    threadId,
    messageId,
    source: "email_cold_contact",
    actorType: "user",
    actorId: input.senderUserId,
  });

  return { threadId, messageId, computerId: routing.computerId };
}

async function resolveColdContactComputer(input: {
  tenantId: string;
  spaceId: string;
}) {
  const platformAgent = await resolveTenantPlatformAgent(input.tenantId);
  const agentId = platformAgent.id;

  const [computer] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        ne(computers.status, "archived"),
        sql`(${computers.primary_agent_id} = ${agentId} OR ${computers.migrated_from_agent_id} = ${agentId})`,
      ),
    )
    .limit(1);

  if (!computer) {
    throw new Error(
      `No active Computer found for cold-contact platform agent ${platformAgent.name ?? agentId}`,
    );
  }

  return {
    agentId,
    computerId: computer.id,
    localRole: "agent",
  };
}

function titleFromSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Email conversation";
  return trimmed.length <= 80
    ? trimmed
    : `${trimmed.substring(0, 80).replace(/\s+\S*$/, "")}...`;
}
