import { createHash } from "node:crypto";

/**
 * Per-thread AgentCore runtime session key — v1 (THINK-585 U6, KTD1).
 *
 * `sha256("session:" + tenantId + ":" + agentId + ":" + userId + ":" + threadId)`
 * hex — 64 chars, satisfying AgentCore's ≥33-char runtimeSessionId minimum.
 * Per-thread keying (session-settled decision) matches the per-thread rendered
 * workspace prefix and turns AgentCore's per-session serialization into the
 * turn-ordering the harness already assumes; a user's parallel threads never
 * queue behind each other.
 *
 * The dispatcher derives this server-side from identity fields it validated —
 * it NEVER accepts a caller-supplied session ID — and the container recomputes
 * it from its envelope to hard-fail mismatched invocations when the runtime
 * exposes the session ID.
 */
export function deriveAgentCoreSessionId(identity: {
  tenantId: string;
  agentId: string;
  userId: string;
  threadId: string;
}): string {
  const { tenantId, agentId, userId, threadId } = identity;
  assertSessionIdentityFields("deriveAgentCoreSessionId", {
    tenantId,
    agentId,
    userId,
    threadId,
  });
  return createHash("sha256")
    .update(`session:${tenantId}:${agentId}:${userId}:${threadId}`)
    .digest("hex");
}

/**
 * Per-user AgentCore runtime session key — v2 (THINK-909).
 *
 * `sha256("session:v2:" + tenantId + ":" + agentId + ":" + userId)` hex.
 *
 * Widening the key from (tenant, agent, user, thread) to (tenant, agent,
 * user) lets a user's NEW thread land on the microVM their previous thread
 * already warmed, instead of paying the ~20-24 s AgentCore cold start per
 * thread. The tenant/user boundary is unchanged: the id still binds
 * tenantId + agentId + userId, all derived server-side from validated
 * identity fields — a caller-supplied session ID is never accepted.
 *
 * `session:v2:` is a distinct domain prefix from v1's `session:`, and no
 * identity field may contain ':' , so a v2 preimage can never equal a v1
 * preimage.
 */
export function deriveAgentCoreUserSessionId(identity: {
  tenantId: string;
  agentId: string;
  userId: string;
}): string {
  const { tenantId, agentId, userId } = identity;
  assertSessionIdentityFields("deriveAgentCoreUserSessionId", {
    tenantId,
    agentId,
    userId,
  });
  return createHash("sha256")
    .update(`session:v2:${tenantId}:${agentId}:${userId}`)
    .digest("hex");
}

/**
 * Runtime session scope (THINK-909). `thread` = v1 per-thread keying
 * (today's behavior, the default); `user` = v2 per-user keying with a
 * per-thread fallback on the first 409.
 *
 * Defaults to `thread` so the Lambda change is safe to ship BEFORE the
 * container image that dual-accepts both ids has rolled: a stage flips to
 * `user` only after its runtime image carries the dual-accept check.
 */
export type AgentCoreSessionScope = "thread" | "user";

export function resolveAgentCoreSessionScope(
  env: { AGENTCORE_SESSION_SCOPE?: string | undefined } = process.env,
): AgentCoreSessionScope {
  return (env.AGENTCORE_SESSION_SCOPE ?? "").trim().toLowerCase() === "user"
    ? "user"
    : "thread";
}

function assertSessionIdentityFields(
  fn: string,
  fields: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${fn}: missing identity field ${name}`);
    }
    if (value.includes(":")) {
      // The joined preimage is colon-delimited; a colon inside a field would
      // let two different identity tuples collide on one session.
      throw new Error(`${fn}: identity field ${name} must not contain ':'`);
    }
  }
}
