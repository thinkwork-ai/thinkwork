import { createHash } from "node:crypto";

/**
 * Per-thread AgentCore runtime session key (THINK-585 U6, KTD1).
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
  for (const [name, value] of Object.entries({
    tenantId,
    agentId,
    userId,
    threadId,
  })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `deriveAgentCoreSessionId: missing identity field ${name}`,
      );
    }
    if (value.includes(":")) {
      // The joined preimage is colon-delimited; a colon inside a field would
      // let two different identity tuples collide on one session.
      throw new Error(
        `deriveAgentCoreSessionId: identity field ${name} must not contain ':'`,
      );
    }
  }
  return createHash("sha256")
    .update(`session:${tenantId}:${agentId}:${userId}:${threadId}`)
    .digest("hex");
}
