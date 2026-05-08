import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  sql,
  agents,
  tenants,
  threads,
  messages,
  threadToCamel,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import {
  enqueueComputerThreadTurn,
  resolveThreadComputer,
} from "../../../lib/computers/thread-cutover.js";

export const createThread = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;

  // Tenant gate. Cognito callers must belong to the target tenant — without
  // this, an authenticated user holding a JWT for tenant A could supply
  // i.tenantId = tenant B and create threads in B's namespace. Closes the
  // F5 P0 from #959 review. apikey callers are pre-authorized service
  // identities (agentcore runtime, schedulers); they are validated by the
  // shared API secret and may legitimately create threads across tenants.
  if (ctx.auth.authType === "cognito") {
    await requireTenantMember(ctx, i.tenantId);
  }

  const createdByType = i.createdByType ?? "user";
  const createdById =
    createdByType === "user"
      ? ((await resolveCallerFromAuth(ctx.auth)).userId ?? i.createdById)
      : i.createdById;
  const threadComputer = await resolveThreadComputer({
    tenantId: i.tenantId,
    ownerUserId: createdByType === "user" ? createdById : null,
    requestedComputerId: i.computerId ?? null,
  });

  // PRD-09 §9.4.4: Agent-created thread validation
  if (createdByType === "agent" && createdById) {
    const [creatorAgent] = await db
      .select({ tenant_id: agents.tenant_id })
      .from(agents)
      .where(eq(agents.id, createdById));
    if (!creatorAgent || creatorAgent.tenant_id !== i.tenantId) {
      throw new Error("Agent can only create threads in its own tenant");
    }
  }

  const channel = (i.channel?.toLowerCase() ?? "manual") as string;
  const CHANNEL_PREFIX: Record<string, string> = {
    schedule: "AUTO",
    email: "EMAIL",
    chat: "CHAT",
    manual: "TICK",
    webhook: "HOOK",
    api: "API",
  };
  const prefix = CHANNEL_PREFIX[channel] || "TICK";
  const initialStatus =
    channel === "chat" || channel === "schedule" ? "in_progress" : "backlog";

  // Atomic: counter bump + thread insert + optional first user message. Keeps
  // hosts from needing a two-round-trip create-then-send and prevents orphan
  // threads if the message insert fails.
  const { row, firstMessageId } = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({
        issue_counter: sql`${tenants.issue_counter} + 1`,
      })
      .where(eq(tenants.id, i.tenantId))
      .returning({
        next_number: sql<number>`${tenants.issue_counter}`,
      });
    if (!tenant) throw new Error("Tenant not found");
    const nextNumber = tenant.next_number;
    const identifier = `${prefix}-${nextNumber}`;

    // Mirror sendMessage's auto-title logic so the atomic path matches the
    // two-step flow when callers leave title as "Untitled conversation".
    let effectiveTitle = i.title;
    if (i.firstMessage && i.title === "Untitled conversation") {
      const raw = i.firstMessage.trim();
      effectiveTitle =
        raw.length <= 80 ? raw : raw.substring(0, 80).replace(/\s+\S*$/, "...");
    }

    const [threadRow] = await tx
      .insert(threads)
      .values({
        tenant_id: i.tenantId,
        agent_id: threadComputer ? null : i.agentId,
        computer_id: threadComputer?.id,
        user_id: threadComputer?.owner_user_id,
        number: nextNumber,
        identifier,
        title: effectiveTitle,
        status: initialStatus,
        channel,
        assignee_type: i.assigneeType,
        assignee_id: i.assigneeId,
        billing_code: i.billingCode,
        created_by_type: createdByType,
        created_by_id: createdById,
        labels: i.labels ? JSON.parse(i.labels) : undefined,
        metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
        due_at: i.dueAt ? new Date(i.dueAt) : undefined,
      })
      .returning();

    let firstMsgId: string | null = null;
    if (i.firstMessage) {
      const [msgRow] = await tx
        .insert(messages)
        .values({
          thread_id: threadRow.id,
          tenant_id: i.tenantId,
          role: "user",
          content: i.firstMessage,
          sender_type: createdByType,
          sender_id: createdById,
        })
        .returning({ id: messages.id });
      firstMsgId = msgRow?.id ?? null;
    }

    return { row: threadRow, firstMessageId: firstMsgId };
  });

  // Side effects after commit (non-transactional — Lambda invoke + SNS notify).
  notifyThreadUpdate({
    threadId: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    title: row.title,
  }).catch(() => {});

  if (firstMessageId && row.computer_id) {
    await enqueueComputerThreadTurn({
      tenantId: row.tenant_id,
      computerId: row.computer_id,
      threadId: row.id,
      messageId: firstMessageId,
      source: "chat_message",
      actorType: createdByType,
      actorId: createdById,
    });
    return threadToCamel(row);
  }

  return threadToCamel(row);
};
