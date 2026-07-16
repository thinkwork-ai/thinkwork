import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(
  value: unknown,
): "strands" | "pi" | "harness" {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "pi" || normalized === "flue")
    return "pi";
  // THINK-311: the Agent-configuration Runtime dropdown is the tenant-wide
  // AgentCore switch. While it is on, ALL of this agent's chat turns run
  // on the AWS AgentCore Harness path and non-chat dispatch (wakeups,
  // evals, skill runs) fails loudly (trial is chat-only). Internally the
  // runtime token stays "harness" (agents.runtime, thread_turns
  // runtime_type, the harness-runner Lambda).
  if (normalized === "agentcore" || normalized === "harness") return "harness";
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  // THINK-311: AGENTCORE is a first-class AgentRuntime enum value so the
  // Agent-configuration dropdown can select and display it. Internal rows
  // store "harness" (the AWS feature is "AgentCore Harness").
  if (normalized === "harness" || normalized === "agentcore")
    return "AGENTCORE";
  if (normalized === "pi" || normalized === "flue" || normalized === "strands")
    return "FLUE";
  return value.toUpperCase();
}
