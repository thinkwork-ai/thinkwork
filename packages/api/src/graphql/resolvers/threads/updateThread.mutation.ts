import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  eq,
  and,
  sql,
  threads,
  threadParticipants,
  agentWakeupRequests,
  inboxItems,
  threadToCamel,
  assertTransition,
  checkAndFireUnblockWakeups,
} from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

export const updateThread = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const updates: Record<string, unknown> = {};
  let callerParticipantLastReadAt: Date | null | undefined;
  let callerParticipantReadStateHandled = false;
  if (i.title !== undefined) updates.title = i.title;
  if (i.status !== undefined) {
    const newStatus = i.status.toLowerCase();
    // Fetch current status for transition validation
    const [current] = await db
      .select({ status: threads.status })
      .from(threads)
      .where(eq(threads.id, args.id));
    if (!current) throw new Error("Thread not found");
    assertTransition(current.status, newStatus);
    updates.status = newStatus;
    // Lifecycle timestamps
    if (newStatus === "in_progress" && current.status !== "in_progress") {
      updates.started_at = new Date();
    }
    if (newStatus === "done") {
      updates.completed_at = new Date();
      updates.closed_at = new Date();
      updates.checkout_run_id = null; // auto-release lock
      // PRD-40: Cascade done to all child threads
      db.update(threads)
        .set({
          status: "done",
          completed_at: new Date(),
          closed_at: new Date(),
          checkout_run_id: null,
          updated_at: new Date(),
        })
        .where(eq(threads.parent_id, args.id))
        .catch(() => {});
    }
    if (newStatus === "cancelled") {
      updates.cancelled_at = new Date();
      updates.checkout_run_id = null;
    }
    if (newStatus === "blocked") {
      updates.checkout_run_id = null;
    }
  }
  if (i.channel !== undefined) updates.channel = i.channel.toLowerCase();
  if (i.assigneeType !== undefined) updates.assignee_type = i.assigneeType;
  if (i.assigneeId !== undefined) updates.assignee_id = i.assigneeId;
  if (i.billingCode !== undefined) updates.billing_code = i.billingCode;
  if (i.labels !== undefined) updates.labels = JSON.parse(i.labels);
  if (i.metadata !== undefined) updates.metadata = JSON.parse(i.metadata);
  if (i.dueAt !== undefined)
    updates.due_at = i.dueAt ? new Date(i.dueAt) : null;
  if (i.archivedAt !== undefined)
    updates.archived_at = i.archivedAt ? new Date(i.archivedAt) : null;
  if (i.lastReadAt !== undefined) {
    const readState = await applyCallerReadState(args.id, i.lastReadAt, ctx);
    if (readState.handledByParticipant) {
      callerParticipantLastReadAt = readState.lastReadAt;
      callerParticipantReadStateHandled = true;
    } else {
      updates.last_read_at = readState.lastReadAt;
    }
  }

  let row;
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date();
    [row] = await db
      .update(threads)
      .set(updates)
      .where(eq(threads.id, args.id))
      .returning();
  } else {
    [row] = await db.select().from(threads).where(eq(threads.id, args.id));
  }
  if (!row) throw new Error("Thread not found");

  // On assignment to agent, insert wakeup request
  if (i.assigneeType === "agent" && i.assigneeId) {
    await db.insert(agentWakeupRequests).values({
      tenant_id: row.tenant_id,
      agent_id: i.assigneeId,
      source: "thread_assignment",
      reason: `Thread ${row.identifier ?? `#${row.number}`} assigned`,
      trigger_detail: `thread:${row.id}`,
      requested_by_actor_type: "system",
    });
  }

  // PRD-09: Auto-unblock dependents when thread reaches done/cancelled
  if (i.status !== undefined) {
    const newStatus = i.status.toLowerCase();
    if (newStatus === "done" || newStatus === "cancelled") {
      await checkAndFireUnblockWakeups(args.id, row.tenant_id);
    }
    // PRD-40: Inbox notification on task completion
    if (newStatus === "done" && row.channel === "task" && row.parent_id) {
      const [parent] = await db
        .select({
          assignee_type: threads.assignee_type,
          assignee_id: threads.assignee_id,
          created_by_id: threads.created_by_id,
        })
        .from(threads)
        .where(eq(threads.id, row.parent_id));
      const ownerId =
        parent?.assignee_type === "user" && parent?.assignee_id
          ? parent.assignee_id
          : parent?.created_by_id;
      if (ownerId) {
        db.insert(inboxItems)
          .values({
            tenant_id: row.tenant_id,
            recipient_id: ownerId,
            requester_type: "system",
            type: "task_completed",
            title: `Task completed: ${row.title}`,
            description: `${row.identifier} has been marked done`,
            entity_type: "thread",
            entity_id: row.id,
          })
          .catch(() => {}); // fire-and-forget
      }
    }
  }

  // Fire real-time notification (non-blocking) — skip for read-state-only updates
  const isReadStateOnly = Object.keys(updates).every(
    (k) => k === "updated_at" || k === "last_read_at",
  );
  if (!isReadStateOnly) {
    notifyThreadUpdate({
      threadId: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      title: row.title,
    }).catch(() => {}); // fire-and-forget
  }

  return threadToCamel({
    ...row,
    last_read_at: callerParticipantReadStateHandled
      ? callerParticipantLastReadAt
      : row.last_read_at,
  });
};

async function applyCallerReadState(
  threadId: string,
  rawLastReadAt: string | null,
  ctx: GraphQLContext,
) {
  const lastReadAt = rawLastReadAt ? new Date(rawLastReadAt) : null;
  if (ctx.auth?.authType !== "cognito") {
    return { handledByParticipant: false, lastReadAt };
  }

  const callerTenantId = await resolveCallerTenantId(ctx);
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerTenantId || !callerUserId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [threadRow] = await db
    .select({
      tenant_id: threads.tenant_id,
      user_id: threads.user_id,
    })
    .from(threads)
    .where(eq(threads.id, threadId));
  if (!threadRow) throw new Error("Thread not found");
  if (threadRow.tenant_id !== callerTenantId) {
    throw new GraphQLError("Thread not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const [participantRow] = await db
    .select({ id: threadParticipants.id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, callerTenantId),
        eq(threadParticipants.thread_id, threadId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, callerUserId),
      ),
    );
  if (participantRow) {
    await db
      .update(threadParticipants)
      .set({ last_read_at: lastReadAt, updated_at: new Date() })
      .where(eq(threadParticipants.id, participantRow.id));
    return { handledByParticipant: true, lastReadAt };
  }

  const [participantCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, callerTenantId),
        eq(threadParticipants.thread_id, threadId),
        eq(threadParticipants.participant_type, "user"),
      ),
    );
  if (
    (participantCount?.count ?? 0) > 0 ||
    threadRow.user_id !== callerUserId
  ) {
    throw new GraphQLError("Thread participant required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  return { handledByParticipant: false, lastReadAt };
}
