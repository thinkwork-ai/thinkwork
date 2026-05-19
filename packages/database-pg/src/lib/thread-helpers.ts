/**
 * Thread creation helper (shared across API + Lambda).
 *
 * ensureThreadForWork() is the single entry point for auto-creating a thread
 * whenever a new unit of work begins (chat, email, scheduled job, etc.).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { tenants } from "../schema/core";
import { spaces } from "../schema/spaces";
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

const DEFAULT_THREADS_SPACE_SLUG = "general";

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
  spaceId?: string;
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
  spaceId?: string;
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
  const spaceId =
    opts.spaceId ?? (await ensureDefaultThreadSpaceId(opts.tenantId));

  const [thread] = await db
    .insert(threads)
    .values({
      tenant_id: opts.tenantId,
      agent_id: opts.computerId ? undefined : opts.agentId || undefined,
      computer_id: opts.computerId || undefined,
      space_id: spaceId,
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

async function ensureDefaultThreadSpaceId(tenantId: string): Promise<string> {
  const db = getDb();
  const [space] = await db
    .insert(spaces)
    .values({
      tenant_id: tenantId,
      slug: DEFAULT_THREADS_SPACE_SLUG,
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
        source: "thread_helper_default",
      },
    })
    .onConflictDoUpdate({
      target: [spaces.tenant_id, spaces.slug],
      set: {
        status: "active",
        updated_at: new Date(),
      },
    })
    .returning({ id: spaces.id });

  if (space?.id) return space.id;

  const [existing] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, tenantId),
        eq(spaces.slug, DEFAULT_THREADS_SPACE_SLUG),
      ),
    )
    .limit(1);
  if (!existing?.id) throw new Error("Default Space could not be resolved");
  return existing.id;
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
    spaceId: opts.spaceId,
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
