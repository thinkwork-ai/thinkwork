export type AgentRuntimeType = "strands" | "pi";

export class RuntimeNotProvisionedError extends Error {
  constructor(public readonly runtimeType: AgentRuntimeType) {
    super(
      runtimeType === "pi"
        ? "Pi runtime not yet provisioned in this stage."
        : "Strands runtime not provisioned in this stage.",
    );
    this.name = "RuntimeNotProvisionedError";
  }
}

export function normalizeAgentRuntimeType(value: unknown): AgentRuntimeType {
  return value === "pi" ? "pi" : "strands";
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
  const functionName =
    runtimeType === "pi"
      ? env.AGENTCORE_PI_FUNCTION_NAME
      : env.AGENTCORE_FUNCTION_NAME;

  if (!functionName) {
    throw new RuntimeNotProvisionedError(runtimeType);
  }

  return functionName;
}
