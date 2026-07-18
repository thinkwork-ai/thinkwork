import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(
  value: unknown,
): "strands" | "pi" | "agentcore" {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "pi" || normalized === "flue")
    return "pi";
  // THINK-311: the Agent-configuration Runtime dropdown is the tenant-wide
  // AgentCore switch. While it is on, ALL of this agent's chat turns run
  // on the AWS AgentCore Harness path and non-chat dispatch (wakeups,
  // evals, skill runs) fails loudly (trial is chat-only). Internally the
  // `harness` remains a legacy read/input alias for rows created by the proof.
  // All new application state uses the product runtime identifier `agentcore`.
  if (normalized === "agentcore" || normalized === "harness")
    return "agentcore";
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  // THINK-311: AGENTCORE is a first-class AgentRuntime enum value so the
  // Agent-configuration dropdown can select and display it. Internal rows
  // `harness` is retained as a legacy read alias. The AWS implementation is
  // displayed as "AgentCore Harness", while the application token is agentcore.
  if (normalized === "harness" || normalized === "agentcore")
    return "AGENTCORE";
  if (normalized === "pi" || normalized === "flue" || normalized === "strands")
    return "FLUE";
  return value.toUpperCase();
}
