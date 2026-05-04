export type AgentRuntimeType = "strands" | "flue";

export class RuntimeNotProvisionedError extends Error {
  constructor(public readonly runtimeType: AgentRuntimeType) {
    super(
      runtimeType === "flue"
        ? "Flue runtime not yet provisioned in this stage."
        : "Strands runtime not provisioned in this stage.",
    );
    this.name = "RuntimeNotProvisionedError";
  }
}

export function normalizeAgentRuntimeType(value: unknown): AgentRuntimeType {
  return value === "flue" ? "flue" : "strands";
}

export function resolveRuntimeFunctionName(
  runtimeType: AgentRuntimeType,
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      "AGENTCORE_FUNCTION_NAME" | "AGENTCORE_FLUE_FUNCTION_NAME"
    >
  > = process.env,
): string {
  const functionName =
    runtimeType === "flue"
      ? env.AGENTCORE_FLUE_FUNCTION_NAME
      : env.AGENTCORE_FUNCTION_NAME;

  if (!functionName) {
    throw new RuntimeNotProvisionedError(runtimeType);
  }

  return functionName;
}
