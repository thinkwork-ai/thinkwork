/**
 * Thread creation helper (shared across API + Lambda).
 *
 * ensureThreadForWork() is the single entry point for auto-creating a thread
 * whenever a new unit of work begins (chat, email, scheduled job, etc.).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { tenants } from "../schema/core";
import { threads } from "../schema/threads";

// ---------------------------------------------------------------------------
// Channel → Prefix mapping
// ---------------------------------------------------------------------------

const CHANNEL_PREFIX: Record<string, string> = {
  schedule: "AUTO",
  email: "EMAIL",
  chat: "CHAT",
  manual: "TICK",
  webhook: "HOOK",
  api: "API",
  task: "TASK",
  connector: "CONN",
};

export type ThreadChannel =
  | "chat"
  | "email"
  | "schedule"
  | "manual"
  | "webhook"
  | "api"
  | "task"
  | "connector";

interface EnsureThreadOpts {
  tenantId: string;
  agentId?: string;
  computerId?: string;
  userId?: string;
  title?: string;
  channel: ThreadChannel;
}

interface EnsureThreadResult {
  threadId: string;
  identifier: string;
  number: number;
}

export interface ThreadEntityRef {
  pageTable: "wiki_pages" | "tenant_entity_pages";
  pageId: string;
  subtype: string;
}

export interface EnsureRecurringThreadOpts {
  tenantId: string;
  agentId: string;
  userId: string;
  recurringKey: string;
  title: string;
  entityRefs?: ThreadEntityRef[];
}

export interface EnsureRecurringThreadResult extends EnsureThreadResult {
  created: boolean;
}

export async function ensureThreadForWork(
  opts: EnsureThreadOpts,
): Promise<EnsureThreadResult> {
  const db = getDb();
  const channel = opts.channel || "manual";
  const prefix = CHANNEL_PREFIX[channel] || "TICK";

  // Atomic increment of global issue counter
  const [tenant] = await db
    .update(tenants)
    .set({
      issue_counter: sql`${tenants.issue_counter} + 1`,
    })
    .where(eq(tenants.id, opts.tenantId))
    .returning({
      next_number: sql<number>`${tenants.issue_counter}`,
    });

  if (!tenant) throw new Error("Tenant not found");

  const nextNumber = tenant.next_number;
  const identifier = `${prefix}-${nextNumber}`;

  const initialStatus =
    channel === "chat" || channel === "schedule"
      ? "in_progress"
      : channel === "task"
        ? "todo"
        : "backlog";

  const [thread] = await db
    .insert(threads)
    .values({
      tenant_id: opts.tenantId,
      agent_id: opts.computerId ? undefined : opts.agentId || undefined,
      computer_id: opts.computerId || undefined,
      user_id: opts.userId || undefined,
      number: nextNumber,
      identifier,
      title: opts.title || "Untitled conversation",
      status: initialStatus,
      channel,
      assignee_type: opts.computerId
        ? "computer"
        : opts.agentId
          ? "agent"
          : undefined,
      assignee_id: opts.computerId || opts.agentId || undefined,
      created_by_type: opts.userId ? "user" : "system",
      created_by_id: opts.userId || undefined,
    })
    .returning({ id: threads.id });

  return { threadId: thread.id, identifier, number: nextNumber };
}

export async function ensureRecurringThread(
  opts: EnsureRecurringThreadOpts,
): Promise<EnsureRecurringThreadResult> {
  const recurringKey = opts.recurringKey.trim();
  if (!recurringKey) throw new Error("recurringKey is required");
  const db = getDb();

  const [existing] = await db
    .select({
      id: threads.id,
      identifier: threads.identifier,
      number: threads.number,
    })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, opts.tenantId),
        eq(threads.agent_id, opts.agentId),
        eq(threads.user_id, opts.userId),
        eq(threads.channel, "schedule"),
        inArray(threads.status, ["in_progress", "todo"]),
        sql`${threads.metadata}->>'recurringKey' = ${recurringKey}`,
      ),
    )
    .orderBy(desc(threads.created_at))
    .limit(1);

  if (existing) {
    console.info("recurring_thread_found", {
      tenantId: opts.tenantId,
      threadId: existing.id,
      recurringKey,
    });
    return {
      threadId: existing.id,
      identifier: existing.identifier ?? `AUTO-${existing.number}`,
      number: existing.number,
      created: false,
    };
  }

  const created = await ensureThreadForWork({
    tenantId: opts.tenantId,
    agentId: opts.agentId,
    userId: opts.userId,
    title: opts.title,
    channel: "schedule",
  });
  await db
    .update(threads)
    .set({
      user_id: opts.userId,
      metadata: {
        recurringKey,
        entityRefs: opts.entityRefs ?? [],
      },
      updated_at: new Date(),
    })
    .where(eq(threads.id, created.threadId));
  console.info("recurring_thread_created", {
    tenantId: opts.tenantId,
    threadId: created.threadId,
    recurringKey,
  });
  return { ...created, created: true };
}
