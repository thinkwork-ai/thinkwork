import { deriveFunctionName, getConfig } from "@thinkwork/runtime-config";

/**
 * THINK-324: the managed-harness runtime is retired — "pi" is the only
 * dispatchable runtime. "agentcore" survives in the union solely so legacy
 * readers (historical thread_turns rows, old thread pins) type-check while
 * they normalize to Pi; nothing may dispatch it.
 */
export type AgentRuntimeType = "strands" | "pi" | "agentcore";

export class RuntimeNotProvisionedError extends Error {
  constructor(public readonly runtimeType: AgentRuntimeType) {
    super("Pi runtime not yet provisioned in this stage.");
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
      `Unknown agent runtime selector "${value}". Expected "pi" (or legacy "strands"/"flue"/"agentcore").`,
    );
    this.name = "UnknownAgentRuntimeTypeError";
  }
}

// Every value the GraphQL write path has ever accepted (see
// parseAgentRuntimeInput) plus empty string; all run Pi today.
const LEGACY_PI_RUNTIME_VALUES = new Set(["pi", "strands", "flue", ""]);

export function normalizeAgentRuntimeType(value: unknown): AgentRuntimeType {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  // THINK-324: the managed harness is retired. Legacy "agentcore"/"harness"
  // values (historical rows, stale thread pins, old tenant defaults)
  // normalize to Pi — the loud-failure rationale (R4) died with the trial.
  if (normalized === "agentcore" || normalized === "harness") return "pi";
  if (LEGACY_PI_RUNTIME_VALUES.has(normalized)) return "pi";
  throw new UnknownAgentRuntimeTypeError(String(value));
}

export function resolveRuntimeFunctionName(
  runtimeType: AgentRuntimeType,
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      "AGENTCORE_FUNCTION_NAME" | "AGENTCORE_PI_FUNCTION_NAME"
    >
  > = process.env,
): string {
  const normalizedRuntimeType = normalizeAgentRuntimeType(runtimeType);

  const functionName =
    env.AGENTCORE_PI_FUNCTION_NAME ?? getConfig("AGENTCORE_PI_FUNCTION_NAME");

  if (!functionName) {
    throw new RuntimeNotProvisionedError(normalizedRuntimeType);
  }

  return functionName;
}
