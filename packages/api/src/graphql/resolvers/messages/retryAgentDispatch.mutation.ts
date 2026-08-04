import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  and,
  eq,
  messages,
  threads,
  threadTurns,
  messageToCamel,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { dispatchDefaultAgentChatTurn } from "../../../lib/mentions/default-agent-routing.js";
import { dispatchAgentMentions } from "../../../lib/mentions/dispatch-agent-mentions.js";
import { loadThreadMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";
import { parseMessageMentions } from "../../../lib/mentions/parse-message-mentions.js";

/**
 * THINK-136 U6 (R7/AE5): retry a user message's failed agent dispatch.
 *
 * Authorization (security review, pinned): only the ORIGINAL message sender
 * may retry. The message is looked up tenant-scoped — a missing message OR a
 * cross-tenant message is NOT_FOUND (never leaks existence across tenants); a
 * present in-tenant message sent by someone else is FORBIDDEN.
 *
 * KTD4: the base dispatch keys on `messageId`, and the enqueue no-ops on key
 * match — so a naive re-drive would silently do nothing. Retry increments the
 * attempt counter and threads it into the dispatch so the wakeup fallback
 * mints an `...:attempt-N` idempotency key that cannot collide with the prior
 * attempt. Sender identity for the re-dispatch is resolved from the ORIGINAL
 * message row (same actor the first turn ran as), so R12 holds.
 */

export interface RetryMessageRow {
  id: string;
  tenantId: string;
  threadId: string;
  spaceId: string | null;
  content: string | null;
  senderType: string | null;
  senderId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RetryRedispatchInput {
  route: "mention" | "default";
  attempt: number;
  message: RetryMessageRow;
}

export interface RetryAgentDispatchDeps {
  loadMessage(input: {
    messageId: string;
    tenantId: string;
  }): Promise<RetryMessageRow | null>;
  /**
   * Whether a turn linked to this message (triggering_message_id) failed —
   * the async-failure evidence that authorizes a retry when the sync
   * metadata stamp is absent.
   */
  hasFailedLinkedTurn(input: {
    messageId: string;
    tenantId: string;
  }): Promise<boolean>;
  saveDispatchMetadata(input: {
    messageId: string;
    tenantId: string;
    metadata: Record<string, unknown>;
  }): Promise<RetryMessageRow>;
  redispatch(input: RetryRedispatchInput): Promise<void>;
}

function readPriorDispatch(metadata: Record<string, unknown> | null): {
  attempt: number;
  route: "mention" | "default";
} {
  const dispatch =
    (metadata?.dispatch as Record<string, unknown> | undefined) ?? {};
  const attempt =
    typeof dispatch.attempt === "number" && dispatch.attempt > 0
      ? dispatch.attempt
      : 1;
  const route = dispatch.route === "mention" ? "mention" : "default";
  return { attempt, route };
}

/**
 * Testable core: takes already-resolved caller identity so tests can drive the
 * authorization + attempt-key + re-dispatch behavior without a live DB or a
 * GraphQL context.
 */
export async function runRetryAgentDispatch(
  input: {
    messageId: string;
    tenantId: string | null;
    callerUserId: string | null;
  },
  deps: RetryAgentDispatchDeps,
): Promise<RetryMessageRow> {
  // No resolvable tenant (API-key / unmatched caller) → treat as not found;
  // never fall through to an unscoped lookup.
  if (!input.tenantId) {
    throw new GraphQLError("Message not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const message = await deps.loadMessage({
    messageId: input.messageId,
    tenantId: input.tenantId,
  });
  // Missing OR cross-tenant → NOT_FOUND (the tenant-scoped lookup collapses
  // both cases; do not distinguish them to the caller).
  if (!message) {
    throw new GraphQLError("Message not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  // Only the original human sender may retry.
  if (
    message.senderType !== "user" ||
    !message.senderId ||
    !input.callerUserId ||
    message.senderId !== input.callerUserId
  ) {
    throw new GraphQLError("Only the original sender can retry dispatch", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  // Retry requires evidence of a failed dispatch (R7 is about failures, not
  // re-firing successful turns): either the sync-failure metadata stamp, or a
  // failed turn linked via triggering_message_id (the async-failure path).
  // Without this guard a sender could re-dispatch any of their messages,
  // double-firing the agent (found live during THINK-136 acceptance smoke).
  const dispatchMeta =
    (message.metadata?.dispatch as Record<string, unknown> | undefined) ?? {};
  const hasSyncFailureStamp = dispatchMeta.status === "failed";
  if (!hasSyncFailureStamp) {
    const hasAsyncFailure = await deps.hasFailedLinkedTurn({
      messageId: message.id,
      tenantId: message.tenantId,
    });
    if (!hasAsyncFailure) {
      throw new GraphQLError("Message has no failed dispatch to retry", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
  }

  const prior = readPriorDispatch(message.metadata);
  const nextAttempt = prior.attempt + 1;
  const metadata: Record<string, unknown> = {
    ...(message.metadata ?? {}),
    dispatch: {
      status: "pending",
      attempt: nextAttempt,
      route: prior.route,
    },
  };
  const saved = await deps.saveDispatchMetadata({
    messageId: message.id,
    tenantId: message.tenantId,
    metadata,
  });
  await deps.redispatch({
    route: prior.route,
    attempt: nextAttempt,
    message: saved,
  });
  return saved;
}

function drizzleRetryDeps(): RetryAgentDispatchDeps {
  return {
    async loadMessage({ messageId, tenantId }) {
      const [row] = await db
        .select({
          id: messages.id,
          tenantId: messages.tenant_id,
          threadId: messages.thread_id,
          spaceId: threads.space_id,
          content: messages.content,
          senderType: messages.sender_type,
          senderId: messages.sender_id,
          metadata: messages.metadata,
        })
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.thread_id))
        .where(and(eq(messages.id, messageId), eq(messages.tenant_id, tenantId)))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        threadId: row.threadId,
        spaceId: row.spaceId ?? null,
        content: row.content ?? null,
        senderType: row.senderType ?? null,
        senderId: row.senderId ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      };
    },
    async hasFailedLinkedTurn({ messageId, tenantId }) {
      const [row] = await db
        .select({ id: threadTurns.id })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.tenant_id, tenantId),
            eq(threadTurns.triggering_message_id, messageId),
            eq(threadTurns.status, "failed"),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
    async saveDispatchMetadata({ messageId, tenantId, metadata }) {
      const [row] = await db
        .update(messages)
        .set({ metadata })
        .where(and(eq(messages.id, messageId), eq(messages.tenant_id, tenantId)))
        .returning();
      const [thread] = await db
        .select({ spaceId: threads.space_id })
        .from(threads)
        .where(eq(threads.id, row.thread_id))
        .limit(1);
      return {
        id: row.id,
        tenantId: row.tenant_id,
        threadId: row.thread_id,
        spaceId: thread?.spaceId ?? null,
        content: row.content ?? null,
        senderType: row.sender_type ?? null,
        senderId: row.sender_id ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      };
    },
    async redispatch({ route, attempt, message }) {
      const sender = { type: message.senderType, id: message.senderId };
      if (route === "mention") {
        const targets = await loadThreadMentionTargets({
          tenantId: message.tenantId,
          threadId: message.threadId,
        });
        const parsedMentions = parseMessageMentions({
          content: message.content ?? "",
          targets,
        });
        await dispatchAgentMentions({
          tenantId: message.tenantId,
          threadId: message.threadId,
          spaceId: message.spaceId,
          messageId: message.id,
          content: message.content,
          mentions: parsedMentions,
          sender,
          attempt,
        });
        return;
      }
      await dispatchDefaultAgentChatTurn({
        tenantId: message.tenantId,
        threadId: message.threadId,
        spaceId: message.spaceId,
        messageId: message.id,
        content: message.content,
        sender,
        attempt,
      });
    },
  };
}

export const retryAgentDispatch = async (
  _parent: unknown,
  args: { messageId: string },
  ctx: GraphQLContext,
) => {
  const { userId, tenantId } = await resolveCaller(ctx);
  const saved = await runRetryAgentDispatch(
    { messageId: args.messageId, tenantId, callerUserId: userId },
    drizzleRetryDeps(),
  );
  // messageToCamel expects the DB row shape; re-select the full row for the
  // GraphQL response so downstream field resolvers see canonical columns.
  const [row] = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.id, saved.id), eq(messages.tenant_id, saved.tenantId)),
    )
    .limit(1);
  return messageToCamel(row);
};
