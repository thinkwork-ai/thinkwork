/**
 * flagThreadToBrain — "Send to the Brain" (THINK-781).
 *
 * A user who thinks a thread's answer looks wrong flags it to the
 * ThinkWork Brain; the Brain files a `flag-triage` Platform Agent task
 * (THINK-780) and the investigation lands in the operator's Agent inbox.
 * Investigation path only — deliberately separate from flagThreadForEval
 * (eval-artifact creation); the same thread can be both.
 *
 * Access mirrors the single-thread read gate, not the operator gate: any
 * caller who can SEE the thread (owner / participant / linked work-item
 * assignee) can flag it — the motivating incident (THINK-779) was an end
 * user with no path to raise a false conclusion. Cross-tenant or invisible
 * threads surface as NOT_FOUND (no existence oracle).
 *
 * Transport: POST {brain_ops_api}/flags with the account's existing Brain
 * m2m bearer — resolved through the provisioned `digital-twin` connector
 * (service-credential lane), the same credential the /mcp surface uses.
 * The ops URL is the connector URL with the /mcp suffix rewritten, the
 * same derivation the KB surface uses.
 */

import { GraphQLError } from "graphql";
import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import { asc, db, eq, and, messages, threads } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";
import { resolveTenantMcpServerTarget } from "../../../lib/mcp-configs.js";
import { TWIN_CONNECTOR_SLUG } from "../../../lib/twin/provision-connector.js";
import {
  brainFlagsUrlFrom,
  buildBrainFlagPayload,
  postBrainFlag,
} from "../../../lib/brain/flag-thread.js";
import type { ThreadMessageRow } from "../../../lib/evals/thread-snapshot.js";

const LOG_PREFIX = "[flag-thread-to-brain]";

function gqlError(message: string, code: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

interface FlagThreadToBrainInput {
  threadId: string;
  note: string;
}

export const flagThreadToBrain = async (
  _parent: unknown,
  args: { input: FlagThreadToBrainInput },
  ctx: GraphQLContext,
) => {
  const note = (args.input.note ?? "").trim();
  if (!note) {
    throw gqlError(
      "A note is required: describe what looks wrong so the Brain knows what to investigate.",
      "BAD_USER_INPUT",
    );
  }

  // Same visibility gate as the single-thread read: cognito callers must
  // resolve to a tenant + user and the thread must be visible to them;
  // service/apikey callers are pre-authorized infrastructure.
  let callerTenantId: string | null = null;
  let callerUserId: string | null = null;
  if (ctx.auth.authType === "cognito") {
    callerTenantId = await resolveCallerTenantId(ctx);
    callerUserId = callerTenantId ? await resolveCallerUserId(ctx) : null;
    if (!callerTenantId || !callerUserId) {
      throw gqlError("Thread not found", "NOT_FOUND");
    }
  }

  const threadConditions = callerTenantId
    ? and(
        eq(threads.id, args.input.threadId),
        eq(threads.tenant_id, callerTenantId),
        callerVisibleThreadPredicate(callerTenantId, callerUserId!),
      )
    : eq(threads.id, args.input.threadId);
  const [thread] = await db
    .select({ id: threads.id, tenant_id: threads.tenant_id })
    .from(threads)
    .where(threadConditions);
  if (!thread) throw gqlError("Thread not found", "NOT_FOUND");
  const tenantId = thread.tenant_id;

  // The account's Brain connection — the provisioned digital-twin
  // connector row carries the m2m secretRef and the Brain base URL.
  const resolved = await resolveTenantMcpServerTarget({
    tenantId,
    serverName: TWIN_CONNECTOR_SLUG,
    logPrefix: LOG_PREFIX,
  });
  if (resolved.kind !== "ok") {
    console.error(
      `${LOG_PREFIX} Brain connector unavailable for tenant ${tenantId}: ${resolved.reason}`,
    );
    throw gqlError(
      "This account has no Brain connection configured — ask your operator.",
      "FAILED_PRECONDITION",
    );
  }

  // Raw conversation, same fidelity the eval flag captures (content
  // column first, then typed text parts — pasted content included).
  const messageRows = (await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      parts: messages.parts,
      created_at: messages.created_at,
    })
    .from(messages)
    .where(
      and(eq(messages.thread_id, thread.id), eq(messages.tenant_id, tenantId)),
    )
    .orderBy(asc(messages.created_at))) as ThreadMessageRow[];

  const appUrl = (getConfig("ADMIN_URL", "") || "").trim().replace(/\/+$/, "");
  const payload = buildBrainFlagPayload({
    threadId: thread.id,
    threadUrl: appUrl ? `${appUrl}/threads/${thread.id}` : null,
    flaggedBy: ctx.auth.email,
    note,
    messages: messageRows,
  });

  const result = await postBrainFlag({
    flagsUrl: brainFlagsUrlFrom(resolved.target.url),
    token: resolved.target.token ?? null,
    headers: resolved.target.headers,
    payload,
  });

  if (result.kind === "rejected") {
    // 4xx is validation feedback — surface what the Brain said.
    throw gqlError(
      `The Brain rejected the flag: ${result.message}`,
      "BAD_USER_INPUT",
    );
  }
  if (result.kind === "unreachable") {
    console.error(`${LOG_PREFIX} Brain unreachable: ${result.message}`);
    throw gqlError(
      "Couldn't reach the Brain — try again.",
      "SERVICE_UNAVAILABLE",
    );
  }

  return {
    flagId: result.flagId,
    taskId: result.taskId,
    note: result.note,
  };
};
