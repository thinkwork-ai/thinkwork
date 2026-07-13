/**
 * searchAsk — THINK-263 U6 "ask-turn machinery" (SERVER ONLY, INERT).
 *
 * Opens an "ask" turn for a palette query: it budget-pre-checks, creates a
 * HIDDEN, owner-restricted thread plus a triggering user message, and
 * dispatches the tenant's default agent in ASK MODE — cost metered, retention
 * suppressed (`use_memory: false`, threaded through the dispatch → invoke
 * event → chat-agent-invoke). It returns the hidden thread id; the client
 * streams the answer via `onThreadTurnStep` (wired in U7). NOTHING calls this
 * mutation yet — the palette wiring is U7.
 *
 * Hidden + owner-restricted (KTD-3): the thread's `user_id` is the caller and
 * no foreign participants are added, so the by-id `thread(id)` resolver's
 * `callerVisibleThreadPredicate` already denies it to every other tenant
 * member; `metadata.systemHidden = true` hides it from the thread lists
 * (`visibleThreadListPredicate`). No new access resolver is required.
 *
 * chat-agent-invoke creates the `thread_turns` row when it receives the invoke
 * event, so this mutation only dispatches — that keeps cost/finalize
 * attachment identical to a normal chat turn.
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  sql,
  tenants,
  threads,
  messages,
  threadParticipants,
} from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";
import { dispatchDefaultAgentChatTurn } from "../../../lib/mentions/default-agent-routing.js";
import { getUserBudgetStatus } from "../../../lib/user-budget-enforcement.js";
import { notifyThreadUpdate } from "../../notify.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";

const MAX_TITLE_LEN = 80;

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

function askThreadTitle(query: string): string {
  const base = `Search: ${query.trim()}`;
  return base.length <= MAX_TITLE_LEN
    ? base
    : `${base.slice(0, MAX_TITLE_LEN - 1).replace(/\s+\S*$/, "")}…`;
}

export interface RunSearchAskInput {
  tenantId: string;
  callerUserId: string | null;
  query: string;
}

export interface AskThreadRecord {
  threadId: string;
  spaceId: string | null;
  messageId: string;
}

export interface SearchAskDeps {
  /**
   * Over-budget pre-flight. MUST run before any writes so an over-budget user
   * gets an immediate BUDGET_EXCEEDED instead of a hidden thread that starts
   * and dies at the chat-agent-invoke gate. Fails OPEN on infra error (a
   * broken budget lookup must not block ask) — the invoke gate is the backstop.
   */
  getBudgetStatus(input: { tenantId: string; userId: string }): Promise<{
    overBudget: boolean;
    spentUsd: number;
    limitUsd: number;
  }>;
  /**
   * Create the hidden, owner-restricted thread + triggering user message.
   * Returns the thread id (and space id for the dispatch fallback payload).
   */
  createHiddenAskThread(input: {
    tenantId: string;
    userId: string;
    query: string;
  }): Promise<AskThreadRecord>;
  /**
   * Dispatch the default-agent turn in ask mode (`use_memory: false`). Must
   * surface failures (throw) so the resolver can log — never fire-and-forget.
   */
  dispatchAskTurn(input: {
    tenantId: string;
    threadId: string;
    spaceId: string | null;
    messageId: string;
    content: string;
    userId: string;
  }): Promise<void>;
}

/**
 * Pure orchestration, injectable deps (mirrors runRetryAgentDispatch). Budget
 * gate → hidden-thread create → ask dispatch → return thread id.
 */
export async function runSearchAsk(
  input: RunSearchAskInput,
  deps: SearchAskDeps,
): Promise<{ threadId: string }> {
  const { tenantId, callerUserId, query } = input;
  // Ask needs an owner (thread visibility + memory scope run as this user).
  if (!callerUserId) {
    throw forbidden("Requester user identity required for search ask");
  }
  const trimmed = query.trim();
  if (!trimmed) {
    throw new GraphQLError("Query is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // Budget pre-flight BEFORE any writes (fail-open on infra error).
  let overBudgetError: GraphQLError | null = null;
  try {
    const budget = await deps.getBudgetStatus({
      tenantId,
      userId: callerUserId,
    });
    if (budget.overBudget) {
      overBudgetError = new GraphQLError(
        `Monthly budget exceeded: $${budget.spentUsd.toFixed(2)} of $${budget.limitUsd.toFixed(2)} used. Ask your operator to raise the limit or unpause your budget.`,
        { extensions: { code: "BUDGET_EXCEEDED" } },
      );
    }
  } catch (err) {
    console.error("[searchAsk] budget pre-check failed:", err);
  }
  if (overBudgetError) throw overBudgetError;

  const thread = await deps.createHiddenAskThread({
    tenantId,
    userId: callerUserId,
    query: trimmed,
  });

  try {
    await deps.dispatchAskTurn({
      tenantId,
      threadId: thread.threadId,
      spaceId: thread.spaceId,
      messageId: thread.messageId,
      content: trimmed,
      userId: callerUserId,
    });
  } catch (err) {
    // The hidden thread already committed and is returned so the client can
    // still open it; a failed dispatch means no turn ran — make it loud in
    // logs rather than swallowing it (parity with sendMessage's default route,
    // which logs + stamps instead of throwing back to the caller).
    console.error(
      `[searchAsk] ask-turn dispatch failed for thread=${thread.threadId}:`,
      err,
    );
  }

  return { threadId: thread.threadId };
}

/**
 * Real thread-create: resolve the tenant's default space + platform agent,
 * then atomically bump the issue counter, insert the HIDDEN thread (owner =
 * caller, `metadata.systemHidden`, agent pre-assigned so the dispatch resolves
 * it), the requester participant row, and the triggering user message.
 */
async function createHiddenAskThreadReal(input: {
  tenantId: string;
  userId: string;
  query: string;
}): Promise<AskThreadRecord> {
  const space = await ensureDefaultThreadSpace({
    tenantId: input.tenantId,
    userId: input.userId,
  });

  let agentId: string | null = null;
  try {
    agentId = (await resolveTenantPlatformAgent(input.tenantId)).id;
  } catch (err) {
    if (!(err instanceof PlatformAgentNotFoundError)) throw err;
  }

  const title = askThreadTitle(input.query);
  const createdAt = new Date();

  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(tenants)
      .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
      .where(eq(tenants.id, input.tenantId))
      .returning({ next_number: sql<number>`${tenants.issue_counter}` });
    if (!tenant) throw new Error("Tenant not found");
    const nextNumber = tenant.next_number;
    const identifier = `CHAT-${nextNumber}`;

    const existingThreads = await tx
      .select({
        id: threads.id,
        workspaceFolderName: threads.workspace_folder_name,
      })
      .from(threads)
      .where(eq(threads.tenant_id, input.tenantId));
    const threadFolderName = workspaceFolderName(
      title || identifier,
      existingThreads.map((row) => row.workspaceFolderName ?? row.id),
      "thread",
    );

    const [threadRow] = await tx
      .insert(threads)
      .values({
        tenant_id: input.tenantId,
        agent_id: agentId ?? undefined,
        space_id: space.id,
        // Owner-restricted (KTD-3): user_id = caller, no foreign participants.
        user_id: input.userId,
        number: nextNumber,
        identifier,
        title,
        workspace_folder_name: threadFolderName,
        status: "in_progress",
        channel: "chat",
        created_by_type: "user",
        created_by_id: input.userId,
        // Hidden from thread lists (visibleThreadListPredicate).
        metadata: { systemHidden: true, searchAsk: true },
        created_at: createdAt,
        updated_at: createdAt,
      })
      .returning({ id: threads.id, space_id: threads.space_id });

    await tx.insert(threadParticipants).values({
      tenant_id: input.tenantId,
      thread_id: threadRow.id,
      space_id: space.id,
      participant_type: "user",
      user_id: input.userId,
      role: "requester",
      source: "thread_creator",
      last_read_at: createdAt,
    });

    const [messageRow] = await tx
      .insert(messages)
      .values({
        thread_id: threadRow.id,
        tenant_id: input.tenantId,
        role: "user",
        content: input.query,
        sender_type: "user",
        sender_id: input.userId,
        created_at: createdAt,
      })
      .returning({ id: messages.id });

    return {
      threadId: threadRow.id,
      spaceId: threadRow.space_id ?? space.id,
      messageId: messageRow.id,
    };
  });

  notifyThreadUpdate({
    threadId: result.threadId,
    tenantId: input.tenantId,
    status: "in_progress",
    title,
  }).catch(() => {});

  return result;
}

const realSearchAskDeps: SearchAskDeps = {
  async getBudgetStatus(input) {
    const budget = await getUserBudgetStatus({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    return {
      overBudget: budget.overBudget,
      spentUsd: budget.spentUsd,
      limitUsd: budget.limitUsd,
    };
  },
  createHiddenAskThread: createHiddenAskThreadReal,
  async dispatchAskTurn(input) {
    const result = await dispatchDefaultAgentChatTurn({
      tenantId: input.tenantId,
      threadId: input.threadId,
      spaceId: input.spaceId,
      messageId: input.messageId,
      content: input.content,
      // THINK-263 U6: retention suppressed for the ephemeral ask answer. askMode
      // also skips the wakeup fallback (which would retain), so a failed direct
      // invoke reports a miss here rather than silently enqueuing a retaining
      // turn — surfaced by the resolver's dispatch-failure log.
      askMode: true,
      sender: { type: "user", id: input.userId },
    });
    if (!result || (!result.directInvoked && !result.enqueued)) {
      throw new Error("Search ask direct dispatch did not fire");
    }
  },
};

export const searchAsk = async (
  _parent: unknown,
  args: { tenantId: string; query: string },
  ctx: GraphQLContext,
): Promise<{ threadId: string }> => {
  // Only Cognito end-users open ask turns from the palette. Service/apikey
  // callers (the Pi agent tool, schedulers) do not ask via this mutation —
  // the agent-facing surface is the `search` broker (U8).
  if (ctx.auth?.authType !== "cognito") {
    throw forbidden("Search ask is only available to authenticated users");
  }

  const callerTenantId = await resolveCallerTenantId(ctx);
  if (!callerTenantId || callerTenantId !== args.tenantId) {
    throw forbidden("Access denied: tenant mismatch");
  }
  const callerUserId = await resolveCallerUserId(ctx);

  return runSearchAsk(
    { tenantId: args.tenantId, callerUserId, query: args.query },
    realSearchAskDeps,
  );
};
