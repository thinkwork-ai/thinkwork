/**
 * teachBrain — "Teach the Brain" (THINK-784).
 *
 * A domain expert states knowledge in their own words and sends it to
 * the ThinkWork Brain for review. Sibling of flagThreadToBrain
 * (THINK-781): flag = "this answer is wrong", teach = "here's something
 * the Brain should know". Server-side the Brain files a teaching-distill
 * investigation that grounds the statement against the data, drafts
 * attributed knowledge ("Taught by <name>…"), and routes it to an
 * operator for admission — never published unreviewed, never dropped
 * silently.
 *
 * Attribution: `taught_by` is REQUIRED by the Brain and always derived
 * from the signed-in caller (email) — the expert never types their own
 * identity. Thread context is optional; when a threadId is provided the
 * caller must be able to SEE that thread (same visibility gate as the
 * flag path) and it resolves to `context_thread_url`.
 *
 * Transport: POST {BRAIN_OPS_API_URL}/teachings with the same
 * agent-identity m2m bearer as /flags (BRAIN_OPS_M2M_SECRET_ARN).
 */

import { GraphQLError } from "graphql";
import { getConfig, getSecret } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, threads } from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "./access.js";
import {
  cachedM2mToken,
  m2mCredentialsFromSecret,
} from "../../../lib/twin/m2m-token.js";
import {
  brainTeachingsUrlFrom,
  buildBrainTeachingPayload,
  postBrainTeaching,
} from "../../../lib/brain/teach.js";

const LOG_PREFIX = "[teach-brain]";

function gqlError(message: string, code: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

interface TeachBrainInput {
  text: string;
  threadId?: string | null;
  answersQuestionId?: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const teachBrain = async (
  _parent: unknown,
  args: { input: TeachBrainInput },
  ctx: GraphQLContext,
) => {
  const text = (args.input.text ?? "").trim();
  if (!text) {
    throw gqlError(
      "A statement is required: what should the Brain know?",
      "BAD_USER_INPUT",
    );
  }

  // The Brain requires attribution; the caller's email is the identity we
  // hold for every cognito sign-in (Google-federated included).
  // Answering a Brain expert question (THINK-787): the Brain requires a
  // UUID; reject early rather than bounce on its 400.
  const answersQuestionId = args.input.answersQuestionId?.trim() || null;
  if (answersQuestionId && !UUID_RE.test(answersQuestionId)) {
    throw gqlError("answersQuestionId must be a UUID.", "BAD_USER_INPUT");
  }

  const taughtBy = (ctx.auth.email ?? "").trim();
  if (!taughtBy) {
    throw gqlError(
      "Couldn't determine who is teaching — sign in again and retry.",
      "BAD_USER_INPUT",
    );
  }

  // Optional thread context: same visibility gate as the flag path — an
  // invisible or cross-tenant thread is NOT_FOUND, no existence oracle.
  let contextThreadUrl: string | null = null;
  const threadId = args.input.threadId?.trim() || null;
  if (threadId) {
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
          eq(threads.id, threadId),
          eq(threads.tenant_id, callerTenantId),
          callerVisibleThreadPredicate(callerTenantId, callerUserId!),
        )
      : eq(threads.id, threadId);
    const [thread] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(threadConditions);
    if (!thread) throw gqlError("Thread not found", "NOT_FOUND");
    const appUrl = (getConfig("ADMIN_URL", "") || "")
      .trim()
      .replace(/\/+$/, "");
    contextThreadUrl = appUrl ? `${appUrl}/threads/${thread.id}` : null;
  }

  // Same Brain ops-api connection as the flag path: base URL +
  // agent-identity m2m secret, both stage config.
  const opsApiUrl = (getConfig("BRAIN_OPS_API_URL", "") || "").trim();
  const secretRef = (getConfig("BRAIN_OPS_M2M_SECRET_ARN", "") || "").trim();
  const notConfigured = () =>
    gqlError(
      "This account has no Brain connection configured — ask your operator.",
      "FAILED_PRECONDITION",
    );
  if (!opsApiUrl || !secretRef) {
    console.error(
      `${LOG_PREFIX} BRAIN_OPS_API_URL / BRAIN_OPS_M2M_SECRET_ARN not configured`,
    );
    throw notConfigured();
  }
  let token: string;
  try {
    const secretValue: unknown = JSON.parse(await getSecret(secretRef));
    const creds = m2mCredentialsFromSecret(
      secretValue as Record<string, unknown>,
    );
    if (!creds) throw new Error("secret is not a client-credentials blob");
    token = await cachedM2mToken(secretRef, creds);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} could not mint Brain ops-api bearer: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    throw notConfigured();
  }

  const payload = buildBrainTeachingPayload({
    taughtBy,
    text,
    contextThreadUrl,
    answersQuestionId,
  });

  const result = await postBrainTeaching({
    teachingsUrl: brainTeachingsUrlFrom(opsApiUrl),
    token,
    payload,
  });

  if (result.kind === "rejected") {
    // 4xx is validation feedback — surface what the Brain said.
    throw gqlError(
      `The Brain rejected the teaching: ${result.message}`,
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
    teachingId: result.teachingId,
    taskId: result.taskId,
    note: result.note,
  };
};
