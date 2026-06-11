import { getConfig } from "@thinkwork/runtime-config";

export type AgentRuntimeType = "strands" | "pi";

export class RuntimeNotProvisionedError extends Error {
  constructor(public readonly runtimeType: AgentRuntimeType) {
    super("Pi runtime not yet provisioned in this stage.");
    this.name = "RuntimeNotProvisionedError";
  }
}

export function normalizeAgentRuntimeType(_value: unknown): AgentRuntimeType {
  return "pi";
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
