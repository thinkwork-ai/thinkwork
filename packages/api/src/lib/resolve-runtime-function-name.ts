import { deriveFunctionName, getConfig } from "@thinkwork/runtime-config";

export type AgentRuntimeType = "strands" | "pi" | "agentcore";

export class RuntimeNotProvisionedError extends Error {
  constructor(public readonly runtimeType: AgentRuntimeType) {
    super(
      runtimeType === "agentcore"
        ? "AgentCore Harness runtime not yet provisioned in this stage."
        : "Pi runtime not yet provisioned in this stage.",
    );
    this.name = "RuntimeNotProvisionedError";
  }
}

/**
 * THINK-311 (R4): an unrecognized `agents.runtime` value must fail the
 * dispatch loudly instead of silently coercing to Pi — a mistyped trial
 * flag ("harness2") running Pi would be exactly the silent fallback the
 * trial forbids.
 */
export class UnknownAgentRuntimeTypeError extends Error {
  constructor(public readonly value: string) {
    super(
      `Unknown agent runtime selector "${value}". Expected "pi" (or legacy "strands"/"flue") or "agentcore".`,
    );
    this.name = "UnknownAgentRuntimeTypeError";
  }
}

/**
 * THINK-311 (KTD-7): the Harness trial covers chat-originated turns only.
 * Wakeup, retry, eval, and skill-run dispatch of a harness-flagged agent
 * is a declared explicit failure, never a silent Pi run.
 */
export class HarnessChatDispatchOnlyError extends Error {
  constructor(public readonly channel: string) {
    super(
      `Agent runtime "agentcore" is trial-scoped to chat dispatch; ${channel} dispatch is not supported.`,
    );
    this.name = "HarnessChatDispatchOnlyError";
  }
}

// Every value the GraphQL write path has ever accepted (see
// parseAgentRuntimeInput) plus empty string; all run Pi today.
const LEGACY_PI_RUNTIME_VALUES = new Set(["pi", "strands", "flue", ""]);

export function normalizeAgentRuntimeType(value: unknown): AgentRuntimeType {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  // `harness` was persisted by the dev proof. Keep it as a read alias while
  // returning the canonical application identifier for every caller.
  if (normalized === "agentcore" || normalized === "harness")
    return "agentcore";
  if (LEGACY_PI_RUNTIME_VALUES.has(normalized)) return "pi";
  throw new UnknownAgentRuntimeTypeError(String(value));
}

export function resolveRuntimeFunctionName(
  runtimeType: AgentRuntimeType,
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      | "AGENTCORE_FUNCTION_NAME"
      | "AGENTCORE_PI_FUNCTION_NAME"
      | "HARNESS_RUNNER_FUNCTION_NAME"
    >
  > = process.env,
): string {
  const normalizedRuntimeType = normalizeAgentRuntimeType(runtimeType);

  if (normalizedRuntimeType === "agentcore") {
    // THINK-311 (KTD-4): the harness runner is the only function this
    // branch can resolve — the Pi function below is structurally
    // unreachable for a harness-flagged agent. An explicit env/config
    // override wins; otherwise the name derives from stage identity
    // (R1/R10: derivable thinkwork-<stage>-api-* names never ride env),
    // mirroring workspace-renderer. With no override and no STAGE this
    // throws and the turn fails setup loudly.
    const harnessFunctionName =
      env.HARNESS_RUNNER_FUNCTION_NAME ??
      getConfig("HARNESS_RUNNER_FUNCTION_NAME");
    if (harnessFunctionName) return harnessFunctionName;
    try {
      return deriveFunctionName("harness-runner");
    } catch {
      throw new RuntimeNotProvisionedError("agentcore");
    }
  }

  const functionName =
    env.AGENTCORE_PI_FUNCTION_NAME ?? getConfig("AGENTCORE_PI_FUNCTION_NAME");

  if (!functionName) {
    throw new RuntimeNotProvisionedError(normalizedRuntimeType);
  }

  return functionName;
}
