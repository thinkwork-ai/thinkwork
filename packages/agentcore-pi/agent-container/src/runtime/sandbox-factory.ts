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
  type SessionEnv,
} from "@thinkwork/pi-aws";
import {
  type CapabilitySdkBootstrapInput,
  buildCapabilitySdkBootstrapContent,
  capabilitySdkBootstrapTarget,
  capabilitySdkSourceFiles,
} from "./capability-sdk-source.js";

/**
 * THINK-280 U4 — capability-private broker session bootstrap carried on the
 * dispatch payload's `capability_private_session` field. Structurally the SDK
 * bootstrap input; `privateKey` is the short-lived Ed25519 session capability
 * and MUST NOT reach logs/stdout/stderr/exceptions.
 */
export type CapabilityPrivateSessionBootstrap = CapabilitySdkBootstrapInput;

/**
 * THINK-280 U4 — per-invocation capability-private selection. Present on the
 * payload ONLY when the broker is enabled and a session was opened (U7);
 * absent otherwise, in which case behavior is exactly the single-interpreter
 * path below.
 */
export interface CapabilityPrivateSession {
  /** capability-private interpreter id (tenants.sandbox_interpreter_capability_private_id). */
  interpreterId: string;
  /** Broker session bootstrap the host materializes into the session (chmod 0600). */
  bootstrap: CapabilityPrivateSessionBootstrap;
}

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
   *
   * Optional now: a capability-private invocation may carry
   * `capability_private_session` INSTEAD of a template-env interpreter id.
   */
  sandbox_interpreter_id?: string;
  /**
   * THINK-280 U4 — capability-private selection + broker session bootstrap.
   * When present, the runtime selects the capability-private interpreter and
   * materializes the SDK + bootstrap into the session. INERT when absent.
   */
  capability_private_session?: CapabilityPrivateSession;
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
  // THINK-280 U4 — capability-private selection takes precedence. Present only
  // when the broker is enabled and a session was opened (U7); fail CLOSED
  // rather than fall through to the template-env interpreter, matching
  // capabilities-json.ts's loud, no-silent-fallback trust posture.
  const capabilityPrivate = payload?.capability_private_session;
  if (capabilityPrivate !== undefined) {
    return resolveCapabilityPrivateFactory(capabilityPrivate, options);
  }

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

/**
 * Build the SandboxFactory for a capability-private invocation: the dedicated
 * VPC-mode interpreter, wrapped so each new session first materializes the
 * pure-stdlib capability SDK plus a chmod-0600 broker session bootstrap. The
 * session is ALWAYS stopped and the bootstrap deleted on cleanup.
 *
 * Fail-closed: a capability-private request with a missing interpreter id or
 * malformed bootstrap throws `SandboxFactoryError` — it never degrades to the
 * default-public interpreter. Error strings deliberately carry NO bootstrap
 * content or key material.
 */
function resolveCapabilityPrivateFactory(
  session: CapabilityPrivateSession,
  options: ResolveSandboxFactoryOptions,
): SandboxFactory {
  const interpreterId = session?.interpreterId;
  if (
    interpreterId === undefined ||
    interpreterId === null ||
    typeof interpreterId !== "string" ||
    interpreterId.trim().length === 0
  ) {
    throw new SandboxFactoryError(
      "capability-private invocation is missing its interpreter id. This is " +
        "the provisioned capability-private interpreter " +
        "(tenants.sandbox_interpreter_capability_private_id) resolved by " +
        "sandbox-preflight; its absence is a fail-closed contract violation, " +
        "never a fallback to the default-public interpreter.",
    );
  }
  assertValidBootstrap(session?.bootstrap);

  // cleanup:true — a capability-private session holds a live session key and
  // must always be stopped, so the underlying connector stops the AgentCore
  // session and the wrapper additionally deletes the bootstrap first.
  const inner = agentcoreCodeInterpreter(options.client, {
    interpreterId,
    cleanup: true,
    sessionTimeoutSeconds: options.sessionTimeoutSeconds,
  });
  return withCapabilitySdkBootstrap(inner, session.bootstrap);
}

/**
 * Validate the broker session bootstrap shape without ever echoing its
 * contents. Keeps the private key out of any thrown message.
 */
function assertValidBootstrap(
  bootstrap: CapabilityPrivateSessionBootstrap | undefined,
): asserts bootstrap is CapabilityPrivateSessionBootstrap {
  const nonEmpty = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  const ok =
    bootstrap !== undefined &&
    bootstrap !== null &&
    typeof bootstrap === "object" &&
    nonEmpty(bootstrap.sessionId) &&
    nonEmpty(bootstrap.audience) &&
    nonEmpty(bootstrap.brokerEndpoint) &&
    nonEmpty(bootstrap.brokerApiId) &&
    nonEmpty(bootstrap.privateKey) &&
    nonEmpty(bootstrap.expiresAt) &&
    typeof bootstrap.nextSequence === "number" &&
    Number.isFinite(bootstrap.nextSequence);
  if (!ok) {
    throw new SandboxFactoryError(
      "capability-private invocation carries a malformed session bootstrap " +
        "(session key material redacted). A valid bootstrap requires a " +
        "sessionId, audience, brokerEndpoint, brokerApiId, privateKey, " +
        "expiresAt, and a numeric nextSequence.",
    );
  }
}

/** Single-quote a POSIX shell argument (embedded-quote safe). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Wrap a SandboxFactory so each created session materializes the capability
 * SDK sources plus the chmod-0600 broker session bootstrap, and its cleanup
 * deletes the bootstrap before stopping the session.
 *
 * Exported for tests: exercised with a fake inner factory + mock SessionEnv so
 * the write/chmod/cleanup contract is verified without real AgentCore.
 */
export function withCapabilitySdkBootstrap(
  inner: SandboxFactory,
  bootstrap: CapabilityPrivateSessionBootstrap,
): SandboxFactory {
  return {
    async createSessionEnv(opts): Promise<SessionEnv> {
      const env = await inner.createSessionEnv(opts);
      await materializeCapabilitySdk(env, bootstrap);

      const bootstrapPath = capabilitySdkBootstrapTarget().path;
      const innerCleanup = env.cleanup;
      return {
        ...env,
        cleanup: async () => {
          // Delete the bootstrap first (best-effort) so the session key does
          // not linger past the turn, then stop the session.
          try {
            await env.rm(bootstrapPath, { force: true });
          } catch {
            // Session teardown below is authoritative; a failed unlink of a
            // session-duration file must not mask the stop.
          }
          if (innerCleanup) await innerCleanup();
        },
      };
    },
  };
}

/**
 * Write the SDK `.py` sources and the bootstrap into a session, then chmod the
 * bootstrap to 0600. All failures are re-thrown REDACTED — the underlying
 * writeFile/exec errors and the bootstrap content never reach the surfaced
 * message.
 */
async function materializeCapabilitySdk(
  env: SessionEnv,
  bootstrap: CapabilityPrivateSessionBootstrap,
): Promise<void> {
  try {
    for (const file of capabilitySdkSourceFiles()) {
      await env.writeFile(file.path, file.content);
    }
    const target = capabilitySdkBootstrapTarget();
    await env.writeFile(
      target.path,
      buildCapabilitySdkBootstrapContent(bootstrap),
    );
    // SessionEnv.writeFile has no mode argument; enforce 0600 via chmod on the
    // resolved absolute path (exec does not inherit the JS-side cwd).
    const absoluteBootstrap = env.resolvePath(env.cwd, target.path);
    await env.exec(
      `chmod ${target.mode.toString(8)} ${shellQuote(absoluteBootstrap)}`,
      { cwd: env.cwd },
    );
  } catch {
    // Redact: the caught error may reference the file we just wrote; never
    // surface bootstrap content or the session private key.
    throw new SandboxFactoryError(
      "failed to materialize the capability SDK and session bootstrap into " +
        "the capability-private session (session key material redacted).",
    );
  }
}
