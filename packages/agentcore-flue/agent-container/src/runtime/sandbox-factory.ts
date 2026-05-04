/**
 * Plan §005 U8 — Resolve a Flue `SandboxFactory` from an invocation payload.
 *
 * Flue's invocation payload carries `sandbox_interpreter_id` — the
 * AgentCore Code Interpreter id resolved by
 * `packages/api/src/lib/sandbox-preflight.ts` per-tenant before
 * chat-agent-invoke fires. The Flue trusted-handler reads that id
 * from the payload and constructs the connector that the agent loop
 * (and `session.task()` sub-agents) will use as their default sandbox.
 *
 * No SSM lookup. No callback. The id is part of the payload contract
 * because sandbox-preflight is the canonical per-tenant resolution
 * path — re-resolving from the runtime container would duplicate
 * tenant-scoping logic and add latency to every invocation.
 *
 * Shipped INERT in U8: `server.ts` does not call this helper yet.
 * U9's handler shell wires it in alongside the rest of the Flue
 * runtime construction (SessionStore, MCP wiring, tools).
 */

import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  agentcoreCodeInterpreter,
  type SandboxFactory,
} from "@thinkwork/flue-aws";

/**
 * The subset of Flue's invocation payload that the sandbox-factory
 * helper inspects. The full payload (tenantId, agentId, threadId, ...)
 * lives in U9's handler shell.
 */
export interface FlueInvocationPayload {
  /**
   * Per-tenant AgentCore Code Interpreter id. Set by
   * `packages/api/src/lib/sandbox-preflight.ts` upstream of
   * chat-agent-invoke. Required — its absence is a contract violation.
   */
  sandbox_interpreter_id: string;
}

export interface ResolveSandboxFactoryOptions {
  /** AgentCore client (test harnesses inject mocks here). */
  client: BedrockAgentCoreClient;
  /**
   * Pass-through to `agentcoreCodeInterpreter`. Defaults to false
   * (leave AgentCore session running until its TTL).
   */
  cleanup?: boolean;
  /** Pass-through. Defaults to 300 inside the connector. */
  sessionTimeoutSeconds?: number;
}

export class SandboxFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxFactoryError";
  }
}

export function resolveSandboxFactory(
  payload: FlueInvocationPayload,
  options: ResolveSandboxFactoryOptions,
): SandboxFactory {
  const interpreterId = payload?.sandbox_interpreter_id;
  if (
    interpreterId === undefined ||
    interpreterId === null ||
    typeof interpreterId !== "string" ||
    interpreterId.trim().length === 0
  ) {
    throw new SandboxFactoryError(
      "Flue invocation payload missing `sandbox_interpreter_id`. This field " +
        "must be populated by sandbox-preflight (packages/api/src/lib/" +
        "sandbox-preflight.ts) before chat-agent-invoke dispatches to the " +
        "Flue runtime — its absence is a contract violation upstream, not a " +
        "runtime fallback case.",
    );
  }

  return agentcoreCodeInterpreter(options.client, {
    interpreterId,
    cleanup: options.cleanup,
    sessionTimeoutSeconds: options.sessionTimeoutSeconds,
  });
}
