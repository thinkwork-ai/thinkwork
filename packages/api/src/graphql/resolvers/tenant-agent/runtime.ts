import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(
  value: unknown,
): "strands" | "pi" | "harness" {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "pi" || normalized === "flue")
    return "pi";
  // THINK-311: the Agent-configuration Runtime dropdown is the tenant-wide
  // Harness switch. While it is on, ALL of this agent's chat turns run on
  // the AWS Harness path and non-chat dispatch (wakeups, evals, skill
  // runs) fails loudly (trial is chat-only).
  if (normalized === "harness") return "harness";
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  // THINK-311: HARNESS is a first-class AgentRuntime enum value so the
  // Agent-configuration dropdown can select and display it.
  if (normalized === "harness") return "HARNESS";
  if (normalized === "pi" || normalized === "flue" || normalized === "strands")
    return "FLUE";
  return value.toUpperCase();
}
