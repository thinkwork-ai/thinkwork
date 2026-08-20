/**
 * The wire contract for the THINK-908 session pre-warm ping.
 *
 * Kept in its own dependency-free module so the `agentcore-runtime-dispatch`
 * Lambda can recognize a ping without pulling in the sender's runtime-config
 * dependency graph.
 *
 * A ping is an ordinary LWA `/invocations` envelope whose body carries the
 * `kind: "session_warm_ping"` discriminator and NOTHING but the four identity
 * fields the per-thread session ID is derived from. Notably it carries no
 * `thread_turn_id` and no `message`: the Pi container short-circuits on the
 * discriminator before identity validation, so the ping can never start an
 * agent loop, write session state, or fire a finalize callback.
 */

export const SESSION_WARM_PING_KIND = "session_warm_ping";

export interface SessionPrewarmIdentity {
  tenantId: string;
  agentId: string;
  userId: string;
  threadId: string;
}

/** The LWA-shaped envelope the dispatcher already knows how to unwrap. */
export function buildSessionPrewarmEnvelope(
  identity: SessionPrewarmIdentity,
): string {
  return JSON.stringify({
    requestContext: { http: { method: "POST", path: "/invocations" } },
    rawPath: "/invocations",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: SESSION_WARM_PING_KIND,
      tenant_id: identity.tenantId,
      assistant_id: identity.agentId,
      user_id: identity.userId,
      thread_id: identity.threadId,
    }),
    isBase64Encoded: false,
  });
}
