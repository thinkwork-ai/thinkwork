/**
 * agentcore-session-prewarm (THINK-908).
 *
 * Every NEW chat thread pays ~20-24 s of Bedrock AgentCore microVM
 * provisioning: the dispatcher's `InvokeAgentRuntime` returns only once the
 * Pi container's `server_listening` line appears, and the container itself
 * boots in ~1.3 s — the rest is the platform standing a microVM up. Warm
 * sessions never covered this because the runtime session ID is derived
 * per-thread (`deriveAgentCoreSessionId`), so a brand-new thread is always a
 * cold session.
 *
 * The fix is to pay that cost while the user is still typing: when a thread
 * is created with an agent but WITHOUT an opening message, Event-invoke the
 * existing `agentcore-runtime-dispatch` Lambda with an envelope carrying the
 * `session_warm_ping` discriminator. The dispatcher derives the SAME session
 * ID the first real turn will use, so the microVM the ping boots is the one
 * the turn lands on.
 *
 * Safety rules this module upholds (the ping must never look like a turn):
 * - No `thread_turn_id`: there is no turn, and the dispatcher's warm-ping
 *   branch refuses to touch `thread_turns` at all.
 * - Fire-and-forget `Event` invoke, every failure swallowed — a pre-warm that
 *   fails must never fail `createThread`.
 * - Only fired when the thread has no opening message and no seeded turn, so
 *   the ping can never contend with a real turn for the session.
 * - Only fired when this agent would actually ride the AgentCore Runtime path
 *   (`resolveChatDispatchTarget` → `agentcore_runtime`); on the Pi Lambda path
 *   there is no microVM to warm.
 */

import { logAgentCorePhase } from "./agentcore-phase-log.js";
import {
  resolveChatDispatchTarget,
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from "./resolve-runtime-function-name.js";
import {
  buildSessionPrewarmEnvelope,
  SESSION_WARM_PING_KIND,
  type SessionPrewarmIdentity,
} from "./agentcore-warm-ping.js";

export {
  buildSessionPrewarmEnvelope,
  SESSION_WARM_PING_KIND,
  type SessionPrewarmIdentity,
};

/**
 * Stage/operator kill-switch. Default ON — set `AGENTCORE_SESSION_PREWARM` to
 * "0" / "false" / "off" to disable per stage without a code change.
 */
export function isSessionPrewarmEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.AGENTCORE_SESSION_PREWARM ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export interface DispatchSessionPrewarmDeps {
  /** Injected in tests; production lazily imports the Lambda client. */
  invoke?: (input: { functionName: string; payload: string }) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Fire the warm ping. Never throws, never awaits anything the caller's
 * mutation depends on. Returns true when a ping was actually dispatched
 * (useful for tests and for the phase log).
 */
export async function dispatchSessionPrewarm(
  input: SessionPrewarmIdentity & {
    /** The agent's `agents.agentcore_runtime_dispatch` flag. */
    agentFlagEnabled: boolean;
    runtimeType?: AgentRuntimeType | string | null;
  },
  deps: DispatchSessionPrewarmDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (!isSessionPrewarmEnabled(env)) return false;
  const { tenantId, agentId, userId, threadId } = input;
  if (!tenantId || !agentId || !userId || !threadId) return false;

  try {
    let runtimeType: AgentRuntimeType;
    try {
      runtimeType = normalizeAgentRuntimeType(input.runtimeType ?? "pi");
    } catch {
      // An unrecognized runtime selector fails the real turn loudly in
      // chat-agent-invoke; here it just means "don't pre-warm".
      return false;
    }
    const target = resolveChatDispatchTarget(
      { runtimeType, agentFlagEnabled: input.agentFlagEnabled },
      env,
    );
    // Pi-Lambda-path agents have no microVM to warm.
    if (target.kind !== "agentcore_runtime") return false;

    const payload = buildSessionPrewarmEnvelope({
      tenantId,
      agentId,
      userId,
      threadId,
    });
    const invoke = deps.invoke ?? defaultInvoke;
    await invoke({ functionName: target.functionName, payload });
    logAgentCorePhase({
      source: "chat-agent-invoke",
      phase: "api.session_prewarm.dispatched",
      status: "completed",
      tenantId,
      agentId,
      threadId,
      runtimeType,
    });
    return true;
  } catch (err) {
    // Best-effort by construction: a cold start is a latency regression, a
    // thrown createThread is a broken product.
    console.warn(
      "[agentcore-session-prewarm] warm ping dispatch failed (ignored):",
      err instanceof Error ? err.message : err,
    );
    logAgentCorePhase({
      source: "chat-agent-invoke",
      phase: "api.session_prewarm.dispatched",
      status: "failed",
      tenantId,
      agentId,
      threadId,
      errorType: err instanceof Error ? err.name : "unknown",
    });
    return false;
  }
}

async function defaultInvoke(input: {
  functionName: string;
  payload: string;
}): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: input.functionName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(input.payload),
    }),
  );
}
