/**
 * Plan §005 U8 — Resolve a Pi `SandboxFactory` from an invocation payload.
 *
 * When Code Interpreter is enabled, Pi's invocation payload carries
 * `sandbox_interpreter_id` — the
 * AgentCore Code Interpreter id resolved by
 * `packages/api/src/lib/sandbox-preflight.ts` per-tenant before
 * chat-agent-invoke fires. The Pi trusted-handler reads that id
 * from the payload and constructs the connector that the agent loop
 * (and `session.task()` sub-agents) will use as their default sandbox.
 *
 * No SSM lookup. No callback. The id is part of the execute_code tool
 * registration contract because sandbox-preflight is the canonical per-tenant
 * resolution path — re-resolving from the runtime container would duplicate
 * tenant-scoping logic and add latency to sandbox-enabled invocations.
 */

import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  agentcoreCodeInterpreter,
  type SandboxFactory,
} from "@thinkwork/pi-aws";

/**
 * The subset of Pi's invocation payload that the sandbox-factory
 * helper inspects. The full payload (tenantId, agentId, threadId, ...)
 * lives in U9's handler shell.
 */
export interface PiInvocationPayload {
  /**
   * Per-tenant AgentCore Code Interpreter id. Set by
   * `packages/api/src/lib/sandbox-preflight.ts` upstream of
   * chat-agent-invoke when execute_code should be registered.
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
  /** Pass-through. Defaults to the 8-hour AgentCore maximum inside the connector. */
  sessionTimeoutSeconds?: number;
}

export class SandboxFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxFactoryError";
  }
}

export function resolveSandboxFactory(
  payload: PiInvocationPayload,
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
      "Pi invocation payload missing `sandbox_interpreter_id`. This field " +
        "must be populated by sandbox-preflight (packages/api/src/lib/" +
        "sandbox-preflight.ts) before chat-agent-invoke dispatches to the " +
        "Pi runtime — its absence is a contract violation upstream, not a " +
        "runtime fallback case.",
    );
  }

  return agentcoreCodeInterpreter(options.client, {
    interpreterId,
    cleanup: options.cleanup,
    sessionTimeoutSeconds: options.sessionTimeoutSeconds,
  });
}
