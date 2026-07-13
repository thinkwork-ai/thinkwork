/**
 * searchResearch — THINK-263 U9 "research rung".
 *
 * A "Research this" affordance in the search palette that enqueues a
 * BACKGROUND agent run whose answer arrives asynchronously as a reply in a
 * VISIBLE thread. Unlike the ask rung (hidden thread, streamed inline,
 * retention-suppressed), research is a normal visible thread + a normal
 * background chat turn:
 *
 *  - Thread is VISIBLE (no `metadata.systemHidden`), owned by the caller,
 *    titled `Research: <query>`, with the caller as owner participant. We
 *    stamp `metadata.searchResearch = true` for provenance only.
 *  - Optional `threadId`: when supplied we do NOT create a thread — we
 *    validate the caller can write to it (owner/participant via
 *    `callerVisibleThreadPredicate`, the same gate `sendMessage` uses) and
 *    post the query there. A caller who cannot write is rejected FORBIDDEN
 *    BEFORE any dispatch.
 *  - Dispatch is NORMAL mode (no `askMode`): retention is normal and the
 *    wakeup fallback is allowed — research is a legit background run. Cost
 *    metering rides chat-finalize automatically.
 *
 * Returns the (new or target) thread id so the client can link to where the
 * answer will post.
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
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
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";
import { dispatchDefaultAgentChatTurn } from "../../../lib/mentions/default-agent-routing.js";
import { notifyThreadUpdate } from "../../notify.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";

const MAX_TITLE_LEN = 80;

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

function researchThreadTitle(query: string): string {
  const base = `Research: ${query.trim()}`;
  return base.length <= MAX_TITLE_LEN
    ? base
    : `${base.slice(0, MAX_TITLE_LEN - 1).replace(/\s+\S*$/, "")}…`;
}

export interface RunSearchResearchInput {
  tenantId: string;
  callerUserId: string | null;
  query: string;
  threadId?: string | null;
}

export interface ResearchThreadRecord {
  threadId: string;
  spaceId: string | null;
  messageId: string;
}

export interface SearchResearchDeps {
  /**
   * Create the VISIBLE, owner-restricted research thread + triggering user
   * message. Returns the thread id (and space id for the dispatch payload).
   */
  createResearchThread(input: {
    tenantId: string;
    userId: string;
    query: string;
  }): Promise<ResearchThreadRecord>;
  /**
   * Post the query into an existing thread the caller supplied. MUST validate
   * the caller has write/participant access to it and return `null` when they
   * do not (the orchestration turns that into FORBIDDEN before any dispatch).
   */
  postToExistingThread(input: {
    tenantId: string;
    userId: string;
    threadId: string;
    query: string;
  }): Promise<ResearchThreadRecord | null>;
  /**
   * Dispatch the default-agent turn in NORMAL mode (no `askMode`). Must
   * surface failures (throw) so the resolver can log — never fire-and-forget.
   */
  dispatchResearchTurn(input: {
    tenantId: string;
    threadId: string;
    spaceId: string | null;
    messageId: string;
    content: string;
    userId: string;
  }): Promise<void>;
}

/**
 * Pure orchestration, injectable deps (mirrors runSearchAsk). Resolve the
 * target thread (new visible thread, or an authorized existing one) → dispatch
 * a normal background turn → return the thread id. Authorization for an
 * existing thread is enforced BEFORE any dispatch.
 */
export async function runSearchResearch(
  input: RunSearchResearchInput,
  deps: SearchResearchDeps,
): Promise<{ threadId: string }> {
  const { tenantId, callerUserId, query, threadId } = input;
  // Research needs an owner (thread visibility runs as this user).
  if (!callerUserId) {
    throw forbidden("Requester user identity required for search research");
  }
  const trimmed = query.trim();
  if (!trimmed) {
    throw new GraphQLError("Query is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  let record: ResearchThreadRecord;
  if (threadId) {
    const posted = await deps.postToExistingThread({
      tenantId,
      userId: callerUserId,
      threadId,
      query: trimmed,
    });
    // No write/participant access → reject BEFORE any dispatch or thread work.
    if (!posted) {
      throw forbidden("Access denied: cannot post research to this thread");
    }
    record = posted;
  } else {
    record = await deps.createResearchThread({
      tenantId,
      userId: callerUserId,
      query: trimmed,
    });
  }

  try {
    await deps.dispatchResearchTurn({
      tenantId,
      threadId: record.threadId,
      spaceId: record.spaceId,
      messageId: record.messageId,
      content: trimmed,
      userId: callerUserId,
    });
  } catch (err) {
    // The thread + message already committed and the id is returned so the
    // client can still link to it; a failed dispatch means no turn ran — make
    // it loud in logs rather than swallowing it (parity with searchAsk /
    // sendMessage's default route, which log instead of throwing back).
    console.error(
      `[searchResearch] research-turn dispatch failed for thread=${record.threadId}:`,
      err,
    );
  }

  return { threadId: record.threadId };
}

/**
 * Real thread-create: resolve the tenant's default space + platform agent,
 * then atomically bump the issue counter, insert the VISIBLE thread (owner =
 * caller, `metadata.searchResearch` for provenance, agent pre-assigned so the
 * dispatch resolves it), the requester participant row, and the triggering
 * user message. Mirrors createHiddenAskThreadReal WITHOUT the systemHidden bit.
 */
async function createResearchThreadReal(input: {
  tenantId: string;
  userId: string;
  query: string;
}): Promise<ResearchThreadRecord> {
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

  const title = researchThreadTitle(input.query);
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
        // Owner = caller; VISIBLE (no systemHidden) so it lists normally.
        user_id: input.userId,
        number: nextNumber,
        identifier,
        title,
        workspace_folder_name: threadFolderName,
        status: "in_progress",
        channel: "chat",
        created_by_type: "user",
        created_by_id: input.userId,
        // Provenance only — NOT a visibility flag.
        metadata: { searchResearch: true },
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

/**
 * Real existing-thread post: verify the caller can write to the thread (owner
 * or participant, via the same predicate sendMessage uses) and insert the
 * triggering user message. Returns `null` when the caller has no access — the
 * orchestration rejects FORBIDDEN before any dispatch.
 */
async function postToExistingThreadReal(input: {
  tenantId: string;
  userId: string;
  threadId: string;
  query: string;
}): Promise<ResearchThreadRecord | null> {
  const [thread] = await db
    .select({ id: threads.id, space_id: threads.space_id })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.tenant_id, input.tenantId),
        callerVisibleThreadPredicate(input.tenantId, input.userId),
      ),
    );
  if (!thread) return null;

  const createdAt = new Date();
  const [messageRow] = await db
    .insert(messages)
    .values({
      thread_id: thread.id,
      tenant_id: input.tenantId,
      role: "user",
      content: input.query,
      sender_type: "user",
      sender_id: input.userId,
      created_at: createdAt,
    })
    .returning({ id: messages.id });

  return {
    threadId: thread.id,
    spaceId: thread.space_id ?? null,
    messageId: messageRow.id,
  };
}

const realSearchResearchDeps: SearchResearchDeps = {
  createResearchThread: createResearchThreadReal,
  postToExistingThread: postToExistingThreadReal,
  async dispatchResearchTurn(input) {
    const result = await dispatchDefaultAgentChatTurn({
      tenantId: input.tenantId,
      threadId: input.threadId,
      spaceId: input.spaceId,
      messageId: input.messageId,
      content: input.content,
      // NORMAL mode: no askMode — retention is normal and the wakeup fallback
      // is allowed (research is a legit background run). Cost metering rides
      // chat-finalize automatically.
      sender: { type: "user", id: input.userId },
    });
    if (!result || (!result.directInvoked && !result.enqueued)) {
      throw new Error("Search research dispatch did not fire");
    }
  },
};

export const searchResearch = async (
  _parent: unknown,
  args: { tenantId: string; query: string; threadId?: string | null },
  ctx: GraphQLContext,
): Promise<{ threadId: string }> => {
  // Only Cognito end-users enqueue research from the palette. Service/apikey
  // callers (the Pi agent tool, schedulers) do not research via this mutation.
  if (ctx.auth?.authType !== "cognito") {
    throw forbidden("Search research is only available to authenticated users");
  }

  const callerTenantId = await resolveCallerTenantId(ctx);
  if (!callerTenantId || callerTenantId !== args.tenantId) {
    throw forbidden("Access denied: tenant mismatch");
  }
  const callerUserId = await resolveCallerUserId(ctx);

  return runSearchResearch(
    {
      tenantId: args.tenantId,
      callerUserId,
      query: args.query,
      threadId: args.threadId ?? null,
    },
    realSearchResearchDeps,
  );
};
